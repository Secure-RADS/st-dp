#!/usr/bin/env python3
"""Decompose execution time into attributable phases, from log-service events.

An execution's wall clock is dominated by per-run provisioning (fresh EC2 instance
plus a `dnf install` of the tooling) that both trees pay. This separates that from
the work the trusted path actually adds, so the comparison is not misread.

Writes results/phases.json and results/figures/execution-phases.png.

Run with:  python3 benchmark/timeline.py
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

import matplotlib as mpl

mpl.use("Agg")

import matplotlib.pyplot as plt

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import config, flow

HERE = Path(__file__).resolve().parent
OUT_JSON = HERE / "results" / "phases.json"
OUT_FIG = HERE / "results" / "figures" / "execution-phases.png"

TREES = ["rads", "secure-rads"]
PALETTE = {"rads": "#2E6F95", "secure-rads": "#C8542A"}

MIN_LABEL_SECONDS = 4.0

LAUNCHED = {"executor-launched", "enclave-launched"}
READY = {"executor-finished", "enclave-started"}
TERMINAL = {"result-persisted", "executor-finished"}
EXEC_EVENTS = {
    "run-requested",
    "executor-launched",
    "launch-failed",
    "executor-finished",
    "enclave-launched",
    "enclave-started",
    "attested",
    "records-fetched",
    "dc-app-completed",
    "output-sent",
    "run-failed",
    "result-persisted",
}


def parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts).astimezone(UTC)


def fetch_runs(log_url: str) -> list[list[dict]]:
    runs: list[list[dict]] = []
    for _sample, _dataset, algorithm_id in config.SAMPLES:
        by_run: dict[str, list[dict]] = defaultdict(list)
        for event in flow.fetch_events(log_url, algorithm_id):
            if event.get("event") in EXEC_EVENTS and event.get("runId"):
                by_run[event["runId"]].append(event)
        for events in by_run.values():
            events.sort(key=lambda e: parse(e["timestamp"]))
            runs.append(events)
    return runs


def phase_seconds(tree: str, events: list[dict]) -> dict[str, float]:
    """Split one run into phases; missing phases contribute 0."""
    service = [e for e in events if (e.get("detail") or {}).get("source") != "benchmark"]
    client = [e for e in events if (e.get("detail") or {}).get("source") == "benchmark"]
    if not service or not client:
        return {}

    t0 = parse(service[0]["timestamp"])
    t_end = parse(client[-1]["timestamp"])

    def first(names: set[str]) -> float | None:
        for e in service:
            if e["event"] in names:
                return (parse(e["timestamp"]) - t0).total_seconds()
        return None

    launch = first(LAUNCHED)
    ready = first(READY)
    attested = first({"attested"})
    records = first({"records-fetched"})
    compute = first({"dc-app-completed"})
    terminal = first(TERMINAL)
    if launch is None or ready is None or terminal is None:
        return {}

    total = (t_end - t0).total_seconds()
    phases: dict[str, float] = {
        "control_plane": launch,
        "provisioning": ready - launch,
        "result_delivery": total - terminal,
    }
    if tree == "secure-rads":
        phases["trusted_attest"] = (attested or ready) - ready
        phases["trusted_data"] = (records or ready) - (attested or ready)
        phases["trusted_compute"] = (compute or ready) - (records or ready)
        phases["trusted_result"] = terminal - (compute or ready)
    else:
        # rads' fetch/load/compute happens inside the provisioning window (the
        # executor only reports once, at the end), so it cannot be split out.
        phases["trusted_attest"] = 0.0
        phases["trusted_data"] = 0.0
        phases["trusted_compute"] = 0.0
        phases["trusted_result"] = 0.0
    phases["total"] = total
    return phases


def main() -> int:
    # Only log services are needed; the secure-rads registry is on the stopped CSAV host.
    logs = {tree: config.stack_outputs(config.STACKS[tree]["log"])["HttpApiUrl"] for tree in config.TREES}

    collected: dict[str, list[dict[str, float]]] = {t: [] for t in TREES}
    for tree in TREES:
        for events in fetch_runs(logs[tree]):
            phases = phase_seconds(tree, events)
            if phases:
                collected[tree].append(phases)

    summary: dict[str, dict[str, float]] = {}
    for tree, runs in collected.items():
        if not runs:
            continue
        keys = [k for k in runs[0] if k != "total"]
        mean = {k: sum(r[k] for r in runs) / len(runs) for k in [*keys, "total"]}
        summary[tree] = {"runs": len(runs), **{k: round(v, 3) for k, v in mean.items()}}

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(summary, indent=2))
    print("wrote", OUT_JSON.relative_to(HERE))
    for tree, s in summary.items():
        print(f"\n{tree}  ({s['runs']} runs, mean seconds)")
        for key in (
            "control_plane",
            "provisioning",
            "trusted_attest",
            "trusted_data",
            "trusted_compute",
            "trusted_result",
            "result_delivery",
            "total",
        ):
            if key in s:
                print(f"  {key:18s} {s[key]:7.2f}")

    if summary:
        render(summary)
    return 0


def render(summary: dict[str, dict[str, float]]) -> None:
    segments = [
        ("control_plane", "control plane (Lambda -> RunInstances)", "#8FB8CF"),
        ("provisioning", "instance boot + tooling install + artifact transfer", "#2E6F95"),
        ("trusted_attest", "enclave attestation", "#F0A868"),
        ("trusted_data", "trusted data path (KMS + PDM + decrypt)", "#E08A3C"),
        ("trusted_compute", "DC app compute", "#C8542A"),
        ("trusted_result", "result persist", "#8F3A1B"),
        ("result_delivery", "delivery + client poll", "#B9B9B9"),
    ]

    fig, ax = plt.subplots(figsize=(11, 3.6))
    for y, tree in enumerate(TREES):
        s = summary.get(tree)
        if not s:
            continue
        left = 0.0
        for key, label, color in segments:
            value = s.get(key, 0.0)
            if value <= 0:
                continue
            ax.barh(
                y,
                value,
                left=left,
                color=color,
                edgecolor="white",
                linewidth=0.8,
                label=label if y == len(TREES) - 1 else None,
            )
            if value >= MIN_LABEL_SECONDS:
                ax.text(
                    left + value / 2,
                    y,
                    f"{value:.0f}s",
                    ha="center",
                    va="center",
                    fontsize=9,
                    color="white",
                    fontweight="bold",
                )
            left += value
        ax.text(left + 0.6, y, f"total {s['total']:.0f}s", va="center", fontsize=10, fontweight="bold")

    ax.set_yticks(range(len(TREES)))
    ax.set_yticklabels(["rads\n(baseline)", "secure-rads\n(enclave)"], fontsize=10)
    ax.set_xlabel("seconds (mean per run)")
    ax.set_title("Where an execution's wall clock goes  ·  per-run cold start dominates both trees")
    ax.grid(axis="y", visible=False)
    ax.set_axisbelow(True)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.legend(
        handles=[plt.Rectangle((0, 0), 1, 1, color=color) for _key, _label, color in segments],
        labels=[label for _key, label, _color in segments],
        loc="upper center",
        bbox_to_anchor=(0.5, -0.34),
        ncol=2,
        fontsize=8.5,
        frameon=False,
    )
    fig.text(
        0.5,
        -0.13,
        "rads reports once at the end, so its record fetch, docker load and compute sit inside the "
        "provisioning bar.\nsecure-rads reports each step, so its trusted path is separable: "
        "attestation + KMS/PDM fetch + compute cost ~4-5s.",
        ha="center",
        fontsize=8.5,
        color="#444444",
    )
    fig.savefig(OUT_FIG, bbox_inches="tight")
    plt.close(fig)
    print("wrote", OUT_FIG.relative_to(HERE))


if __name__ == "__main__":
    raise SystemExit(main())
