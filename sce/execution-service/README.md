# execution-service

Part of the SCE. Given an `AlgorithmId`, looks up its EIF in S3 (via registry-service's `AlgorithmTable`), spins up a Nitro-Enclave-capable EC2 instance, and runs the EIF.

`POST /run` is fire-and-forget: it assigns a `runId`, launches the enclave, and returns `202 {runId, algorithmId, instanceId, status: "pending"}` immediately. The enclave host sends its result (exit status plus what the DC app returned over vsock) to the run-results SQS queue when it finishes; a consumer Lambda (result-consumer) writes it to the RunResults table.

`GET /run/{runId}` polls for the result: `{runId, status: "pending"}` until it lands, then the stored result once the consumer has written it.

Key points across the run are logged to log-service (run-requested, enclave-launched, and the enclave/result events from sce-unit and result-consumer).

See [../README.md](../README.md) for the full SCE context.
