#!/usr/bin/env python3
"""Benchmark driver: build each sample once, then repeat upload/register/execute.

Per sample, per tree, per repetition the harness times the client-observed
stages and records them to the tree's log service so the run timeline and the
raw JSON here agree.

Usage:
    python3 benchmark/run.py --reps 10
    python3 benchmark/run.py --trees rads --samples health-risk-python --reps 1
    python3 benchmark/run.py --build-only
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
class Repetition:
    tree: str
    sample: str
    dataset: str
    algorithm_id: str
    rep: int
    upload_seconds: float | None
    register_seconds: float | None
    execute_seconds: float | None
    total_seconds: float | None
    run_id: str | None
    status: str | None
    output: str | None
    error: str | None


def build_image(tree: str, sample: str) -> Path:
    """Build the arm64 image tar once per sample. rads runs it directly;
    secure-rads feeds the same tar to the EIF-building registry upload."""
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


def run_one(
    tree: str,
    sample: str,
    dataset: str,
    algorithm_id: str,
    rep: int,
    endpoints: dict[str, str],
    *,
    registry_url: str | None,
    tar_path: Path,
    client_timestamp: str,
) -> Repetition:
    total_start = time.perf_counter()
    timing = flow.StageTiming()
    try:
        if tree == "rads":
            timing.upload_seconds = flow.upload_rads(endpoints["registry"], algorithm_id, tar_path)
            timing.register_seconds = flow.register_rads(endpoints["registry"], algorithm_id)
        else:
            if registry_url is None:
                raise flow.FlowError("secure-rads registry URL not configured")
            timing.upload_seconds = flow.upload_secure(registry_url, algorithm_id, tar_path)

        timing.execute_seconds, timing.run_id, timing.status, timing.output = flow.execute(
            endpoints["execution"], algorithm_id
        )
    except Exception as err:  # noqa: BLE001 - record and continue the sweep
        timing.error = f"{type(err).__name__}: {err}"
    timing.total_seconds = time.perf_counter() - total_start

    flow._request(  # noqa: SLF001 - direct stage timing event, best-effort
        "POST",
        f"{endpoints['log']}/events",
        data=json.dumps(
            {
                "algorithmId": algorithm_id,
                "runId": timing.run_id or f"bench-{tree}-{sample}-{rep}",
                "event": "run-requested",
                "timestamp": client_timestamp,
                "detail": {
                    "tree": tree,
                    "sample": sample,
                    "rep": rep,
                    "uploadSeconds": timing.upload_seconds,
                    "registerSeconds": timing.register_seconds,
                    "executeSeconds": timing.execute_seconds,
                    "totalSeconds": timing.total_seconds,
                    "status": timing.status,
                    "error": timing.error,
                },
            }
        ).encode(),
        headers={"Content-Type": "application/json"},
    )

    return Repetition(
        tree=tree,
        sample=sample,
        dataset=dataset,
        algorithm_id=algorithm_id,
        rep=rep,
        upload_seconds=timing.upload_seconds,
        register_seconds=timing.register_seconds,
        execute_seconds=timing.execute_seconds,
        total_seconds=timing.total_seconds,
        run_id=timing.run_id,
        status=timing.status,
        output=timing.output,
        error=timing.error,
    )


def seed(tree: str) -> None:
    cmd = {
        "rads": "seed-rads",
        "secure-rads": "seed-secure-rads",
    }[tree]
    subprocess.run(["bun", "install"], check=True, cwd=REPO_ROOT / "seeding")
    subprocess.run(["bun", "run", "generate"], check=True, cwd=REPO_ROOT / "seeding")
    env = {
        "RADS_PDM_TABLE": config.stack_outputs(config.STACKS["rads"]["pdm"]).get("PersonalDataTableName", ""),
        "PDM_TABLE": config.stack_outputs(config.STACKS["secure-rads"]["pdm"]).get("PersonalDataTableName", ""),
        "DATA_KEY_TABLE": config.stack_outputs(config.STACKS["secure-rads"]["pdm"]).get("DataKeyTableName", ""),
        "ALGORITHM_TABLE": config.stack_outputs("secure-rads-registry-service-storage").get("AlgorithmsTableName", ""),
        "AWS_REGION": config.REGION,
    }
    subprocess.run(["bun", "run", cmd], check=True, cwd=REPO_ROOT / "seeding", env={**os.environ, **env})


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reps", type=int, default=10)
    parser.add_argument("--trees", nargs="+", choices=config.TREES, default=list(config.TREES))
    parser.add_argument("--samples", nargs="+", default=[s[0] for s in config.SAMPLES])
    parser.add_argument("--build-only", action="store_true")
    parser.add_argument("--skip-seed", action="store_true")
    args = parser.parse_args()

    samples = [s for s in config.SAMPLES if s[0] in args.samples]
    if not samples:
        print("no matching samples", file=sys.stderr)
        return 1

    endpoints = config.resolve_endpoints()
    secure_registry = endpoints["secure-rads"].get("registry")

    built: dict[tuple[str, str], Path] = {}
    for tree in args.trees:
        for sample, _dataset, _algorithm_id in samples:
            print(f"build: {tree}/{sample}", flush=True)
            built[(tree, sample)] = build_image(tree, sample)
    if args.build_only:
        return 0

    if not args.skip_seed:
        for tree in args.trees:
            print(f"seed: {tree}", flush=True)
            seed(tree)

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    all_reps: list[Repetition] = []
    run_started = int(time.time())
    for tree in args.trees:
        for sample, dataset, algorithm_id in samples:
            tar_path = built[(tree, sample)]
            for rep in range(1, args.reps + 1):
                timestamp = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
                print(f"run: {tree}/{sample} rep={rep}/{args.reps}", flush=True)
                repetition = run_one(
                    tree,
                    sample,
                    dataset,
                    algorithm_id,
                    rep,
                    endpoints[tree],
                    registry_url=secure_registry,
                    tar_path=tar_path,
                    client_timestamp=timestamp,
                )
                all_reps.append(repetition)
                print(
                    f"  upload={_fmt(repetition.upload_seconds)} "
                    f"execute={_fmt(repetition.execute_seconds)} "
                    f"total={_fmt(repetition.total_seconds)} status={repetition.status} "
                    f"err={repetition.error}",
                    flush=True,
                )

    out_path = RAW_DIR / f"runs-{run_started}.json"
    out_path.write_text(json.dumps([asdict(r) for r in all_reps], indent=2))
    print(f"wrote {out_path}", flush=True)
    return 0


def _fmt(value: float | None) -> str:
    return f"{value:.2f}s" if value is not None else "n/a"


if __name__ == "__main__":
    raise SystemExit(main())
