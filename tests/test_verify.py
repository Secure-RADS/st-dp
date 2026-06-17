from __future__ import annotations

from datetime import UTC, datetime, timedelta

import cbor2
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.serialization import Encoding
from cryptography.x509.oid import NameOID

from nitro_attestation.verify import COSE_SIGN1_TAG, AttestationError, Expected, verify

P384_COORD_BYTES = 48
COSE_ALG_ES384 = -35
EXPECTED_CHAIN_LENGTH = 2


def _name(common_name: str) -> x509.Name:
    return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, common_name)])


def _make_cert(
    subject: str,
    subject_key: ec.EllipticCurvePrivateKey,
    issuer: str,
    issuer_key: ec.EllipticCurvePrivateKey,
    *,
    is_ca: bool,
) -> x509.Certificate:
    now = datetime.now(tz=UTC)
    return (
        x509.CertificateBuilder()
        .subject_name(_name(subject))
        .issuer_name(_name(issuer))
        .public_key(subject_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=1))
        .add_extension(x509.BasicConstraints(ca=is_ca, path_length=None), critical=True)
        .sign(issuer_key, hashes.SHA384())
    )


def _raw_signature(der_signature: bytes) -> bytes:
    r, s = decode_dss_signature(der_signature)
    return r.to_bytes(P384_COORD_BYTES, "big") + s.to_bytes(P384_COORD_BYTES, "big")


def _build_document(nonce: bytes) -> tuple[bytes, bytes]:
    """Build a signed COSE_Sign1 attestation document.

    Returns:
        Tuple of (raw COSE_Sign1 bytes, root certificate PEM).
    """
    root_key = ec.generate_private_key(ec.SECP384R1())
    leaf_key = ec.generate_private_key(ec.SECP384R1())

    root_cert = _make_cert("nitro-test-root", root_key, "nitro-test-root", root_key, is_ca=True)
    leaf_cert = _make_cert("nitro-test-leaf", leaf_key, "nitro-test-root", root_key, is_ca=False)

    document = {
        "module_id": "i-0123456789abcdef-enc0",
        "timestamp": int(datetime.now(tz=UTC).timestamp() * 1000),
        "digest": "SHA384",
        "pcrs": {0: b"\x00" * 48, 1: b"\x11" * 48},
        "certificate": leaf_cert.public_bytes(encoding=Encoding.DER),
        "cabundle": [root_cert.public_bytes(encoding=Encoding.DER)],
        "public_key": None,
        "user_data": None,
        "nonce": nonce,
    }
    payload = cbor2.dumps(document)
    protected = cbor2.dumps({1: COSE_ALG_ES384})
    sig_structure = cbor2.dumps(["Signature1", protected, b"", payload])
    der_signature = leaf_key.sign(sig_structure, ec.ECDSA(hashes.SHA384()))
    cose = cbor2.dumps(cbor2.CBORTag(COSE_SIGN1_TAG, [protected, {}, payload, _raw_signature(der_signature)]))

    root_pem = root_cert.public_bytes(encoding=Encoding.PEM)
    return cose, root_pem


def test_verify_accepts_valid_document() -> None:
    nonce = b"client-supplied-nonce"
    cose, root_pem = _build_document(nonce)

    result = verify(cose, Expected(root_certificate_pem=root_pem, nonce=nonce))

    assert result.nonce_verified is True
    assert result.module_id == "i-0123456789abcdef-enc0"
    assert result.digest == "SHA384"
    assert result.pcrs[0] == b"\x00" * 48
    assert len(result.certificate_chain) == EXPECTED_CHAIN_LENGTH


def test_verify_rejects_wrong_nonce() -> None:
    cose, root_pem = _build_document(b"real-nonce")

    with pytest.raises(AttestationError, match="nonce does not match"):
        verify(cose, Expected(root_certificate_pem=root_pem, nonce=b"wrong-nonce"))


def test_verify_requires_root_certificate() -> None:
    cose, _ = _build_document(b"n")

    with pytest.raises(AttestationError, match="root certificate is required"):
        verify(cose, Expected(root_certificate_pem=b""))


def test_verify_rejects_untrusted_root() -> None:
    cose, _ = _build_document(b"n")
    other_root_pem = _build_document(b"n")[1]

    with pytest.raises(AttestationError, match="terminate at the pinned AWS root"):
        verify(cose, Expected(root_certificate_pem=other_root_pem))
