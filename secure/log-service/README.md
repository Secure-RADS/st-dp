# log-service

Serverless Framework v4, TypeScript. A fire-and-forget run-timeline logger: SCE components POST timestamped events keyed by `(AlgorithmId, runId)` into an SQS queue, a worker writes them to DynamoDB, and operators export a run's or an algorithm's timeline as JSON or CSV for benchmarking.

## Endpoints

Two custom domains carry the routes.

The mTLS domain accepts internal producers only:

- `POST /events` - registry-service, execution-service, and result-consumer post `{algorithmId, runId, event, timestamp, detail?}`. The client certificate is the authentication; the event is stored with `auth: mtls` and `origin: service`.
- `POST /subject-access` - pdm-service posts one batch of `{algorithmId, runId, dataSubjectIds, timestamp}` each time it serves records to an enclave. It authenticates with its client certificate and forwards the enclave's bearer token, which is verified too.

The public domain, pinned by callers, carries the enclave and read paths:

- `POST /events` - sce-unit posts `{algorithmId, runId, event, timestamp, detail?, origin?}`. Events emitted after attestation carry the verifier-issued token and are stored with `auth: attested`. `enclave-started`, `unit-ready`, and host events have no token, are accepted with `auth: none`, and keep `origin: enclave` or `origin: host`.
- `GET /logs/{algorithmId}` - exports one algorithm's timeline. `?runId=` narrows to a single run. Pages through all results, never truncated.
- `GET /logs` - exports the whole table across all algorithms.
- `GET /subject-access` - the data-subject/authority read path. `?dataSubjectId=` returns one data subject's chronological access entries as a key query; omitting it scans and returns every access event for the authority dashboard.

Validation happens at ingest; valid events are enqueued and the handler returns `202` without waiting for DynamoDB.

## Ingest authentication

The mTLS domain is enforced by API Gateway. Clients present a self-signed certificate whose public cert is in the truststore. Registry-service, execution-service, result-consumer, and pdm-service each have their own cert and SSM parameters; the truststore is rebuilt from those certs at deploy time.

On the public domain, when `VERIFIER_JWKS_URL` is set, post-attestation `POST /events` calls verify the ML-DSA-87 access token that verifier-service mints only after a successful Nitro attestation (`src/lib/jwt.ts` on the shared `@srads/common/jwt` verifier, with SPKI-pinned TLS on the JWKS fetch and `aud=log-service`). The token's `sub` must match the request's `algorithmId`, and the request's `runId`, when present, must match the token's `run_id`.

Events emitted before attestation (`enclave-started`, `unit-ready`) and host events (`executor-ready`, `artifact-retrieved`, `enclave-launched`, `executor-finished`) are accepted without a token and stored with `auth: none`. The host posts them directly; it holds no log-service credential.

`run-failed` is emitted by the enclave before it exits. `executor-finished` is host-reported after the run result is published. result-consumer only emits `result-persisted`.

This applies to `secure` only. The `rads` baseline has no verifier or attested producer, so its log-service is unchanged.

Both export routes take `?format=csv` (`text/csv`) or default to JSON. CSV columns: `algorithmId,runId,event,timestamp,receivedAt,auth,origin,detail`, with `detail` as compact JSON per cell.

## Queue

`POST /events` `SendMessage`s onto a standard SQS queue. A worker Lambda consumes it:

- `batchSize` 10, `ReportBatchItemFailures` so one bad record does not redo the rest of the batch
- `reservedConcurrency` 5
- visibility timeout 60s (worker timeout is 30s)
- after 5 receives, SQS moves the message to a DLQ (14-day retention)

SQS retries on the visibility interval, then parks on the DLQ. That is not exponential backoff; a poison message should not sit on the main queue.

## Key model

Items are keyed by partition `AlgorithmId` and sort key `Sk = <runId>#<timestamp>#<event>`. ISO-8601 timestamps sort lexically, so a run's events come back in chronological order. Each item also stores `Auth` (`attested`, `mtls`, or `none`) and `Origin` (`enclave`, `host`, or `service`).

Bun is used as the local dev/bundle tool only (`bun install`) - the Lambda itself runs on the standard `nodejs24.x` runtime, no custom Bun runtime layer.

## Prerequisites (manual, one-time, outside this repo's IaC)

- Two hostnames with issued ACM certificates: `log.sr.secure-rads.org` (public) and `log-mtls.sr.secure-rads.org` (mTLS). Pass the certificate ARNs as params; the stack does not create them.
- Client certs for registry-service, execution-service, result-consumer, and pdm-service in SSM under `/secure-rads/log-service/mtls/clients/<client>/cert|key`. Generate and upload them with `scripts/gen-log-mtls-certs.sh`.

## Deploy

The mTLS domain needs a truststore version at creation, so the deploy is two-phase. The first deploy creates the stack and the versioned truststore bucket with the domain skipped:

```
bun install
bunx serverless deploy \
  --param="domainName=log.sr.secure-rads.org" --param="certificateArn=$LOG_CERT_ARN" \
  --param="mtlsDomainName=log-mtls.sr.secure-rads.org" --param="mtlsCertificateArn=$LOG_MTLS_CERT_ARN"
```

Upload the truststore from the SSM client certs and capture the version:

```
export TRUSTSTORE_BUCKET=$(aws cloudformation describe-stacks --stack-name secure-rads-log-service-dev \
  --query "Stacks[0].Outputs[?OutputKey=='TruststoreBucketName'].OutputValue" --output text)
scripts/upload-log-truststore.sh
```

Deploy again with `truststoreVersionId=<version>` to create the mTLS domain. Point both hostnames at the stack outputs `ApiRegionalDomainName` (mTLS) and `PublicApiRegionalDomainName` (public) with DNS-only records, then fill `LOG_MTLS_PUBKEY_SHA256` from the public endpoint, which shares the certificate.
