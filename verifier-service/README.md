# verifier-service

Serverless Framework v4, TypeScript. Receives `AlgorithmId` + PCR values from registry-service (build-time attestation registration) over mTLS and stores them in DynamoDB.

Bun is used as the local dev/bundle tool only (`bun install`) - the Lambda itself runs on the standard `nodejs20.x` runtime, no custom Bun runtime layer.

## Prerequisites (manual, one-time, outside this repo's IaC)

- A domain name + ACM certificate for it already provisioned - `serverless.yml` takes these as `domainName`/`certificateArn` params, it does not create them.
- registry-service's client cert (`csav/registry-service/tls/client.crt`, from `make gen-client-cert` there) uploaded as the truststore PEM to the `TruststoreBucket` this stack creates, before the custom domain's mTLS config can take effect. `TruststoreBucket` is versioned per AWS's guidance for safe truststore rollovers.
- Once deployed, the custom domain's TLS leaf cert pubkey SHA-256 needs to be read back and set as registry-service's `VERIFIER_PUBKEY_SHA256` (its own pin, checked in `csav/registry-service/verifier.go`) - this is a manual bootstrap step since both sides pin each other.

## Deploy

```
bun install
bunx serverless deploy --param="domainName=..." --param="certificateArn=..."
```
