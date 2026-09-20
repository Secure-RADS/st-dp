#!/usr/bin/env python3
"""Benchmark driver: secure-rads vs rads, client-observed stage timings.

Phases run in a deliberate order:

  uploads  every sample, every rep: ship the image (rads presigns+PUTs+registers,
           secure-rads builds and uploads an EIF). Both trees record an
           `image-uploaded` event in their log-service.
  seed     both trees, once, AFTER the uploads: secure-rads issues a fresh
           per-algorithm KMS key on every build, so seeding before the last
           upload would leave the records under a superseded key.
  executes every sample, every rep: POST /run and poll to a terminal status.

Usage:
    python3 benchmark/run.py --reps 10
    python3 benchmark/run.py --phases executes --reps 3
    python3 benchmark/run.py --trees rads --samples health-risk-python --reps 1
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
PHASES = ("uploads", "seed", "executes")


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


def execute_once(job: Job, rep: int, endpoints: dict[str, str]) -> Stage:
    """Fire one run and poll it to a terminal status."""
    start = time.perf_counter()
    error = None
    run_id = status = output = None
    try:
        _elapsed, run_id, status, output = flow.execute(endpoints["execution"], job.algorithm_id)
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


def seed(tree: str) -> None:
    """Seed one tree's datasets, resolving the target tables from live stack outputs."""
    env = {
        "RADS_PDM_TABLE": config.stack_outputs(config.STACKS["rads"]["pdm"]).get("PersonalDataTableName", ""),
        "PDM_TABLE": config.stack_outputs(config.STACKS["secure-rads"]["pdm"]).get("PersonalDataTableName", ""),
        "DATA_KEY_TABLE": config.stack_outputs(config.STACKS["secure-rads"]["pdm"]).get("DataKeyTableName", ""),
        "ALGORITHM_TABLE": config.stack_outputs("secure-rads-registry-service-storage").get("AlgorithmTableName", ""),
        "AWS_REGION": config.REGION,
    }
    subprocess.run(["bun", "install"], check=True, cwd=REPO_ROOT / "seeding")
    subprocess.run(["bun", "run", "generate"], check=True, cwd=REPO_ROOT / "seeding")
    subprocess.run(
        ["bun", "run", "seed-rads" if tree == "rads" else "seed-secure-rads"],
        check=True,
        cwd=REPO_ROOT / "seeding",
        env={**os.environ, **env},
    )


def flush(stages: list[Stage], phases: list[str], run_started: int) -> None:
    """Append this phase's rows to results/raw/<phases>-<timestamp>.json."""
    if not stages:
        return
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    out = RAW_DIR / f"{'-'.join(phases)}-{run_started}.json"
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
    parser.add_argument("--samples", nargs="+", default=[s[0] for s in config.SAMPLES])
    parser.add_argument("--phases", nargs="+", choices=PHASES, default=list(PHASES))
    parser.add_argument("--skip-build", action="store_true")
    return parser.parse_args()


def select_jobs(args: argparse.Namespace) -> list[Job]:
    chosen = [s for s in config.SAMPLES if s[0] in args.samples]
    return [Job(tree, sample, dataset, algorithm_id) for tree in args.trees for sample, dataset, algorithm_id in chosen]


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


def run_uploads(
    jobs: list[Job],
    endpoints: dict[str, dict[str, str]],
    tars: dict[tuple[str, str], Path],
    args: argparse.Namespace,
) -> list[Stage]:
    secure_registry = endpoints["secure-rads"].get("registry", "")
    if any(job.tree == "secure-rads" for job in jobs) and not secure_registry:
        msg = "secure-rads registry URL not configured (is the CSAV host running?)"
        print(msg, file=sys.stderr)
        raise SystemExit(1)

    stages: list[Stage] = []
    for job in jobs:
        for rep in range(args.rep_start, args.rep_start + args.reps):
            stage = upload_once(job, rep, endpoints[job.tree], secure_registry, tars[(job.tree, job.sample)])
            stages.append(stage)
            print(f"upload {job.tree}/{job.sample} rep={rep} {stage.seconds:.1f}s err={stage.error}", flush=True)
    return stages


def run_executes(
    jobs: list[Job],
    endpoints: dict[str, dict[str, str]],
    args: argparse.Namespace,
) -> list[Stage]:
    stages: list[Stage] = []
    for job in jobs:
        for rep in range(args.rep_start, args.rep_start + args.reps):
            stage = execute_once(job, rep, endpoints[job.tree])
            stages.append(stage)
            print(
                f"execute {job.tree}/{job.sample} rep={rep} {stage.seconds:.1f}s "
                f"status={stage.status} err={stage.error}",
                flush=True,
            )
    return stages


def main() -> int:
    args = parse_args()
    jobs = select_jobs(args)
    if not jobs:
        print("no matching samples", file=sys.stderr)
        return 1

    tars = {} if "uploads" not in args.phases else collect_tars(jobs, skip_build=args.skip_build)
    endpoints = config.resolve_endpoints(include_secure_registry="uploads" in args.phases)

    run_started = int(time.time())
    if "uploads" in args.phases:
        flush(run_uploads(jobs, endpoints, tars, args), ["uploads"], run_started)
    if "seed" in args.phases:
        for tree in args.trees:
            print(f"seed: {tree}", flush=True)
            seed(tree)
    if "executes" in args.phases:
        flush(run_executes(jobs, endpoints, args), ["executes"], run_started)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
