# verifier-service

Serverless Framework v4, TypeScript. Receives `AlgorithmId` + PCR values from registry-service (build-time attestation registration) over mTLS and stores them in DynamoDB.

## Endpoints (two separate custom domains, see below)

- `POST /algorithms` (mTLS domain) - registry-service registers `AlgorithmId` -> PCR0/1/2 at build time.
- `POST /challenge` (public domain) - sce-unit asks for a single-use nonce before attesting. The row is stored hashed in `AttestationChallengeTable` with a 60 s TTL and is bound to the `algorithmId` and `runId` in the request.
- `POST /attest` (public domain) - sce-unit submits a real Nitro attestation document (base64 COSE_Sign1 bytes) + `algorithmId` + `runId` + the `challenge` it was issued. The document's `nonce` must equal the challenge, and the challenge is consumed atomically before the PCR check, so a captured document cannot be replayed. Verified against the pinned AWS Nitro root cert chain and the registered PCRs; on success, issues a signed access JWT + opaque refresh token (persisted in `AttestationSessionTable`, including `RunId`).
- `POST /refresh` (public domain) - exchanges a still-valid refresh token plus its `runId` for a new access JWT, without requiring a fresh attestation document. The `runId` must match the one stored on the session.
- `GET /.well-known/jwks.json` (public domain) - the ML-DSA-87 public key downstream services use to verify access JWTs locally. Public by definition, no auth.

### Access token format (ML-DSA-87 compact JWS)

Downstream services (pdm-service, kms-service, log-service) verify the JWT locally against the JWKS endpoint - there is no `/validate` round-trip. Claims:

| Claim | Value | Meaning |
| --- | --- | --- |
| `iss` | `verifier-service` | fixed issuer, checked on every verification |
| `sub` | algorithm ID | the only source of `algorithmId` downstream services trust; PCRs were already matched at `/attest` |
| `aud` | `pdm-service`, `kms-service`, `log-service` | audience restriction, checked on every verification; each service accepts only its own audience |
| `iat` | unix seconds | issuance time (not enforced, informational) |
| `exp` | unix seconds | expiry; `exp * 1000 <= now` rejects the token, no clock skew tolerance (both sides are AWS-hosted) |
| `jti` | random 32 hex chars | unique per minted token, even within one refresh session |
| `run_id` | run ID from `/attest` | the only source of `runId` pdm-service and kms-service trust for cost and DSAR attribution; a token without it is rejected |

Expiry behavior: access tokens live **2 hours** (`ACCESS_TOKEN_TTL_SECONDS` in `src/lib/tokens.ts`). sce-unit refreshes 30 s before expiry via `/refresh`; the refresh token itself is opaque, lives **4 hours** (it must outlive the access token), and is stored SHA-256-hashed with a `Revoked` flag in `AttestationSessionTable` - revoking a session row stops refreshes immediately, and already-minted access JWTs die within at most 2 hours. Signing key: an ML-DSA-87 (FIPS 204) private key in SSM SecureString `/verifier-service/jwt-signing-key`, whose `kid` is the RFC 7638 thumbprint of its public JWK.

`/attest`, `/challenge`, and `/refresh` are deliberately not behind mTLS: a static client cert baked into the EIF would be extractable by anyone who can pull the artifact from S3 and decompose it, and would be redundant anyway - the attestation document itself (PCR0/1/2) is the real identity proof. So they (plus the JWKS endpoint) live on a second `AWS::ApiGatewayV2::Api` with a plain-TLS custom domain, pinned by callers to its leaf pubkey instead (same scheme registry-service already uses against the mTLS domain).

The AWS Nitro root cert (`certs/AWS_NitroEnclaves_Root-G1.pem`) is pinned/committed here, not fetched at runtime - downloaded from `https://aws-nitro-enclaves.amazonaws.com/AWS_NitroEnclaves_Root-G1.zip` per AWS's own documented distribution channel.

Bun is used as the local dev/bundle tool only (`bun install`) - the Lambda itself runs on the standard `nodejs24.x` runtime, no custom Bun runtime layer. (ML-DSA signing goes through the runtime's WebCrypto, which needs Node.js 24.7+.)

## Prerequisites (manual, one-time, outside this repo's IaC)

- Two domain names + ACM certificates already provisioned, one per custom domain - `serverless.yml` takes these as `domainName`/`certificateArn` (mTLS) and `publicDomainName`/`publicCertificateArn` (plain TLS) params, it does not create them.
- The truststore PEM in `TruststoreBucket` bundles every mTLS client cert: registry-service's (`secure/csav/registry-service/tls/client.crt`, from `make gen-client-cert` there) and pdm-service's (see `secure/pdm-service/README.md`). `TruststoreBucket` is versioned per AWS's guidance for safe truststore rollovers.
- Once deployed, each custom domain's TLS leaf cert pubkey SHA-256 needs to be read back and pinned on the other side: the mTLS domain's into registry-service's `VERIFIER_PUBKEY_SHA256` (`secure/csav/registry-service/verifier.go`), the public domain's into registry-service's `VERIFIER_HOST`/pubkey used to bake `sce-unit`'s run config (`secure/csav/registry-service/rootfs.go`), into execution-service's `VERIFIER_HOST` (`secure/sce/execution-service/Makefile`), and into pdm-service's `verifierJwksPubkeySha256` (pinned on JWKS fetches). Manual bootstrap step since both sides pin each other.
- An ML-DSA-87 (FIPS 204) JWT signing key, stored as an SSM SecureString at `/verifier-service/jwt-signing-key`:

```
openssl genpkey -algorithm ML-DSA-87 -out jwt-signing-key.pem
aws ssm put-parameter --name /verifier-service/jwt-signing-key --type SecureString --value file://jwt-signing-key.pem
```

(The key must be PKCS#8 "BEGIN PRIVATE KEY" PEM - `genpkey` emits this by default. ML-DSA generation needs OpenSSL 3.5+.)

## Deploy

First deploy the functions, tables, and truststore bucket without `truststoreVersionId`. Then upload the truststore and deploy again with the returned version ID to create the mTLS custom domain.

```
bun install
bunx serverless deploy --param="domainName=..." --param="certificateArn=..." --param="publicDomainName=..." --param="publicCertificateArn=..."

aws s3api put-object --bucket <truststore-bucket> --key truststore.pem \
  --body ../csav/registry-service/tls/client.crt --query VersionId --output text

bunx serverless deploy --param="domainName=..." --param="certificateArn=..." \
  --param="publicDomainName=..." --param="publicCertificateArn=..." \
  --param="truststoreVersionId=<version-id>"
```
