# cost-service

Serverless Framework v4, TypeScript. Asynchronous AWS cost metering: SCE components POST one typed cost event per selected, attributable operation, keyed by `(AlgorithmId, runId)`. A worker prices each operation from a pinned price table and writes a row to DynamoDB; operators export a run's or an algorithm's cost as JSON or CSV.

The table stores **one row per AWS operation**, not per run. Callers (the benchmark harness) sum rows by `runId` to get a run total, so the raw per-operation detail is never lost.

## Endpoints

- `POST /cost` - a producer posts one event `{algorithmId, runId, eventId, phase, service, operation, quantity, timestamp, detail?}`. `eventId` is a producer-generated UUID; it is part of the sort key so an SQS redelivery overwrites the row instead of double-counting. The handler validates, enqueues, and returns `202` without waiting for DynamoDB.
- `GET /cost/{algorithmId}` - one algorithm's cost rows. `?runId=` narrows to a run; the JSON response also carries `totalUsd` plus `priceRegion`/`priceAsOf` provenance.
- `GET /cost` - the whole table.

Both GET routes page via `?cursor=` (the previous response's `nextCursor`) and return at most one page, so a large history cannot overflow the 10 MB API Gateway response cap. They take `?format=csv` (`text/csv`) or default to JSON; on CSV the next-page token rides the `x-next-cursor` response header. CSV columns: `algorithmId,runId,phase,service,operation,quantity,unit,costUsd,timestamp,receivedAt,detail`.

## Event vocabulary

The ingest authority rejects anything outside these enums, so no free-form service or operation string reaches the table. Go producers use typed constants for the operations they emit; keep their values aligned.

- `phase`: `build` | `execution`
- `service`: `s3` | `dynamodb` | `sqs` | `ec2` | `lambda` | `apigateway`
- `operation` (per service):
  - `s3`: `put` | `get` | `head` | `list` (quantity = requests)
  - `dynamodb`: `read-capacity` | `write-capacity` (quantity = `ConsumedCapacity.CapacityUnits`); legacy `read`/`write` byte events remain accepted during rollout
  - `sqs`: `send` | `receive` (quantity = message bytes; billed per 64 KB chunk) | `delete` (quantity = requests)
  - `ec2`: `instance` (quantity = seconds; 60s minimum per start)
  - `lambda`: `invocation` (quantity = requests) | `compute` (quantity = GB-seconds)
  - `apigateway`: `request` (quantity = requests)

The unit for each operation is fixed by the price table, not sent on the wire.

## Pricing and scope

- Prices are pinned in `src/lib/prices.ts` for `ap-southeast-2`, stamped with an as-of date. Re-check them against the AWS Price List API when the stamp is old. Every row also records its computed `costUsd`, so a price change does not rewrite history.
- This is an **estimate from list prices**, not the invoice: it ignores credits, free tier, and volume-discount tiers above the first, and AWS Cost Explorer is not comparable per run.
- **KMS is excluded by design.** Build uploads and artifact accesses may make SSE-KMS requests (the bucket uses S3 Bucket Keys); per-run enclave decrypts, verifier cold-start decrypts, and per-algorithm key storage are not attributed. Ongoing/fixed costs (S3 object storage, CloudWatch Logs, the persistent CSAV host, data transfer) are likewise excluded and listed in `docs/cost-service.md`.
- EC2 is priced as the per-run `c6g.large` executor. A different `ENCLAVE_INSTANCE_TYPE` needs a new price-table entry.

## EC2 timing

The execution-service stamps the launch epoch immediately before `RunInstances`. The host captures `now - launch` before posting the `ec2:instance` event and calling `terminate-instances`. This can include non-billable pending time and omit the reporting and shutdown time, so the net error is unknown; the price rule applies a 60-second minimum.

Lambda compute events measure handler wall time before the final cost-event posts. They omit billable cold-start initialization and the reporting time itself, so they are estimates rather than Lambda's billed duration.

AWS bills per second while the instance is `running`, with a one-minute minimum; `pending` is not billed. Since the measured interval starts before `RunInstances` and ends before the cost POST and termination request, its error direction is unknown. See `docs/cost-service.md` for the measurement limits.

## Queue

`POST /cost` uses a standard SQS queue with a worker Lambda: `batchSize` 10, `ReportBatchItemFailures`, `reservedConcurrency` 5, 60s visibility timeout (worker timeout 30s), and a DLQ after 5 receives.

## Key model

Partition key `AlgorithmId`, sort key `Sk = <runId>#<timestamp>#<eventId>`. ISO-8601 timestamps sort lexically, so a run's rows come back in chronological order.

## Prerequisites (manual, one-time, outside this repo's IaC)

- A domain name (`cost.r.secure-rads.org`) + ACM certificate already provisioned - `serverless.yml` takes these as `domainName`/`certificateArn` params, it does not create them.

## Deploy

```
bun install
bunx serverless deploy --param="domainName=cost.r.secure-rads.org" --param="certificateArn=..."
```
