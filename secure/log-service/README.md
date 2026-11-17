# log-service

Serverless Framework v4, TypeScript. Stores the data-subject access trail: one row per `(DataSubjectId, algorithm, run)` recorded after a successful DC app run. This is the store that answers data-subject and supervisory-authority access queries.

Run, build, and debug events live in [`../telemetry-service`](../telemetry-service). Log Service accepts no timeline events and has no mTLS domain.

## Endpoints

The public domain carries the subject-access write and read paths:

- `POST /subject-access` - sce-unit posts one batch of `{algorithmId, runId, dataSubjectIds, timestamp}` after a successful DC app run, using the ids PDM returned for that run. The bearer token is verified, so only an attested enclave can write its own algorithm's trail.
- `GET /subject-access/{dataSubjectId}` - one data subject's chronological access entries as a key query.
- `GET /subject-access` - a cursor-paginated view over all access events for the authority dashboard. `?limit=` caps at 1000 (default 500); pass the returned `nextCursor` as `?cursor=` until it is `null`. Scan order is not chronological.

## Authentication

When `VERIFIER_JWKS_URL` is set, `POST /subject-access` verifies the ML-DSA-87 access token that verifier-service mints only after a successful Nitro attestation (`src/lib/jwt.ts` on the shared `@srads/common/jwt` verifier, with SPKI-pinned TLS on the JWKS fetch and `aud=log-service`). The token's `sub` must match the request's `algorithmId`, and the request's `runId` must match the token's `run_id`, so the trail cannot be written for another algorithm or run. The read paths are open, matching the PDM DSAR relay.

The `rads` baseline has no verifier, so its log-service accepts subject-access writes without a token.

## Key model

Partition key `DataSubjectId`, sort key `Sk = <timestamp>#<algorithmId>#<runId>`. That tuple is unique per item: a data subject's record lives on exactly one PDM page, so it is read once per run by exactly one algorithm. A redelivered ingest overwrites an identical row instead of appending a duplicate.

## Prerequisites (manual, one-time, outside this repo's IaC)

- A hostname with an issued ACM certificate: `log.sr.secure-rads.org`. Pass the certificate ARN as a param; the stack does not create it.

## Deploy

```sh
bun install
bunx serverless deploy \
  --param="domainName=log.sr.secure-rads.org" --param="certificateArn=$LOG_CERT_ARN"
```

Point the hostname at the stack output `PublicApiRegionalDomainName` with a DNS-only record.
