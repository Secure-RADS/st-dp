from __future__ import annotations

import base64
import json
import logging
import os
from datetime import UTC, datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlsplit

from nitro_attestation import vsock

DEFAULT_ADDR = ":8080"
DEFAULT_ENCLAVE_CID = 16
DEFAULT_ENCLAVE_PORT = 5000
ENCLAVE_TIMEOUT_SECONDS = 10.0

logger = logging.getLogger("nitro_attestation.relay")


class EnclaveError(Exception):
    """Raised when the enclave relay request fails."""


def _now() -> str:
    """Return the current time as an RFC 3339 string."""
    return datetime.now(tz=UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_attestation(cid: int, port: int, nonce: str) -> bytes:
    """Fetch a raw attestation document from the enclave over vsock.

    Args:
        cid: Enclave context id.
        port: Enclave vsock port.
        nonce: base64url nonce forwarded to the enclave.

    Returns:
        The raw attestation document bytes.

    Raises:
        EnclaveError: If the enclave is unreachable or returns an error.
    """
    try:
        conn = vsock.dial(cid, port, timeout=ENCLAVE_TIMEOUT_SECONDS)
    except OSError as exc:
        msg = f"connect to enclave over vsock: {exc}"
        raise EnclaveError(msg) from exc

    try:
        conn.sendall((json.dumps({"nonce": nonce}) + "\n").encode("utf-8"))
        line = conn.makefile("r", encoding="utf-8").readline()
    finally:
        conn.close()

    if not line:
        msg = "enclave closed the connection without a response"
        raise EnclaveError(msg)
    envelope = json.loads(line)
    if envelope.get("status") != "ok":
        msg = f"enclave returned error: {envelope.get('message', '')}"
        raise EnclaveError(msg)
    document = envelope.get("attestation_document", "")
    if not document:
        msg = "enclave response did not include attestation_document"
        raise EnclaveError(msg)
    return base64.b64decode(document)


class _RelayHandler(BaseHTTPRequestHandler):
    """HTTP handler implementing the relay routes."""

    enclave_cid: int = DEFAULT_ENCLAVE_CID
    enclave_port: int = DEFAULT_ENCLAVE_PORT

    def log_message(self, fmt: str, *args: Any) -> None:
        """Route the default access log through the module logger."""
        logger.info("%s - %s", self.address_string(), fmt % args)

    def _write_json(self, status: HTTPStatus, value: dict[str, Any]) -> None:
        """Serialize ``value`` as a JSON HTTP response."""
        body = json.dumps(value).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        """Handle GET routes: /healthz, /attestation, and the catch-all."""
        path = urlsplit(self.path).path
        if path == "/healthz":
            self._write_json(
                HTTPStatus.OK,
                {"status": "ok", "message": "ec2 http server is healthy", "time": _now()},
            )
        elif path == "/attestation":
            self._handle_attestation()
        else:
            self._handle_request()

    def do_POST(self) -> None:
        """Handle POST to the catch-all route."""
        self._handle_request()

    def _handle_request(self) -> None:
        """Acknowledge a generic request, mirroring the Go relay."""
        self._write_json(
            HTTPStatus.OK,
            {"status": "ok", "message": "request received by ec2 http server", "time": _now()},
        )

    def _handle_attestation(self) -> None:
        """Relay an attestation request to the enclave and return the result."""
        query = parse_qs(urlsplit(self.path).query)
        nonce = query.get("nonce", [""])[0]
        try:
            raw_doc = fetch_attestation(self.enclave_cid, self.enclave_port, nonce)
        except EnclaveError as exc:
            self._write_json(
                HTTPStatus.BAD_GATEWAY,
                {"status": "error", "message": str(exc), "time": _now()},
            )
            return

        self._write_json(
            HTTPStatus.OK,
            {
                "status": "ok",
                "message": "attestation document returned by enclave relay",
                "attestation_document": base64.b64encode(raw_doc).decode("ascii"),
                "encoding": "base64",
                "time": _now(),
            },
        )


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


def _parse_addr(addr: str) -> tuple[str, int]:
    """Parse a ``host:port`` (or ``:port``) bind address."""
    host, _, port = addr.rpartition(":")
    return host, int(port)


def main() -> None:
    """Run the public HTTP relay server."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    host, port = _parse_addr(os.environ.get("HTTP_ADDR", DEFAULT_ADDR))

    _RelayHandler.enclave_cid = _env_uint("ENCLAVE_CID", DEFAULT_ENCLAVE_CID)
    _RelayHandler.enclave_port = _env_uint("ENCLAVE_PORT", DEFAULT_ENCLAVE_PORT)

    server = ThreadingHTTPServer((host, port), _RelayHandler)
    server.timeout = ENCLAVE_TIMEOUT_SECONDS
    logger.info("starting public HTTP server addr=%s:%d", host or "0.0.0.0", port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("server stopping")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
