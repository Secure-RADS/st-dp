# cost-service

Serverless Framework v4, TypeScript. Fire-and-forget AWS cost metering: SCE components POST one typed cost event per billable AWS operation they perform, keyed by `(AlgorithmId, runId)`. A worker prices each operation from a pinned price table and writes a row to DynamoDB; operators export a run's or an algorithm's cost as JSON or CSV.

The table stores **one row per AWS operation**, not per run. Callers (the benchmark harness) sum rows by `runId` to get a run total, so the raw per-operation detail is never lost.

## Endpoints

- `POST /cost` - a producer posts one event `{algorithmId, runId, eventId, phase, service, operation, quantity, timestamp, detail?}`. `eventId` is a producer-generated UUID; it is part of the sort key so an SQS redelivery overwrites the row instead of double-counting. The handler validates, enqueues, and returns `202` without waiting for DynamoDB.
- `GET /cost/{algorithmId}` - one algorithm's cost rows. `?runId=` narrows to a run; the JSON response also carries `totalUsd` plus `priceRegion`/`priceAsOf` provenance.
- `GET /cost` - the whole table.

Both GET routes page via `?cursor=` (the previous response's `nextCursor`) and return at most one page, so a large history cannot overflow the 10 MB API Gateway response cap. They take `?format=csv` (`text/csv`) or default to JSON; on CSV the next-page token rides the `x-next-cursor` response header. CSV columns: `algorithmId,runId,phase,service,operation,quantity,unit,costUsd,timestamp,receivedAt,detail`.

## Event vocabulary

The ingest authority rejects anything outside these enums, so no free-form service or operation string reaches the table. Go producers mirror the list as typed constants - keep them in sync.

- `phase`: `build` | `execution`
- `service`: `s3` | `dynamodb` | `sqs` | `ec2` | `lambda` | `apigateway`
- `operation` (per service):
  - `s3`: `put` | `get` | `head` | `list` (quantity = requests)
  - `dynamodb`: `read` (item bytes) | `read-capacity` (`ConsumedCapacity.CapacityUnits`) | `write` (item bytes)
  - `sqs`: `send` | `receive` | `delete` (quantity = message bytes; billed per 64 KB chunk)
  - `ec2`: `instance` (quantity = seconds; 60s minimum per start)
  - `lambda`: `invocation` (quantity = requests) | `compute` (quantity = GB-seconds)
  - `apigateway`: `request` (quantity = requests)

The unit for each operation is fixed by the price table, not sent on the wire.

## Pricing and scope

- Prices are pinned in `src/lib/prices.ts` for `ap-southeast-2`, stamped with an as-of date. Re-check them against the AWS Price List API when the stamp is old. Every row also records its computed `costUsd`, so a price change does not rewrite history.
- This is an **estimate from list prices**, not the invoice: it ignores credits, free tier, and volume-discount tiers above the first, and AWS Cost Explorer is not comparable per run.
- **KMS is excluded by design.** The per-algorithm key is created once and kept across rebuilds, so it is not attributed per run. Ongoing/fixed costs (S3 object storage, CloudWatch Logs, the persistent CSAV host, data transfer) are likewise excluded and listed in `docs/cost-service.md`.
- EC2 is priced as the per-run `c6g.large` executor. A different `ENCLAVE_INSTANCE_TYPE` needs a new price-table entry.

## EC2 timing

The executor's cost is measured as launch-to-terminate: the execution-service stamps `RunInstances` success, and the host emits the finish when it calls `terminate-instances` at its last step. The duration is passed as an `ec2:instance` event in seconds; the price rule applies the 60-second minimum.

AWS bills per second and stops charging **as soon as the instance state changes to `shutting-down`/`terminated`**, which is seconds after the terminate call - there is no published hard SLA for that transition. The launch-to-terminate window is therefore a close proxy, and the only meaningful uncertainty is the final sub-minute tail plus the 60s floor. Cost Explorer reporting lag is unrelated (visibility, not billing).

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
