# Registry Service

Part of the CSAV. Builds the EIF for deployment on Nitro Enclaves — takes the Data Controller's OCI image, unpacks it during a trusted build, layers the SCE Unit and nsjail on top, stores the resulting artifact in S3, and records `AlgorithmId` -> S3 path in DynamoDB.

See [../README.md](../README.md) for the full CSAV context.
