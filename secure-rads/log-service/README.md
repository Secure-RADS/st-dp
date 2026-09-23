# log-service

Serverless Framework v4, TypeScript. A fire-and-forget run-timeline logger: SCE components publish timestamped events keyed by `(AlgorithmId, runId)` onto an SQS queue, a worker writes them to DynamoDB, and operators export a run's or an algorithm's timeline as JSON or CSV for benchmarking.

Producers publish to the queue directly through `LOG_QUEUE_URL`; the enclave's `sce-unit` POSTs `{algorithmId, runId, event, timestamp, detail?}` to `POST /events` and gets `202`, the same queue's HTTP front for anything that cannot reach SQS. Retry and scale live behind both contracts.

## Endpoints

- `POST /events` - the enclave's `sce-unit` posts one event `{algorithmId, runId, event, timestamp, detail?}`. The `timestamp` is client-provided - the time the event actually happened, not server receive time - and is stored alongside a server `receivedAt` stamped by the worker when it persists. Validation happens here; valid events are enqueued and the handler returns `202` without waiting for DynamoDB.
- `GET /logs/{algorithmId}` - exports one algorithm's timeline. `?runId=` narrows to a single run. Pages through all results, never truncated.
- `GET /logs` - exports the whole table across all algorithms.
- Subject-access ingest is SQS-only: pdm-service enqueues one `{type: "subject-access", algorithmId, runId, dataSubjectIds, timestamp}` message per page onto the log queue, and the worker writes one item per data subject into the DS-keyed `SubjectAccessTable`. This is the GDPR trail: which algorithm/run read which data subjects, and when.
- `GET /subject-access` - the data-subject/authority read path. `?dataSubjectId=` returns one data subject's chronological access entries as a key query; omitting it scans and returns every access event for the authority dashboard.

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

Items are keyed by partition `AlgorithmId` and sort key `Sk = <runId>#<timestamp>#<uuid>`. ISO-8601 timestamps sort lexically, so a run's events come back in chronological order; the UUID keeps concurrent same-timestamp events distinct.

Bun is used as the local dev/bundle tool only (`bun install`) - the Lambda itself runs on the standard `nodejs24.x` runtime, no custom Bun runtime layer.

## Prerequisites (manual, one-time, outside this repo's IaC)

- A domain name (`log.secure-rads.org`) + ACM certificate already provisioned - `serverless.yml` takes these as `domainName`/`certificateArn` params, it does not create them.

## Deploy

```
bun install
bunx serverless deploy --param="domainName=log.secure-rads.org" --param="certificateArn=..."
```
