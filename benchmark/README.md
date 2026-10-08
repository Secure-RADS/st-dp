# Benchmark harness

End-to-end Exp1/Exp2 size sweep: `rads` (baseline) vs `secure-rads` (Nitro enclave) on the trial-eligibility algorithm over a shared e-health dataset.

One algorithm id is reused across sizes. `make seed` generates the dataset, uploads both algorithm images, and BatchWrites the same JSON into both trees. `make run` then executes each size with a fetch `size` limit. Sizes come from `TRIAL_SIZES` in `src/lib/config.py` (10k..150k step 10k; not a CLI override). Each `(size, rep)` wave runs selected trees in parallel (separate stacks).

Use [Devbox](https://www.jetify.com/docs/devbox/) from the repo root so AWS hits the local `.aws/` credentials and `ap-southeast-2` (`devbox shell` / `devbox run …`).

## Commands

From `benchmark/`:

```
make seed      # generate + upload + BatchWrite PDM
make run       # size sweep only (needs a prior seed, or existing PDM rows)
make export    # results/raw/ -> phase-timings.csv
make plot      # phase-timings.csv -> figures/   (alias: make graph)
make report    # export + plot
make all       # seed + run + report
```

From the repo root:

```
make benchmark           # make -C benchmark all
make benchmark-seed
make benchmark-run
make benchmark-report
```

| Variable | Default | Applies to | Meaning |
| --- | --- | --- | --- |
| `REPS` | `10` | `run`, `all` | Repetitions per size × tree |
| `TREES` | `rads secure-rads` | `seed`, `run`, `all` | Which trees |

```
make seed
make run REPS=1
make all REPS=3
make run TREES=rads REPS=2
```

Typical iteration: `make seed` once, then `make run REPS=1` / `make report` while tuning. Full paper matrix: `make all REPS=10`.

## Prerequisites

- Devbox + repo `.aws/credentials` (not the global AWS root profile)
- Both trees deployed (PDM, execution, log, cost, result-consumer; secure-rads also needs CSAV registry + verifier)
- CSAV host running (`make up` / `make secure-rads-ready` from the repo root)
- Docker (arm64) for the sample algorithm image on first upload
- `uv` (Python); `bun` for `../seeding` generate/seed

Executors default to `c6g.large` on both trees. Secure-rads enclave allocation on that size is 1 vCPU / 2048 MiB.

### Runtime cost

Each rep launches a **fresh EC2 executor**, boots (~70–90s), runs, then terminates:

`len(TRIAL_SIZES) × trees × reps × ~100s`

| Matrix | Launches | Rough wall clock |
| --- | --- | --- |
| 5 sizes, 2 trees, 1 rep | 10 | ~15–20 min |
| 5 sizes, 2 trees, 3 reps | 30 | ~45–60 min |
| 5 sizes, 2 trees, 10 reps | 100 | ~3 h |

## Shared seed data

`make seed` BatchWrites the same `ehealth.json` (100K records) into both trees (rads plaintext; secure-rads envelope-encrypted under a KMS-wrapped DEK). `make run` passes `size` so each executor reads only the first N rows.

Seed overwrites matching `(AlgorithmId, RecordId)` keys; it does not delete orphan rows from an older larger seed. Use BatchWrite via `seed-rads` / `seed-secure-rads` only — not DynamoDB ImportTable / S3 import.

Sample image tarballs are cached under `benchmark/build/`. The cache is invalidated when any file under the sample directory is newer than the tar; delete `benchmark/build/*.tar` manually if a rebuild is needed without a source mtime change.

## Run without Make

```
cd benchmark
export PYTHONPATH=src
uv run python -m execute --setup-only
uv run python -m execute --skip-generate --skip-seed --reps 1
uv run python -m export
uv run python -m plot
```

| Flag | Meaning |
| --- | --- |
| `--setup-only` | generate + upload + seed; no size sweep |
| `--reps N` | Repetitions per size × tree (default 10) |
| `--trees rads secure-rads` | Which trees |
| `--skip-generate` | Reuse `seeding/datasets/` |
| `--skip-seed` | Reuse PDM rows already BatchWritten |

Setup resolves the service catalog once (API Gateway URLs; CSAV registry via live EC2 public IP), then generate → parallel uploads → parallel seeds. `make run` is the serial size×tree×rep loop. Logging is loguru via richuru; execute/export use tqdm.

Each sweep writes `results/raw/sweep-<unix>.json`. Stop with Ctrl-C and terminate leftover `*-execution-service-run` EC2 instances if needed.

## Export and figures

```
make export    # every results/raw/sweep-*.json + log-service + cost-service -> phase-timings.csv
make plot      # -> results/figures/sweep-phases.png, sweep-scaling.png, sweep-cost.png
make report    # both
```

`export` also reads `GET /cost/{algorithmId}?runId=` and adds per-service (`ec2_cost_usd`, `dynamodb_cost_usd`, `s3_cost_usd`, `sqs_cost_usd`, `lambda_cost_usd`, `apigateway_cost_usd`) and `total_cost_usd` columns. `plot` writes `sweep-cost.png` (total cost vs size, and a cost-by-service breakdown). These are list-price estimates, not the bill - see [`../docs/cost-service.md`](../docs/cost-service.md). Cost rows land asynchronously via SQS, so run `export` after the sweep has settled.

To export one sweep only, move other `results/raw/sweep-*.json` files aside first. Drop or re-run failed reps (`error` in raw JSON, or PDM 500s) before treating the CSV as final.

### Event boundaries

The event contract follows [RADS](../docs/e2e-rads.txt) and [Secure-RADS](../docs/e2e-secure-rads.txt).

| Phase | rads | secure-rads |
| --- | --- | --- |
| Host provisioning | `executor-launched` → `executor-ready` | `executor-launched` → `executor-ready` |
| Algorithm retrieval | `executor-ready` → `artifact-retrieved` | `executor-ready` → `artifact-retrieved` |
| Enclave boot | — | `artifact-retrieved` → `enclave-started` |
| SCE unit | — | `enclave-started` → `unit-ready` |
| Attestation | — | `unit-ready` → `attested` |
| Data retrieval | `artifact-retrieved` → `records-stored-locally` | `attested` → `records-stored-locally` |
| Algorithm processing | `records-stored-locally` → `compute-completed` | `records-stored-locally` → `dc-app-completed` |
| Result delivery | `compute-completed` → `result-persisted` | `output-sent` → `result-persisted` |
| Total | `run-requested` → `result-persisted` | `run-requested` → `result-persisted` |

`records-fetched` precedes file serialization/writing in both trees. Secure-rads emits `records-decrypted` after decryption and `records-stored-locally` after writing the plaintext file. Its data-retrieval phase includes fetching AWS credentials, fetching records, KMS key unwrapping, record decryption, and writing the file. The CSV includes the individual event timestamps as well as the aggregate phase durations.

`executor-launched` records EC2 launch; secure-rads' `enclave-launched` records a successful `nitro-cli run-enclave`. Host and enclave run concurrently, so `enclave-started` can arrive before the host emits `enclave-launched`; enclave boot therefore ends at `enclave-started`.

Existing committed results use the earlier event contract (`data-decrypted` after the file write, and `enclave-launched` for EC2 launch). They remain historical measurements. Re-exporting those runs with the new exporter leaves phases blank where the new events are absent; deploy the aligned services, rebuild the EIFs, ship the rads host tools, and run a fresh sweep for the new contract.

## Layout

| Path | Role |
| --- | --- |
| `Makefile` | `seed` / `run` / `export` / `plot` / `report` / `all` |
| `src/execute.py` | Setup and size sweep (`--setup-only`, `--skip-*`) |
| `src/export.py` | Raw JSON + log-service → `phase-timings.csv` |
| `src/plot.py` | CSV → phase / scaling figures |
| `src/lib/catalog.py` | `ApiGatewayService` / `Ec2HttpService` catalog |
| `src/lib/config.py` | Trial constants + `resolve()` |
| `src/lib/tree.py` | `Tree` StrEnum |
| `src/lib/trees/` | `TreeHarness` ABC + rads / secure-rads |
| `src/lib/http.py` | httpx helpers (sync + async) |
| `src/lib/log.py` | loguru + richuru |
| `src/paths.py` | Package / results / repo roots |
| `results/` | Raw JSON, `phase-timings.csv`, figures (tracked) |
| `../seeding/` | Shared generate + BatchWrite seeders |
