#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import subprocess
import time

from pydantic import BaseModel
from tqdm import tqdm

from lib import config
from lib.log import logger
from lib.trees import Tree, TreeHarness, harness_for
from paths import RAW_DIR, REPO_ROOT


class Result(BaseModel):
    tree: Tree
    dataset: str
    algorithm_id: str
    rep: int
    size: int
    seconds: float | None
    run_id: str | None = None
    status: str | None = None
    output: str | None = None
    error: str | None = None


def generate() -> None:
    subprocess.run(["bun", "install"], check=True, cwd=REPO_ROOT / "seeding")
    subprocess.run(["bun", "run", "generate"], check=True, cwd=REPO_ROOT / "seeding")


def seed(tree: Tree, dataset: str) -> None:
    env = {
        "RADS_PDM_TABLE": config.stack_outputs(config.STACKS[Tree.RADS]["pdm"]).get("PersonalDataTableName", ""),
        "PDM_TABLE": config.stack_outputs(config.STACKS[Tree.SECURE_RADS]["pdm"]).get("PersonalDataTableName", ""),
        "DATA_KEY_TABLE": config.stack_outputs(config.STACKS[Tree.SECURE_RADS]["pdm"]).get("DataKeyTableName", ""),
        "ALGORITHM_TABLE": config.stack_outputs("secure-rads-registry-service-storage").get("AlgorithmTableName", ""),
        "AWS_REGION": config.REGION,
        "SEED_DATASET": dataset,
    }
    subprocess.run(["bun", "install"], check=True, cwd=REPO_ROOT / "seeding")
    subprocess.run(
        ["bun", "run", "seed-rads" if tree is Tree.RADS else "seed-secure-rads"],
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


def run_once(harness: TreeHarness, dataset: str, size: int, rep: int) -> Result:
    start = time.perf_counter()
    run_id = status = output = None
    error = None
    try:
        run_id, status, output = harness.execute(config.TRIAL_ALGORITHM_ID, size)
        error = payload_error(output)
    except Exception as err:  # noqa: BLE001 - record and keep sweeping
        error = f"{type(err).__name__}: {err}"
    return Result(
        tree=harness.name,
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
    parser.add_argument("--trees", nargs="+", type=Tree, choices=list(Tree), default=list(Tree))
    parser.add_argument("--sizes", nargs="+", type=int, default=config.TRIAL_SIZES)
    parser.add_argument("--skip-generate", action="store_true")
    parser.add_argument("--skip-seed", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    sizes = sorted(args.sizes)
    dataset = config.TRIAL_DATASET
    endpoints = config.resolve_endpoints(include_secure_registry=True)
    if Tree.SECURE_RADS in args.trees and not endpoints[Tree.SECURE_RADS].get("registry"):
        logger.error("secure-rads registry URL not configured (is the CSAV host running?)")
        return 1

    harnesses = [harness_for(tree, endpoints[tree]) for tree in args.trees]

    if not args.skip_generate:
        generate()
        logger.info("generated shared dataset {} (same file seeded to every tree)", dataset)
    for harness in harnesses:
        logger.info("upload: {}/{}", harness.name, config.TRIAL_SAMPLE)
        harness.upload(config.TRIAL_ALGORITHM_ID)
    if not args.skip_seed:
        for harness in harnesses:
            logger.info("seed: {} <- seeding/datasets/{}.json", harness.name, dataset)
            seed(harness.name, dataset)
    else:
        logger.info("skip-seed: using existing {}", dataset)

    results: list[Result] = []
    jobs = [
        (size, harness, rep)
        for size in sizes
        for harness in harnesses
        for rep in range(1, args.reps + 1)
    ]
    for size, harness, rep in tqdm(jobs, desc="execute", unit="run"):
        result = run_once(harness, dataset, size, rep)
        results.append(result)
        logger.info(
            "execute {}/{} size={} rep={} {:.1f}s status={} err={}",
            harness.name,
            dataset,
            size,
            rep,
            result.seconds,
            result.status,
            result.error,
        )

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    out = RAW_DIR / f"sweep-{int(time.time())}.json"
    out.write_text(json.dumps([result.model_dump() for result in results], indent=2))
    logger.info("wrote {} ({} rows)", out, len(results))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
