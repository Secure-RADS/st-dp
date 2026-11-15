# sce-unit

The composed image's real entrypoint. Runs as root, attests, fetches and decrypts
PDM records, writes `records.json` under the DC rootfs `/data` (JSON shape
`algorithmId` + `records`, same load path as rads), starts nsjail with
`RECORDS_PATH` / `RESULT_PATH` set, reads the DC app's `result.json`, then streams
that result to the parent instance over vsock (CID 3, port 5000) - the enclave's
only channel out.

Each PDM record carries its `dataSubjectId`. sce-unit keeps those ids in memory,
strips them from `records.json`, and after a successful DC app run posts the list
to log-service `POST /subject-access` with its attested token. The DC app never
sees subject ids.
