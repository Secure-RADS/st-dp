"""VSock helpers shared by the relay and the enclave server.

Python equivalent of the ``vsock_linux.go`` / ``vsock_unsupported.go`` build
tag pair: vsock is only available on Linux, so callers get a clear error on
other platforms instead of an import failure.
"""

from __future__ import annotations

import socket

VSOCK_SUPPORTED = hasattr(socket, "AF_VSOCK")

# Wildcard CID used when listening inside the enclave (VMADDR_CID_ANY).
VMADDR_CID_ANY = 0xFFFFFFFF


def dial(cid: int, port: int, timeout: float | None = None) -> socket.socket:
    """Dial a vsock peer (parent -> enclave).

    Args:
        cid: Destination context id (the enclave CID on the parent host).
        port: Destination vsock port.
        timeout: Optional socket timeout in seconds.

    Returns:
        A connected vsock stream socket.

    Raises:
        OSError: If vsock is unavailable on this platform.
    """
    if not VSOCK_SUPPORTED:
        msg = "vsock is only available on linux parent instances"
        raise OSError(msg)
    sock = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
    if timeout is not None:
        sock.settimeout(timeout)
    sock.connect((cid, port))
    return sock


def listen(port: int, backlog: int = 16) -> socket.socket:
    """Listen for vsock connections on ``port`` (enclave side).

    Args:
        port: VSock port to bind.
        backlog: Listen backlog.

    Returns:
        A listening vsock socket.

    Raises:
        OSError: If vsock is unavailable on this platform.
    """
    if not VSOCK_SUPPORTED:
        msg = "vsock is only available inside linux nitro enclaves"
        raise OSError(msg)
    sock = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((VMADDR_CID_ANY, port))
    sock.listen(backlog)
    return sock
