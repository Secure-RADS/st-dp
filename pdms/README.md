# pdms

Personal Data Management Service. Serverless Framework v4, TypeScript - same pattern as verifier-service (Bun as local dev/bundle tool only, runs on standard `nodejs20.x`).

Stub only - accepts a request from sce-unit with its access token, calls verifier-service's `/introspect` over mTLS to check it's valid, and returns a placeholder response. No real personal-data storage/retrieval logic yet; that's future work.

## Prerequisites (manual, one-time, outside this repo's IaC)

- A domain name + ACM certificate for it already provisioned - `serverless.yml` takes these as `domainName`/`certificateArn` params, it does not create them.
- `make gen-client-cert` generates PDMS's own mTLS identity to verifier-service (`certs/client.crt`/`certs/client.key`, gitignored - PoC trust material, not committed).
- sce-unit's PDMS-specific client cert (baked into the EIF by registry-service, see `csav/registry-service/rootfs.go`) uploaded as the truststore PEM to the `TruststoreBucket` this stack creates.
- verifier-service's leaf cert pubkey SHA-256 set as `VERIFIER_PUBKEY_SHA256` here (this stack pins verifier-service, same as registry-service does).
- Once deployed, this stack's own leaf cert pubkey SHA-256 needs to be read back and baked into sce-unit as its pin for calling PDMS.

## Deploy

```
make gen-client-cert
bun install
bunx serverless deploy --param="domainName=..." --param="certificateArn=..." --param="verifierIntrospectUrl=..." --param="verifierPubkeySha256=..."
```
