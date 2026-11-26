# execution-service

Part of the SCE. API Gateway invokes the TypeScript Lambda control plane. Given an `AlgorithmId`, it looks up the EIF in S3 (via registry-service's `AlgorithmTable`), starts a Nitro-Enclave-capable EC2 instance, and returns immediately. The per-run EC2 instance remains necessary as the Nitro Enclave parent; the service itself has no persistent EC2 host.

`POST /run` is fire-and-forget: it assigns a `runId`, looks up the EIF, and — when `size` is set — rejects the request if that count exceeds the rows already seeded for the algorithm in PDM. The check calls PDM's `/count` endpoint over mTLS with a client certificate fetched from SSM; this Lambda has no DynamoDB access to PDM. It then launches the enclave and returns `202 {runId, algorithmId, instanceId, status: "pending"}` immediately.

The request accepts an optional `webhookUrl`:

```json
{ "algorithmId": "...", "size": 1000, "webhookUrl": "https://dc.example/results" }
```

When omitted, results go to secure-rads-result-consumer's HTTPS receiver and `GET /run/{runId}` returns them. When provided, the URL must be `https` and must not target localhost or an obvious private/internal address; the signed result goes to that DC webhook instead and `GET /run/{runId}` stays `pending`.

The enclave signs the result (run id, algorithm id, status, and output) with its attested ephemeral key and POSTs the signed envelope over CA-verified TLS. For the internal receiver, result-consumer verifies the signature and writes the RunResults table. For a DC webhook, the DC verifies the envelope with verifier-service `GET /runs/{runId}`.

`GET /run/{runId}?algorithmId={algorithmId}` polls for the result: `{runId, status: "pending"}` until it lands, then the stored result for internally delivered runs. `algorithmId` is required so every poll can be attributed to its run.

The control plane logs `run-requested` and `executor-launched` (or `launch-failed`). The parent posts `executor-ready`, `artifact-retrieved`, `enclave-launched`, and `executor-finished` directly to telemetry-service with `origin: host`. The host holds no credential; telemetry ingest is unauthenticated. The enclave emits `run-failed` before it exits. result-consumer emits `result-persisted` for internally delivered runs. SCE-unit and result-consumer emit the remaining events in [the execution flow](../../../docs/e2e-secure-rads.txt).

See [../README.md](../README.md) for the full SCE context.

## Deployment

`make -C sce deploy` deploys the Lambda stack. It requires registry-service storage, verifier-service, result-consumer, and kms-service to exist first.

The enclave host pulls the EIF but does not publish the result; it has no algorithm-key KMS permission. Data-key decryption runs in kms-service, so the per-algorithm key policy names the kms-service role rather than this per-deployment host role. `KMS_HOST` is passed as `KMS_SERVICE_HOST` and baked into the host user data, which proxies the enclave's `/decrypt` call.
