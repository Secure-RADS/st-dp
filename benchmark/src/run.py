#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from typing import TYPE_CHECKING

from pydantic import BaseModel

from lib import config, flow
from paths import BUILD_DIR, RAW_DIR, REPO_ROOT

if TYPE_CHECKING:
    from pathlib import Path


class Result(BaseModel):
    tree: str
    dataset: str
    algorithm_id: str
    rep: int
    size: int
    seconds: float | None
    run_id: str | None = None
    status: str | None = None
    output: str | None = None
    error: str | None = None


def build_tar(tree: str) -> Path:
    tar_path = BUILD_DIR / f"{tree}-{config.TRIAL_SAMPLE}.tar"
    if tar_path.exists():
        return tar_path
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    tag = f"bench-{tree}-{config.TRIAL_SAMPLE}:local"
    context = REPO_ROOT / tree / "samples" / config.TRIAL_SAMPLE
    subprocess.run(["docker", "build", "--platform", "linux/arm64", "-t", tag, str(context)], check=True, cwd=REPO_ROOT)
    subprocess.run(["docker", "save", tag, "-o", str(tar_path)], check=True)
    return tar_path


def upload(tree: str, endpoints: dict[str, str], tar_path: Path) -> None:
    if tree == "rads":
        flow.upload_rads(endpoints["registry"], config.TRIAL_ALGORITHM_ID, tar_path)
        flow.register_rads(endpoints["registry"], config.TRIAL_ALGORITHM_ID)
    else:
        flow.upload_secure(endpoints["registry"], config.TRIAL_ALGORITHM_ID, tar_path)


def generate() -> None:
    subprocess.run(["bun", "install"], check=True, cwd=REPO_ROOT / "seeding")
    subprocess.run(["bun", "run", "generate"], check=True, cwd=REPO_ROOT / "seeding")


def seed(tree: str, dataset: str) -> None:
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


def payload_error(output: str | None) -> str | None:
    if not output:
        return None
    try:
        parsed = json.loads(output)
    except json.JSONDecodeError:
        return None
    return str(parsed["error"]) if isinstance(parsed, dict) and parsed.get("error") else None


def run_once(tree: str, dataset: str, size: int, rep: int, endpoints: dict[str, str]) -> Result:
    start = time.perf_counter()
    run_id = status = output = None
    error = None
    try:
        run_id, status, output = flow.execute(endpoints["execution"], config.TRIAL_ALGORITHM_ID, size)
        error = payload_error(output)
    except Exception as err:  # noqa: BLE001 - record and keep sweeping
        error = f"{type(err).__name__}: {err}"
    return Result(
        tree=tree,
        dataset=dataset,
        algorithm_id=config.TRIAL_ALGORITHM_ID,
        rep=rep,
        size=size,
        seconds=time.perf_counter() - start,
        run_id=run_id,
        status=status,
        output=output,
        error=error,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reps", type=int, default=10)
    parser.add_argument("--trees", nargs="+", choices=config.TREES, default=list(config.TREES))
    parser.add_argument("--sizes", nargs="+", type=int, default=config.TRIAL_SIZES)
    parser.add_argument("--skip-generate", action="store_true")
    parser.add_argument("--skip-seed", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    sizes = sorted(args.sizes)
    dataset = config.trial_dataset(max(sizes))
    endpoints = config.resolve_endpoints(include_secure_registry=True)
    if "secure-rads" in args.trees and not endpoints["secure-rads"].get("registry"):
        print("secure-rads registry URL not configured (is the CSAV host running?)", file=sys.stderr)
        return 1

    if not args.skip_generate:
        generate()
        print(f"generated shared dataset {dataset} (same file seeded to every tree)", flush=True)
    for tree in args.trees:
        print(f"upload: {tree}/{config.TRIAL_SAMPLE}", flush=True)
        upload(tree, endpoints[tree], build_tar(tree))
    if not args.skip_seed:
        for tree in args.trees:
            print(f"seed: {tree} <- seeding/datasets/{dataset}.json", flush=True)
            seed(tree, dataset)
    else:
        print(f"skip-seed: using existing {dataset}", flush=True)

    results: list[Result] = []
    for size in sizes:
        for tree in args.trees:
            for rep in range(1, args.reps + 1):
                result = run_once(tree, dataset, size, rep, endpoints[tree])
                results.append(result)
                print(
                    f"execute {tree}/{dataset} size={size} rep={rep} {result.seconds:.1f}s "
                    f"status={result.status} err={result.error}",
                    flush=True,
                )

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    out = RAW_DIR / f"sweep-{int(time.time())}.json"
    out.write_text(json.dumps([result.model_dump() for result in results], indent=2))
    print(f"wrote {out} ({len(results)} rows)", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
