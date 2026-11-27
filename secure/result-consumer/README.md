# result-consumer

Serverless Framework v4, TypeScript. HTTPS receiver for the enclave's signed run result.

## Flow

`POST /results` accepts the signed envelope `{ runId, algorithmId, payload, signature }`:

1. Fetch the run's attested public key from verifier-service `GET /runs/{runId}`, pinned to the verifier leaf SPKI.
2. Check the returned `runId` matches, then verify the signature and signed `algorithmId`.
3. `PutItem` the verified fields into `RunResultsTable`, which execution-service reads back at `GET /run/{runId}`.

Returns `200` on success, `400` for malformed input, `404` when the run has not attested, and `401` for an invalid signature. DynamoDB errors return `500` so the enclave's webhook retry can try again.

## Resources

- `RunResultsTable` - PAY_PER_REQUEST DynamoDB table, PK `RunId`.
- `ResultWebhookUrl` - output consumed by execution-service as the default webhook target.

Deploy verifier-service first so `GET /runs/{runId}` exists:

```sh
bun install
bunx serverless deploy --param="region=$REGION"
```
