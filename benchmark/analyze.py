#!/usr/bin/env python3
"""Analyse the benchmark runs and render simple, direct comparison figures.

Everything is reported as measured, in plain terms:

  average   the mean of the N runs for that sample and tree
  fastest   the quickest run
  slowest   the slowest run
  slower    how much longer secure-rads took than rads, in seconds and percent

No confidence intervals or significance testing: for each bar the line shows the
fastest and slowest run, so the bar and the spread are both visible.

Writes results/summary.csv plus PNGs in results/figures/.

Run with:  uv run python benchmark/analyze.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib as mpl

mpl.use("Agg")

import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns

HERE = Path(__file__).resolve().parent
RAW_DIR = HERE / "results" / "raw"
FIG_DIR = HERE / "results" / "figures"
SUMMARY_CSV = HERE / "results" / "summary.csv"

TREES = ["rads", "secure-rads"]
PALETTE = {"rads": "#2E6F95", "secure-rads": "#C8542A"}
LABELS = {"rads": "rads (baseline)", "secure-rads": "secure-rads (enclave)"}
STAGE_TITLES = {
    "upload": "Shipping the image (upload + register)",
    "execute": "Running the algorithm (start to result)",
}
DATASET_SIZES = {
    "health-risk-python": 250,
    "spend-analysis-go": 1000,
    "product-trends-node": 2500,
    "audience-segments-rust": 5000,
    "trial-eligibility-ruby": 10000,
}

PERCENT = 100.0
RANGE_CAP_FRACTION = 0.28
MIN_RANGE_VISIBLE = 0.4

sns.set_theme(style="whitegrid", context="talk", font_scale=0.82)
plt.rcParams.update(
    {
        "figure.dpi": 200,
        "savefig.dpi": 200,
        "savefig.bbox": "tight",
        "axes.edgecolor": "#4A4A4A",
        "axes.linewidth": 0.9,
        "axes.titlesize": 15,
        "axes.titleweight": "bold",
        "axes.labelsize": 12,
        "legend.frameon": False,
        "grid.color": "#D9D9D9",
        "grid.linewidth": 0.7,
    }
)


def load() -> pd.DataFrame:
    """Load every raw measurement, dropping failed runs."""
    rows: list[dict] = []
    for path in sorted(RAW_DIR.glob("*.json")):
        rows.extend(json.loads(path.read_text()))
    if not rows:
        print(f"no raw runs found under {RAW_DIR}", file=sys.stderr)
        raise SystemExit(1)

    df = pd.DataFrame(rows)
    df = df[pd.notna(df["seconds"])].copy()
    df["seconds"] = df["seconds"].astype(float)
    df["sample"] = pd.Categorical(df["sample"], categories=sample_order(df), ordered=True)
    return df


def sample_order(df: pd.DataFrame) -> list[str]:
    """Order samples by dataset size, smallest first."""
    present = set(df["sample"].unique())
    return sorted(present, key=lambda name: (DATASET_SIZES.get(name, 0), name))


def stats_by_group(df: pd.DataFrame, stage: str) -> pd.DataFrame:
    """Average / fastest / slowest seconds per (sample, tree) for one stage."""
    subset = df[df["stage"] == stage]
    grouped = (
        subset.groupby(["sample", "tree"], observed=True)["seconds"]
        .agg(runs="count", average="mean", fastest="min", slowest="max")
        .reset_index()
    )
    return grouped.sort_values(["sample", "tree"])


def style_axis(ax: plt.Axes, ylabel: str) -> None:
    """Apply the shared axis styling."""
    ax.set_ylabel(ylabel)
    ax.set_xlabel("")
    ax.grid(axis="x", visible=False)
    ax.set_axisbelow(True)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)


def annotate_bars(ax: plt.Axes, grouped: pd.DataFrame, tree: str, categories: list[str], headroom: float) -> None:
    """Label each bar with its average and draw its fastest-to-slowest range above it."""
    rows = grouped[grouped["tree"] == tree].set_index("sample")
    container = next(bar_group for bar_group, name in zip(ax.containers, TREES, strict=True) if name == tree)
    for category, patch in zip(categories, container.patches, strict=True):
        row = rows.loc[category]
        centre = patch.get_x() + patch.get_width() / 2
        if row["slowest"] - row["fastest"] >= MIN_RANGE_VISIBLE:
            cap = patch.get_width() * RANGE_CAP_FRACTION
            ax.vlines(centre, row["fastest"], row["slowest"], color="#222222", linewidth=1.5, zorder=5)
            ax.hlines(
                [row["fastest"], row["slowest"]],
                centre - cap,
                centre + cap,
                color="#222222",
                linewidth=1.5,
                zorder=5,
            )
        ax.text(
            centre,
            max(row["average"], row["slowest"]) + headroom,
            f"{row['average']:.1f}s",
            ha="center",
            va="bottom",
            fontsize=9,
            color="#333333",
        )


def average_bars(df: pd.DataFrame, stage: str, path: Path) -> None:
    """Bar = average of the runs, line = fastest to slowest run."""
    subset = df[df["stage"] == stage]
    if subset.empty:
        return
    grouped = stats_by_group(df, stage)
    categories = [name for name in sample_order(df) if name in set(grouped["sample"])]
    runs = int(grouped["runs"].min())

    fig, ax = plt.subplots(figsize=(13, 6.0))
    sns.barplot(
        data=grouped,
        x="sample",
        y="average",
        hue="tree",
        hue_order=TREES,
        order=categories,
        palette=PALETTE,
        edgecolor="white",
        linewidth=0.8,
        ax=ax,
    )
    ax.set_xticks(range(len(categories)))
    ax.set_xticklabels(categories, rotation=16, ha="right", fontsize=10)

    ceiling = float(grouped["slowest"].max())
    ax.set_ylim(0, ceiling * 1.20)
    headroom = ceiling * 0.015
    for tree in TREES:
        annotate_bars(ax, grouped, tree, categories, headroom)

    ax.set_title(
        f"{STAGE_TITLES[stage]}\nbar = average of {runs} runs   ·   line = fastest to slowest run",
        fontsize=13,
    )
    style_axis(ax, "seconds")
    ax.legend(title="", loc="upper center", bbox_to_anchor=(0.5, -0.22), ncol=2, fontsize=10)
    fig.savefig(path)
    plt.close(fig)
    print(f"wrote {path.relative_to(HERE)}")


def run_dots(df: pd.DataFrame, stage: str, path: Path) -> None:
    """Every run as a dot, so the spread is visible without a box plot."""
    subset = df[df["stage"] == stage]
    if subset.empty:
        return

    fig, ax = plt.subplots(figsize=(13, 5.6))
    sns.stripplot(
        data=subset,
        x="sample",
        y="seconds",
        hue="tree",
        hue_order=TREES,
        order=sample_order(df),
        dodge=True,
        palette=PALETTE,
        size=4.5,
        alpha=0.8,
        edgecolor="white",
        linewidth=0.4,
        ax=ax,
    )
    ax.set_xticks(range(len(sample_order(df))))
    ax.set_xticklabels(sample_order(df), rotation=16, ha="right", fontsize=10)
    handles, labels = ax.get_legend_handles_labels()
    ax.legend(handles[: len(TREES)], labels[: len(TREES)], title="", loc="upper left", fontsize=10)
    ax.set_title(f"{STAGE_TITLES[stage]}\nevery dot is one run", fontsize=13)
    style_axis(ax, "seconds")
    fig.savefig(path)
    plt.close(fig)
    print(f"wrote {path.relative_to(HERE)}")


def overall(df: pd.DataFrame, path: Path) -> None:
    """One pair of bars per stage: the overall average for each tree."""
    fig, axes = plt.subplots(1, 2, figsize=(11, 5.0))
    for ax, stage in zip(axes, ("upload", "execute"), strict=True):
        subset = df[df["stage"] == stage]
        if subset.empty:
            ax.axis("off")
            continue
        grouped = subset.groupby("tree", observed=True)["seconds"].agg(average="mean").reset_index()
        sns.barplot(
            data=grouped,
            x="tree",
            y="average",
            hue="tree",
            hue_order=TREES,
            order=TREES,
            palette=PALETTE,
            legend=False,
            edgecolor="white",
            linewidth=0.8,
            ax=ax,
        )
        for bar_group in ax.containers:
            ax.bar_label(bar_group, fmt="%.1fs", padding=6, fontsize=10, color="#333333")
        ax.set_title(STAGE_TITLES[stage], fontsize=12)
        ax.set_xticks(range(len(TREES)))
        ax.set_xticklabels([LABELS[tree] for tree in TREES], fontsize=9)
        style_axis(ax, "seconds")
        ax.margins(y=0.18)
    fig.suptitle("Overall average per stage  ·  all five samples pooled", fontweight="bold", fontsize=13)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)
    print(f"wrote {path.relative_to(HERE)}")


def differences(df: pd.DataFrame, stage: str, path: Path) -> None:
    """How much longer secure-rads took, in seconds, per sample."""
    grouped = stats_by_group(df, stage)
    if grouped.empty:
        return
    means = grouped.pivot_table(index="sample", columns="tree", values="average", observed=True)
    if not {"rads", "secure-rads"}.issubset(means.columns):
        return
    means["extra"] = means["secure-rads"] - means["rads"]
    means["pct"] = PERCENT * means["extra"] / means["rads"]
    categories = [name for name in sample_order(df) if name in means.index]
    means = means.loc[categories]

    fig, ax = plt.subplots(figsize=(13, 5.4))
    bars = ax.bar(
        means.index,
        means["extra"],
        color="#C8542A",
        edgecolor="white",
        linewidth=0.8,
    )
    for bar, pct in zip(bars, means["pct"], strict=True):
        ax.annotate(
            f"+{bar.get_height():.1f}s\n({pct:.0f}% slower)",
            (bar.get_x() + bar.get_width() / 2, bar.get_height()),
            ha="center",
            va="bottom",
            fontsize=9,
            color="#333333",
        )
    ax.set_title(f"{STAGE_TITLES[stage]}\nextra time secure-rads took, per sample", fontsize=13)
    plt.setp(ax.get_xticklabels(), rotation=16, ha="right", fontsize=10)
    style_axis(ax, "extra seconds vs rads")
    ax.margins(y=0.22)
    fig.savefig(path)
    plt.close(fig)
    print(f"wrote {path.relative_to(HERE)}")


def write_summary(df: pd.DataFrame) -> None:
    """Write the plain per-sample numbers to CSV."""
    rows = []
    for stage in ("upload", "execute"):
        for _, row in stats_by_group(df, stage).iterrows():
            rows.append(
                {
                    "stage": stage,
                    "tree": row["tree"],
                    "sample": row["sample"],
                    "runs": int(row["runs"]),
                    "average_seconds": round(row["average"], 2),
                    "fastest_seconds": round(row["fastest"], 2),
                    "slowest_seconds": round(row["slowest"], 2),
                }
            )
    pd.DataFrame(rows).to_csv(SUMMARY_CSV, index=False)
    print(f"wrote {SUMMARY_CSV.relative_to(HERE)}")


def print_plain_summary(df: pd.DataFrame) -> None:
    """Print the numbers in the terms the benchmark is meant to answer."""
    for stage in ("execute", "upload"):
        grouped = stats_by_group(df, stage)
        if grouped.empty:
            continue
        means = grouped.pivot_table(index="sample", columns="tree", values="average", observed=True)
        runs = int(grouped["runs"].min())
        print()
        print(f"{STAGE_TITLES[stage].upper()}   average of {runs} runs")
        print(f"  {'sample':24s} {'rads':>9s} {'secure-rads':>12s} {'extra':>9s} {'slower by':>10s}")
        for sample, row in means.iterrows():
            extra = row["secure-rads"] - row["rads"]
            pct = PERCENT * extra / row["rads"]
            print(f"  {sample:24s} {row['rads']:8.1f}s {row['secure-rads']:11.1f}s {extra:8.1f}s {pct:9.0f}%")
        rads_all = means["rads"].mean()
        secure_all = means["secure-rads"].mean()
        extra = secure_all - rads_all
        print(
            f"  {'ALL SAMPLES (average)':24s} {rads_all:8.1f}s {secure_all:11.1f}s "
            f"{extra:8.1f}s {PERCENT * extra / rads_all:9.0f}%"
        )


def main() -> int:
    """Render every figure and write the summary."""
    FIG_DIR.mkdir(parents=True, exist_ok=True)
    df = load()
    print(f"loaded {len(df)} successful measurements")
    failed = [
        row for path in sorted(RAW_DIR.glob("*.json")) for row in json.loads(path.read_text()) if row.get("error")
    ]
    if failed:
        print(f"excluded {len(failed)} failed measurement(s)")

    average_bars(df, "execute", FIG_DIR / "execute-average.png")
    average_bars(df, "upload", FIG_DIR / "upload-average.png")
    run_dots(df, "execute", FIG_DIR / "execute-every-run.png")
    run_dots(df, "upload", FIG_DIR / "upload-every-run.png")
    overall(df, FIG_DIR / "overall-average.png")
    differences(df, "execute", FIG_DIR / "execute-extra-time.png")
    differences(df, "upload", FIG_DIR / "upload-extra-time.png")
    write_summary(df)
    print_plain_summary(df)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
