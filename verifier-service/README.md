# verifier-service

Serverless Framework v4, TypeScript. Receives `AlgorithmId` + PCR values from registry-service (build-time attestation registration) over mTLS and stores them in DynamoDB.

## Endpoints (two separate custom domains, see below)

- `POST /algorithms` (mTLS domain) - registry-service registers `AlgorithmId` -> PCR0/1/2 at build time.
- `POST /attest` (public domain) - sce-unit submits a real Nitro attestation document (base64 COSE_Sign1 bytes) + `algorithmId`. Verified against the pinned AWS Nitro root cert chain and the registered PCRs; on success, issues a short-lived access token + longer-lived refresh token, persisted in `AttestationSessionTable`.
- `POST /refresh` (public domain) - exchanges a still-valid refresh token for a new access token, without requiring a fresh attestation document.
- `POST /validate` (both domains) - what downstream services call to check whether an access token sce-unit presented is currently valid, without redoing attestation verification itself. Served on the mTLS domain for services holding a client cert (pdm-service), and kept on the public domain too.

`/attest` and `/refresh` are deliberately not behind mTLS: a static client cert baked into the EIF would be extractable by anyone who can pull the artifact from S3 and decompose it, and would be redundant anyway - the attestation document itself (PCR0/1/2) is the real identity proof. So they (plus `/validate`'s public copy) live on a second `AWS::ApiGatewayV2::Api` with a plain-TLS custom domain, pinned by callers to its leaf pubkey instead (same scheme registry-service already uses against the mTLS domain).

The AWS Nitro root cert (`certs/AWS_NitroEnclaves_Root-G1.pem`) is pinned/committed here, not fetched at runtime - downloaded from `https://aws-nitro-enclaves.amazonaws.com/AWS_NitroEnclaves_Root-G1.zip` per AWS's own documented distribution channel.

Bun is used as the local dev/bundle tool only (`bun install`) - the Lambda itself runs on the standard `nodejs20.x` runtime, no custom Bun runtime layer.

## Prerequisites (manual, one-time, outside this repo's IaC)

- Two domain names + ACM certificates already provisioned, one per custom domain - `serverless.yml` takes these as `domainName`/`certificateArn` (mTLS) and `publicDomainName`/`publicCertificateArn` (plain TLS) params, it does not create them.
- The truststore PEM in `TruststoreBucket` bundles every mTLS client cert: registry-service's (`csav/registry-service/tls/client.crt`, from `make gen-client-cert` there) and pdm-service's (see pdm-service/README.md). Upload it to the `TruststoreBucket` this stack creates, before the mTLS custom domain's config can take effect. `TruststoreBucket` is versioned per AWS's guidance for safe truststore rollovers.
- Once deployed, each custom domain's TLS leaf cert pubkey SHA-256 needs to be read back and pinned on the other side: the mTLS domain's into registry-service's `VERIFIER_PUBKEY_SHA256` (`csav/registry-service/verifier.go`), the public domain's into registry-service's `VERIFIER_HOST`/pubkey used to bake `sce-unit`'s run config (`csav/registry-service/rootfs.go`) and into execution-service's `VERIFIER_HOST` (`sce/execution-service/Makefile`). Manual bootstrap step since both sides pin each other.

## Deploy

```
bun install
bunx serverless deploy --param="domainName=..." --param="certificateArn=..." --param="publicDomainName=..." --param="publicCertificateArn=..."
```
