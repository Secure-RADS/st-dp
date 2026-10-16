# cost-service: metering and per-run cost estimates

`cost-service` turns the AWS operations the SCE performs into per-`(AlgorithmId, runId)` cost estimates. It is a
fire-and-forget meter, not a billing system: producers POST one typed event per billable AWS operation, a worker
prices it against a pinned list-price table, and the benchmark sums the rows for a run.

It exists in both trees: `secure-rads/cost-service` and `rads/cost-service`. See each service's `README.md` for
endpoints, deploy, and the event vocabulary.

## The one rule

**The component that performs the AWS call emits the cost event.** Server-side operations are otherwise invisible
to the caller (the enclave never sees PDM's DynamoDB reads; the registry never sees the verifier's Lambda). Each
producer emits for its own calls only, so nothing is double-counted.

## How a run's cost is assembled

1. A producer `POST`s `{algorithmId, runId, eventId, phase, service, operation, quantity, timestamp, detail?}` to
   `POST /cost`. `eventId` is a producer UUID; it is part of the DynamoDB sort key so an SQS redelivery overwrites
   instead of double-counting.
2. The handler validates against the enums, enqueues to SQS, and returns `202` immediately - the producer is never
   blocked on a write.
3. A worker prices the operation (`quantity` x the pinned price rule, applying per-chunk rounding and the EC2 60s
   floor) and writes one row per operation: `AlgorithmId`, `Sk = <runId>#<timestamp>#<eventId>`, `Phase`,
   `Service`, `Operation`, `Quantity`, `Unit`, `CostUsd`, `Detail`.
4. The benchmark reads `GET /cost/{algorithmId}?runId={runId}` and sums `CostUsd` by service. The raw per-operation
   rows are the source of truth; the run total is derived.

Phases: `build` (registry) and `execution` (run). A build's cost is keyed by its build id; in secure-rads that is
the registry's generated build UUID, in rads there is no build run id so the algorithm id is used.

## Emission points

### Build phase

secure-rads (`csav/registry-service`, Go, on the CSAV host):

- `dynamodb:read` - `getAlgorithm` (existing-key lookup).
- `s3:put` - EIF upload; quantity is the multipart part count derived from the EIF size.
- `dynamodb:write` - `putAlgorithm` (algorithm record).
- KMS key lifecycle and STS are **not** metered (KMS is excluded by decision; STS is free).
- The CSAV host's own compute is not metered (persistent shared host, excluded).

rads (`csav/registry-service`, Lambdas):

- `/upload`: `apigateway:request`, `lambda:invocation`, `lambda:compute`. The presign is local, so no S3 call.
- `/register`: `s3:head`, `s3:put` (the client's actual tarball upload, attributed from the object size returned by
  `HeadObject`), `dynamodb:write`, `apigateway:request`, `lambda:invocation`, `lambda:compute`.

### Execution phase (both trees)

- execution-service `POST /run`: `apigateway:request`, `lambda:invocation`, `lambda:compute`, `dynamodb:read`
  (algorithm lookup), `dynamodb:read` (record-count check; bytes estimated at `ESTIMATED_RECORD_BYTES` per row).
  It also stamps the launch epoch into the host user-data.
- execution-service `GET /run/{runId}` (each poll): `apigateway:request`, `lambda:invocation`, `lambda:compute`,
  `dynamodb:read`. The harness passes `?algorithmId=` so polls are attributable.
- executor host (user-data, both trees): `s3:get` (artifact; rads also the host tools), `sqs:send` (result),
  `ec2:instance` (seconds from launch to the terminate call).
- pdm-service `/records`: `apigateway:request`, `lambda:invocation`, `lambda:compute`, `dynamodb:read`
  (data-key `GetItem` and each records `Query` page, metered in item bytes).
- result-consumer: `sqs:receive` (one event per batch, in returned bytes), `dynamodb:write`, `lambda:invocation`,
  `lambda:compute`.
- sce-unit (in the enclave) performs no billable AWS operations other than KMS (excluded) - nothing to meter.

## EC2 timing

The executor is the per-run `c6g.large`. Its cost is launch-to-terminate: execution-service stamps the launch epoch
when `RunInstances` returns and the host emits `ec2:instance` with `now - launch` when it calls
`terminate-instances` at its last step. The price rule applies a 60-second minimum.

Hard metric: AWS bills per second and stops charging **as soon as the instance state leaves `running` for
`shutting-down`/`terminated`**; there is no published SLA for that transition (it is seconds). The terminate call
is therefore a close proxy. `pending -> running` is not billed, and Cost Explorer lag is reporting, not billing.
Root EBS and data transfer are not included (see below).

## Pricing

List prices are pinned in `src/lib/prices.ts` for `ap-southeast-2` with an as-of date, and each row stores the
`costUsd` computed at ingest, so a later price change does not rewrite history. This is an **estimate from list
prices**: it ignores credits, free tier, and volume-discount tiers above the first, and cannot be reconciled
per-run against Cost Explorer.

## Excluded costs (documented, not metered)

- **KMS** - the per-algorithm key is created once and kept across rebuilds, so it is not attributed per run. This is
  the one deliberate exclusion.
- verifier-service API Gateway + Lambda (attestation / registration), and `pdm-service`'s `/subject` DSAR lookup
  (no `algorithmId` to attribute to).
- log-service and cost-service self-cost (ingest API Gateway/Lambda/queue/DynamoDB).
- Ongoing storage (S3 EIF/artifact objects, DynamoDB table storage), CloudWatch Logs ingestion/storage, CloudWatch
  alarms, the persistent CSAV host, and data transfer (internet egress, cross-AZ).
- SQS queue-cost of the result delivery is metered as `sqs:send` + `sqs:receive`; the message-delete request is not
  emitted.
- DynamoDB sizes for small lookups and count queries are estimated, not measured exactly.

## Querying

```
make cost-csv      ALGORITHM_ID=<id> RUN_ID=<runId>   # one run  -> cost-<runId>.csv
make cost-csv-algo ALGORITHM_ID=<id>                  # one algo -> cost-algo-<id>.csv
make cost-csv-all                                     # whole table -> cost-all.csv
```

The Makefile defaults `COST_HOST` to `cost.sr.secure-rads.org`; pass `COST_HOST=cost.r.secure-rads.org` for rads.

The benchmark (`benchmark/`) resolves the cost-service per tree and adds per-service and total cost columns to
`phase-timings.csv`, plus a `sweep-cost.png` figure. See `benchmark/README.md`.
