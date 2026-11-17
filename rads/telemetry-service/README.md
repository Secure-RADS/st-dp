# telemetry-service

Serverless Framework v4, TypeScript. Diagnostic timeline for the rads baseline: build, provisioning, run-phase, and result-delivery events. Best-effort and unauthenticated by design.

The data-subject access trail lives in [`../log-service`](../log-service).

## Endpoints

- `POST /events` - producers post `{algorithmId, runId?, event, timestamp, detail?}`. The event is validated against the allowlist in `src/lib/events.ts`, enqueued, and the handler returns `202`.
- `GET /logs/{algorithmId}` - exports one algorithm's timeline. `?runId=` narrows to a single run.
- `GET /logs` - exports the whole table.

Both export routes take `?format=csv` or default to JSON.

## Key model

Partition key `AlgorithmId`, sort key `Sk = <runId>#<timestamp>#<event>`, so a run's events come back in chronological order.

## Deploy

```sh
bun install
bunx serverless deploy \
  --param="domainName=telemetry.r.secure-rads.org" --param="certificateArn=$TELEMETRY_CERT_ARN"
```

Point the hostname at the stack output `ApiRegionalDomainName` with a DNS-only record.
