# log-service

Serverless Framework v4, TypeScript. Stores the data-subject access trail for the rads baseline: one row per `(DataSubjectId, algorithm, run)` recorded after a successful app run.

Run and debug events live in [`../telemetry-service`](../telemetry-service).

## Endpoints

- `POST /subject-access` - the executor posts one batch of `{algorithmId, runId, dataSubjectIds, timestamp}` after the DC app produced a result.
- `GET /subject-access/{dataSubjectId}` - one data subject's chronological access entries as a key query.
- `GET /subject-access` - every access event, scanned for the authority dashboard.

## Key model

Partition key `DataSubjectId`, sort key `Sk = <timestamp>#<algorithmId>#<runId>`, so the write is idempotent and a data-subject lookup is a key query rather than a scan.

## Deploy

```sh
bun install
bunx serverless deploy \
  --param="domainName=log.r.secure-rads.org" --param="certificateArn=$LOG_CERT_ARN"
```

Point the hostname at the stack output `ApiRegionalDomainName` with a DNS-only record.
