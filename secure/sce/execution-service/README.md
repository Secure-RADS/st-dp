# execution-service

Part of the SCE. API Gateway invokes the TypeScript Lambda control plane. Given an `AlgorithmId`, it looks up the EIF in S3 (via registry-service's `AlgorithmTable`), starts a Nitro-Enclave-capable EC2 instance, and returns immediately. The per-run EC2 instance remains necessary as the Nitro Enclave parent; the service itself has no persistent EC2 host.

`POST /run` is fire-and-forget: it assigns a `runId`, looks up the EIF, and — when `size` is set — rejects the request if that count exceeds the rows already seeded for the algorithm in PDM. It then launches the enclave and returns `202 {runId, algorithmId, instanceId, status: "pending"}` immediately. The enclave host sends its result (exit status plus what the DC app returned over vsock) to the run-results SQS queue when it finishes; a consumer Lambda (result-consumer) writes it to the RunResults table.

Before launching the instance, `POST /run` registers `(runId, runSecret)` with verifier-service over mTLS (`VERIFIER_RUNS_URL`, pinned by `VERIFIER_PUBKEY_SHA256`, client cert in `tls/`). The secret goes into the host's user data and is served to the enclave on vsock port 5001; the enclave presents it to `/challenge`, so a compromised host cannot bind its enclave to another run's id. Registration happens before `RunInstances`, so a register failure never leaves an unbindable instance running.

`GET /run/{runId}?algorithmId={algorithmId}` polls for the result: `{runId, status: "pending"}` until it lands, then the stored result once the consumer has written it. `algorithmId` is required so every poll can be attributed to its run.

The control plane logs `run-requested` and `executor-launched` (or `launch-failed`). The parent posts `executor-ready`, `artifact-retrieved`, `enclave-launched`, and `executor-finished` directly to telemetry-service with `origin: host`. The host holds no credential; telemetry ingest is unauthenticated. The enclave emits `run-failed` before it exits. result-consumer only emits `result-persisted`. SCE-unit and result-consumer emit the remaining events in [the execution flow](../../../docs/e2e-secure-rads.txt).

See [../README.md](../README.md) for the full SCE context.

## Deployment

`make -C sce deploy` deploys the Lambda stack. It requires result-consumer, registry-service storage, kms-service, and verifier-service to exist first. The deploy target generates `tls/client.crt`/`client.key` on first run; add the public cert to the verifier truststore (see verifier-service's README).

The enclave host pulls the EIF and publishes the result; it has no algorithm-key KMS permission. Data-key decryption runs in kms-service, so the per-algorithm key policy names the kms-service role rather than this per-deployment host role. `KMS_HOST` is passed as `KMS_SERVICE_HOST` and baked into the host user data, which proxies the enclave's `/decrypt` call.
