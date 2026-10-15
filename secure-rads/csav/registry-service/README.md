# Registry Service

Part of the CSAV. Builds the EIF for deployment on Nitro Enclaves — takes the Data Controller's OCI image, unpacks it during a trusted build, layers the SCE Unit and nsjail on top, stores the resulting artifact in S3, and records `AlgorithmId` -> S3 path in DynamoDB.

See [../README.md](../README.md) for the full CSAV context.

The [build timeline](../../../docs/e2e-secure-rads.txt) emits `build-started`, `build-completed` once the EIF is built, `image-uploaded`, `pcrs-registered`, `kms-key-provisioned`, then `algorithm-registered` only after the DynamoDB write succeeds. All share a build id in `runId`; any pipeline failure emits `build-failed` under that same id.
