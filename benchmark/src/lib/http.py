from __future__ import annotations

import json
from typing import Any

import httpx

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


def request(method: str, url: str, *, timeout: float = HTTP_TIMEOUT_SECONDS, **kwargs: Any) -> tuple[int, bytes]:
    response = httpx.request(method, url, timeout=timeout, **kwargs)
    return response.status_code, response.content


async def arequest(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    **kwargs: Any,
) -> tuple[int, bytes]:
    response = await client.request(method, url, **kwargs)
    return response.status_code, response.content


def parse_json(body: bytes) -> dict[str, Any]:
    try:
        return json.loads(body)
    except json.JSONDecodeError as err:
        msg = f"expected JSON response, got: {body[:RESPONSE_SNIPPET_BYTES]!r}"
        raise FlowError(msg) from err
