# Benchmark harness

End-to-end Exp1/Exp2 sweep: `rads` (baseline CE) vs `secure-rads` (Sec-CE) on the trial-eligibility algorithm over the shared e-health dataset.

One algorithm id is reused across sizes. The harness generates the dataset once, BatchWrites the same JSON into both trees, then runs each size with a `size` limit on fetch.

## Commands

From `benchmark/` (or `make -C benchmark …` from the repo root):

```
make run      # full size matrix (generate + seed + execute)
make report   # results/raw/ -> sweep.csv + figures/
```

From the repo root:

```
make benchmark          # same as: make -C benchmark run
make benchmark-report   # same as: make -C benchmark report
```

Overrides for `make run`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `REPS` | `10` | Repetitions per size × tree |
| `SIZES` | (config default) | e.g. `SIZES='10000 100000'` |
| `TREES` | `rads secure-rads` | Which trees to run |
| `SKIP` | empty | `SKIP=1` → reuse datasets + already-seeded PDM rows |

```
make run REPS=3
make run SIZES='10000 100000' REPS=10
make run SKIP=1 REPS=3
```

## Prerequisites

- AWS credentials for the PoC account (`AWS_REGION=ap-southeast-2`)
- Both trees deployed (PDM, execution, log, result-consumer; secure-rads also needs CSAV registry + verifier)
- CSAV host running so the secure registry is reachable (`make up` / `make secure-rads-ready` from the repo root)
- Docker (arm64) to build the sample algorithm image on first run
- `uv` (Python); `bun` only for `../seeding` generate/seed invoked by `make run`

Executors default to `c6g.large`. Keep rads and secure-rads on the same instance type when comparing.

### Runtime cost

Each rep launches a **fresh EC2 executor**, boots it (~70–90s), runs the job, then terminates it. Wall time is roughly:

`sizes × trees × reps × ~100s`

Examples:

| Matrix | Launches | Rough wall clock |
| --- | --- | --- |
| 10K + 100K, 2 trees, 3 reps | 12 | ~10–15 min |
| 10K + 100K, 2 trees, 10 reps | 40 | ~1–1.5 h |
| 10K…100K (5 sizes), 2 trees, 10 reps | 100 | ~3 h |
| 10K…100K (5 sizes), 2 trees, 3 reps | 30 | ~45–60 min |

Use `make run REPS=3` while iterating; reserve `REPS=10` for the paper Exp2 runs.

## Shared seed data

`make run` generates once and BatchWrites the **same** `ehealth.json` (100K records) into both trees (rads plaintext; secure-rads envelope-encrypted). Each execute passes `size` so the executor reads only the first N of those rows.

Use BatchWrite via `seed-rads` / `seed-secure-rads` only. Do not use DynamoDB ImportTable / S3 import for this harness.

## Run without Make

Defaults in `src/lib/config.py`: sizes `10_000 25_000 50_000 75_000 100_000`, `--reps 10`, both trees.

```
cd benchmark
export PYTHONPATH=src
uv run python -m run
uv run python -m run --sizes 10000 100000 --reps 3
uv run python -m run --skip-generate --skip-seed --reps 3
```

| Flag | Meaning |
| --- | --- |
| `--sizes 10000 100000` | Subset of sizes |
| `--reps N` | Repetitions per size × tree (default 10) |
| `--trees rads secure-rads` | Which trees to run |
| `--skip-generate` | Reuse `seeding/datasets/` |
| `--skip-seed` | Reuse PDM rows already BatchWritten |

Each finished sweep writes `results/raw/sweep-<unix>.json`. Stdout logs client wall time per rep; phase timings come from the log-service export in `make report`.

Stop early with Ctrl-C (and terminate any leftover `*-execution-service-run` EC2 instances if needed).

## Export results and figures

```
make report
```

Writes `results/sweep.csv` plus `results/figures/sweep-phases.png` and `sweep-scaling.png`.

`python -m export` reads **every** `results/raw/sweep-*.json`. To export one sweep only, temporarily move the other raw files aside, run `make report`, then move them back.

Failed reps (`error` set in the raw JSON, or a 500 from PDM) should be dropped or re-run before treating the CSV as final.

## Layout

| Path | Role |
| --- | --- |
| `Makefile` | `run` / `report` |
| `src/run.py` | Generate → upload algorithm → seed → execute sweep |
| `src/export.py` | Raw JSON + log-service → `results/sweep.csv` |
| `src/plot.py` | CSV → phase / total figures |
| `src/lib/config.py` | Sizes, algorithm id, CFN stack names |
| `src/lib/trees/` | Strategy package: ABC + rads / secure-rads concretes |
| `src/lib/trees/base.py` | `TreeHarness` ABC (shared build/execute; abstract upload) |
| `src/lib/trees/rads.py` / `secure_rads.py` | Per-tree Strategy concretes (`(TreeHarness)`) |
| `src/lib/trees/sample_tar.py` | Shared docker build/save for sample tars |
| `src/lib/http.py` | Shared HTTP + execute poll |
| `src/paths.py` | Package / results / repo roots |
| `results/` | Raw JSON, CSV, figures (gitignored outputs) |
| `../seeding/` | Shared generate + BatchWrite seeders |
