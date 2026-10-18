# cost-service: metering and per-run cost estimates

`cost-service` turns selected, attributable AWS operations the SCE performs into per-`(AlgorithmId, runId)` cost
estimates. It is an asynchronous meter, not a billing system: producers POST one typed event per metered operation,
a worker prices it against a pinned list-price table, and the benchmark sums the rows for a run.

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

Phases: `build` (registry) and `execution` (run). A build has no run, so its cost is keyed by `algorithmId` on
both trees, and its log events carry a null `runId`.

## Emission points

### Build phase

secure-rads (`csav/registry-service`, Go, on the CSAV host):

- `dynamodb:read-capacity` - `getAlgorithm` (existing-key lookup).
- `s3:put` - EIF upload; quantity counts the multipart initiation, part uploads, and completion requests.
- `dynamodb:write-capacity` - `putAlgorithm` (algorithm record).
- KMS key lifecycle and STS are **not** metered (KMS is excluded by decision; STS is free).
- The CSAV host's own compute is not metered (persistent shared host, excluded).

rads (`csav/registry-service`, Lambdas):

- `/upload`: `apigateway:request`, `lambda:invocation`, `lambda:compute`. The presign is local, so no S3 call.
- `/register`: `s3:head`, `s3:put` (the client's single presigned `PutObject` request), `dynamodb:write-capacity`,
  `apigateway:request`, `lambda:invocation`, `lambda:compute`.

### Execution phase (both trees)

- execution-service `POST /run`: `apigateway:request`, `lambda:invocation`, `lambda:compute`,
  `dynamodb:read-capacity` (algorithm lookup and record-count check; actual `ConsumedCapacity.CapacityUnits`).
  It also stamps the launch epoch into the host user-data.
- execution-service `GET /run/{runId}` (each poll): `apigateway:request`, `lambda:invocation`, `lambda:compute`,
  `dynamodb:read-capacity`. The harness passes `?algorithmId=` so polls are attributable.
- executor host (user-data, both trees): `s3:get` (artifact; rads also the host tools), `sqs:send` (result),
  `ec2:instance` (seconds from launch to the terminate call).
- pdm-service `/records`: `apigateway:request`, `lambda:invocation`, `lambda:compute`, `dynamodb:read-capacity`
  (data-key `GetItem` and each records `Query` page).
- result-consumer (`batchSize` 1, so each run's receive + invoke lands on that run): `sqs:receive` (message
  bytes), `sqs:delete` (one request when the handler succeeds; Lambda performs the deletion),
  `dynamodb:write-capacity`, `lambda:invocation`, `lambda:compute`.
- verifier-service (secure-rads): `/attest` and `/refresh` (the enclave's attestation and token refresh, keyed by
  the run) and `/algorithms` (build-time PCR registration, keyed by `algorithmId`): `dynamodb:read-capacity` and
  `dynamodb:write-capacity` where attributable, plus `apigateway:request`, `lambda:invocation`, `lambda:compute`.
- sce-unit (in the enclave) performs no billable AWS operations other than KMS (excluded) - nothing to meter.

## EC2 timing

The executor is the per-run `c6g.large`. Execution-service stamps the launch epoch immediately before calling
`RunInstances`; the host captures `now - launch` before posting the `ec2:instance` event and calling
`terminate-instances`. This can overstate runtime by including time before the instance becomes `running`, and
understate it by excluding the cost-event POST and shutdown time. The net error is unknown; the price rule applies
a 60-second minimum.

Hard metric: AWS bills per second and stops charging **as soon as the instance state leaves `running` for
`shutting-down`/`terminated`**; there is no published SLA for that transition (it is seconds). `pending -> running`
is not billed, and Cost Explorer lag is reporting, not billing. Root EBS and data transfer are not included (see
below).

Lambda compute events use handler wall time captured before the final metering POSTs. They exclude the billable
cold-start initialization phase for managed-runtime ZIP functions (billed since August 1, 2025) and the time spent
posting those cost events, so they are estimates rather than Lambda's billed duration. See [AWS's INIT billing
announcement](https://aws.amazon.com/blogs/compute/aws-lambda-standardizes-billing-for-init-phase/).

## Pricing

List prices are pinned in `src/lib/prices.ts` for `ap-southeast-2` with an as-of date, and each row stores the
`costUsd` computed at ingest, so a later price change does not rewrite history. This is an **estimate from list
prices**: it ignores credits, free tier, and volume-discount tiers above the first, and cannot be reconciled
per-run against Cost Explorer.

## Excluded costs (documented, not metered)

- **KMS** - excluded by decision. Build uploads and enclave artifact accesses may make KMS requests for SSE-KMS
  (the bucket uses S3 Bucket Keys); enclave data-key decryption and verifier cold starts also use KMS. Per-algorithm
  key storage incurs ongoing cost. None of these KMS costs are currently attributed.
- verifier-service `/.well-known/jwks.json` and `pdm-service`'s `/subject` DSAR lookup - neither carries an
  `algorithmId` to attribute to.
- log-service and cost-service self-cost (ingest API Gateway/Lambda/queue/DynamoDB).
- Ongoing storage (S3 EIF/artifact objects, DynamoDB table storage), CloudWatch Logs ingestion/storage, CloudWatch
  alarms, the persistent CSAV host, and data transfer (internet egress, cross-AZ).
- SQS queue-cost of result delivery is metered as `sqs:send`, `sqs:receive`, and `sqs:delete`. Receive requests
  that invoke the handler with an attributable result are counted, including redeliveries; idle polling, empty
  receives, and messages without parseable run identifiers cannot be attributed to a run.
- Attributed DynamoDB events use each response's `ConsumedCapacity.CapacityUnits`; an invalid verifier refresh lookup
  has no algorithm ID to attach to its consumed capacity.

## Querying

```
make cost-csv      ALGORITHM_ID=<id> RUN_ID=<runId>   # one run  -> cost-<runId>.csv
make cost-csv-algo ALGORITHM_ID=<id>                  # one algo -> cost-algo-<id>.csv
make cost-csv-all                                     # whole table -> cost-all.csv
```

These walk every page automatically: the GET routes cap each response at one DynamoDB page and expose the next
token as `nextCursor` (JSON) or `x-next-cursor` (CSV), so a full export never trips the 10 MB API Gateway
response limit.

The Makefile defaults `COST_HOST` to `cost.sr.secure-rads.org`; pass `COST_HOST=cost.r.secure-rads.org` for rads.

The benchmark (`benchmark/`) resolves the cost-service per tree and adds per-service and total cost columns to
`phase-timings.csv`, plus `sweep-cost.png` (total vs size) and `sweep-cost-services.png` (by service). See
`benchmark/README.md`.
