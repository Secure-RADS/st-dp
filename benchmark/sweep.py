#!/usr/bin/env python3
"""Render the Exp1/Exp2 dataset-size sweep: where execution time goes, and how it scales.

Reads results/sweep.csv (written by benchmark/export.ts) and renders:

  sweep-phases.png    per dataset size, the phase breakdown for rads vs secure-rads (stacked bars)
  sweep-scaling.png   total execution time against dataset size, one line per tree

Run with:  uv run python benchmark/sweep.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import matplotlib as mpl

mpl.use("Agg")

import matplotlib.pyplot as plt
import pandas as pd

HERE = Path(__file__).resolve().parent
CSV = HERE / "results" / "sweep.csv"
FIG_DIR = HERE / "results" / "figures"

TREES = ["rads", "secure-rads"]
PALETTE = {"rads": "#2E6F95", "secure-rads": "#C8542A"}
LABELS = {"rads": "rads (baseline)", "secure-rads": "secure-rads (enclave)"}

# Phase order and labels, matching the experiment sheet (encrypt result / log excluded).
PHASES = [
    ("algorithm_retrieval_s", "algorithm retrieval"),
    ("enclave_initialization_s", "enclave init"),
    ("sce_unit_s", "sce unit"),
    ("attestation_s", "attestation"),
    ("data_retrieval_s", "data retrieval"),
    ("data_decryption_s", "data decryption"),
    ("algorithm_processing_s", "algorithm processing"),
    ("result_delivery_s", "result delivery"),
]
PHASE_COLORS = ["#4C9BE8", "#1F4E79", "#6FBF73", "#F2C14E", "#E8873C", "#C0392B", "#8E44AD", "#7F8C8D"]

MIN_LABEL_SECONDS = 2.0
BAR_GAP = 0.7


def load() -> pd.DataFrame:
    """Load the sweep CSV with numeric phase columns."""
    if not CSV.exists():
        print(f"no sweep CSV at {CSV}; run bun benchmark/export.ts first", file=sys.stderr)
        raise SystemExit(1)
    df = pd.read_csv(CSV)
    for column in (name for name, _ in PHASES):
        df[column] = pd.to_numeric(df[column], errors="coerce")
    df["total_s"] = pd.to_numeric(df["total_s"], errors="coerce")
    df["dataset_size"] = df["dataset_size"].astype(int)
    return df


def phases_figure(df: pd.DataFrame) -> None:
    """Stacked phase bars per size, rads vs secure-rads."""
    sizes = sorted(df["dataset_size"].unique())
    fig, ax = plt.subplots(figsize=(12, 1.5 * len(sizes) + 2.0))

    y = 0.0
    ticks: list[float] = []
    labels: list[str] = []
    for size in sizes:
        for tree in TREES:
            subset = df[(df["dataset_size"] == size) & (df["tree"] == tree)]
            if subset.empty:
                continue
            means = subset[[name for name, _ in PHASES]].mean()
            total = float(subset["total_s"].mean())
            left = 0.0
            for (column, label), color in zip(PHASES, PHASE_COLORS, strict=True):
                value = float(means[column]) if pd.notna(means[column]) else 0.0
                if value <= 0:
                    continue
                ax.barh(
                    y,
                    value,
                    left=left,
                    color=color,
                    edgecolor="white",
                    linewidth=0.6,
                    label=label if not ticks else None,
                )
                if value >= MIN_LABEL_SECONDS:
                    ax.text(left + value / 2, y, f"{value:.0f}", ha="center", va="center", fontsize=8, color="white")
                left += value
            ax.text(left + 1.0, y, f"total {total:.0f}s", va="center", fontsize=9, color="#333333")
            ticks.append(y)
            labels.append(f"{size // 1000}K  {LABELS[tree]}")
            y += 1.0
        y += BAR_GAP

    ax.set_yticks(ticks)
    ax.set_yticklabels(labels, fontsize=9)
    ax.invert_yaxis()
    ax.set_xlabel("seconds (mean per run)")
    ax.set_title("Where an execution's wall clock goes, by dataset size", fontsize=13, fontweight="bold")
    ax.grid(axis="y", visible=False)
    ax.set_axisbelow(True)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.legend(
        handles=[plt.Rectangle((0, 0), 1, 1, color=color) for color in PHASE_COLORS],
        labels=[label for _, label in PHASES],
        loc="upper center",
        bbox_to_anchor=(0.5, -0.12),
        ncol=4,
        fontsize=8.5,
        frameon=False,
    )
    fig.text(
        0.5,
        -0.06,
        "enclave init = per-run instance boot + tooling install (size-independent); data retrieval is the "
        "PDM fetch, which grows with the dataset. rads has no enclave, so attestation / sce unit / "
        "data decryption are blank for it.",
        ha="center",
        fontsize=8.5,
        color="#444444",
    )
    out = FIG_DIR / "sweep-phases.png"
    fig.savefig(out, bbox_inches="tight", dpi=200)
    plt.close(fig)
    print(f"wrote {out.relative_to(HERE)}")


def scaling_figure(df: pd.DataFrame) -> None:
    """Total execution time against dataset size, one line per tree."""
    fig, ax = plt.subplots(figsize=(9, 5.2))
    for tree in TREES:
        subset = df[df["tree"] == tree].groupby("dataset_size", as_index=False)["total_s"].mean()
        subset = subset.sort_values("dataset_size")
        if subset.empty:
            continue
        ax.plot(
            subset["dataset_size"],
            subset["total_s"],
            marker="o",
            color=PALETTE[tree],
            label=LABELS[tree],
            linewidth=2.0,
        )
    ax.set_xlabel("dataset size (records)")
    ax.set_ylabel("total execution time (seconds, mean per run)")
    ax.set_title("End-to-end execution time vs dataset size", fontsize=13, fontweight="bold")
    ax.grid(axis="x", visible=False)
    ax.set_axisbelow(True)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    ax.legend(frameon=False)
    out = FIG_DIR / "sweep-scaling.png"
    fig.savefig(out, bbox_inches="tight", dpi=200)
    plt.close(fig)
    print(f"wrote {out.relative_to(HERE)}")


def main() -> int:
    """Render both sweep figures."""
    FIG_DIR.mkdir(parents=True, exist_ok=True)
    df = load()
    print(f"loaded {len(df)} runs across {df['dataset_size'].nunique()} sizes")
    phases_figure(df)
    scaling_figure(df)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
