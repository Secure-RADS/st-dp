# log-service

Serverless Framework v4, TypeScript. A fire-and-forget run-timeline logger: SCE components POST timestamped events keyed by `(AlgorithmId, runId)` into DynamoDB, and operators export a run's or an algorithm's timeline as JSON or CSV for benchmarking.

## Endpoints

- `POST /events` - a producer (execution-service, the enclave host, sce-unit inside the enclave, result-consumer) posts one event `{algorithmId, runId, event, timestamp, detail?}`. The `timestamp` is client-provided - the time the event actually happened, not server receive time - and is stored alongside a server `receivedAt`. Returns `202`. Minimal by design; this is the hot path.
- `GET /logs/{algorithmId}` - exports one algorithm's timeline. `?runId=` narrows to a single run. Pages through all results, never truncated.
- `GET /logs` - exports the whole table across all algorithms.

Both export routes take `?format=csv` (`text/csv`) or default to JSON. CSV columns: `algorithmId,runId,event,timestamp,receivedAt,detail`, with `detail` as compact JSON per cell.

## Key model

Items are keyed by partition `AlgorithmId` and sort key `Sk = <runId>#<timestamp>#<uuid>`. ISO-8601 timestamps sort lexically, so a run's events come back in chronological order; the UUID keeps concurrent same-timestamp events distinct.

Bun is used as the local dev/bundle tool only (`bun install`) - the Lambda itself runs on the standard `nodejs20.x` runtime, no custom Bun runtime layer.

## Prerequisites (manual, one-time, outside this repo's IaC)

- A domain name (`gdpr-log.prdai.dev`) + ACM certificate already provisioned - `serverless.yml` takes these as `domainName`/`certificateArn` params, it does not create them.

## Deploy

```
bun install
bunx serverless deploy --param="domainName=gdpr-log.prdai.dev" --param="certificateArn=..."
```
