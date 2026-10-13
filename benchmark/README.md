# Benchmark harness

End-to-end Exp1/Exp2 size sweep: `rads` (baseline) vs `secure-rads` (Nitro enclave) on the trial-eligibility algorithm over a shared e-health dataset.

One algorithm id is reused across sizes. `make seed` generates the dataset, uploads both algorithm images, and BatchWrites the same JSON into both trees. `make run` then executes each size with a fetch `size` limit. Sizes come from `TRIAL_SIZES` in `src/lib/config.py` (50k..400k step 50k; not a CLI override). Each `(size, rep)` wave runs selected trees in parallel (separate stacks).

Sizes are capped at 400k: the sample app `json.load`s the whole records file and pydantic-models every row, so the run needs ~1.58 GB at 400k, which fits the secure-rads 2048 MiB enclave. 500k (~1.96 GB) does not fit and larger sizes OOM.

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
- Both trees deployed (PDM, execution, log, result-consumer; secure-rads also needs CSAV registry + verifier)
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
make export    # every results/raw/sweep-*.json + log-service -> phase-timings.csv
make plot      # -> results/figures/sweep-phases.png and sweep-scaling.png
make report    # both
```

To export one sweep only, move other `results/raw/sweep-*.json` files aside first. Drop or re-run failed reps (`error` in raw JSON, or PDM 500s) before treating the CSV as final.

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
