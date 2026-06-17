from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import threading
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from nitro_attestation import vsock
from nitro_attestation.nsm import Attester, NsmError, get_attester

if TYPE_CHECKING:
    import socket

DEFAULT_VSOCK_PORT = 5000
CONNECTION_TIMEOUT_SECONDS = 10.0

logger = logging.getLogger("nitro_attestation.enclave")


def _now() -> str:
    """Return the current time as an RFC 3339 string."""
    return datetime.now(tz=UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _read_request(conn: socket.socket) -> dict[str, str]:
    """Read one newline-delimited JSON request object from ``conn``."""
    reader = conn.makefile("r", encoding="utf-8")
    line = reader.readline()
    if not line:
        msg = "empty request"
        raise ValueError(msg)
    return json.loads(line)


def _write_response(conn: socket.socket, value: dict[str, str]) -> None:
    """Write one newline-delimited JSON response object to ``conn``."""
    conn.sendall((json.dumps(value) + "\n").encode("utf-8"))


def handle_connection(conn: socket.socket, provider: Attester) -> None:
    """Serve a single attestation request on ``conn``.

    Args:
        conn: Accepted vsock connection.
        provider: NSM attester used to produce the document.
    """
    conn.settimeout(CONNECTION_TIMEOUT_SECONDS)
    request = _read_request(conn)
    nonce_b64 = request.get("nonce", "")

    try:
        nonce = base64.urlsafe_b64decode(_pad_base64url(nonce_b64))
    except (binascii.Error, ValueError) as exc:
        _write_response(conn, {"status": "error", "message": f"decode base64url nonce: {exc}", "time": _now()})
        return

    try:
        raw_doc = provider.attestation_document(nonce)
    except NsmError as exc:
        _write_response(conn, {"status": "error", "message": str(exc), "time": _now()})
        return

    _write_response(
        conn,
        {
            "status": "ok",
            "message": "attestation document returned by nitro enclave",
            "attestation_document": base64.b64encode(raw_doc).decode("ascii"),
            "encoding": "base64",
            "nonce": nonce_b64,
            "time": _now(),
        },
    )


def _pad_base64url(value: str) -> str:
    """Restore base64url padding stripped by the raw url encoding."""
    return value + "=" * (-len(value) % 4)


def _env_uint(name: str, fallback: int) -> int:
    """Read a non-negative integer environment variable with a fallback."""
    value = os.environ.get(name, "")
    if not value:
        return fallback
    try:
        return int(value)
    except ValueError:
        logger.warning("invalid int env value, using fallback name=%s value=%s fallback=%d", name, value, fallback)
        return fallback


def main() -> None:
    """Run the enclave vsock attestation server loop."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    port = _env_uint("VSOCK_PORT", DEFAULT_VSOCK_PORT)

    listener = vsock.listen(port)
    provider = get_attester()
    logger.info("starting enclave attestation vsock server port=%d", port)

    try:
        while True:
            conn, _ = listener.accept()
            thread = threading.Thread(target=_serve, args=(conn, provider), daemon=True)
            thread.start()
    finally:
        listener.close()


def _serve(conn: socket.socket, provider: Attester) -> None:
    """Handle one connection and always close it."""
    try:
        handle_connection(conn, provider)
    except (OSError, ValueError, json.JSONDecodeError):
        logger.exception("handle attestation request")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
