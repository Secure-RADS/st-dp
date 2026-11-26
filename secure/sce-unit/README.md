# sce-unit

The composed image's real entrypoint. Runs as root, requests a single-use verifier
challenge, attests to the Verifier Service with that challenge as the NSM nonce,
fetches and decrypts
PDM records, writes `records.json` under the DC rootfs `/data` (JSON shape
`algorithmId` + `records`, same load path as rads), starts nsjail with
`RECORDS_PATH` / `RESULT_PATH` set, reads the DC app's `result.json`, then signs
the result fields with the ephemeral key it registered during attestation.

sce-unit POSTs the signed envelope to the run's DC webhook over CA-verified TLS
through a per-run vsock-proxy. The signature, not the transport, is what keeps a
compromised host from forging a result.

PDM returns a standalone `dataSubjectIds` list aligned with the records. sce-unit
keeps those ids in memory, writes `records.json` without them, and after a
successful DC app run posts the list to log-service `POST /subject-access` with
its attested token. Run-timeline events go to telemetry-service instead, without a token. The DC app never sees subject ids.
