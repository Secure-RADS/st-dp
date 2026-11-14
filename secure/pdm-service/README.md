# pdm-service

Serverless Framework v4, TypeScript. The Personal Data Management Service: stores per-user personal-data records keyed by `AlgorithmId` in DynamoDB and serves them to an attested enclave.

## Endpoints

- `GET /records` - sce-unit presents the bearer access JWT it got from verifier-service's `/attest`. The JWT is verified **locally** (`src/lib/jwt.ts`): ML-DSA-87 signature against verifier-service's JWKS (`GET /.well-known/jwks.json` on the public domain, fetched with SPKI-pinned TLS and cached, refetched on unknown `kid`), plus `iss`/`aud`/`exp` checks. The `algorithmId` always comes from the verified token's `sub` claim and the `runId` from its `run_id` claim - never anything the client sends - and selects which records are returned. Paginated via `?cursor=` (base64url of DynamoDB's `LastEvaluatedKey`), 500 items per page. Records are ciphertext only; the wrapped data key lives in the `DataKeyTable` and is read by kms-service, never returned here. Every page is also recorded to log-service's `/subject-access` endpoint over its mTLS domain, using PDM's client certificate, as a GDPR access trail: the `dataSubjectId` of each served record, the algorithm, the timestamp, and the `runId` from the token's `run_id` claim. The enclave's bearer token is forwarded and verified as well, so log-service accepts the trail only from an attested caller reading its own algorithm. The write is best-effort so a log-service hiccup cannot block the enclave from getting its records.
- `GET /subject/{dataSubjectId}` - the public data-subject access-request endpoint. No auth (the identifier is an opaque UUID) and rate-limited via a small reserved concurrency; it relays to log-service's `/subject-access?dataSubjectId=` and returns which algorithms/runs touched that data subject. Never returns personal data.

Both routes are plain server-auth TLS and the HTTP API sets `cors: true` for the transparency portal. The `records` route's identity proof is the attestation-backed access token, not a client cert (which would be extractable from the EIF). There is no verifier round-trip per request anymore - claims and expiry are defined in verifier-service's README (access JWTs, ML-DSA-87, `iss=verifier-service`, `aud` includes `pdm-service`, `sub=algorithmId`).

Bun is used as the local dev/bundle tool only (`bun install`) - the Lambda itself runs on the standard `nodejs24.x` runtime, no custom Bun runtime layer. (ML-DSA verification goes through the runtime's WebCrypto, which needs Node.js 24.7+.)

## Prerequisites (manual, one-time, outside this repo's IaC)

- A domain name (`pdm.sr.secure-rads.org`) + ACM certificate already provisioned - `serverless.yml` takes these as `domainName`/`certificateArn` params, it does not create them.
- verifier-service's public (attest) domain TLS leaf cert pubkey SHA-256, passed as the `verifierJwksPubkeySha256` param - pinned on JWKS fetches on top of normal CA verification. Without the pin, a MITM could swap in its own JWKS and mint tokens that verify locally.
- verifier-service deployed with its ML-DSA-87 signing key at SSM `/verifier-service/jwt-signing-key` (see secure/verifier-service/README.md).

## Deploy

```
bun install
bunx serverless deploy --param="domainName=pdm.sr.secure-rads.org" --param="certificateArn=..." --param="verifierJwksPubkeySha256=..."
```
