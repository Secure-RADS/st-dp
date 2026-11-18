# Benchmark phases: what each timing window counts

`benchmark/src/export.py` turns the two event streams into `benchmark/results/phase-timings.csv`. The windows are
defined once, in `PHASES` in that file. This page explains what work falls inside each one and what does not.

Event names and ordering come from [`docs/e2e-rads.txt`](e2e-rads.txt) and
[`docs/e2e-secure-rads.txt`](e2e-secure-rads.txt). A change to either the producer or the event list must update
both the allowlist in `telemetry-service/src/lib/events.ts` and `PHASES` in `benchmark/src/export.py`.

## How a phase is computed

- Every producer posts `{algorithmId, runId, event, timestamp, detail?, origin?}` to telemetry-service `POST /events`.
- `export.py` fetches a run's events, sorts them by timestamp, and keeps the first timestamp per event name.
- A phase is `end event timestamp - start event timestamp`.
- A missing endpoint leaves the cell blank. This happens when the step does not apply to a tree, or when the run
  predates the event.
- Timestamps are producer wall-clock, UTC RFC3339Nano, so each phase includes network and scheduling latency around
  the measured work.

## Event order

Execution phase, in emit order.

| rads (CE) | secure-rads (SCE) |
| --- | --- |
| `run-requested` (control plane) | `run-requested` (control plane) |
| `executor-launched` (control plane) | `executor-launched` (control plane) |
| `executor-ready` (host) | `executor-ready` (host) |
| `artifact-retrieved` (host) | `artifact-retrieved` (host) |
| `records-fetched` (host helper) | `enclave-launched` (host) |
| `records-stored-locally` (host) | `enclave-started` (enclave) |
| `compute-completed` (host) | `unit-ready` (enclave) |
| `executor-finished` (host) | `attested` (enclave) |
| `result-persisted` (result-consumer) | `records-fetched` (enclave) |
| | `records-decrypted` (enclave) |
| | `records-stored-locally` (enclave) |
| | `dc-app-completed` (enclave) |
| | `output-sent` (enclave) |
| | `executor-finished` (host) |
| | `result-persisted` (result-consumer) |

Host and enclave run concurrently, so `enclave-started` can arrive before the host emits `enclave-launched`.
`enclave_boot` therefore ends at `enclave-started`.

## Phase definitions

| Phase | rads (CE) | secure-rads (SCE) | Includes | Excludes |
| --- | --- | --- | --- | --- |
| `host_provisioning` | `executor-launched` → `executor-ready` | `executor-launched` → `executor-ready` | EC2 boot, package install, daemon or allocator start and readiness wait, helper download where used | Algorithm artifact |
| `algorithm_retrieval` | `executor-ready` → `artifact-retrieved` | `executor-ready` → `artifact-retrieved` | Artifact S3 GET, cost POST, and any run-time unpack | Tool install, container or enclave start, records |
| `enclave_boot` | — | `artifact-retrieved` → `enclave-started` | `nitro-cli run-enclave` and enclave start | Attestation |
| `sce_unit` | — | `enclave-started` → `unit-ready` | Entropy seeding, run-config read | Attestation |
| `attestation` | — | `unit-ready` → `attested` | Challenge request, NSM attestation, verifier round trip | Records |
| `data_retrieval` | `artifact-retrieved` → `records-stored-locally` | `attested` → `records-stored-locally` | PDM paging and `records.json` write. Secure-rads also fetches AWS credentials, unwraps the key, and decrypts. | Runtime start |
| `algorithm_processing` | `records-stored-locally` → `compute-completed` | `records-stored-locally` → `dc-app-completed` | Container or nsjail start and the DC app | Records, result delivery |
| `result_delivery` | `compute-completed` → `result-persisted` | `output-sent` → `result-persisted` | SQS publish, consumer Lambda, DynamoDB write | Algorithm work |
| `total` | `run-requested` → `result-persisted` | `run-requested` → `result-persisted` | Full run, including control-plane calls and async delivery | Nothing |

## Artifact retrieval in detail

`algorithm_retrieval` starts at `executor-ready`, which is after host provisioning, and ends at
`artifact-retrieved`, which is before any container or enclave runs.

### rads (CE)

1. `aws s3 cp` the image tar to `/tmp/app.tar`.
2. `emit_cost s3 get 1`, a best-effort cost-service POST.
3. `docker load` decompresses the image layers and writes the rootfs into the Docker image store.
4. Parse the load log for the image name. The run fails if it is missing.

### secure-rads (SCE)

1. `mkdir -p /opt/eif`.
2. `aws s3 cp` the EIF to `/opt/eif/app.eif`.
3. `emit_cost s3 get 1`.

No unpack happens here. The OCI image was unpacked at build time in registry-service (skopeo + umoci), and the
rootfs, SCE Unit, and nsjail were baked into the EIF.

## Known limitation: download and unpack share one window

`algorithm_retrieval` covers both the S3 download and any run-time unpack. For rads that means the tar download
plus `docker load`; for secure-rads it is the EIF download only, because its unpack happened at build time.

The CSV cannot separate the two, so a faster download can mask a slower unpack, and the rads and secure-rads
numbers cover different work. This is why comparing the single `algorithm_retrieval` value across trees is not a
like-for-like download comparison.

If the split matters for a result, add a checkpoint between the download and the unpack (for example after the
`aws s3 cp`), register it in the telemetry allowlist, and add the corresponding phase to `PHASES` in
`benchmark/src/export.py`. Keep `algorithm_retrieval` as the aggregate so earlier results stay comparable.

## Reading the CSV

`phase-timings.csv` has one row per run with a `<phase>_s` column for each window above and an `<event>_ts` column
for each raw timestamp. `plot.py` reads the aggregate phases.
