"""AWS Nitro Enclaves remote attestation verifier (Python port).

This package is the Python migration of the original Go reference
implementation. It keeps the same three runtime pieces:

- ``nitro_attestation.client``  -> client-side attestation verifier CLI
- ``nitro_attestation.relay``   -> parent EC2 HTTP relay over vsock
- ``nitro_attestation.enclave`` -> in-enclave NSM vsock attestation server

The shared verification logic lives in ``nitro_attestation.verify``.
"""

__all__ = ["verify"]
