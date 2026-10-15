#!/usr/bin/env python3

from __future__ import annotations

import csv
import json
from datetime import datetime
from typing import Any

from tqdm import tqdm

from lib import config, http
from lib.log import logger
from lib.trees import Tree
from paths import PHASE_TIMINGS_CSV, RAW_DIR

# null endpoints = phase does not apply (rads has no enclave).
Window = tuple[str | None, str | None]

PHASES: dict[str, dict[str, Window]] = {
    "secure-rads": {
        "host_provisioning": ("executor-launched", "executor-ready"),
        "algorithm_retrieval": ("executor-ready", "artifact-retrieved"),
        "enclave_boot": ("artifact-retrieved", "enclave-started"),
        "sce_unit": ("enclave-started", "unit-ready"),
        "attestation": ("unit-ready", "attested"),
        "data_retrieval": ("attested", "records-stored-locally"),
        "algorithm_processing": ("records-stored-locally", "dc-app-completed"),
        "result_delivery": ("output-sent", "result-persisted"),
        "total": ("run-requested", "result-persisted"),
    },
    "rads": {
        "host_provisioning": ("executor-launched", "executor-ready"),
        "algorithm_retrieval": ("executor-ready", "artifact-retrieved"),
        "enclave_boot": (None, None),
        "sce_unit": (None, None),
        "attestation": (None, None),
        "data_retrieval": ("artifact-retrieved", "records-stored-locally"),
        "algorithm_processing": ("records-stored-locally", "compute-completed"),
        "result_delivery": ("compute-completed", "result-persisted"),
        "total": ("run-requested", "result-persisted"),
    },
}

COLUMNS = list(PHASES["secure-rads"])

TIMESTAMP_EVENTS = [
    "run-requested",
    "executor-launched",
    "enclave-launched",
    "executor-ready",
    "artifact-retrieved",
    "enclave-started",
    "unit-ready",
    "attested",
    "records-fetched",
    "records-decrypted",
    "records-stored-locally",
    "dc-app-completed",
    "compute-completed",
    "output-sent",
    "result-persisted",
    "executor-finished",
]


def load_runs() -> list[dict[str, Any]]:
    if not RAW_DIR.is_dir():
        return []
    rows: list[dict[str, Any]] = []
    for path in sorted(RAW_DIR.glob("sweep-*.json")):
        parsed = json.loads(path.read_text())
        rows.extend(row for row in parsed if row.get("run_id") and row.get("size") is not None and not row.get("error"))
    return rows


def fetch_events(url: str, algorithm_id: str, run_id: str) -> dict[str, str]:
    endpoint = f"{url}/logs/{algorithm_id}?runId={run_id}"
    status, body = http.request("GET", endpoint, timeout=60)
    http.require(status, http.HTTP_OK, f"GET {endpoint}", body)
    events = json.loads(body)
    events.sort(key=lambda event: _parse_ts(event["timestamp"]))
    by_event: dict[str, str] = {}
    for event in events:
        by_event.setdefault(event["event"], event["timestamp"])
    return by_event


def _parse_ts(value: str) -> float:
    if value.endswith("Z"):
        value = f"{value[:-1]}+00:00"
    return datetime.fromisoformat(value).timestamp()


def window_seconds(by_event: dict[str, str], window: Window) -> str:
    start, end = window
    if not start or not end:
        return ""
    from_ts = by_event.get(start)
    to_ts = by_event.get(end)
    if not from_ts or not to_ts:
        return ""
    return f"{(_parse_ts(to_ts) - _parse_ts(from_ts)):.2f}"


def main() -> int:
    runs = load_runs()
    if not runs:
        logger.error("no sweep rows in {}; run `make execute` first", RAW_DIR)
        return 1

    try:
        resolved, _ = config.resolve()
    except Exception as err:  # noqa: BLE001 - surface resolve failures as CLI errors
        logger.error("failed to resolve service catalog: {}", err)
        return 1
    urls = {tree: resolved[tree]["log"] for tree in Tree}

    header = [
        "dataset_size",
        "tree",
        "run",
        "status",
        *[f"{column}_s" for column in COLUMNS],
        *[f"{event}_ts" for event in TIMESTAMP_EVENTS],
    ]

    PHASE_TIMINGS_CSV.parent.mkdir(parents=True, exist_ok=True)
    with PHASE_TIMINGS_CSV.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        for row in tqdm(runs, desc="export", unit="run"):
            by_event = fetch_events(urls[Tree(row["tree"])], row["algorithm_id"], row["run_id"])
            phases = [window_seconds(by_event, PHASES[row["tree"]][column]) for column in COLUMNS]
            stamps = [by_event.get(event, "") for event in TIMESTAMP_EVENTS]
            writer.writerow([row["size"], row["tree"], row["rep"], row.get("status") or "", *phases, *stamps])

    logger.info("wrote {} ({} runs)", PHASE_TIMINGS_CSV, len(runs))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
