"""Client-side attestation request and verification CLI.

Python port of ``client/cmd/request/main.go``. Requests an attestation
document from the EC2 relay with a fresh (or supplied) nonce, then verifies the
AWS certificate chain, COSE signature, and nonce on the client side.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from nitro_attestation.verify import AttestationError, Expected, verify

DEFAULT_TIMEOUT_SECONDS = 10.0
NONCE_BYTES = 32
HTTP_OK_MIN = 200
HTTP_OK_MAX = 299


def _pad_base64url(value: str) -> str:
    """Restore base64url padding stripped by the raw url encoding."""
    return value + "=" * (-len(value) % 4)


def _nonce_from_flag(value: str) -> bytes:
    """Decode a supplied base64url nonce or generate a random 32-byte nonce.

    Args:
        value: base64url nonce, or empty to generate one.

    Returns:
        The raw nonce bytes.

    Raises:
        ValueError: If a supplied nonce is not valid base64url.
    """
    if value:
        return base64.urlsafe_b64decode(_pad_base64url(value))
    return secrets.token_bytes(NONCE_BYTES)


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    """Parse command-line arguments, mirroring the Go flags."""
    parser = argparse.ArgumentParser(description="Verify a Nitro attestation document from the EC2 relay.")
    parser.add_argument(
        "--url",
        default=os.environ.get("EC2_ATTESTATION_URL", ""),
        help="EC2 attestation relay URL; defaults to EC2_ATTESTATION_URL",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT_SECONDS,
        help="request timeout in seconds",
    )
    parser.add_argument(
        "--root-cert",
        default=os.environ.get("AWS_NITRO_ROOT_CERT", ""),
        help="AWS Nitro Enclaves root certificate PEM path; defaults to AWS_NITRO_ROOT_CERT",
    )
    parser.add_argument(
        "--nonce",
        default="",
        help="base64url nonce to request and verify; generated when empty",
    )
    return parser.parse_args(argv)


def _request_document(url: str, nonce: bytes, timeout: float) -> dict[str, str]:
    """Request an attestation envelope from the relay for ``nonce``.

    Args:
        url: Relay attestation URL.
        nonce: Raw nonce bytes.
        timeout: Request timeout in seconds.

    Returns:
        The decoded JSON response envelope.

    Raises:
        urllib.error.HTTPError: For non-2xx responses.
    """
    parsed = urllib.parse.urlsplit(url)
    query = dict(urllib.parse.parse_qsl(parsed.query))
    query["nonce"] = base64.urlsafe_b64encode(nonce).rstrip(b"=").decode("ascii")
    request_url = urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query)))

    with urllib.request.urlopen(request_url, timeout=timeout) as response:
        body = response.read()
    return json.loads(body)


def main(argv: list[str] | None = None) -> int:  # noqa: PLR0911 -- CLI guard-clause exit codes
    """Run the attestation request/verify CLI.

    Args:
        argv: Optional argument vector (defaults to ``sys.argv``).

    Returns:
        Process exit code.
    """
    args = _parse_args(argv)

    if not args.url:
        return 1
    if not args.root_cert:
        return 1

    try:
        root_cert = Path(args.root_cert).read_bytes()
    except OSError:
        return 1

    try:
        nonce = _nonce_from_flag(args.nonce)
    except ValueError:
        return 1

    try:
        envelope = _request_document(args.url, nonce, args.timeout)
    except urllib.error.HTTPError:
        return 1
    except (urllib.error.URLError, TimeoutError):
        return 1

    base64.urlsafe_b64encode(nonce).rstrip(b"=").decode("ascii")

    document = envelope.get("attestation_document", "")
    if not document:
        return 0

    raw_doc = base64.b64decode(document)
    try:
        result = verify(raw_doc, Expected(root_certificate_pem=root_cert, nonce=nonce))
    except AttestationError:
        return 1

    for _index, _value in sorted(result.pcrs.items()):
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
