# rads-pdm-service

Serverless Framework v4, TypeScript. The Personal Data Management Service for the baseline: stores per-user personal-data records as plaintext JSON in one DynamoDB table per algorithm, named `<PDM_TABLE_PREFIX>-<algorithmId>`, and serves them to the executor. The stack does not own the tables; seeding creates them.

## Endpoints

- `GET /records` - `?algorithmId=` selects which records are returned. Paginated via `?cursor=` (base64url of DynamoDB's `LastEvaluatedKey`), 500 items per page. The response also carries a standalone `dataSubjectIds` list aligned with `records`: the rads host assembles the GDPR access trail from it after a successful DC app run, and `records` stays `{recordId, data}`, so the DC app never sees subject ids. PDM itself writes nothing to the log on retrieval.
- `GET /count` - public metadata endpoint used by execution-service's size check. Returns the seeded record count for `?algorithmId=` and stops early when `?size=` is supplied. Never returns personal data.
- `GET /subject/{dataSubjectId}` - the public data-subject access-request endpoint. No auth (the identifier is an opaque UUID) and rate-limited via a small reserved concurrency; it relays to log-service's `/subject-access/{dataSubjectId}` and returns which algorithms/runs touched that data subject. Never returns personal data.

The baseline PDM is fully trusted: there is no access token, verifier round-trip, or envelope encryption, and records are stored and returned as plaintext. Both routes are plain server-auth TLS and the HTTP API sets `cors: true` for the transparency portal.

Bun is used as the local dev/bundle tool only (`bun install`) - the Lambda itself runs on the standard `nodejs24.x` runtime, no custom Bun runtime layer.

## Prerequisites (manual, one-time, outside this repo's IaC)

- A domain name (`pdm.r.secure-rads.org`) + ACM certificate already provisioned - `serverless.yml` takes these as `domainName`/`certificateArn` params, it does not create them.

## Deploy

```sh
bun install
bunx serverless deploy --param="domainName=pdm.r.secure-rads.org" --param="certificateArn=..."
```
