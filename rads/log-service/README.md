# rads-log-service

Serverless Framework v4, TypeScript. A fire-and-forget run-timeline logger for the baseline: producers
publish timestamped events keyed by `(AlgorithmId, runId)`, a worker writes them to DynamoDB, and operators
export a run's or an algorithm's timeline as JSON or CSV.

Producers (registry-service, execution-service Lambda, EC2 executor, result-consumer) all post through
`POST /events`. The HTTP handler enqueues onto SQS; the worker writes DynamoDB.

Ingest is unauthenticated here because the baseline has no verifier or attested producer. The handlers carry
the same env-gated bearer-token verification as `secure-rads/log-service`, but this stack deploys without
`VERIFIER_JWKS_URL`, so enforcement stays off.

## Endpoints

- `POST /events` - posts one event `{algorithmId, runId, event, timestamp, detail?}` onto the queue and returns `202` without waiting for DynamoDB. `runId` may be null for build-phase events. The `timestamp` is client-provided - when the event happened, not when the server received it - and is stored alongside a server `receivedAt` stamped at ingest.
- `GET /logs/{algorithmId}` - exports one algorithm's timeline. `?runId=` narrows to a single run. Pages through all results, never truncated.
- `GET /logs` - exports the whole table across all algorithms.
- `POST /subject-access` - pdm-service posts one batch of `{algorithmId, runId, dataSubjectIds, timestamp}` each time it serves records to the executor. The batch is validated, deduplicated, and written one item per data subject into the DS-keyed `rads-subject-access` table. This is the GDPR trail: which algorithm/run read which data subjects, and when.
- `GET /subject-access/{dataSubjectId}` - one data subject's chronological access entries as a key query.
- `GET /subject-access` - scans and returns every access event, for the authority dashboard.

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

Run-log items in `rads-log-events` are keyed by partition `AlgorithmId` and sort key `Sk = <runId or empty>#<timestamp>#<event>`. ISO-8601 timestamps sort lexically, so a run's events come back in chronological order, and the event name disambiguates events that share a timestamp. Subject-access rows live in a separate `rads-subject-access` table keyed by `DataSubjectId` with `Sk = <timestamp>#<algorithmId>#<runId>`, which makes a redelivered ingest overwrite an identical row instead of duplicating it.

Bun is used as the local dev/bundle tool only (`bun install`) - the Lambda itself runs on the standard `nodejs20.x` runtime, no custom Bun runtime layer.

## Prerequisites (manual, one-time, outside this repo's IaC)

- A domain name (`log.r.secure-rads.org`) + ACM certificate already provisioned - `serverless.yml` takes these as `domainName`/`certificateArn` params, it does not create them.

## Deploy

```
bun install
bunx serverless deploy --param="domainName=log.r.secure-rads.org" --param="certificateArn=..."
```
