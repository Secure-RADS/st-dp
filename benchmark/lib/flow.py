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
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

POLL_INTERVAL_SECONDS = 5.0
POLL_TIMEOUT_SECONDS = 900.0
HTTP_TIMEOUT_SECONDS = 900.0


class FlowError(RuntimeError):
    pass


@dataclass
class StageTiming:
    upload_seconds: float | None = None
    register_seconds: float | None = None
    execute_seconds: float | None = None
    total_seconds: float | None = None
    run_id: str | None = None
    status: str | None = None
    output: str | None = None
    error: str | None = None
    events: list[dict[str, Any]] = field(default_factory=list)


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
        raise FlowError(f"expected JSON response, got: {body[:200]!r}") from err


def upload_rads(registry_url: str, algorithm_id: str, tar_path: Path) -> float:
    start = time.perf_counter()
    status, body = _request(
        "POST",
        f"{registry_url}/upload",
        data=json.dumps({"algorithmId": algorithm_id}).encode(),
        headers={"Content-Type": "application/json"},
    )
    if status != 200:
        raise FlowError(f"/upload returned {status}: {body[:200]!r}")

    upload_url = _json(body)["uploadUrl"]
    payload = tar_path.read_bytes()
    status, body = _request(
        "PUT",
        upload_url,
        data=payload,
        headers={"Content-Type": "application/x-tar"},
    )
    if status not in (200, 204):
        raise FlowError(f"S3 PUT returned {status}: {body[:200]!r}")
    return time.perf_counter() - start


def register_rads(registry_url: str, algorithm_id: str) -> float:
    start = time.perf_counter()
    status, body = _request(
        "POST",
        f"{registry_url}/register",
        data=json.dumps({"algorithmId": algorithm_id}).encode(),
        headers={"Content-Type": "application/json"},
    )
    if status != 200:
        raise FlowError(f"/register returned {status}: {body[:200]!r}")
    return time.perf_counter() - start


def upload_secure(registry_url: str, algorithm_id: str, tar_path: Path) -> float:
    boundary = "----benchmarkboundary7d9f3a"
    payload = tar_path.read_bytes()
    head = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="algorithmId"\r\n\r\n'
        f"{algorithm_id}\r\n"
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="image"; filename="{tar_path.name}"\r\n'
        f"Content-Type: application/x-tar\r\n\r\n"
    ).encode()
    tail = f"\r\n--{boundary}--\r\n".encode()
    body = head + payload + tail

    start = time.perf_counter()
    status, response = _request(
        "POST",
        f"{registry_url}/upload",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    if status != 200:
        raise FlowError(f"/upload returned {status}: {response[:200]!r}")
    return time.perf_counter() - start


def execute(execution_url: str, algorithm_id: str) -> tuple[float, str, str, str]:
    start = time.perf_counter()
    status, body = _request(
        "POST",
        f"{execution_url}/run",
        data=json.dumps({"algorithmId": algorithm_id}).encode(),
        headers={"Content-Type": "application/json"},
    )
    if status != 202:
        raise FlowError(f"/run returned {status}: {body[:200]!r}")

    run_id = _json(body)["runId"]
    deadline = time.time() + POLL_TIMEOUT_SECONDS
    while time.time() < deadline:
        status, result_body = _request("GET", f"{execution_url}/run/{run_id}")
        if status != 200:
            raise FlowError(f"/run/{run_id} returned {status}: {result_body[:200]!r}")
        result = _json(result_body)
        if result.get("status") != "pending":
            output = result.get("output", "") or ""
            return time.perf_counter() - start, run_id, result.get("status", ""), output
        time.sleep(POLL_INTERVAL_SECONDS)

    raise FlowError(f"timed out after {POLL_TIMEOUT_SECONDS:.0f}s waiting for runId={run_id}")


def fetch_events(log_url: str, algorithm_id: str, run_id: str | None = None) -> list[dict[str, Any]]:
    url = f"{log_url}/logs/{algorithm_id}"
    if run_id:
        url += f"?runId={run_id}"
    status, body = _request("GET", url)
    if status != 200:
        return []
    payload = _json(body)
    return payload if isinstance(payload, list) else []
