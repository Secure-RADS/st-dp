"""End-to-end flow clients for both trees, with per-stage wall-clock timing.

Both trees follow the same client-visible shape:
  rads:        POST /upload (presigned URL) -> PUT tar to S3 -> POST /register -> POST /run -> poll /run/{id}
  secure-rads: POST /upload (multipart; builds the EIF) ----/                 -> POST /run -> poll /run/{id}

Timing is client-observed: upload (including the S3 PUT / EIF build), register,
and execute-to-result, plus the total.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from pathlib import Path

POLL_INTERVAL_SECONDS = 5.0
POLL_TIMEOUT_SECONDS = 900.0
HTTP_TIMEOUT_SECONDS = 900.0

HTTP_OK = 200
HTTP_ACCEPTED = 202
HTTP_NO_CONTENT = 204

RESPONSE_SNIPPET_BYTES = 200


class FlowError(RuntimeError):
    """Raised when a flow step returns something other than its expected response."""


class StageTiming(BaseModel):
    """Client-observed durations for one flow, in seconds."""

    upload_seconds: float | None = None
    register_seconds: float | None = None
    execute_seconds: float | None = None
    total_seconds: float | None = None
    run_id: str | None = None
    status: str | None = None
    output: str | None = None
    error: str | None = None
    events: list[dict[str, Any]] = Field(default_factory=list)


def _require(response_status: int, expected: int | tuple[int, ...], context: str, body: bytes) -> None:
    if response_status in ((expected,) if isinstance(expected, int) else expected):
        return
    snippet = body[:RESPONSE_SNIPPET_BYTES]
    msg = f"{context} returned {response_status}: {snippet!r}"
    raise FlowError(msg)


def _request(
    method: str,
    url: str,
    *,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = HTTP_TIMEOUT_SECONDS,
) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=data, method=method)
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()


def _json(body: bytes) -> dict[str, Any]:
    try:
        return json.loads(body)
    except json.JSONDecodeError as err:
        msg = f"expected JSON response, got: {body[:RESPONSE_SNIPPET_BYTES]!r}"
        raise FlowError(msg) from err


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())


def post_event(log_url: str, event: dict[str, Any]) -> bool:
    """Best-effort stage record; a logging failure must not fail the sweep."""
    status, _ = _request(
        "POST",
        f"{log_url}/events",
        data=json.dumps(event).encode(),
        headers={"Content-Type": "application/json"},
    )
    return status in (HTTP_OK, HTTP_ACCEPTED)


def upload_rads(registry_url: str, algorithm_id: str, tar_path: Path) -> float:
    """Presign, PUT the tarball to S3, and register it. Returns the elapsed seconds."""
    start = time.perf_counter()
    status, body = _request(
        "POST",
        f"{registry_url}/upload",
        data=json.dumps({"algorithmId": algorithm_id}).encode(),
        headers={"Content-Type": "application/json"},
    )
    _require(status, HTTP_OK, "/upload", body)

    upload_url = _json(body)["uploadUrl"]
    status, body = _request(
        "PUT",
        upload_url,
        data=tar_path.read_bytes(),
        headers={"Content-Type": "application/x-tar"},
    )
    _require(status, (HTTP_OK, HTTP_NO_CONTENT), "S3 PUT", body)
    return time.perf_counter() - start


def register_rads(registry_url: str, algorithm_id: str) -> float:
    """Register the uploaded tarball. Returns the elapsed seconds."""
    start = time.perf_counter()
    status, body = _request(
        "POST",
        f"{registry_url}/register",
        data=json.dumps({"algorithmId": algorithm_id}).encode(),
        headers={"Content-Type": "application/json"},
    )
    _require(status, HTTP_OK, "/register", body)
    return time.perf_counter() - start


def upload_secure(registry_url: str, algorithm_id: str, tar_path: Path) -> float:
    """Multipart-upload the OCI tar, which builds and registers the EIF. Returns elapsed seconds."""
    boundary = "----benchmarkboundary7d9f3a"
    head = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="algorithmId"\r\n\r\n'
        f"{algorithm_id}\r\n"
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="image"; filename="{tar_path.name}"\r\n'
        f"Content-Type: application/x-tar\r\n\r\n"
    ).encode()
    tail = f"\r\n--{boundary}--\r\n".encode()

    start = time.perf_counter()
    status, body = _request(
        "POST",
        f"{registry_url}/upload",
        data=head + tar_path.read_bytes() + tail,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    _require(status, HTTP_OK, "/upload", body)
    return time.perf_counter() - start


def execute(execution_url: str, algorithm_id: str) -> tuple[float, str, str, str]:
    """Fire a run and poll to a terminal status. Returns (seconds, run_id, status, output)."""
    start = time.perf_counter()
    status, body = _request(
        "POST",
        f"{execution_url}/run",
        data=json.dumps({"algorithmId": algorithm_id}).encode(),
        headers={"Content-Type": "application/json"},
    )
    _require(status, HTTP_ACCEPTED, "/run", body)

    run_id = _json(body)["runId"]
    deadline = time.time() + POLL_TIMEOUT_SECONDS
    while time.time() < deadline:
        status, result_body = _request("GET", f"{execution_url}/run/{run_id}")
        _require(status, HTTP_OK, f"/run/{run_id}", result_body)
        result = _json(result_body)
        if result.get("status") != "pending":
            output = result.get("output", "") or ""
            return time.perf_counter() - start, run_id, result.get("status", ""), output
        time.sleep(POLL_INTERVAL_SECONDS)

    msg = f"timed out after {POLL_TIMEOUT_SECONDS:.0f}s waiting for runId={run_id}"
    raise FlowError(msg)


def fetch_events(log_url: str, algorithm_id: str, run_id: str | None = None) -> list[dict[str, Any]]:
    """Read an algorithm's timeline back from its log service."""
    url = f"{log_url}/logs/{algorithm_id}"
    if run_id:
        url += f"?runId={run_id}"
    status, body = _request("GET", url)
    if status != HTTP_OK:
        return []
    payload = _json(body)
    return payload if isinstance(payload, list) else []
