# rads-log-service

Serverless Framework v4, TypeScript. A fire-and-forget run-timeline logger for the baseline: registry-service and the execution-service/EC2 executor publish timestamped events keyed by `(AlgorithmId, runId)` onto an SQS queue, a worker writes them to DynamoDB, and operators export a run's or an algorithm's timeline as JSON or CSV.

Producers publish to the queue directly through `LOG_QUEUE_URL`; `POST /events` is the same queue's HTTP front for anything that cannot reach SQS (the enclave's `sce-unit`).

## Endpoints

- `POST /events` - posts one event `{algorithmId, runId, event, timestamp, detail?}` onto the queue and returns `202` without waiting for DynamoDB. `runId` may be null for build-phase events. The `timestamp` is client-provided - when the event happened, not when the server received it - and is stored alongside a server `receivedAt` stamped by the worker when it persists.
- `GET /logs/{algorithmId}` - exports one algorithm's timeline. `?runId=` narrows to a single run. Pages through all results, never truncated.
- `GET /logs` - exports the whole table across all algorithms.
- Subject-access ingest is SQS-only: pdm-service enqueues one `{type: "subject-access", algorithmId, runId, dataSubjectIds, timestamp}` message per page onto the log queue, and the worker writes one DS-keyed row per data subject into `rads-subject-access`. This is the GDPR trail: which algorithm/run read which data subjects, and when.
- `GET /subject-access/{dataSubjectId}` - one data subject's chronological access entries as a key query.
- `GET /subject-access` - scans and returns every access event, for the authority dashboard.

Both export routes take `?format=csv` (`text/csv`) or default to JSON. CSV columns: `algorithmId,runId,event,timestamp,receivedAt,detail`, with `detail` as compact JSON per cell.

The HTTP API sets `cors: true` so the transparency portal can call it directly from the browser.

## Queue

The queue carries two message types, `run-event` and `subject-access`. The worker routes on `type`; `POST /events` and the direct producers both `SendMessage` onto the same standard queue:

- `batchSize` 10, `ReportBatchItemFailures` so one bad record does not redo the rest of the batch
- `reservedConcurrency` 5
- visibility timeout 60s (worker timeout is 30s)
- after 5 receives, SQS moves the message to a DLQ (14-day retention)
- a CloudWatch alarm on DLQ depth `>= 1` publishes to an SNS topic (no subscription by default)

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
