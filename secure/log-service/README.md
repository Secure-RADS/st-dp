# log-service

Serverless Framework v4, TypeScript. A fire-and-forget run-timeline logger: SCE components POST timestamped events keyed by `(AlgorithmId, runId)` into an SQS queue, a worker writes them to DynamoDB, and operators export a run's or an algorithm's timeline as JSON or CSV for benchmarking.

Producers are unchanged: they still POST `{algorithmId, runId, event, timestamp, detail?}` to `POST /events` and get `202`. Retry and scale live behind that contract.

## Endpoints

- `POST /events` - a producer (execution-service, the enclave host, sce-unit inside the enclave, result-consumer) posts one event `{algorithmId, runId, event, timestamp, detail?}`. The `timestamp` is client-provided - the time the event actually happened, not server receive time - and is stored alongside a server `receivedAt` stamped at ingest. Validation happens here; valid events are enqueued and the handler returns `202` without waiting for DynamoDB.
- `GET /logs/{algorithmId}` - exports one algorithm's timeline. `?runId=` narrows to a single run. Pages through all results, never truncated.
- `GET /logs` - exports the whole table across all algorithms.
- `POST /subject-access` - pdm-service posts one batch of `{algorithmId, runId, dataSubjectIds, timestamp}` each time it serves records to an enclave, forwarding the enclave's bearer token. The event is validated, deduplicated, and written one item per data subject into the DS-keyed `SubjectAccessTable`. This is the GDPR trail: which algorithm/run read which data subjects, and when.
- `GET /subject-access` - the data-subject/authority read path. `?dataSubjectId=` returns one data subject's chronological access entries as a key query; omitting it scans and returns every access event for the authority dashboard.

## Subject-access authentication

When `VERIFIER_JWKS_URL` is set, `POST /subject-access` verifies the ML-DSA-87 access token that verifier-service mints only after a successful Nitro attestation (`src/lib/jwt.ts`, same local-JWKS scheme as pdm-service, with SPKI-pinned TLS on the JWKS fetch and `aud=log-service`). The token's `sub` must match the batch's `algorithmId`. pdm-service forwards the token the enclave presented on `/records`.

`POST /events` and the read endpoints are unchanged: build- and host-side producers cannot attest, and the transparency portal still reads without a token.

The baseline has no verifier, so `rads/log-service` leaves these variables unset and subject-access ingest stays open.

Both export routes take `?format=csv` (`text/csv`) or default to JSON. CSV columns: `algorithmId,runId,event,timestamp,receivedAt,detail`, with `detail` as compact JSON per cell.

The HTTP API sets `cors: true` so the transparency portal can call it directly from the browser.

## Queue

`POST /events` `SendMessage`s onto a standard SQS queue. A worker Lambda consumes it:

- `batchSize` 10, `ReportBatchItemFailures` so one bad record does not redo the rest of the batch
- `reservedConcurrency` 5
- visibility timeout 60s (worker timeout is 30s)
- after 5 receives, SQS moves the message to a DLQ (14-day retention)

SQS retries on the visibility interval, then parks on the DLQ. That is not exponential backoff; a poison message should not sit on the main queue.

## Key model

Items are keyed by partition `AlgorithmId` and sort key `Sk = <runId>#<timestamp>#<uuid>`. ISO-8601 timestamps sort lexically, so a run's events come back in chronological order; the UUID keeps concurrent same-timestamp events distinct.

Bun is used as the local dev/bundle tool only (`bun install`) - the Lambda itself runs on the standard `nodejs24.x` runtime, no custom Bun runtime layer.

## Prerequisites (manual, one-time, outside this repo's IaC)

- A domain name (`log.sr.secure-rads.org`) + ACM certificate already provisioned - `serverless.yml` takes these as `domainName`/`certificateArn` params, it does not create them.

## Deploy

```
bun install
bunx serverless deploy --param="domainName=log.sr.secure-rads.org" --param="certificateArn=..."
```
