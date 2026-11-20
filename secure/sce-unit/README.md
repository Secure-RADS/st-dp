# sce-unit

The composed image's real entrypoint. Runs as root, requests a single-use verifier
challenge, starts the jailed Data Controller app, then serves it over an AF_UNIX
gRPC socket at `/data/sce.sock`. The app calls `FetchRecords`, which triggers
attestation to the Verifier Service with that challenge as the NSM nonce, fetches
the algorithm's PDM records, unwraps the data key via the KMS Service, decrypts
each protobuf `RecordEnvelope`, and streams `sce.v1.Record` messages back. The app
computes and calls `SubmitResult` with one `google.protobuf.Struct`; sce-unit
converts that result to JSON and streams it to the parent instance over vsock
(CID 3, port 5000) - the enclave's only channel out.

PDM returns a standalone `dataSubjectIds` list aligned with the records. sce-unit
keeps those ids in memory, never exposes them to the DC app, and after a
successful DC app run posts the list to log-service `POST /subject-access` with
its attested token. Run-timeline events go to telemetry-service instead, without a token. The DC app never sees subject ids.
