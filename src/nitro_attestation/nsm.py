from __future__ import annotations

import ctypes
import ctypes.util
from typing import Protocol

# Upper bound for an NSM attestation document, matching the AWS NSM API.
NSM_MAX_ATTESTATION_DOC_SIZE = 16 * 1024
# NSM caps the caller nonce at 512 bytes.
NSM_MAX_NONCE_BYTES = 512
ERROR_CODE_SUCCESS = 0


class NsmError(Exception):
    """Raised when NSM attestation document generation fails."""


class Attester(Protocol):
    """Produces a raw attestation document bound to a caller nonce."""

    def attestation_document(self, nonce: bytes) -> bytes:
        """Return a raw CBOR/COSE attestation document for ``nonce``."""
        ...


class _UnsupportedAttester:
    """Attester used when ``libnsm`` is unavailable (non-enclave hosts)."""

    def attestation_document(self, nonce: bytes) -> bytes:  # noqa: ARG002
        """Always fail: NSM is only reachable inside a Linux Nitro Enclave."""
        msg = "NSM attestation is only available inside linux nitro enclaves"
        raise NsmError(msg)


class _LibNsmAttester:
    """Attester backed by the AWS ``libnsm`` shared library."""

    def __init__(self, lib: ctypes.CDLL) -> None:
        """Bind the libnsm symbols and open an NSM session.

        Args:
            lib: Loaded ``libnsm`` shared library.

        Raises:
            NsmError: If the NSM device session cannot be opened.
        """
        self._lib = lib
        lib.nsm_lib_init.restype = ctypes.c_int32
        lib.nsm_lib_init.argtypes = []
        lib.nsm_lib_exit.restype = None
        lib.nsm_lib_exit.argtypes = [ctypes.c_int32]
        lib.nsm_get_attestation_doc.restype = ctypes.c_int
        lib.nsm_get_attestation_doc.argtypes = [
            ctypes.c_int32,  # fd
            ctypes.c_char_p,  # user_data
            ctypes.c_uint32,  # user_data_len
            ctypes.c_char_p,  # nonce
            ctypes.c_uint32,  # nonce_len
            ctypes.c_char_p,  # public_key
            ctypes.c_uint32,  # public_key_len
            ctypes.c_char_p,  # att_doc (out)
            ctypes.POINTER(ctypes.c_uint32),  # att_doc_len (in/out)
        ]
        self._fd = lib.nsm_lib_init()
        if self._fd < 0:
            msg = "open NSM session: nsm_lib_init failed"
            raise NsmError(msg)

    def attestation_document(self, nonce: bytes) -> bytes:
        """Request a fresh attestation document bound to ``nonce``.

        Args:
            nonce: Caller-supplied nonce (max 512 bytes).

        Returns:
            The raw attestation document bytes.

        Raises:
            NsmError: If the nonce is too large or NSM returns an error.
        """
        if len(nonce) > NSM_MAX_NONCE_BYTES:
            msg = f"nonce is {len(nonce)} bytes, max {NSM_MAX_NONCE_BYTES}"
            raise NsmError(msg)

        doc_buf = ctypes.create_string_buffer(NSM_MAX_ATTESTATION_DOC_SIZE)
        doc_len = ctypes.c_uint32(NSM_MAX_ATTESTATION_DOC_SIZE)
        code = self._lib.nsm_get_attestation_doc(
            self._fd,
            None,
            0,
            nonce,
            len(nonce),
            None,
            0,
            doc_buf,
            ctypes.byref(doc_len),
        )
        if code != ERROR_CODE_SUCCESS:
            msg = f"request NSM attestation document: error code {code}"
            raise NsmError(msg)
        if doc_len.value == 0:
            msg = "NSM response did not include attestation document"
            raise NsmError(msg)
        return doc_buf.raw[: doc_len.value]

    def close(self) -> None:
        """Close the NSM device session."""
        if getattr(self, "_fd", -1) >= 0:
            self._lib.nsm_lib_exit(self._fd)
            self._fd = -1


def get_attester() -> Attester:
    """Return the best available NSM attester for this host.

    Returns:
        A libnsm-backed attester inside an enclave, otherwise a fallback
        attester that raises a clear error on use.
    """
    lib_path = ctypes.util.find_library("nsm") or "libnsm.so"
    try:
        lib = ctypes.CDLL(lib_path)
        return _LibNsmAttester(lib)
    except (OSError, NsmError, AttributeError):
        return _UnsupportedAttester()
