#!/usr/bin/env python3
"""Analyse the benchmark runs and render the comparison figures.

Reads every results/raw/*.json produced by run.py, pools the measurements per
(tree, sample, stage), and writes summary.csv plus PNGs to results/figures/.

Run with:  uv run python benchmark/analyze.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402
import seaborn as sns  # noqa: E402

HERE = Path(__file__).resolve().parent
RAW_DIR = HERE / "results" / "raw"
FIG_DIR = HERE / "results" / "figures"
SUMMARY_CSV = HERE / "results" / "summary.csv"

TREES = ["rads", "secure-rads"]
PALETTE = {"rads": "#2E6F95", "secure-rads": "#C8542A"}
LABELS = {"rads": "rads (baseline)", "secure-rads": "secure-rads (enclave)"}
STAGE_TITLES = {
    "upload": "Image upload (build + S3 ship)",
    "execute": "Execution (launch + compute + result)",
}

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
        "xtick.labelsize": 10,
        "ytick.labelsize": 10,
        "legend.frameon": False,
        "grid.color": "#D9D9D9",
        "grid.linewidth": 0.7,
    }
)


def load() -> pd.DataFrame:
    rows: list[dict] = []
    for path in sorted(RAW_DIR.glob("*.json")):
        payload = json.loads(path.read_text())
        for row in payload:
            row["source_file"] = path.name
            rows.append(row)
    if not rows:
        print("no raw runs found under", RAW_DIR, file=sys.stderr)
        raise SystemExit(1)

    df = pd.DataFrame(rows)
    df = df[pd.notna(df["seconds"])].copy()
    df["seconds"] = df["seconds"].astype(float)
    df["tree"] = pd.Categorical(df["tree"], categories=TREES, ordered=True)
    df["sample"] = pd.Categorical(df["sample"], categories=sample_order(df), ordered=True)
    return df


def sample_order(df: pd.DataFrame) -> list[str]:
    sizes = {"health-risk-python": 250, "spend-analysis-go": 1000, "product-trends-node": 2500,
             "audience-segments-rust": 5000, "trial-eligibility-ruby": 10000}
    present = set(df["sample"].unique())
    return sorted(present, key=lambda s: (sizes.get(s, 0), s))


def failures(df_all: pd.DataFrame) -> int:
    return int((df_all["error"].notna() | (df_all["status"].fillna("") != "exit:0")
                & (df_all["stage"] == "execute")).sum())


def style_axis(ax: plt.Axes, ylabel: str) -> None:
    ax.set_ylabel(ylabel)
    ax.set_xlabel("")
    ax.grid(axis="x", visible=False)
    ax.set_axisbelow(True)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)


def grouped_bars(df: pd.DataFrame, stage: str, path: Path) -> None:
    subset = df[df["stage"] == stage]
    if subset.empty:
        return

    fig, ax = plt.subplots(figsize=(11, 5.6))
    sns.barplot(
        data=subset,
        x="sample",
        y="seconds",
        hue="tree",
        hue_order=TREES,
        palette=PALETTE,
        errorbar=("ci", 95),
        capsize=0.06,
        err_kws={"linewidth": 1.4, "color": "#333333"},
        edgecolor="white",
        linewidth=0.8,
        ax=ax,
    )
    for container, tree in zip(ax.containers, TREES):
        ax.bar_label(container, fmt="%.1fs", padding=6, fontsize=9, color="#333333")

    n = subset.groupby(["sample", "tree"], observed=True)["seconds"].count().min()
    ax.set_title(f"{STAGE_TITLES[stage]}  ·  mean ± 95% CI  (n={int(n)} per bar)")
    style_axis(ax, "seconds")
    ax.margins(y=0.20)
    ax.legend(title="", loc="upper center", bbox_to_anchor=(0.5, -0.09), ncol=2, fontsize=10)
    fig.savefig(path)
    plt.close(fig)
    print("wrote", path.relative_to(HERE))


def distributions(df: pd.DataFrame, stage: str, path: Path, kind: str = "box") -> None:
    subset = df[df["stage"] == stage]
    if subset.empty:
        return

    fig, ax = plt.subplots(figsize=(11, 5.6))
    if kind == "box":
        sns.boxplot(
            data=subset, x="sample", y="seconds", hue="tree", hue_order=TREES,
            palette=PALETTE, width=0.62, linewidth=1.0, fliersize=0, ax=ax,
        )
    else:
        sns.violinplot(
            data=subset, x="sample", y="seconds", hue="tree", hue_order=TREES,
            palette=PALETTE, cut=0, inner="quart", linewidth=1.0, ax=ax,
        )
    sns.stripplot(
        data=subset, x="sample", y="seconds", hue="tree", hue_order=TREES,
        dodge=True, palette=PALETTE, size=3.2, alpha=0.75, edgecolor="white",
        linewidth=0.4, ax=ax,
    )

    handles, labels = ax.get_legend_handles_labels()
    ax.legend(handles[: len(TREES)], labels[: len(TREES)], title="",
              loc="upper center", bbox_to_anchor=(0.5, -0.09), ncol=2, fontsize=10)
    ax.set_title(f"{STAGE_TITLES[stage]}  ·  distribution across reps")
    style_axis(ax, "seconds")
    ax.margins(y=0.12)
    fig.savefig(path)
    plt.close(fig)
    print("wrote", path.relative_to(HERE))


def overall(df: pd.DataFrame, path: Path) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(11, 5.0))
    for ax, stage in zip(axes, ("upload", "execute")):
        subset = df[df["stage"] == stage]
        if subset.empty:
            ax.axis("off")
            continue
        sns.barplot(
            data=subset, x="tree", y="seconds", hue="tree", order=TREES, hue_order=TREES,
            palette=PALETTE, legend=False, errorbar=("ci", 95), capsize=0.12,
            edgecolor="white", linewidth=0.8, ax=ax,
        )
        for container in ax.containers:
            ax.bar_label(container, fmt="%.1fs", padding=6, fontsize=10, color="#333333")
        ax.set_title(STAGE_TITLES[stage])
        ax.set_xticks(range(len(TREES)))
        ax.set_xticklabels([LABELS[t] for t in TREES], fontsize=9)
        style_axis(ax, "seconds")
    fig.suptitle("Overall mean per stage  ·  mean ± 95% CI", fontweight="bold")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)
    print("wrote", path.relative_to(HERE))


def delta(df: pd.DataFrame, stage: str, path: Path) -> None:
    subset = df[df["stage"] == stage]
    if subset.empty:
        return
    means = subset.groupby(["sample", "tree"], observed=True)["seconds"].mean().unstack()
    if not {"rads", "secure-rads"}.issubset(means.columns):
        return
    means["delta"] = means["secure-rads"] - means["rads"]
    means["pct"] = 100 * means["delta"] / means["rads"]

    fig, ax = plt.subplots(figsize=(11, 5.0))
    colors = ["#C8542A" if v > 0 else "#2E6F95" for v in means["delta"]]
    bars = ax.bar(means.index, means["delta"], color=colors, edgecolor="white", linewidth=0.8)
    for bar, pct in zip(bars, means["pct"]):
        offset = 0.6 if bar.get_height() >= 0 else -0.6
        ax.annotate(
            f"{pct:+.0f}%",
            (bar.get_x() + bar.get_width() / 2, bar.get_height() + offset),
            ha="center", va="bottom" if bar.get_height() >= 0 else "top", fontsize=9, color="#333333",
        )
    ax.axhline(0, color="#4A4A4A", linewidth=1.0)
    ax.set_title(f"{STAGE_TITLES[stage]}  ·  secure-rads minus rads per sample")
    style_axis(ax, "seconds")
    ax.margins(y=0.20)
    fig.savefig(path)
    plt.close(fig)
    print("wrote", path.relative_to(HERE))


def per_rep(df: pd.DataFrame, stage: str, path: Path) -> None:
    subset = df[df["stage"] == stage]
    if subset.empty:
        return
    fig, ax = plt.subplots(figsize=(11, 5.4))
    sns.lineplot(
        data=subset, x="rep", y="seconds", hue="tree", style="sample",
        hue_order=TREES, palette=PALETTE, markers=True, dashes=False,
        linewidth=1.6, markersize=6, ax=ax,
    )
    ax.set_title(f"{STAGE_TITLES[stage]}  ·  run-to-run stability by rep")
    style_axis(ax, "seconds")
    ax.legend(title="", loc="upper center", bbox_to_anchor=(0.5, -0.12), ncol=3, fontsize=9)
    fig.savefig(path)
    plt.close(fig)
    print("wrote", path.relative_to(HERE))


def write_summary(df: pd.DataFrame) -> None:
    stats = (
        df.groupby(["stage", "tree", "sample", "dataset"], observed=True)["seconds"]
        .agg(["count", "mean", "std", "median", "min", "max"])
        .round(2)
        .reset_index()
    )
    stats = stats.sort_values(["stage", "sample", "tree"])
    stats.to_csv(SUMMARY_CSV, index=False)
    print("wrote", SUMMARY_CSV.relative_to(HERE))
    print()
    print(stats.to_string(index=False))


def main() -> int:
    FIG_DIR.mkdir(parents=True, exist_ok=True)
    all_rows = pd.DataFrame(
        row for path in sorted(RAW_DIR.glob("*.json")) for row in json.loads(path.read_text())
    )
    df = load()

    print(f"loaded {len(df)} successful measurements from {len(list(RAW_DIR.glob('*.json')))} files")
    if not all_rows.empty:
        bad = all_rows[all_rows["error"].notna()]
        if not bad.empty:
            print(f"\n{len(bad)} failed measurement(s) excluded:")
            for _, r in bad.iterrows():
                print(f"  {r['stage']} {r['tree']}/{r['sample']} rep={r['rep']}: {r['error'][:90]}")

    grouped_bars(df, "upload", FIG_DIR / "upload-by-sample.png")
    grouped_bars(df, "execute", FIG_DIR / "execute-by-sample.png")
    distributions(df, "execute", FIG_DIR / "execute-distribution.png")
    distributions(df, "upload", FIG_DIR / "upload-distribution.png")
    overall(df, FIG_DIR / "overall-mean.png")
    delta(df, "execute", FIG_DIR / "execute-delta.png")
    delta(df, "upload", FIG_DIR / "upload-delta.png")
    per_rep(df, "execute", FIG_DIR / "execute-by-rep.png")
    write_summary(df)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
