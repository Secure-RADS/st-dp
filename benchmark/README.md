# Benchmark harness

End-to-end Exp1/Exp2 sweep: `rads` (baseline CE) vs `secure-rads` (Sec-CE) on the trial-eligibility algorithm over the shared e-health dataset.

One algorithm id is reused across sizes. The harness generates the dataset once, BatchWrites the same JSON into both trees, then runs each size with a `size` limit on fetch.

## Prerequisites

- AWS credentials for the PoC account (`AWS_REGION=ap-southeast-2`)
- Both trees deployed (PDM, execution, log, result-consumer; secure-rads also needs CSAV registry + verifier)
- CSAV host running so the secure registry is reachable (`make up` / `make secure-rads-ready` from the repo root)
- Docker (arm64) to build the sample algorithm image on first run
- `uv` (Python) and `bun` (seeding + CSV export)

```
cd benchmark && uv sync
cd ../seeding && bun install
```

Executors default to `c6g.large`. Keep rads and secure-rads on the same instance type when comparing.

### Runtime cost

Each rep launches a **fresh EC2 executor**, boots it (~70–90s), runs the job, then terminates it. Wall time is roughly:

`sizes × trees × reps × ~100s`

Examples:

| Matrix | Launches | Rough wall clock |
| --- | --- | --- |
| 10K + 100K, 2 trees, 10 reps | 40 | ~1–1.5 h |
| 10K…100K (5 sizes), 2 trees, 10 reps | 100 | ~3 h |
| 10K…100K (5 sizes), 2 trees, 3 reps | 30 | ~45–60 min |

Use `--reps 3` (or `--sizes 10000 100000`) while iterating; reserve `--reps 10` for the paper Exp2 runs.

## Shared seed data

Generate once, seed each tree from the **same** file (rads stores plaintext; secure-rads envelope-encrypts):

```
cd seeding
bun run generate

# run.py wires tables from CloudFormation; for a manual seed:
RADS_PDM_TABLE=<rads-pdm> SEED_DATASET=ehealth-100k bun run seed-rads
PDM_TABLE=<secure-pdm> DATA_KEY_TABLE=<dek-table> ALGORITHM_TABLE=<algo-table> \
  SEED_DATASET=ehealth-100k bun run seed-secure-rads
```

`ehealth-10k` … `ehealth-100k` are prefixes of one faker stream (seed `505`), so the first N records are identical across sizes. Seeding the largest (`ehealth-100k`) is enough for every size in the sweep.

Use BatchWrite via `seed-rads` / `seed-secure-rads` only. Do not use DynamoDB ImportTable / S3 import for this harness.

## Run the suite

Defaults in `lib/config.py`: sizes `10_000 25_000 50_000 75_000 100_000`, `--reps 10`, both trees.

```
cd benchmark
uv run python run.py
```

| Flag | Meaning |
| --- | --- |
| `--sizes 10000 100000` | Subset of sizes |
| `--reps N` | Repetitions per size × tree (default 10) |
| `--trees rads secure-rads` | Which trees to run |
| `--skip-generate` | Reuse `seeding/datasets/` |
| `--skip-seed` | Reuse PDM rows already BatchWritten |

Examples:

```
# Full Exp2 matrix (default sizes, 10 reps) — long / expensive
uv run python run.py

# Cheaper smoke: extremes only, 3 reps
uv run python run.py --sizes 10000 100000 --reps 3

# Re-run executes only (algorithm already uploaded, PDM already seeded)
uv run python run.py --skip-generate --skip-seed --reps 3
```

Each finished sweep writes `results/raw/sweep-<unix>.json`. Stdout logs client wall time per rep; phase timings come from the log-service export below.

Stop early with Ctrl-C (and terminate any leftover `*-execution-service-run` EC2 instances if needed).

## Export results and figures

Pull per-phase durations from the log stacks into CSV, then render figures:

```
cd benchmark
bun install
bun run export          # -> results/sweep.csv
uv run python sweep.py  # -> results/figures/sweep-phases.png, sweep-scaling.png
```

`export.ts` reads **every** `results/raw/sweep-*.json`. To export one sweep only, temporarily move the other raw files aside, run export, then move them back.

Failed reps (`error` set in the raw JSON, or a 500 from PDM) should be dropped or re-run before treating the CSV as final.

## Layout

| Path | Role |
| --- | --- |
| `run.py` | Generate → upload algorithm → seed → execute sweep |
| `lib/config.py` | Sizes, algorithm id, CFN stack names |
| `lib/flow.py` | Upload / execute / poll helpers |
| `export.ts` | Raw JSON + log-service → `results/sweep.csv` |
| `sweep.py` | CSV → phase / total figures |
| `../seeding/` | Shared generate + BatchWrite seeders |
