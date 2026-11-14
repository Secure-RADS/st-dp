# sce-unit

The composed image's real entrypoint. Runs as root, attests, fetches and decrypts
PDM records, writes `records.json` under the DC rootfs `/data` (JSON shape
`algorithmId` + `records`, same load path as rads), starts nsjail with
`RECORDS_PATH` / `RESULT_PATH` set, reads the DC app's `result.json`, then publishes
the result to the results SQS queue itself (through the host's vsock-proxy). It signals
the parent instance over vsock (CID 3, port 5000) with the result byte count - the
result body never crosses that channel.
