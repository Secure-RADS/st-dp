# rads-pdm-service

Serverless Framework v4, TypeScript. The Personal Data Management Service for the baseline: stores per-user personal-data records keyed by `AlgorithmId` in DynamoDB as plaintext JSON and serves them to the executor.

## Endpoints

- `GET /records` - `?algorithmId=` selects which records are returned. Paginated via `?cursor=` (base64url of DynamoDB's `LastEvaluatedKey`), 500 items per page. Each record also carries its `dataSubjectId`: the rads host assembles the GDPR access trail from those ids after a successful DC app run and strips them before writing `records.json`, so the DC app only ever sees data. PDM itself writes nothing to the log on retrieval.
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
