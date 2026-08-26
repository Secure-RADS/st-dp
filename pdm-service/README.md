# pdm-service

Serverless Framework v4, TypeScript. The Personal Data Management Service: stores per-user personal-data records keyed by `AlgorithmId` in DynamoDB and serves them to an attested enclave.

## Endpoints

- `GET /records` - sce-unit presents the bearer access token it got from verifier-service's `/attest`. The token is checked against verifier-service's `POST /validate` (over mTLS, server pubkey pinned), and the `algorithmId` from that response - never anything the client sends - selects which records are returned. Paginated via `?cursor=` (base64url of DynamoDB's `LastEvaluatedKey`), 500 items per page.

The route is plain server-auth TLS: the enclave's identity proof is the attestation-backed access token, not a client cert (which would be extractable from the EIF). The mTLS in play here is on the outgoing call - pdm-service is itself a client of verifier-service's mTLS-protected `/validate`.

Bun is used as the local dev/bundle tool only (`bun install`) - the Lambda itself runs on the standard `nodejs20.x` runtime, no custom Bun runtime layer.

## Prerequisites (manual, one-time, outside this repo's IaC)

- A domain name (`gdpr-pdm.prdai.dev`) + ACM certificate already provisioned - `serverless.yml` takes these as `domainName`/`certificateArn` params, it does not create them.
- A client cert/key pair for calling verifier-service's mTLS domain, stored as SSM SecureString parameters `/pdm-service/verifier-client-cert` and `/pdm-service/verifier-client-key` (fetched with decryption at Lambda cold start). The client cert must also be appended to verifier-service's truststore PEM in its `TruststoreBucket`, or the mTLS handshake to `/validate` fails.
- verifier-service's mTLS domain TLS leaf cert pubkey SHA-256, passed as the `verifierPubkeySha256` param - pinned on every `/validate` call on top of normal CA verification.

## Deploy

```
bun install
bunx serverless deploy --param="domainName=gdpr-pdm.prdai.dev" --param="certificateArn=..." --param="verifierPubkeySha256=..."
```
