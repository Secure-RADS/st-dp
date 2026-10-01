#!/usr/bin/env python3

from __future__ import annotations

import csv
import json
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime
from typing import Any

from paths import RAW_DIR, SWEEP_CSV

REGION = "ap-southeast-2"

LOG_STACKS = {
    "rads": "rads-log-service-dev",
    "secure-rads": "secure-rads-log-service-dev",
}

# null endpoints = phase does not apply (rads has no enclave).
Window = tuple[str | None, str | None]

PHASES: dict[str, dict[str, Window]] = {
    "secure-rads": {
        "algorithm_retrieval": ("executor-ready", "artifact-retrieved"),
        # Launch → executor-ready = host boot + tooling; enclave-started would nest algorithm retrieval.
        "enclave_initialization": ("enclave-launched", "executor-ready"),
        "attestation": ("unit-ready", "attested"),
        "sce_unit": ("enclave-started", "unit-ready"),
        "data_retrieval": ("attested", "records-fetched"),
        "data_decryption": ("records-fetched", "data-decrypted"),
        "algorithm_processing": ("data-decrypted", "dc-app-completed"),
        "result_delivery": ("output-sent", "result-persisted"),
        "total": ("run-requested", "result-persisted"),
    },
    "rads": {
        "algorithm_retrieval": ("executor-ready", "artifact-retrieved"),
        "enclave_initialization": ("executor-launched", "executor-ready"),
        "attestation": (None, None),
        "sce_unit": (None, None),
        "data_retrieval": ("artifact-retrieved", "records-fetched"),
        "data_decryption": (None, None),
        "algorithm_processing": ("records-fetched", "compute-completed"),
        "result_delivery": ("compute-completed", "executor-finished"),
        "total": ("run-requested", "executor-finished"),
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
    "data-decrypted",
    "dc-app-completed",
    "compute-completed",
    "output-sent",
    "result-persisted",
    "executor-finished",
]


def _aws(*args: str) -> str:
    out = subprocess.run(["aws", *args], capture_output=True, text=True, check=False)
    if out.returncode != 0:
        msg = f"aws {' '.join(args)} failed: {out.stderr.strip()}"
        raise RuntimeError(msg)
    return out.stdout.strip()


def log_url(stack: str) -> str:
    return _aws(
        "cloudformation",
        "describe-stacks",
        "--stack-name",
        stack,
        "--region",
        REGION,
        "--query",
        "Stacks[0].Outputs[?OutputKey=='HttpApiUrl'].OutputValue",
        "--output",
        "text",
    )


def load_runs() -> list[dict[str, Any]]:
    if not RAW_DIR.is_dir():
        return []
    rows: list[dict[str, Any]] = []
    for path in sorted(RAW_DIR.glob("sweep-*.json")):
        parsed = json.loads(path.read_text())
        rows.extend(row for row in parsed if row.get("run_id") and row.get("size") is not None)
    return rows


def fetch_events(url: str, algorithm_id: str, run_id: str) -> dict[str, str]:
    endpoint = f"{url}/logs/{algorithm_id}?runId={run_id}"
    req = urllib.request.Request(endpoint)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read()
    except urllib.error.HTTPError as err:
        msg = f"GET {endpoint} returned {err.code}"
        raise RuntimeError(msg) from err
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
        print(f"no sweep rows in {RAW_DIR}; run `make execute` first", file=sys.stderr)
        return 1

    urls = {tree: log_url(stack) for tree, stack in LOG_STACKS.items()}
    header = [
        "dataset_size",
        "tree",
        "run",
        "status",
        *[f"{column}_s" for column in COLUMNS],
        *[f"{event}_ts" for event in TIMESTAMP_EVENTS],
    ]

    SWEEP_CSV.parent.mkdir(parents=True, exist_ok=True)
    with SWEEP_CSV.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        for row in runs:
            by_event = fetch_events(urls[row["tree"]], row["algorithm_id"], row["run_id"])
            phases = [window_seconds(by_event, PHASES[row["tree"]][column]) for column in COLUMNS]
            stamps = [by_event.get(event, "") for event in TIMESTAMP_EVENTS]
            writer.writerow([row["size"], row["tree"], row["rep"], row.get("status") or "", *phases, *stamps])

    print(f"wrote {SWEEP_CSV} ({len(runs)} runs)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
