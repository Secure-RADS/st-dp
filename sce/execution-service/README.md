# execution-service

Part of the SCE. Given an `AlgorithmId`, looks up its EIF in S3 (via registry-service's `AlgorithmTable`), spins up a Nitro-Enclave-capable EC2 instance, and runs the EIF. `POST /run` blocks until the enclave host POSTs its result (exit status plus what the DC app returned over vsock) back to `/result/<instance-id>` and responds with `{algorithmId, instanceId, status, output}`, or 504 after 10 minutes.

See [../README.md](../README.md) for the full SCE context.
