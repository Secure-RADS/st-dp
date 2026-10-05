# End-to-end run flows (RADS and Secure-RADS)

High-level pseudocode for the build and execution paths, with every run-timeline event callout. Rendered with GitHub math (`$...$` and fenced `math` blocks); GitHub does not run LaTeX algorithm packages, so the listings are math-aligned text, not `algorithm2e`.

Canonical event names live in each tree's log-service (`RUN_EVENTS`). Anything else is rejected at ingest. Producers mirror that list.

Benchmark phase windows (see `benchmark/src/export.py`) are derived from pairs of these events.

---

## Event catalogs

### RADS

| Phase | Event | Emitter |
| --- | --- | --- |
| Build | `image-uploaded` | registry-service |
| Build | `algorithm-registered` | registry-service |
| Exec (control plane) | `run-requested` | execution-service Lambda |
| Exec (control plane) | `executor-launched` | execution-service Lambda |
| Exec (control plane) | `launch-failed` | execution-service Lambda |
| Exec (EC2) | `executor-ready` | userdata |
| Exec (EC2) | `artifact-retrieved` | userdata |
| Exec (EC2) | `records-fetched` | userdata |
| Exec (EC2) | `compute-completed` | userdata |
| Exec (EC2) | `executor-finished` | userdata `finish()` |

Transport: SQS → log-service worker. No enclave, attestation, decrypt, or `result-persisted` events.

### Secure-RADS

| Phase | Event | Emitter |
| --- | --- | --- |
| Build | `image-uploaded` | registry-service |
| Build | `build-started` | registry-service |
| Build | `eif-built` | registry-service |
| Build | `pcrs-registered` | registry-service |
| Build | `kms-key-provisioned` | registry-service |
| Build | `build-completed` / `build-failed` | registry-service |
| Exec (control plane) | `run-requested` | execution-service Lambda |
| Exec (control plane) | `enclave-launched` | execution-service Lambda |
| Exec (control plane) | `launch-failed` | execution-service Lambda |
| Exec (host) | `executor-ready` | userdata |
| Exec (host) | `artifact-retrieved` | userdata |
| Exec (enclave) | `enclave-started` | sce-unit |
| Exec (enclave) | `unit-ready` | sce-unit |
| Exec (enclave) | `attested` | sce-unit |
| Exec (enclave) | `records-fetched` | sce-unit |
| Exec (enclave) | `data-decrypted` | sce-unit |
| Exec (enclave) | `dc-app-completed` | sce-unit |
| Exec (enclave) | `output-sent` | sce-unit |
| Exec (enclave) | `run-failed` | sce-unit |
| Result | `result-persisted` | result-consumer |

Transport: HTTPS `POST /events` to log-service (control plane, host, sce-unit, result-consumer).

---

## RADS — build

Caller uploads a Docker image tarball, then registers an `algorithmId`. No EIF, PCR, or KMS step.

```math
\begin{aligned}
&\textbf{RADS Build} \\[0.4em]
&1:\ \textbf{procedure}\ \textsc{Register}(a,\ \textit{tar}) \\
&2:\ \quad \text{store tar in S3 under } a \\
&3:\ \quad \textbf{emit}\ \texttt{image-uploaded} \\
&4:\ \quad \text{write } a \mapsto \text{S3 path in DynamoDB} \\
&5:\ \quad \textbf{emit}\ \texttt{algorithm-registered} \\
&6:\ \quad \textbf{return}
\end{aligned}
```

---

## RADS — execution

Plain EC2 + Docker. The host fetches plaintext records from PDM and bind-mounts them into the container. Result goes to SQS; a consumer Lambda writes `RunResults`. The executor's terminal timeline event is `executor-finished` (not `result-persisted`).

```math
\begin{aligned}
&\textbf{RADS Execution} \\[0.4em]
&1:\ \textbf{procedure}\ \textsc{Run}(a,\ n) \\
&2:\ \quad \textit{runId} \leftarrow \text{new id} \\
&3:\ \quad \textbf{emit}\ \texttt{run-requested} \\
&4:\ \quad \text{look up S3 artifact for } a \\
&5:\ \quad \text{RunInstances(userdata with } a,\ \textit{runId},\ n\text{)} \\
&6:\ \quad \textbf{emit}\ \texttt{executor-launched} \\
&7:\ \quad \textbf{return}\ \textit{runId}\ \text{(caller polls later)} \\[0.6em]
&\textbf{on EC2 (userdata):} \\
&8:\ \quad \text{install docker + awscli; start docker} \\
&9:\ \quad \textbf{emit}\ \texttt{executor-ready} \\
&10:\ \quad \text{S3 pull tar; docker load} \\
&11:\ \quad \textbf{emit}\ \texttt{artifact-retrieved} \\
&12:\ \quad \text{GET PDM pages for } a\ \text{(limit } n\text{); write } \textit{records.json} \\
&13:\ \quad \textbf{emit}\ \texttt{records-fetched} \\
&14:\ \quad \text{docker run with } /data/\textit{records.json}\ \text{bind-mount} \\
&15:\ \quad \textbf{emit}\ \texttt{compute-completed} \\
&16:\ \quad \textbf{on exit:}\ \text{SQS result + }\textbf{emit}\ \texttt{executor-finished}\text{; terminate} \\[0.6em]
&\textbf{result-consumer:} \\
&17:\ \quad \text{persist result to DynamoDB (no timeline event)}
\end{aligned}
```

### RADS benchmark phase windows

| Phase | Start | End |
| --- | --- | --- |
| `enclave_initialization` | `executor-launched` | `executor-ready` |
| `algorithm_retrieval` | `executor-ready` | `artifact-retrieved` |
| `data_retrieval` | `artifact-retrieved` | `records-fetched` |
| `algorithm_processing` | `records-fetched` | `compute-completed` |
| `result_delivery` | `compute-completed` | `executor-finished` |
| `total` | `run-requested` | `executor-finished` |

`attestation`, `sce_unit`, `data_decryption` are null (N/A).

---

## Secure-RADS — build (CSAV)

registry-service on the CSAV host: unpack OCI image, layer sce-unit + nsjail, build EIF, register PCRs with the verifier, provision (or reuse) the per-algorithm KMS key, store the EIF.

```math
\begin{aligned}
&\textbf{Secure\text{-}RADS Build} \\[0.4em]
&1:\ \textbf{procedure}\ \textsc{Build}(a,\ \textit{oci}) \\
&2:\ \quad \textit{buildId} \leftarrow \text{new id} \\
&3:\ \quad \textbf{emit}\ \texttt{build-started} \\
&4:\ \quad \text{skopeo + umoci unpack; layer sce-unit + nsjail} \\
&5:\ \quad \text{eif\_build} \rightarrow \textit{EIF},\ \textit{PCRs} \\
&6:\ \quad \textbf{emit}\ \texttt{eif-built} \\
&7:\ \quad \text{upload EIF to S3} \\
&8:\ \quad \textbf{emit}\ \texttt{image-uploaded} \\
&9:\ \quad \text{register PCRs for } a\ \text{with verifier (mTLS)} \\
&10:\ \quad \textbf{emit}\ \texttt{pcrs-registered} \\
&11:\ \quad \text{create or reuse per-algorithm KMS key} \\
&12:\ \quad \textbf{emit}\ \texttt{kms-key-provisioned} \\
&13:\ \quad \text{write } a \mapsto \text{S3 path (+ KMS ARN) in DynamoDB} \\
&14:\ \quad \textbf{emit}\ \texttt{build-completed}\ \text{(or }\texttt{build-failed}\text{)} \\
&15:\ \quad \textbf{return}
\end{aligned}
```

Seeding encrypts dataset rows under that algorithm's KMS key after registration (see `seeding/`).

---

## Secure-RADS — execution

Control plane launches a Nitro parent EC2. Host pulls the EIF and starts the enclave. sce-unit attests, fetches ciphertext from PDM, unwraps the DEK via KMS under attestation, decrypts in-enclave, relays plaintext to the jailed DC app over a unix socket, then streams output to the parent over vsock. Host publishes the result to SQS; result-consumer persists and emits `result-persisted`.

```math
\begin{aligned}
&\textbf{Secure\text{-}RADS Execution} \\[0.4em]
&1:\ \textbf{procedure}\ \textsc{Run}(a,\ n) \\
&2:\ \quad \textit{runId} \leftarrow \text{new id} \\
&3:\ \quad \textbf{emit}\ \texttt{run-requested} \\
&4:\ \quad \text{look up EIF S3 path for } a \\
&5:\ \quad \text{RunInstances(Nitro parent + userdata)} \\
&6:\ \quad \textbf{emit}\ \texttt{enclave-launched} \\
&7:\ \quad \textbf{return}\ \textit{runId} \\[0.6em]
&\textbf{on parent EC2 (userdata):} \\
&8:\ \quad \text{install nitro-cli; configure allocator} \\
&9:\ \quad \textbf{emit}\ \texttt{executor-ready} \\
&10:\ \quad \text{S3 pull EIF} \\
&11:\ \quad \textbf{emit}\ \texttt{artifact-retrieved} \\
&12:\ \quad \text{start vsock listeners (output :5000, runInfo :5001)} \\
&13:\ \quad \text{nitro-cli run-enclave} \\[0.6em]
&\textbf{inside enclave (sce-unit):} \\
&14:\ \quad \text{read } \{\textit{runId},\ n\}\ \text{from host :5001} \\
&15:\ \quad \textbf{emit}\ \texttt{enclave-started} \\
&16:\ \quad \text{seed entropy from NSM} \\
&17:\ \quad \textbf{emit}\ \texttt{unit-ready} \\
&18:\ \quad \text{attest to verifier} \rightarrow \text{access token} \\
&19:\ \quad \textbf{emit}\ \texttt{attested} \\
&20:\ \quad \text{fetch AWS creds; GET PDM ciphertext for } a \\
&21:\ \quad \textbf{emit}\ \texttt{records-fetched} \\
&22:\ \quad \text{KMS Decrypt(encDEK) under attestation; decrypt records} \\
&23:\ \quad \textbf{emit}\ \texttt{data-decrypted} \\
&24:\ \quad \text{start nsjail; relay payload on unix socket} \\
&25:\ \quad \textbf{emit}\ \texttt{dc-app-completed} \\
&26:\ \quad \text{stream output to parent vsock :5000} \\
&27:\ \quad \textbf{emit}\ \texttt{output-sent} \\
&28:\ \quad \text{(on failure earlier: }\textbf{emit}\ \texttt{run-failed}\text{)} \\[0.6em]
&\textbf{on parent exit:} \\
&29:\ \quad \text{SQS result message; terminate instance} \\[0.4em]
&\textbf{result-consumer:} \\
&30:\ \quad \text{write RunResults} \\
&31:\ \quad \textbf{emit}\ \texttt{result-persisted}
\end{aligned}
```

### Secure-RADS benchmark phase windows

| Phase | Start | End |
| --- | --- | --- |
| `enclave_initialization` | `enclave-launched` | `executor-ready` |
| `algorithm_retrieval` | `executor-ready` | `artifact-retrieved` |
| `sce_unit` | `enclave-started` | `unit-ready` |
| `attestation` | `unit-ready` | `attested` |
| `data_retrieval` | `attested` | `records-fetched` |
| `data_decryption` | `records-fetched` | `data-decrypted` |
| `algorithm_processing` | `data-decrypted` | `dc-app-completed` |
| `result_delivery` | `output-sent` | `result-persisted` |
| `total` | `run-requested` | `result-persisted` |

Note: host boot + nitro tooling sit in `enclave_initialization`. EIF download is `algorithm_retrieval`. Unix-socket handoff of plaintext into the DC app is inside `algorithm_processing`, after `data-decrypted` — not inside `data_retrieval`.

---

## Side-by-side (execution only)

```math
\begin{aligned}
&\underline{\textbf{RADS}} &&\underline{\textbf{Secure\text{-}RADS}} \\
&\texttt{run-requested} &&\texttt{run-requested} \\
&\texttt{executor-launched} &&\texttt{enclave-launched} \\
&\texttt{executor-ready} &&\texttt{executor-ready} \\
&\texttt{artifact-retrieved} &&\texttt{artifact-retrieved} \\
& &&\texttt{enclave-started} \\
& &&\texttt{unit-ready} \\
& &&\texttt{attested} \\
&\texttt{records-fetched} &&\texttt{records-fetched} \\
& &&\texttt{data-decrypted} \\
&\texttt{compute-completed} &&\texttt{dc-app-completed} \\
& &&\texttt{output-sent} \\
&\texttt{executor-finished} &&\texttt{result-persisted}
\end{aligned}
```

Data path difference that matters for timing: RADS writes the full JSON dataset to disk before `records-fetched`; Secure-RADS holds ciphertext in memory until decrypt, then hands plaintext over the socket during `algorithm_processing`.
