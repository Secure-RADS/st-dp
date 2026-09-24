#!/usr/bin/env python3
"""Dataset-size sweep driver: secure-rads vs rads, per-phase execution timings.

Runs Exp1/Exp2: the trial-eligibility algorithm over the e-health dataset at
10K/25K/50K/65K/100K records. One algorithmId is reused; for each size the dataset is
reseeding into both trees' PDM, then the algorithm is run `--reps` times per tree. The
image is built and uploaded once per tree, before the size loop.

Usage:
    python3 benchmark/run.py --reps 10
    python3 benchmark/run.py --sizes 10000 100000 --reps 1
    python3 benchmark/run.py --trees secure-rads --sizes 10000 --reps 1
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from pydantic import BaseModel, ConfigDict

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import config, flow

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
BUILD_DIR = HERE / "build"
RAW_DIR = HERE / "results" / "raw"

STAGE_UPLOAD = "upload"
STAGE_EXECUTE = "execute"


class Job(BaseModel):
    """One sample algorithm in one tree."""

    model_config = ConfigDict(frozen=True)

    tree: str
    sample: str
    dataset: str
    algorithm_id: str


class Stage(BaseModel):
    """One measured stage of one repetition."""

    tree: str
    sample: str
    dataset: str
    algorithm_id: str
    rep: int
    stage: str
    seconds: float | None
    run_id: str | None = None
    status: str | None = None
    output: str | None = None
    error: str | None = None
    size: int | None = None


def build_image(tree: str, sample: str) -> Path:
    """Build the arm64 image tar once per tree+sample; every upload ships this same tar.

    The two trees' samples are not interchangeable: rads apps read a records file,
    secure-rads apps speak the SCE unix socket, so each tree gets its own tar.
    """
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    tar_path = BUILD_DIR / f"{tree}-{sample}.tar"
    if tar_path.exists():
        return tar_path

    tag = f"bench-{tree}-{sample}:local"
    context = REPO_ROOT / tree / "samples" / sample
    subprocess.run(
        ["docker", "build", "--platform", "linux/arm64", "-t", tag, str(context)],
        check=True,
        cwd=REPO_ROOT,
    )
    subprocess.run(["docker", "save", tag, "-o", str(tar_path)], check=True)
    return tar_path


def emit(client_timestamp: str, log_url: str, stage: Stage) -> None:
    """Record the client-observed measurement in the tree's log service."""
    flow.post_event(
        log_url,
        {
            "algorithmId": stage.algorithm_id,
            "runId": stage.run_id or f"bench-{stage.tree}-{stage.sample}-{stage.rep}",
            "event": "run-requested",
            "timestamp": client_timestamp,
            "detail": {
                "source": "benchmark",
                "tree": stage.tree,
                "sample": stage.sample,
                "dataset": stage.dataset,
                "rep": stage.rep,
                "stage": stage.stage,
                "seconds": stage.seconds,
                "status": stage.status,
                "error": stage.error,
            },
        },
    )


def upload_once(
    job: Job,
    rep: int,
    endpoints: dict[str, str],
    secure_registry: str,
    tar_path: Path,
) -> Stage:
    """Ship one image: rads presigns+PUTs+registers, secure-rads builds and registers an EIF."""
    timestamp = flow.now_iso()
    start = time.perf_counter()
    error = None
    try:
        if job.tree == "rads":
            flow.upload_rads(endpoints["registry"], job.algorithm_id, tar_path)
            flow.register_rads(endpoints["registry"], job.algorithm_id)
        else:
            flow.upload_secure(secure_registry, job.algorithm_id, tar_path)
    except Exception as err:  # noqa: BLE001 - record and keep sweeping
        error = f"{type(err).__name__}: {err}"
    stage = Stage(
        tree=job.tree,
        sample=job.sample,
        dataset=job.dataset,
        algorithm_id=job.algorithm_id,
        rep=rep,
        stage=STAGE_UPLOAD,
        seconds=time.perf_counter() - start,
        error=error,
    )
    emit(timestamp, endpoints["log"], stage)
    return stage


def payload_error(output: str | None) -> str | None:
    """A run whose payload carries an `error` key failed, even though the host itself exited 0."""
    if not output:
        return None
    try:
        parsed = json.loads(output)
    except json.JSONDecodeError:
        return None
    if isinstance(parsed, dict) and parsed.get("error"):
        return str(parsed["error"])
    return None


def execute_once(job: Job, rep: int, endpoints: dict[str, str]) -> Stage:
    """Fire one run and poll it to a terminal status."""
    start = time.perf_counter()
    error = None
    run_id = status = output = None
    try:
        _elapsed, run_id, status, output = flow.execute(endpoints["execution"], job.algorithm_id)
        error = payload_error(output)
    except Exception as err:  # noqa: BLE001 - record and keep sweeping
        error = f"{type(err).__name__}: {err}"
    stage = Stage(
        tree=job.tree,
        sample=job.sample,
        dataset=job.dataset,
        algorithm_id=job.algorithm_id,
        rep=rep,
        stage=STAGE_EXECUTE,
        seconds=time.perf_counter() - start,
        run_id=run_id,
        status=status,
        output=output,
        error=error,
    )
    emit(flow.now_iso(), endpoints["log"], stage)
    return stage


def generate() -> None:
    """Regenerate every dataset file (deterministic). Slow for the larger ehealth sizes, so called once."""
    subprocess.run(["bun", "install"], check=True, cwd=REPO_ROOT / "seeding")
    subprocess.run(["bun", "run", "generate"], check=True, cwd=REPO_ROOT / "seeding")


def clear() -> None:
    """Clear the sweep algorithm's PDM records in both trees, before any size is seeded.

    The sweep reuses one algorithmId, so without this a previous (larger) size's records would remain
    and contaminate a smaller size's run.
    """
    env = {
        "RADS_PDM_TABLE": config.stack_outputs(config.STACKS["rads"]["pdm"]).get("PersonalDataTableName", ""),
        "PDM_TABLE": config.stack_outputs(config.STACKS["secure-rads"]["pdm"]).get("PersonalDataTableName", ""),
        "AWS_REGION": config.REGION,
    }
    subprocess.run(
        ["bun", "run", "clear-sweep"],
        check=True,
        cwd=REPO_ROOT / "seeding",
        env={**os.environ, **env},
    )


def seed(tree: str, dataset: str) -> None:
    """Seed one tree's PDM with a single dataset (SEED_DATASET), resolving tables from stack outputs.

    The sweep reuses one algorithmId across sizes, so its sizes must be seeded one at a time.
    """
    env = {
        "RADS_PDM_TABLE": config.stack_outputs(config.STACKS["rads"]["pdm"]).get("PersonalDataTableName", ""),
        "PDM_TABLE": config.stack_outputs(config.STACKS["secure-rads"]["pdm"]).get("PersonalDataTableName", ""),
        "DATA_KEY_TABLE": config.stack_outputs(config.STACKS["secure-rads"]["pdm"]).get("DataKeyTableName", ""),
        "ALGORITHM_TABLE": config.stack_outputs("secure-rads-registry-service-storage").get("AlgorithmTableName", ""),
        "AWS_REGION": config.REGION,
        "SEED_DATASET": dataset,
    }
    subprocess.run(["bun", "install"], check=True, cwd=REPO_ROOT / "seeding")
    subprocess.run(
        ["bun", "run", "seed-rads" if tree == "rads" else "seed-secure-rads"],
        check=True,
        cwd=REPO_ROOT / "seeding",
        env={**os.environ, **env},
    )


def flush(stages: list[Stage], run_started: int) -> None:
    """Append this sweep's rows to results/raw/sweep-<timestamp>.json."""
    if not stages:
        return
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    out = RAW_DIR / f"sweep-{run_started}.json"
    existing: list[dict] = json.loads(out.read_text()) if out.exists() else []
    existing.extend(stage.model_dump() for stage in stages)
    out.write_text(json.dumps(existing, indent=2))
    print(f"wrote {out} ({len(existing)} rows)", flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reps", type=int, default=10)
    parser.add_argument(
        "--rep-start", type=int, default=1, help="first rep index; lets passes append without collisions"
    )
    parser.add_argument("--trees", nargs="+", choices=config.TREES, default=list(config.TREES))
    parser.add_argument("--sizes", nargs="+", type=int, default=None, help="sweep sizes; defaults to TRIAL_SIZES")
    parser.add_argument("--skip-build", action="store_true")
    return parser.parse_args()


def collect_tars(jobs: list[Job], *, skip_build: bool) -> dict[tuple[str, str], Path]:
    """Resolve (or build) the image tar each upload will ship."""
    tars: dict[tuple[str, str], Path] = {}
    for job in jobs:
        tar_path = BUILD_DIR / f"{job.tree}-{job.sample}.tar"
        if not tar_path.exists():
            if skip_build:
                msg = f"missing {tar_path} and --skip-build was passed"
                print(msg, file=sys.stderr)
                raise SystemExit(1)
            print(f"build: {job.tree}/{job.sample}", flush=True)
            tar_path = build_image(job.tree, job.sample)
        tars[(job.tree, job.sample)] = tar_path
    return tars


def run_sweep(
    args: argparse.Namespace,
    endpoints: dict[str, dict[str, str]],
    tars: dict[tuple[str, str], Path],
    sizes: list[int],
) -> list[Stage]:
    """Upload the trial-eligibility image once per tree, then reseed and run each size."""
    secure_registry = endpoints["secure-rads"].get("registry", "")
    if any(tree == "secure-rads" for tree in args.trees) and not secure_registry:
        msg = "secure-rads registry URL not configured (is the CSAV host running?)"
        print(msg, file=sys.stderr)
        raise SystemExit(1)

    stages: list[Stage] = []
    for tree in args.trees:
        job = Job(
            tree=tree,
            sample=config.TRIAL_SAMPLE,
            dataset=config.trial_dataset(sizes[0]),
            algorithm_id=config.TRIAL_ALGORITHM_ID,
        )
        print(f"upload: {tree}/{config.TRIAL_SAMPLE}", flush=True)
        stages.append(upload_once(job, 1, endpoints[tree], secure_registry, tars[(tree, config.TRIAL_SAMPLE)]))

    for size in sizes:
        dataset = config.trial_dataset(size)
        for tree in args.trees:
            print(f"seed: {tree} {dataset}", flush=True)
            seed(tree, dataset)
            for rep in range(args.rep_start, args.rep_start + args.reps):
                job = Job(
                    tree=tree,
                    sample=config.TRIAL_SAMPLE,
                    dataset=dataset,
                    algorithm_id=config.TRIAL_ALGORITHM_ID,
                )
                stage = execute_once(job, rep, endpoints[tree])
                stage.size = size
                stages.append(stage)
                print(
                    f"execute {tree}/{dataset} rep={rep} {stage.seconds:.1f}s status={stage.status} err={stage.error}",
                    flush=True,
                )
    return stages


def main() -> int:
    args = parse_args()
    sizes = sorted(args.sizes or config.TRIAL_SIZES)
    jobs = [
        Job(
            tree=tree,
            sample=config.TRIAL_SAMPLE,
            dataset=config.trial_dataset(sizes[0]),
            algorithm_id=config.TRIAL_ALGORITHM_ID,
        )
        for tree in args.trees
    ]
    endpoints = config.resolve_endpoints(include_secure_registry=True)
    tars = collect_tars(jobs, skip_build=args.skip_build)
    generate()
    clear()
    run_started = int(time.time())
    flush(run_sweep(args, endpoints, tars, sizes), run_started)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
