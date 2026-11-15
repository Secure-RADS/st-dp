# sce-unit

The composed image's real entrypoint. Runs as root, attests, fetches and decrypts
PDM records, writes `records.json` under the DC rootfs `/data` (JSON shape
`algorithmId` + `records`, same load path as rads), starts nsjail with
`RECORDS_PATH` / `RESULT_PATH` set, reads the DC app's `result.json`, then streams
that result to the parent instance over vsock (CID 3, port 5000) - the enclave's
only channel out.

PDM returns a standalone `dataSubjectIds` list aligned with the records. sce-unit
keeps those ids in memory, writes `records.json` without them, and after a
successful DC app run posts the list to log-service `POST /subject-access` with
its attested token. The DC app never sees subject ids.
