# sce-unit

The composed image's real entrypoint. Runs as root, attests, fetches and decrypts
PDM records, writes `records.json` under the DC rootfs `/data` (same JSON shape as
rads: `algorithmId`, `pages`, `records`), starts nsjail with `RECORDS_PATH` /
`RESULT_PATH` set, reads the DC app's `result.json`, then streams that result to the
parent instance over vsock (CID 3, port 5000) - the enclave's only channel out.
