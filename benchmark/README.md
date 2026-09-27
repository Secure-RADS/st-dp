# Benchmark harness

End-to-end Exp1/Exp2 sweep: `rads` (baseline CE) vs `secure-rads` (Sec-CE) on the trial-eligibility algorithm over the shared e-health dataset.

One algorithm id is reused across sizes. The harness generates the dataset once, BatchWrites the same JSON into both trees, then runs each size with a `size` limit on fetch.

## Quick start (Makefile)

From `benchmark/`:

```
make help       # list targets
make install    # uv + bun deps
make smoke      # 10K + 100K, 3 reps, both trees (~10–15 min)
make report     # export CSV + figures from results/raw/
```

From the repo root:

```
make benchmark              # same as: make -C benchmark help
make benchmark-smoke        # cheap 10K/100K check
make benchmark-report       # export + figures
make -C benchmark run REPS=3
```

Common overrides:

| Variable | Default | Meaning |
| --- | --- | --- |
| `REPS` | `10` | Repetitions per size × tree |
| `SIZES` | (config default) | e.g. `SIZES='10000 100000'` |
| `TREES` | `rads secure-rads` | Which trees to run |
| `SKIP` | empty | `SKIP=1` → `--skip-generate --skip-seed` |

```
make run REPS=3
make run SIZES='10000 100000' REPS=10
make reuse REPS=3 SIZES='10000 25000 50000 75000 100000'
make seed                    # generate once, BatchWrite ehealth-100k to both trees
make export && make figures  # or: make report
```

## Prerequisites

- AWS credentials for the PoC account (`AWS_REGION=ap-southeast-2`)
- Both trees deployed (PDM, execution, log, result-consumer; secure-rads also needs CSAV registry + verifier)
- CSAV host running so the secure registry is reachable (`make up` / `make secure-rads-ready` from the repo root)
- Docker (arm64) to build the sample algorithm image on first run
- `uv` (Python) and `bun` (seeding + CSV export) — `make install` sets these up

Executors default to `c6g.large`. Keep rads and secure-rads on the same instance type when comparing.

### Runtime cost

Each rep launches a **fresh EC2 executor**, boots it (~70–90s), runs the job, then terminates it. Wall time is roughly:

`sizes × trees × reps × ~100s`

Examples:

| Matrix | Launches | Rough wall clock |
| --- | --- | --- |
| `make smoke` (10K+100K, 3 reps) | 12 | ~10–15 min |
| 10K + 100K, 2 trees, 10 reps | 40 | ~1–1.5 h |
| 10K…100K (5 sizes), 2 trees, 10 reps | 100 | ~3 h |
| 10K…100K (5 sizes), 2 trees, 3 reps | 30 | ~45–60 min |

Use `make smoke` or `make run REPS=3` while iterating; reserve `--reps 10` / `REPS=10` for the paper Exp2 runs.

## Shared seed data

`make seed` (or the seed step inside `make run`) generates once and BatchWrites the **same** `ehealth-100k.json` into both trees (rads plaintext; secure-rads envelope-encrypted).

`ehealth-10k` … `ehealth-100k` are prefixes of one faker stream (seed `505`), so the first N records are identical across sizes. Seeding the largest is enough for every size in the sweep.

Use BatchWrite via `seed-rads` / `seed-secure-rads` only. Do not use DynamoDB ImportTable / S3 import for this harness.

Manual equivalent:

```
make generate
make seed
```

## Run without Make

Defaults in `lib/config.py`: sizes `10_000 25_000 50_000 75_000 100_000`, `--reps 10`, both trees.

```
cd benchmark
uv run python run.py
uv run python run.py --sizes 10000 100000 --reps 3
uv run python run.py --skip-generate --skip-seed --reps 3
```

| Flag | Meaning |
| --- | --- |
| `--sizes 10000 100000` | Subset of sizes |
| `--reps N` | Repetitions per size × tree (default 10) |
| `--trees rads secure-rads` | Which trees to run |
| `--skip-generate` | Reuse `seeding/datasets/` |
| `--skip-seed` | Reuse PDM rows already BatchWritten |

Each finished sweep writes `results/raw/sweep-<unix>.json`. Stdout logs client wall time per rep; phase timings come from the log-service export below.

Stop early with Ctrl-C (and terminate any leftover `*-execution-service-run` EC2 instances if needed).

## Export results and figures

```
make report
# or:
make export     # -> results/sweep.csv
make figures    # -> results/figures/sweep-phases.png, sweep-scaling.png
```

`export.ts` reads **every** `results/raw/sweep-*.json`. To export one sweep only, temporarily move the other raw files aside, run `make export`, then move them back.

Failed reps (`error` set in the raw JSON, or a 500 from PDM) should be dropped or re-run before treating the CSV as final.

## Layout

| Path | Role |
| --- | --- |
| `Makefile` | `install` / `seed` / `run` / `smoke` / `report` wrappers |
| `run.py` | Generate → upload algorithm → seed → execute sweep |
| `lib/config.py` | Sizes, algorithm id, CFN stack names |
| `lib/flow.py` | Upload / execute / poll helpers |
| `export.ts` | Raw JSON + log-service → `results/sweep.csv` |
| `sweep.py` | CSV → phase / total figures |
| `../seeding/` | Shared generate + BatchWrite seeders |
