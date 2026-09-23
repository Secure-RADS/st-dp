# rads-execution-service

The execution-phase control plane for the RADS trusted baseline (the fully-trusted, no-enclave sibling of
`secure-rads/sce/execution-service`): an API Gateway + TypeScript Lambda that, given an `AlgorithmId`, looks
up the algorithm's OCI image in S3 (via the `rads-algorithms` table), launches a plain Docker EC2 instance to
run it, and returns immediately. Results come back asynchronously through the shared rads result-consumer.

`POST /run` is fire-and-forget: it assigns a `runId`, looks up `{Bucket, Key}` for the `AlgorithmId` in the
`rads-algorithms` DynamoDB table (PK `AlgorithmId`), launches a per-run EC2 executor, and returns
`202 {runId, algorithmId, instanceId, status: "pending"}`. The executor installs AWS CLI + Docker, downloads
every PDM record for the algorithm to `/opt/rads/run/records.json`, `aws s3 cp`s the image tar into place,
`docker load`s it, then `docker run`s the image with that directory bind-mounted at `/data` and
`RECORDS_PATH=/data/records.json` / `RESULT_PATH=/data/result.json` set. The app reads the records file and
writes its result file; the executor ships that file as the output, falling back to the container's stdout
for diagnostics. On exit it publishes
`{runId, instanceId, algorithmId, status, output, diag?}` to the `rads-run-results` queue (a consumer Lambda
persists it to the `rads-run-results` table, PK `RunId`) and terminates itself.

`GET /run/{runId}` polls the `rads-run-results` table: `{runId, status: "pending"}` until a result lands, then
the stored result.

Lifecycle events are logged to the `rads-log-events` queue (the log-service ingest contract
`{type: "run-event", algorithmId, runId, event, timestamp, detail?}`): the control plane logs `run-requested`
and `executor-launched`, and the executor logs `executor-finished` before it terminates.

## Deployment

The Lambda stack references shared rads infrastructure by name/parameter. Deploy with all params:

```
bun install
bunx serverless deploy \
  --param="imagesBucket=rads-images" \
  --param="algorithmTable=rads-algorithms" \
  --param="runResultsTable=rads-run-results" \
  --param="runResultsQueueUrl=<rads-run-results queue URL>" \
  --param="runResultsQueueArn=<rads-run-results queue ARN>" \
  --param="logQueueUrl=<rads-log-events queue URL>" \
  --param="logQueueArn=<rads-log-events queue ARN>" \
  --param="pdmUrl=https://pdm.example.org" \
  --param="amiId=<AL2023 AMI id>" \
  --param="vpcId=<VPC id>"
```

`instanceType` defaults to `c6g.large` (arm64, matching the arm64 algorithm images); set it to match the image
architecture you run. `region` defaults to `ap-southeast-2`. The security group, instance role, and instance
profile are created by this stack; the queue URLs/ARNs and the tables/bucket/AMI/VPC already exist.

## Env vars the executor userdata needs (operator-set)

The EC2 userdata is rendered by the Lambda at launch from the values below, so an operator sets them once as
Lambda environment (via the Serverless params above). Values drawn from the launch request / DB record at run
time are noted as such.

- `PDM_URL` - the PDM endpoint the executor downloads records from before the app runs (not passed to the container).
- `RUN_RESULTS_QUEUE_URL` - the `rads-run-results` queue the executor publishes its result to.
- `LOG_QUEUE_URL` - the `rads-log-events` queue the executor publishes `executor-finished` to.
- `REGION` - from the instance/AWS_REGION; not operator-set.
- `AlgorithmId`, `RunId`, `S3Bucket`, `S3Key` - from the launch request and `rads-algorithms` record.

The executor's data path is fixed: it writes `/opt/rads/run/records.json` and mounts `/opt/rads/run` at
`/data`, so the app contract is `RECORDS_PATH` (read) and `RESULT_PATH` (write).

Control-plane env used to launch the executor (from the same params): `EXECUTOR_AMI_ID`, `EXECUTOR_INSTANCE_TYPE`,
`EXECUTOR_SECURITY_GROUP_ID` (from stack), `EXECUTOR_INSTANCE_PROFILE_ARN` (from stack), plus `ALGORITHM_TABLE`
and `RUN_RESULTS_TABLE`.

## Executor permissions (per run)

The executor instance role can read `rads-images` (for the tar), send to `rads-run-results` (result delivery)
and `rads-log-events` (for `executor-finished`), and terminate itself (tag-scoped to `ManagedBy=rads-execution-service`).
