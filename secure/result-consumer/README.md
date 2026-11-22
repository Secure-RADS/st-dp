# result-consumer

Serverless Framework v4, TypeScript. The consumer half of the async run-result flow: an SQS-triggered Lambda that reads enclave run-result messages and writes them to the `RunResults` DynamoDB table (keyed by `RunId`), where execution-service's `GET /run/{runId}` reads them back.

## Resources

- `RunResultsQueue` - standard SQS queue the enclave host forwards signed run results to. 60s visibility timeout, 14-day retention, redrive to `RunResultsDLQ` after 3 receives.
- `RunResultsDLQ` - dead-letter queue for messages that keep failing.
- `RunResultsTable` - PAY_PER_REQUEST DynamoDB table, PK `RunId`.

The enclave signs the result fields with the ephemeral key it registered during attestation. The host only forwards `{ runId, algorithmId, instanceId?, payload, signature }`, where `payload` is base64 of the exact signed JSON bytes.

For each message the `consume` Lambda:

1. reads the run's attested public key from `RunAttestationTable`;
2. verifies the signature and checks the signed `runId`/`algorithmId` match the attested run;
3. `PutItem`s the verified fields (idempotent on `RunId`).

A message with no valid `runId`, no attested key, or an invalid signature is skipped, not thrown, so it can't block the rest of the batch; it ages out to the DLQ. DynamoDB errors throw so the batch retries.

When the signature verifies it also writes `result-persisted` to telemetry-service over plain HTTPS. It does not emit host or terminal events; the enclave owns those.

The stack Outputs (`RunResultsQueueUrl`, `RunResultsQueueArn`, `RunResultsTableName`, `RunResultsTableArn`) are consumed by execution-service.

Bun is used as the local dev/bundle tool only (`bun install`) - the Lambda itself runs on the standard `nodejs24.x` runtime, no custom Bun runtime layer.

## Deploy

Deploy verifier-service first, then pass its run-attestation table name:

```sh
RUN_ATTESTATION_TABLE=$(aws cloudformation describe-stacks \
  --stack-name secure-rads-verifier-service-dev \
  --query "Stacks[0].Outputs[?OutputKey=='RunAttestationTableName'].OutputValue" --output text)
bun install
bunx serverless deploy --param="runAttestationTable=$RUN_ATTESTATION_TABLE"
```
