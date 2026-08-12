# execution-service

Part of the SCE. Given an `AlgorithmId`, looks up its EIF in S3 (via registry-service's `AlgorithmTable`), spins up a Nitro-Enclave-capable EC2 instance, and runs the EIF.

See [../README.md](../README.md) for the full SCE context.
