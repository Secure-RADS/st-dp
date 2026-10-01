# Benchmark harness

End-to-end Exp1/Exp2 size sweep: `rads` (baseline) vs `secure-rads` (Nitro enclave) on the trial-eligibility algorithm over a shared e-health dataset.

One algorithm id is reused across sizes. Setup generates the dataset once, uploads both algorithm images, BatchWrites the same JSON into both trees, then runs each size with a `size` limit on fetch. Sizes come from `TRIAL_SIZES` in `src/lib/config.py` (not a CLI override).

## Commands

From `benchmark/` (or `make -C benchmark …` from the repo root):

```
make execute   # generate + upload + seed + size sweep
make report    # results/raw/ -> phase-timings.csv + figures/
```

From the repo root:

```
make benchmark          # same as: make -C benchmark execute
make benchmark-report   # same as: make -C benchmark report
```

Overrides for `make execute`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `REPS` | `10` | Repetitions per size × tree |
| `TREES` | `rads secure-rads` | Which trees to run |
| `SKIP` | empty | `SKIP=1` → reuse datasets + already-seeded PDM rows |

```
make execute REPS=3
make execute SKIP=1 REPS=3
```

## Prerequisites

- AWS credentials for the PoC account (`AWS_REGION=ap-southeast-2`)
- Both trees deployed (PDM, execution, log, result-consumer; secure-rads also needs CSAV registry + verifier)
- CSAV host running so the secure registry is reachable (`make up` / `make secure-rads-ready` from the repo root)
- Docker (arm64) to build the sample algorithm image on first run
- `uv` (Python); `bun` only for `../seeding` generate/seed invoked by `make execute`

Executors default to `c6g.large`. Keep rads and secure-rads on the same instance type when comparing. Secure-rads enclave allocation on that size is 1 vCPU / 2048 MiB (parent keeps the other vCPU).

### Runtime cost

Each rep launches a **fresh EC2 executor**, boots it (~70–90s), runs the job, then terminates it. Wall time is roughly:

`len(TRIAL_SIZES) × trees × reps × ~100s`

| Matrix | Launches | Rough wall clock |
| --- | --- | --- |
| 5 sizes, 2 trees, 3 reps | 30 | ~45–60 min |
| 5 sizes, 2 trees, 10 reps | 100 | ~3 h |

Use `make execute REPS=3` while iterating; reserve `REPS=10` for paper Exp2 runs.

## Shared seed data

`make execute` generates once and BatchWrites the **same** `ehealth.json` (100K records) into both trees (rads plaintext; secure-rads envelope-encrypted under a KMS-wrapped DEK). Each execute passes `size` so the executor reads only the first N of those rows.

Use BatchWrite via `seed-rads` / `seed-secure-rads` only. Do not use DynamoDB ImportTable / S3 import for this harness.

## Run without Make

Defaults in `src/lib/config.py`: `TRIAL_SIZES = [10_000, 25_000, 50_000, 75_000, 100_000]`, `--reps 10`, both trees.

```
cd benchmark
export PYTHONPATH=src
uv run python -m execute
uv run python -m execute --reps 3
uv run python -m execute --skip-generate --skip-seed --reps 3
```

| Flag | Meaning |
| --- | --- |
| `--reps N` | Repetitions per size × tree (default 10) |
| `--trees rads secure-rads` | Which trees to run |
| `--skip-generate` | Reuse `seeding/datasets/` |
| `--skip-seed` | Reuse PDM rows already BatchWritten |

Setup resolves the service catalog once (API Gateway URLs + CSAV registry via live EC2 IP), then: generate (if needed) → parallel algorithm uploads → parallel seeds → serial size×tree×rep execute loop. Logging is loguru via richuru; execute/export loops show tqdm bars.

Each finished sweep writes `results/raw/sweep-<unix>.json`. Phase timings come from the log-service export in `make report`.

Stop early with Ctrl-C (and terminate any leftover `*-execution-service-run` EC2 instances if needed).

## Export results and figures

```
make report
```

Writes `results/phase-timings.csv` plus `results/figures/sweep-phases.png` and `sweep-scaling.png`.

`python -m export` reads **every** `results/raw/sweep-*.json`. To export one sweep only, temporarily move the other raw files aside, run `make report`, then move them back.

Failed reps (`error` set in the raw JSON, or a 500 from PDM) should be dropped or re-run before treating the CSV as final.

## Layout

| Path | Role |
| --- | --- |
| `Makefile` | `execute` / `report` (export + plot) |
| `src/execute.py` | Async setup + serial size sweep |
| `src/export.py` | Raw JSON + log-service → `phase-timings.csv` |
| `src/plot.py` | CSV → phase / scaling figures |
| `src/lib/catalog.py` | Per-tree service catalog (`Service` / `ServiceKind`) |
| `src/lib/config.py` | Trial constants + `resolve()` (URLs + CFN outputs) |
| `src/lib/tree.py` | `Tree` StrEnum |
| `src/lib/trees/` | `TreeHarness` ABC + rads / secure-rads strategies |
| `src/lib/http.py` | Shared httpx helpers (sync + async) |
| `src/lib/log.py` | loguru + richuru install |
| `src/paths.py` | Package / results / repo roots |
| `results/` | Raw JSON, `phase-timings.csv`, figures (tracked) |
| `../seeding/` | Shared generate + BatchWrite seeders |
