# rads-pdm-service

Serverless Framework v4, TypeScript. The Personal Data Management Service for the baseline: stores per-user personal-data records keyed by `AlgorithmId` in DynamoDB as plaintext JSON and serves them to the executor.

## Endpoints

- `GET /records` - `?algorithmId=` selects which records are returned. Paginated via `?cursor=` (base64url of DynamoDB's `LastEvaluatedKey`), 500 items per page. Every page is also recorded to log-service's `/subject-access` endpoint as a GDPR access trail: the `dataSubjectId` of each served record, the algorithm, the timestamp, and the executor-supplied `X-Run-Id` header. The write is best-effort so a log-service hiccup cannot block the executor from getting its records.
- `GET /subject/{dataSubjectId}` - the public data-subject access-request endpoint. No auth (the identifier is an opaque UUID) and rate-limited via a small reserved concurrency; it relays to log-service's `/subject-access/{dataSubjectId}` and returns which algorithms/runs touched that data subject. Never returns personal data.

The baseline PDM is fully trusted: there is no access token, verifier round-trip, or envelope encryption, and records are stored and returned as plaintext. Both routes are plain server-auth TLS and the HTTP API sets `cors: true` for the transparency portal.

Bun is used as the local dev/bundle tool only (`bun install`) - the Lambda itself runs on the standard `nodejs20.x` runtime, no custom Bun runtime layer.

## Prerequisites (manual, one-time, outside this repo's IaC)

- A domain name (`pdm.r.secure-rads.org`) + ACM certificate already provisioned - `serverless.yml` takes these as `domainName`/`certificateArn` params, it does not create them.

## Deploy

```
bun install
bunx serverless deploy --param="domainName=pdm.r.secure-rads.org" --param="certificateArn=..."
```
