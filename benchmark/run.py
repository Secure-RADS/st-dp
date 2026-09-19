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
from dataclasses import asdict, dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import config, flow  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
BUILD_DIR = Path(__file__).resolve().parent / "build"
RAW_DIR = Path(__file__).resolve().parent / "results" / "raw"


@dataclass
class Stage:
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


def emit(client_timestamp: str, endpoints: dict[str, str], stage: Stage) -> None:
    flow.post_event(
        endpoints["log"],
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
    tree: str,
    sample: str,
    dataset: str,
    algorithm_id: str,
    rep: int,
    endpoints: dict[str, str],
    secure_registry: str | None,
    tar_path: Path,
) -> Stage:
    timestamp = flow.now_iso()
    start = time.perf_counter()
    error = None
    try:
        if tree == "rads":
            flow.upload_rads(endpoints["registry"], algorithm_id, tar_path)
            flow.register_rads(endpoints["registry"], algorithm_id)
        else:
            if not secure_registry:
                raise flow.FlowError("secure-rads registry URL not configured")
            flow.upload_secure(secure_registry, algorithm_id, tar_path)
    except Exception as err:  # noqa: BLE001 - record and keep sweeping
        error = f"{type(err).__name__}: {err}"
    stage = Stage(tree, sample, dataset, algorithm_id, rep, "upload", time.perf_counter() - start, error=error)
    emit(timestamp, endpoints, stage)
    return stage


def execute_once(
    tree: str,
    sample: str,
    dataset: str,
    algorithm_id: str,
    rep: int,
    endpoints: dict[str, str],
) -> Stage:
    start = time.perf_counter()
    error = None
    run_id = status = output = None
    try:
        _elapsed, run_id, status, output = flow.execute(endpoints["execution"], algorithm_id)
    except Exception as err:  # noqa: BLE001
        error = f"{type(err).__name__}: {err}"
    stage = Stage(
        tree,
        sample,
        dataset,
        algorithm_id,
        rep,
        "execute",
        time.perf_counter() - start,
        run_id=run_id,
        status=status,
        output=output,
        error=error,
    )
    emit(flow.now_iso(), endpoints, stage)
    return stage


def seed(tree: str) -> None:
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
    if not stages:
        return
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    out = RAW_DIR / f"{'-'.join(phases)}-{run_started}.json"
    existing: list[dict] = json.loads(out.read_text()) if out.exists() else []
    existing.extend(asdict(s) for s in stages)
    out.write_text(json.dumps(existing, indent=2))
    print(f"wrote {out} ({len(existing)} rows)", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reps", type=int, default=10)
    parser.add_argument("--rep-start", type=int, default=1, help="first rep index; lets passes append without collisions")
    parser.add_argument("--trees", nargs="+", choices=config.TREES, default=list(config.TREES))
    parser.add_argument("--samples", nargs="+", default=[s[0] for s in config.SAMPLES])
    parser.add_argument(
        "--phases",
        nargs="+",
        choices=["uploads", "seed", "executes"],
        default=["uploads", "seed", "executes"],
    )
    parser.add_argument("--skip-build", action="store_true")
    args = parser.parse_args()

    samples = [s for s in config.SAMPLES if s[0] in args.samples]
    if not samples:
        print("no matching samples", file=sys.stderr)
        return 1

    endpoints = config.resolve_endpoints()
    secure_registry = endpoints["secure-rads"].get("registry")

    tars: dict[tuple[str, str], Path] = {}
    for tree in args.trees:
        for sample, _d, _a in samples:
            tar_path = BUILD_DIR / f"{tree}-{sample}.tar"
            if not tar_path.exists():
                if args.skip_build:
                    print(f"missing {tar_path} and --skip-build was passed", file=sys.stderr)
                    return 1
                print(f"build: {tree}/{sample}", flush=True)
                tar_path = build_image(tree, sample)
            tars[(tree, sample)] = tar_path

    run_started = int(time.time())
    stages: list[Stage] = []

    if "uploads" in args.phases:
        for tree in args.trees:
            for sample, dataset, algorithm_id in samples:
                for rep in range(args.rep_start, args.rep_start + args.reps):
                    stage = upload_once(
                        tree, sample, dataset, algorithm_id, rep,
                        endpoints[tree], secure_registry, tars[(tree, sample)],
                    )
                    stages.append(stage)
                    print(f"upload {tree}/{sample} rep={rep} {stage.seconds:.1f}s err={stage.error}", flush=True)
        flush(stages, ["uploads"], run_started)
        stages = []

    if "seed" in args.phases:
        for tree in args.trees:
            print(f"seed: {tree}", flush=True)
            seed(tree)

    if "executes" in args.phases:
        for tree in args.trees:
            for sample, dataset, algorithm_id in samples:
                for rep in range(args.rep_start, args.rep_start + args.reps):
                    stage = execute_once(tree, sample, dataset, algorithm_id, rep, endpoints[tree])
                    stages.append(stage)
                    print(
                        f"execute {tree}/{sample} rep={rep} {stage.seconds:.1f}s "
                        f"status={stage.status} err={stage.error}",
                        flush=True,
                    )
        flush(stages, ["executes"], run_started)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
