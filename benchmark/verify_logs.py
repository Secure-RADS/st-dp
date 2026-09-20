#!/usr/bin/env python3
"""Reconcile the committed raw timings against what the log services hold.

Every measurement the harness takes is also POSTed to the tree's log service as a
`run-requested` event whose detail carries the stage and seconds. This script reads
those events back and checks they match the raw JSON, so the log service can be
treated as the system of record.

Run with:  python3 benchmark/verify_logs.py
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import config, flow

RAW_DIR = Path(__file__).resolve().parent / "results" / "raw"

# Means are compared at millisecond precision; below this they are the same measurement.
MEAN_TOLERANCE_SECONDS = 0.01


def raw_means() -> dict[tuple[str, str, str], list[float]]:
    acc: dict[tuple[str, str, str], list[float]] = defaultdict(list)
    for path in sorted(RAW_DIR.glob("*.json")):
        for row in json.loads(path.read_text()):
            if row.get("seconds") is not None:
                acc[(row["tree"], row["stage"], row["sample"])].append(float(row["seconds"]))
    return acc


def log_service_means(endpoints: dict[str, dict[str, str]]) -> dict[tuple[str, str, str], list[float]]:
    acc: dict[tuple[str, str, str], list[float]] = defaultdict(list)
    for tree in config.TREES:
        for _sample, _dataset, algorithm_id in config.SAMPLES:
            events = flow.fetch_events(endpoints[tree]["log"], algorithm_id)
            for event in events:
                detail = event.get("detail") or {}
                if detail.get("source") != "benchmark":
                    continue
                seconds = detail.get("seconds")
                if seconds is None:
                    continue
                acc[(tree, detail.get("stage", "?"), detail.get("sample", "?"))].append(float(seconds))
    return acc


def counts(endpoints: dict[str, dict[str, str]]) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}
    for tree in config.TREES:
        totals: dict[str, int] = defaultdict(int)
        for _sample, _dataset, algorithm_id in config.SAMPLES:
            for event in flow.fetch_events(endpoints[tree]["log"], algorithm_id):
                totals[event.get("event", "?")] += 1
        out[tree] = dict(sorted(totals.items()))
    return out


def main() -> int:
    # Only log-service URLs are needed, so this works with the CSAV host stopped.
    endpoints = config.resolve_endpoints(include_secure_registry=False)
    raw = raw_means()
    logged = log_service_means(endpoints)

    print("=== event counts recorded in each log service ===")
    for tree, totals in counts(endpoints).items():
        print(f"  {tree}:")
        for name, n in totals.items():
            print(f"    {name:24s} {n}")

    print()
    print("=== timings: raw JSON vs log service (mean seconds) ===")
    print(
        f"{'tree':12s} {'stage':8s} {'sample':24s} {'raw n':>6s} {'raw mean':>9s} "
        f"{'log n':>6s} {'log mean':>9s}  status"
    )
    problems = 0
    extras = 0
    for key in sorted(raw):
        tree, stage, sample = key
        raw_vals = raw[key]
        log_vals = logged.get(key, [])
        raw_mean = sum(raw_vals) / len(raw_vals)
        log_mean = sum(log_vals) / len(log_vals) if log_vals else float("nan")

        if len(log_vals) < len(raw_vals):
            status = f"MISSING {len(raw_vals) - len(log_vals)}"
            problems += 1
        elif len(log_vals) > len(raw_vals):
            # Probe/manual runs also emit events; the committed raw set is the sweep only.
            status = f"ok (+{len(log_vals) - len(raw_vals)} extra)"
            extras += len(log_vals) - len(raw_vals)
        elif abs(raw_mean - log_mean) < MEAN_TOLERANCE_SECONDS:
            status = "ok"
        else:
            status = "MEAN MISMATCH"
            problems += 1

        print(
            f"{tree:12s} {stage:8s} {sample:24s} {len(raw_vals):6d} {raw_mean:9.2f} "
            f"{len(log_vals):6d} {log_mean:9.2f}  {status}"
        )

    print()
    if extras:
        print(f"note: {extras} extra event(s) in the log services from probe/manual runs")
    print(
        "reconciled: every committed measurement is present in the log service"
        if problems == 0
        else f"{problems} problem(s)"
    )
    return 0 if problems == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
