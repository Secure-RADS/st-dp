# log-service

Serverless Framework v4, TypeScript. Stores the data-subject access trail for the rads baseline: one row per `(DataSubjectId, algorithm, run)` recorded after a successful app run.

Run and debug events live in [`../telemetry-service`](../telemetry-service).

## Endpoints

- `POST /subject-access` - the executor posts one batch of `{algorithmId, runId, dataSubjectIds, timestamp}` after the DC app produced a result. If any subject in the batch already has a row for that run, the handler returns `409`.
- `GET /subject-access/{dataSubjectId}` - one data subject's chronological access entries as a key query.
- `GET /subject-access` - a cursor-paginated view over all access events for the authority dashboard. `?limit=` caps at 1000 (default 500); pass the returned `nextCursor` as `?cursor=` until it is `null`. Scan order is not chronological.

## Key model

Partition key `DataSubjectId`, sort key `Sk = <timestamp>#<algorithmId>#<runId>`, so a data-subject lookup is a key query rather than a scan. A repeat write for the same `(algorithmId, runId)` is rejected with `409` rather than appended under a new timestamp.

## Deploy

```sh
bun install
bunx serverless deploy \
  --param="domainName=log.r.secure-rads.org" --param="certificateArn=$LOG_CERT_ARN"
```

Point the hostname at the stack output `ApiRegionalDomainName` with a DNS-only record.
