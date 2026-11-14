# result-consumer

Serverless Framework v4, TypeScript. The consumer half of the async run-result flow: an SQS-triggered Lambda that reads enclave run-result messages and writes them to the `RunResults` DynamoDB table (keyed by `RunId`), where execution-service's `GET /run/{runId}` reads them back.

## Resources

- `RunResultsQueue` - standard SQS queue the enclave host produces JSON run results to. 60s visibility timeout, 14-day retention, redrive to `RunResultsDLQ` after 3 receives.
- `RunResultsDLQ` - dead-letter queue for messages that keep failing.
- `RunResultsTable` - PAY_PER_REQUEST DynamoDB table, PK `RunId`.

The `consume` Lambda parses each message `{ runId, instanceId?, algorithmId?, status?, output?, diag? }` and `PutItem`s it (idempotent on `RunId`). A message with no valid `runId` is skipped, not thrown, so it can't block the rest of the batch; it ages out to the DLQ. DynamoDB errors throw so the batch retries.

When `algorithmId` is present it also writes `result-persisted` to log-service over its mTLS domain, using a client cert from SSM. It does not emit host or terminal events; the enclave owns those.

The stack Outputs (`RunResultsQueueUrl`, `RunResultsQueueArn`, `RunResultsTableName`, `RunResultsTableArn`) are consumed by execution-service.

Bun is used as the local dev/bundle tool only (`bun install`) - the Lambda itself runs on the standard `nodejs24.x` runtime, no custom Bun runtime layer.

## Deploy

```
bun install
bunx serverless deploy
```
