# kms-service

Serverless Framework v4, TypeScript. The enclave's only path to AWS KMS: it authorizes a caller by the verifier access token and performs `Decrypt` on the caller's behalf.

The enclave has no AWS credentials and no network. It sends its NSM attestation document to `POST /decrypt`; kms-service looks up the algorithm's CMK and wrapped data key, calls `kms:Decrypt` with the attestation document as `Recipient`, and returns `CiphertextForRecipient` - encrypted to the ephemeral public key inside that document. Only the measured enclave can unwrap it, so this service never handles plaintext key material. The per-algorithm key policy's `kms:RecipientAttestation:ImageSha384`/`PCR1`/`PCR2` conditions are still what authorize the call.

Before this service existed, the enclave held AWS credentials served over vsock by the host, dialled KMS through a `vsock-proxy` allowlist entry, and the enclave-host role carried `kms:Decrypt *`. All three are gone; the host role no longer has any KMS permission beyond the artifact bucket.

## Endpoint

`POST /decrypt`

- `Authorization: Bearer <access JWT>` from verifier-service `/attest`. The token must carry `aud=kms-service`; `algorithmId` comes only from `sub`.
- `X-Run-Id` (optional) for cost attribution.
- Body: `{ "attestationDocument": "<base64 COSE_Sign1>" }`.
- Response: `{ "ciphertextForRecipient": "<base64>" }` or an error.

The wrapped data key and the KMS key ARN both come from DynamoDB (`AlgorithmTable`, `DataKeyTable`), never from the request.

## Security notes

- The token is a bearer credential valid for 2 hours. It only lets a caller ask for a data key under a matching attestation document; KMS returns ciphertext addressed to that document's ephemeral key, so a leaked token cannot produce a usable plaintext key off-enclave.
- The wrapped data key and key ARN are read from DynamoDB by `algorithmId` (token `sub`), never accepted from the request.
- The service role has `kms:Decrypt` on `*` because per-algorithm keys are created after this stack deploys. The key policy's `kms:RecipientAttestation:ImageSha384`/`PCR1`/`PCR2` conditions are the actual authorization boundary.
- A token holder can still make the service attempt decrypts with invalid documents. Awaiting KMS costs quota but never returns usable key material; add throttling here if that becomes a concern.

## Prerequisites

- verifier-service deployed, with `VERIFIER_JWKS_URL` / `VERIFIER_JWKS_PUBKEY_SHA256` exported.
- A domain name + ACM certificate for this service (`kms.sr.secure-rads.org`), passed as `domainName`/`certificateArn`.
- `algorithmTable` from the registry-service storage stack and `dataKeyTable` from the pdm-service stack.

## Deploy

```
bun install
bunx serverless deploy \
  --param="domainName=kms.sr.secure-rads.org" --param="certificateArn=..." \
  --param="algorithmTable=..." --param="dataKeyTable=..."
```

Read back `ApiRegionalDomainName`'s leaf pubkey SHA-256 and set `KMS_HOST_PUBKEY_SHA256` before building any algorithm: the enclave pins it in the EIF run config. Set `KMS_HOST` to the same domain. Then redeploy registry-service with `KMS_SERVICE_ROLE_ARN` set to this stack's `KmsServiceRoleArn` output and rebuild each algorithm so its key policy names this role.
