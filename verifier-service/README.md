# verifier-service

Serverless Framework v4, TypeScript. Receives `AlgorithmId` + PCR values from registry-service (build-time attestation registration) over mTLS and stores them in DynamoDB.

## Endpoints (all mTLS-only, see below)

- `POST /algorithms` - registry-service registers `AlgorithmId` -> PCR0/1/2 at build time.
- `POST /attest` - sce-unit submits a real Nitro attestation document (base64 COSE_Sign1 bytes) + `algorithmId`. Verified against the pinned AWS Nitro root cert chain and the registered PCRs; on success, issues a short-lived access token + longer-lived refresh token, persisted in `AttestationSessionTable`.
- `POST /refresh` - exchanges a still-valid refresh token for a new access token, without requiring a fresh attestation document.
- `POST /validate` - what downstream services call to check whether an access token sce-unit presented is currently valid, without redoing attestation verification itself.

The AWS Nitro root cert (`certs/AWS_NitroEnclaves_Root-G1.pem`) is pinned/committed here, not fetched at runtime - downloaded from `https://aws-nitro-enclaves.amazonaws.com/AWS_NitroEnclaves_Root-G1.zip` per AWS's own documented distribution channel.

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
