# pdm-service

Serverless Framework v4, TypeScript. The Personal Data Management Service: stores per-user personal-data records keyed by `AlgorithmId` in DynamoDB and serves them to an attested enclave.

## Endpoints

- `GET /records` - sce-unit presents the bearer access JWT it got from verifier-service's `/attest`. The JWT is verified **locally** (`src/lib/jwt.ts`): ES256 signature against verifier-service's JWKS (`GET /.well-known/jwks.json` on the public domain, fetched with SPKI-pinned TLS and cached, refetched on unknown `kid`), plus `iss`/`aud`/`exp` checks. The `algorithmId` always comes from the verified token's `sub` claim - never anything the client sends - and selects which records are returned. Paginated via `?cursor=` (base64url of DynamoDB's `LastEvaluatedKey`), 500 items per page.

The route is plain server-auth TLS: the enclave's identity proof is the attestation-backed access token, not a client cert (which would be extractable from the EIF). There is no verifier round-trip per request anymore - claims and expiry are defined in verifier-service's README (5-minute access JWTs, ES256, `iss=verifier-service`, `aud=pdm-service`, `sub=algorithmId`).

Bun is used as the local dev/bundle tool only (`bun install`) - the Lambda itself runs on the standard `nodejs20.x` runtime, no custom Bun runtime layer.

## Prerequisites (manual, one-time, outside this repo's IaC)

- A domain name (`gdpr-pdm.prdai.dev`) + ACM certificate already provisioned - `serverless.yml` takes these as `domainName`/`certificateArn` params, it does not create them.
- verifier-service's public (attest) domain TLS leaf cert pubkey SHA-256, passed as the `verifierJwksPubkeySha256` param - pinned on JWKS fetches on top of normal CA verification. Without the pin, a MITM could swap in its own JWKS and mint tokens that verify locally.
- verifier-service deployed with its ES256 signing key at SSM `/verifier-service/jwt-signing-key` (see verifier-service/README.md).

## Deploy

```
bun install
bunx serverless deploy --param="domainName=gdpr-pdm.prdai.dev" --param="certificateArn=..." --param="verifierJwksPubkeySha256=..."
```
