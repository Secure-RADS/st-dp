# execution-service

Part of the SCE. Given an `AlgorithmId`, looks up its EIF in S3 (via registry-service's `AlgorithmTable`), spins up a Nitro-Enclave-capable EC2 instance, and runs the EIF. `POST /run` blocks until the host reports back through `runs/<instance-id>/` in the artifact bucket (`status.txt` last, as the done-sentinel; `output.txt` holds what the DC app returned over vsock) and responds with `{algorithmId, instanceId, status, output}`, or 504 after 10 minutes.

See [../README.md](../README.md) for the full SCE context.
