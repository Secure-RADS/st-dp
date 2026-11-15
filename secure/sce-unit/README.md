# sce-unit

The composed image's real entrypoint. Runs as root, requests a single-use verifier
challenge, attests to the Verifier Service with that challenge as the NSM nonce,
fetches and decrypts
PDM records, writes `records.json` under the DC rootfs `/data` (JSON shape
`algorithmId` + `records`, same load path as rads), starts nsjail with
`RECORDS_PATH` / `RESULT_PATH` set, reads the DC app's `result.json`, then streams
that result to the parent instance over vsock (CID 3, port 5000) - the enclave's
only channel out.
