from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

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


def require(response_status: int, expected: int | tuple[int, ...], context: str, body: bytes) -> None:
    if response_status in ((expected,) if isinstance(expected, int) else expected):
        return
    snippet = body[:RESPONSE_SNIPPET_BYTES]
    msg = f"{context} returned {response_status}: {snippet!r}"
    raise FlowError(msg)


def request(
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


def parse_json(body: bytes) -> dict[str, Any]:
    try:
        return json.loads(body)
    except json.JSONDecodeError as err:
        msg = f"expected JSON response, got: {body[:RESPONSE_SNIPPET_BYTES]!r}"
        raise FlowError(msg) from err
