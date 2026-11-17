# telemetry-service

Serverless Framework v4, TypeScript. Diagnostic timeline for performance, test, and debug events: build checkpoints, run phases, and host provisioning. Best-effort and unauthenticated by design. It is not an audit store and must not be used to answer data-subject or authority queries; that trail lives in [`../log-service`](../log-service).

## Endpoints

- `POST /events` - producers post `{algorithmId, runId?, event, timestamp, detail?}`. No token and no client certificate. The event is validated against the allowlist in `src/lib/events.ts`, enqueued, and the handler returns `202`.
- `GET /logs/{algorithmId}` - exports one algorithm's timeline. `?runId=` narrows to a single run. Pages through all results.
- `GET /logs` - exports the whole table across all algorithms.

Both export routes take `?format=csv` (`text/csv`) or default to JSON. CSV columns: `algorithmId,runId,event,timestamp,receivedAt,origin,detail`.

Producers: registry-service build events, execution-service control-plane events, the host-reported checkpoints, the enclave run timeline, and result-consumer `result-persisted`.

## Queue

`POST /events` `SendMessage`s onto a standard SQS queue. A worker Lambda consumes it with `batchSize` 10, `ReportBatchItemFailures`, `reservedConcurrency` 5, a 60s visibility timeout (worker timeout 30s), and a DLQ after 5 receives.

## Key model

Partition key `AlgorithmId`, sort key `Sk = <runId>#<timestamp>#<event>`. ISO-8601 timestamps sort lexically, so a run's events come back in chronological order. `Origin` records who emitted the event; ingest does not authenticate.

## Deploy

```sh
bun install
bunx serverless deploy \
  --param="domainName=telemetry.sr.secure-rads.org" --param="certificateArn=$TELEMETRY_CERT_ARN"
```

Point the hostname at the stack output `ApiRegionalDomainName` with a DNS-only record.
