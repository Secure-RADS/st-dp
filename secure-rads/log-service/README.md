# log-service

Serverless Framework v4, TypeScript. A fire-and-forget run-timeline logger: SCE components POST timestamped events keyed by `(AlgorithmId, runId)` into an SQS queue, a worker writes them to DynamoDB, and operators export a run's or an algorithm's timeline as JSON or CSV for benchmarking.

Producers are unchanged: they still POST `{algorithmId, runId, event, timestamp, detail?}` to `POST /events` and get `202`. Retry and scale live behind that contract.

## Endpoints

- `POST /events` - a producer (execution-service, the enclave host, sce-unit inside the enclave, result-consumer) posts one event `{algorithmId, runId, event, timestamp, detail?}`. The `timestamp` is client-provided - the time the event actually happened, not server receive time - and is stored alongside a server `receivedAt` stamped at ingest. Validation happens here; valid events are enqueued and the handler returns `202` without waiting for DynamoDB.
- `GET /logs/{algorithmId}` - exports one algorithm's timeline. `?runId=` narrows to a single run. Pages through all results, never truncated.
- `GET /logs` - exports every algorithm's events in timestamp order, via `TimelineIndex`. `?from=`/`?to=` narrow it to an ISO-8601 window.
- `GET /runs/{runId}` - one run's timeline across algorithms, via `RunIndex`, without needing to know the algorithm.
- `POST /subject-access` - a producer (pdm-service) posts one batch of `{algorithmId, runId, dataSubjectIds, timestamp}` each time it serves records to an enclave. The event is validated, deduplicated, and written one item per data subject into the DS-keyed `SubjectAccessTable`. This is the GDPR trail: which algorithm/run read which data subjects, and when.
- `GET /subject-access/{dataSubjectId}` - the data-subject read path: one data subject's chronological access entries as a key query.
- `GET /subject-access` - the authority dashboard read path: scans and returns every access event.
- `GET /subject-access/by-algorithm/{algorithmId}` - the inverse: which data subjects one algorithm touched, via `AlgorithmIndex`.

The `/logs`, `/logs/{algorithmId}` and `/runs/{runId}` routes take `?format=csv` (`text/csv`) or default to JSON. CSV columns: `algorithmId,runId,event,timestamp,receivedAt,detail`, with `detail` as compact JSON per cell.

The HTTP API sets `cors: true` so the transparency portal can call it directly from the browser.

## Queue

`POST /events` `SendMessage`s onto a standard SQS queue. A worker Lambda consumes it:

- `batchSize` 10, `ReportBatchItemFailures` so one bad record does not redo the rest of the batch
- `reservedConcurrency` 5
- visibility timeout 60s (worker timeout is 30s)
- after 5 receives, SQS moves the message to a DLQ (14-day retention)

SQS retries on the visibility interval, then parks on the DLQ. That is not exponential backoff; a poison message should not sit on the main queue.

## Key model

Items are keyed by partition `AlgorithmId` and sort key `Sk = <runId>#<timestamp>#<event>`. ISO-8601 timestamps sort lexically, so a run's events come back in chronological order; the event name in place of a random nonce makes a redelivered message overwrite rather than duplicate.

That key serves the per-algorithm reads. Three GSIs cover the reads it cannot:

- `TimelineIndex` on `RunLogTable` (`LogPartition` / `Timestamp`). `LogPartition` is the constant `"EVENT"`, so a cross-algorithm export is one chronological query instead of a scan sorted in the Lambda, and a time window becomes a key condition. The constant key is a deliberate hot partition - fine at this log's rate, not a pattern to copy for high-throughput data.
- `RunIndex` on `RunLogTable` (`RunIdKey` / `Timestamp`), for a run's timeline when the algorithm is unknown. Sparse: `RunIdKey` is written only for execution events, so build events (no `runId`) stay out of the index. It is a separate attribute from `RunId` because a GSI key attribute holding `null` makes DynamoDB reject the base-table write outright, whereas an absent attribute just leaves the item unindexed.
- `AlgorithmIndex` on `SubjectAccessTable` (`AlgorithmId` / `Sk`), inverting the DS-keyed table to answer which subjects an algorithm touched. It reuses attributes the table already writes, so no write path changed.

All three project `ALL`: the exports return every field, and a `KEYS_ONLY` index would turn each row into a second base-table read. Index reads are eventually consistent, which is acceptable for an export but means an event may be missing from a query issued immediately after ingest.

DynamoDB builds at most one index per `UpdateTable`, so adding the two `RunLogTable` indexes to an already-deployed stack takes two deploys; a fresh stack creates all three at once. A GSI added later is backfilled from existing items, but only items that already carry the index key attribute - pre-existing events have no `RunIdKey` and will not appear in `RunIndex`.

Bun is used as the local dev/bundle tool only (`bun install`) - the Lambda itself runs on the standard `nodejs24.x` runtime, no custom Bun runtime layer.

## Prerequisites (manual, one-time, outside this repo's IaC)

- A domain name (`log.secure-rads.org`) + ACM certificate already provisioned - `serverless.yml` takes these as `domainName`/`certificateArn` params, it does not create them.

## Deploy

```
bun install
bunx serverless deploy --param="domainName=log.secure-rads.org" --param="certificateArn=..."
```
