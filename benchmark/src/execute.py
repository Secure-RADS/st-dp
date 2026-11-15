#!/usr/bin/env python3

from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import time

import httpx
from pydantic import BaseModel
from tqdm import tqdm

from lib import config, http
from lib.log import logger
from lib.trees import Tree, TreeHarness, harness_for
from paths import RAW_DIR, REPO_ROOT

SeedOutputs = dict[Tree, dict[str, dict[str, str]]]


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


def _seed_env(tree: Tree, outputs: SeedOutputs, dataset: str) -> dict[str, str]:
    env = {"AWS_REGION": config.REGION, "SEED_DATASET": dataset}
    if tree is Tree.RADS:
        env["RADS_PDM_TABLE"] = outputs[Tree.RADS]["pdm"].get("PersonalDataTableName", "")
        return env
    env["PDM_TABLE"] = outputs[Tree.SECURE_RADS]["pdm"].get("PersonalDataTableName", "")
    env["DATA_KEY_TABLE"] = outputs[Tree.SECURE_RADS]["pdm"].get("DataKeyTableName", "")
    env["ALGORITHM_TABLE"] = outputs[Tree.SECURE_RADS]["registry_storage"].get("AlgorithmTableName", "")
    return env


def seed(tree: Tree, dataset: str, outputs: SeedOutputs) -> None:
    subprocess.run(
        ["bun", "run", "seed-rads" if tree is Tree.RADS else "seed-secure-rads"],
        check=True,
        cwd=REPO_ROOT / "seeding",
        env={**os.environ, **_seed_env(tree, outputs, dataset)},
    )


def payload_error(output: str | None) -> str | None:
    if not output:
        return None
    try:
        parsed = json.loads(output)
    except json.JSONDecodeError:
        return None
    return str(parsed["error"]) if isinstance(parsed, dict) and parsed.get("error") else None


async def run_once(harness: TreeHarness, client: httpx.AsyncClient, dataset: str, size: int, rep: int) -> Result:
    start = time.perf_counter()
    run_id = status = output = None
    error = None
    try:
        run_id, status, output = await harness.execute(client, config.TRIAL_ALGORITHM_ID, size)
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
    parser.add_argument("--start-rep", type=int, default=1, help="first repetition to run (for resuming)")
    parser.add_argument("--trees", nargs="+", type=Tree, choices=list(Tree), default=list(Tree))
    parser.add_argument("--sizes", nargs="+", type=int, help="size subset to sweep (default: config.TRIAL_SIZES)")
    parser.add_argument("--skip-generate", action="store_true")
    parser.add_argument("--skip-seed", action="store_true")
    parser.add_argument("--setup-only", action="store_true", help="generate, upload, and seed; skip the size sweep")
    return parser.parse_args()


async def _upload_one(client: httpx.AsyncClient, harness: TreeHarness) -> None:
    logger.info("upload: {}/{}", harness.name, config.TRIAL_SAMPLE)
    await harness.upload(client, config.TRIAL_ALGORITHM_ID)


async def _seed_one(harness: TreeHarness, dataset: str, outputs: SeedOutputs) -> None:
    logger.info("seed: {} <- seeding/datasets/{}.json", harness.name, dataset)
    await asyncio.to_thread(seed, harness.name, dataset, outputs)


async def setup(
    harnesses: list[TreeHarness],
    *,
    dataset: str,
    outputs: SeedOutputs,
    skip_generate: bool,
    skip_seed: bool,
) -> None:
    if not skip_generate:
        await asyncio.to_thread(generate)
        logger.info("generated shared dataset {} (same file seeded to every tree)", dataset)

    timeout = httpx.Timeout(http.HTTP_TIMEOUT_SECONDS)
    async with httpx.AsyncClient(timeout=timeout) as client:
        await asyncio.gather(*[_upload_one(client, harness) for harness in harnesses])

    if skip_seed:
        logger.info("skip-seed: using existing {}", dataset)
        return

    await asyncio.to_thread(
        subprocess.run,
        ["bun", "install"],
        check=True,
        cwd=REPO_ROOT / "seeding",
    )
    await asyncio.gather(*[_seed_one(harness, dataset, outputs) for harness in harnesses])


async def amain() -> int:
    args = parse_args()
    sizes = args.sizes or config.TRIAL_SIZES
    dataset = config.TRIAL_DATASET

    try:
        urls, outputs = await asyncio.to_thread(config.resolve, args.trees)
    except Exception as err:  # noqa: BLE001 - surface resolve failures as CLI errors
        logger.error("failed to resolve service catalog: {}", err)
        return 1

    for tree in args.trees:
        if "registry" not in urls.get(tree, {}):
            logger.error("{} registry URL not resolved (is the service / CSAV host running?)", tree)
            return 1

    harnesses = [harness_for(tree, urls[tree]) for tree in args.trees]
    await setup(
        harnesses,
        dataset=dataset,
        outputs=outputs,
        skip_generate=args.skip_generate,
        skip_seed=args.skip_seed,
    )
    if args.setup_only:
        logger.info("setup-only: skipping size sweep")
        return 0

    results: list[Result] = []
    # Persist after every completed run so a reboot or killed session loses at most one run.
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    out = RAW_DIR / f"sweep-{int(time.time())}.json"
    # Launch every (rep, size, tree) together; each run has its own PDM/execution stack.
    jobs = [
        (harness, size, rep) for rep in range(args.start_rep, args.reps + 1) for size in sizes for harness in harnesses
    ]
    timeout = httpx.Timeout(http.HTTP_TIMEOUT_SECONDS)
    limits = httpx.Limits(max_connections=max(1, len(jobs)))
    async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
        tasks = [run_once(harness, client, dataset, size, rep) for harness, size, rep in jobs]
        for done in tqdm(asyncio.as_completed(tasks), total=len(tasks), desc="execute", unit="run"):
            result = await done
            results.append(result)
            logger.info(
                "execute {}/{} size={} rep={} {:.1f}s status={} err={}",
                result.tree,
                dataset,
                result.size,
                result.rep,
                result.seconds,
                result.status,
                result.error,
            )
            rows = sorted(results, key=lambda row: (row.rep, row.size, row.tree.value))
            out.write_text(json.dumps([row.model_dump() for row in rows], indent=2))

    logger.info("wrote {} ({} rows)", out, len(results))
    return 0


def main() -> int:
    return asyncio.run(amain())


if __name__ == "__main__":
    raise SystemExit(main())
