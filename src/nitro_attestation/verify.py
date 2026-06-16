"""Client-side AWS Nitro Enclaves attestation document verification.

Python port of ``client/internal/attestation/verify.go``. Verifies the AWS
certificate chain, the COSE_Sign1 signature, and the expected nonce, public
key, user data, and PCR values carried by a Nitro attestation document.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import cbor2
from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, utils

if TYPE_CHECKING:
    from cryptography.hazmat.primitives.hashes import HashAlgorithm

# COSE constants (RFC 8152).
COSE_SIGN1_TAG = 18
COSE_ALG_HEADER_KEY = 1
COSE_ALG_ES256 = -7
COSE_ALG_ES384 = -35
COSE_ALG_ES512 = -36

_COSE_ALG_TO_HASH: dict[int, type[HashAlgorithm]] = {
    COSE_ALG_ES256: hashes.SHA256,
    COSE_ALG_ES384: hashes.SHA384,
    COSE_ALG_ES512: hashes.SHA512,
}

# An NSM nonce is capped by the protocol; the document fields are bounded too.
NSM_MAX_NONCE_BYTES = 512


class AttestationError(Exception):
    """Raised when an attestation document fails verification."""


@dataclass(slots=True)
class Expected:
    """Values the caller expects the attestation document to satisfy.

    Attributes:
        root_certificate_pem: AWS Nitro Enclaves root certificate (PEM or DER).
        nonce: Expected nonce; ``None`` skips the nonce check.
        public_key: Expected enclave public key; ``None`` skips the check.
        user_data: Expected user data; ``None`` skips the check.
        pcrs: Mapping of PCR index to expected value; missing indexes skip.
        now: Validation time for certificate validity; defaults to now (UTC).
    """

    root_certificate_pem: bytes
    nonce: bytes | None = None
    public_key: bytes | None = None
    user_data: bytes | None = None
    pcrs: dict[int, bytes] = field(default_factory=dict)
    now: datetime | None = None


@dataclass(slots=True)
class Result:
    """Outcome of a successful attestation verification."""

    module_id: str
    digest: str
    timestamp: datetime
    pcrs: dict[int, bytes]
    certificate: x509.Certificate
    certificate_chain: list[x509.Certificate]
    root_fingerprint: str
    nonce_verified: bool
    public_key_verified: bool
    user_data_verified: bool
    pcrs_verified: bool


@dataclass(slots=True)
class _CoseSign1:
    """Decoded COSE_Sign1 structure."""

    protected: bytes
    payload: bytes
    signature: bytes


@dataclass(slots=True)
class _AttestationDocument:
    """Decoded Nitro attestation document payload."""

    module_id: str
    timestamp: int
    digest: str
    pcrs: dict[int, bytes]
    certificate: bytes
    cabundle: list[bytes]
    public_key: bytes | None
    user_data: bytes | None
    nonce: bytes | None


def verify(raw: bytes, expected: Expected) -> Result:
    """Verify a raw Nitro attestation document against expected values.

    Args:
        raw: CBOR-encoded COSE_Sign1 attestation document from the enclave.
        expected: Pinned root certificate and optional expected fields.

    Returns:
        The verified attestation result.

    Raises:
        AttestationError: If any verification step fails.
    """
    if not expected.root_certificate_pem:
        msg = "root certificate is required"
        raise AttestationError(msg)

    cose = _decode_cose_sign1(raw)
    doc = _decode_document(cose.payload)
    if not doc.certificate:
        msg = "attestation document does not contain signing certificate"
        raise AttestationError(msg)

    cert, chain, root_fingerprint = _verify_certificate_chain(doc, expected)
    _verify_cose_signature(cose, cert)
    _verify_expected_fields(doc, expected)

    return Result(
        module_id=doc.module_id,
        digest=doc.digest,
        timestamp=datetime.fromtimestamp(doc.timestamp / 1000, tz=UTC),
        pcrs=doc.pcrs,
        certificate=cert,
        certificate_chain=chain,
        root_fingerprint=root_fingerprint,
        nonce_verified=expected.nonce is None or expected.nonce == doc.nonce,
        public_key_verified=expected.public_key is None or expected.public_key == doc.public_key,
        user_data_verified=expected.user_data is None or expected.user_data == doc.user_data,
        pcrs_verified=True,
    )


def _decode_cose_sign1(raw: bytes) -> _CoseSign1:
    """Decode a possibly tagged COSE_Sign1 message into its components."""
    decoded = cbor2.loads(raw)
    if isinstance(decoded, cbor2.CBORTag):
        if decoded.tag != COSE_SIGN1_TAG:
            msg = f"unexpected CBOR tag {decoded.tag}, want COSE_Sign1 tag {COSE_SIGN1_TAG}"
            raise AttestationError(msg)
        parts = decoded.value
    else:
        parts = decoded

    if not isinstance(parts, (list, tuple)) or len(parts) != 4:  # noqa: PLR2004
        got = len(parts) if isinstance(parts, (list, tuple)) else "non-array"
        msg = f"COSE_Sign1 must have 4 elements, got {got}"
        raise AttestationError(msg)

    protected, _unprotected, payload, signature = parts
    if not isinstance(protected, bytes) or not protected:
        msg = "COSE_Sign1 protected headers are empty"
        raise AttestationError(msg)
    if not isinstance(payload, bytes) or not payload:
        msg = "COSE_Sign1 payload is empty"
        raise AttestationError(msg)
    if not isinstance(signature, bytes) or not signature:
        msg = "COSE_Sign1 signature is empty"
        raise AttestationError(msg)
    return _CoseSign1(protected=protected, payload=payload, signature=signature)


def _decode_document(payload: bytes) -> _AttestationDocument:
    """Decode the CBOR attestation document payload."""
    try:
        raw_doc = cbor2.loads(payload)
    except cbor2.CBORDecodeError as exc:
        msg = f"decode attestation document: {exc}"
        raise AttestationError(msg) from exc
    if not isinstance(raw_doc, dict):
        msg = "attestation document payload is not a map"
        raise AttestationError(msg)

    return _AttestationDocument(
        module_id=raw_doc.get("module_id", ""),
        timestamp=raw_doc.get("timestamp", 0),
        digest=raw_doc.get("digest", ""),
        pcrs={int(index): value for index, value in (raw_doc.get("pcrs") or {}).items()},
        certificate=raw_doc.get("certificate", b""),
        cabundle=list(raw_doc.get("cabundle") or []),
        public_key=raw_doc.get("public_key"),
        user_data=raw_doc.get("user_data"),
        nonce=raw_doc.get("nonce"),
    )


def _load_certificate(data: bytes) -> x509.Certificate:
    """Load a certificate from PEM if possible, otherwise from DER."""
    if b"-----BEGIN" in data:
        return x509.load_pem_x509_certificate(data)
    return x509.load_der_x509_certificate(data)


def _verify_certificate_chain(
    doc: _AttestationDocument,
    expected: Expected,
) -> tuple[x509.Certificate, list[x509.Certificate], str]:
    """Verify the attestation certificate chains to the pinned AWS root.

    The AWS ``cabundle`` is ordered root-first, so the verification chain is the
    leaf certificate followed by the reversed bundle, ending at the root.
    """
    try:
        root = _load_certificate(expected.root_certificate_pem)
    except ValueError as exc:
        msg = f"parse root certificate: {exc}"
        raise AttestationError(msg) from exc
    try:
        leaf = x509.load_der_x509_certificate(doc.certificate)
    except ValueError as exc:
        msg = f"parse attestation certificate: {exc}"
        raise AttestationError(msg) from exc

    bundle: list[x509.Certificate] = []
    for der in doc.cabundle:
        try:
            bundle.append(x509.load_der_x509_certificate(der))
        except ValueError as exc:
            msg = f"parse CA bundle certificate: {exc}"
            raise AttestationError(msg) from exc

    chain = [leaf, *reversed(bundle)]
    now = expected.now or datetime.now(tz=UTC)

    root_fp = root.fingerprint(hashes.SHA256())
    if chain[-1].fingerprint(hashes.SHA256()) != root_fp:
        msg = "attestation certificate chain does not terminate at the pinned AWS root"
        raise AttestationError(msg)

    for child, parent in itertools.pairwise(chain):
        _check_validity(child, now)
        _check_signed_by(child, parent)
    _check_validity(chain[-1], now)

    return leaf, chain, root_fp.hex().upper()


def _check_validity(cert: x509.Certificate, now: datetime) -> None:
    """Ensure ``now`` falls within the certificate validity window."""
    if now < cert.not_valid_before_utc or now > cert.not_valid_after_utc:
        msg = f"certificate {cert.subject.rfc4514_string()} is not valid at {now.isoformat()}"
        raise AttestationError(msg)


def _check_signed_by(child: x509.Certificate, parent: x509.Certificate) -> None:
    """Verify ``child`` was signed by ``parent`` (ECDSA only, as Nitro uses)."""
    public_key = parent.public_key()
    if not isinstance(public_key, ec.EllipticCurvePublicKey):
        msg = "attestation chain contains a non-ECDSA certificate"
        raise AttestationError(msg)
    if child.signature_hash_algorithm is None:
        msg = "certificate is missing a signature hash algorithm"
        raise AttestationError(msg)
    try:
        public_key.verify(
            child.signature,
            child.tbs_certificate_bytes,
            ec.ECDSA(child.signature_hash_algorithm),
        )
    except InvalidSignature as exc:
        msg = "verify attestation certificate chain: invalid signature"
        raise AttestationError(msg) from exc


def _verify_cose_signature(msg: _CoseSign1, cert: x509.Certificate) -> None:
    """Verify the COSE_Sign1 signature using the leaf certificate key."""
    hash_factory = _signature_hash(msg.protected)

    public_key = cert.public_key()
    if not isinstance(public_key, ec.EllipticCurvePublicKey):
        msg_0 = "attestation certificate does not contain an ECDSA public key"
        raise AttestationError(msg_0)

    sig_structure = cbor2.dumps(["Signature1", msg.protected, b"", msg.payload])

    if len(msg.signature) % 2 != 0:
        msg_0 = f"invalid ECDSA signature length {len(msg.signature)}"
        raise AttestationError(msg_0)
    half = len(msg.signature) // 2
    r = int.from_bytes(msg.signature[:half], "big")
    s = int.from_bytes(msg.signature[half:], "big")
    der_signature = utils.encode_dss_signature(r, s)

    try:
        public_key.verify(der_signature, sig_structure, ec.ECDSA(hash_factory()))
    except InvalidSignature as exc:
        msg_0 = "verify COSE signature"
        raise AttestationError(msg_0) from exc


def _signature_hash(protected: bytes) -> type[HashAlgorithm]:
    """Read the COSE algorithm from the protected headers and map to a hash."""
    headers = cbor2.loads(protected)
    if not isinstance(headers, dict) or COSE_ALG_HEADER_KEY not in headers:
        msg = "COSE protected headers do not include algorithm"
        raise AttestationError(msg)
    alg = headers[COSE_ALG_HEADER_KEY]
    hash_factory = _COSE_ALG_TO_HASH.get(alg)
    if hash_factory is None:
        msg = f"unsupported COSE algorithm {alg}"
        raise AttestationError(msg)
    return hash_factory


def _verify_expected_fields(doc: _AttestationDocument, expected: Expected) -> None:
    """Enforce the expected nonce, public key, user data, and PCR values."""
    if expected.nonce is not None and expected.nonce != doc.nonce:
        msg = "attestation nonce does not match expected nonce"
        raise AttestationError(msg)
    if expected.public_key is not None and expected.public_key != doc.public_key:
        msg = "attestation public_key does not match expected value"
        raise AttestationError(msg)
    if expected.user_data is not None and expected.user_data != doc.user_data:
        msg = "attestation user_data does not match expected value"
        raise AttestationError(msg)
    for index, want in expected.pcrs.items():
        got = doc.pcrs.get(index)
        if got is None:
            msg = f"attestation PCR{index} is missing"
            raise AttestationError(msg)
        if want != got:
            msg = f"attestation PCR{index} does not match expected value"
            raise AttestationError(msg)
