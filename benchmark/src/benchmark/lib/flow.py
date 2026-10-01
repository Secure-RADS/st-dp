from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pathlib import Path

POLL_INTERVAL_SECONDS = 5.0
# 5M secure-rads: PDM page + decrypt can exceed 1h; keep the client waiting.
POLL_TIMEOUT_SECONDS = 7200.0
HTTP_TIMEOUT_SECONDS = 7200.0

HTTP_OK = 200
HTTP_ACCEPTED = 202
HTTP_NO_CONTENT = 204

RESPONSE_SNIPPET_BYTES = 200


class FlowError(RuntimeError):
    pass


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


def upload_rads(registry_url: str, algorithm_id: str, tar_path: Path) -> None:
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


def register_rads(registry_url: str, algorithm_id: str) -> None:
    status, body = _request(
        "POST",
        f"{registry_url}/register",
        data=json.dumps({"algorithmId": algorithm_id}).encode(),
        headers={"Content-Type": "application/json"},
    )
    _require(status, HTTP_OK, "/register", body)


def upload_secure(registry_url: str, algorithm_id: str, tar_path: Path) -> None:
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

    status, body = _request(
        "POST",
        f"{registry_url}/upload",
        data=head + tar_path.read_bytes() + tail,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    _require(status, HTTP_OK, "/upload", body)


def execute(execution_url: str, algorithm_id: str, size: int | None = None) -> tuple[str, str, str]:
    payload: dict[str, object] = {"algorithmId": algorithm_id}
    if size is not None:
        payload["size"] = size
    status, body = _request(
        "POST",
        f"{execution_url}/run",
        data=json.dumps(payload).encode(),
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
            return run_id, result.get("status", ""), output
        time.sleep(POLL_INTERVAL_SECONDS)

    msg = f"timed out after {POLL_TIMEOUT_SECONDS:.0f}s waiting for runId={run_id}"
    raise FlowError(msg)
