#!/usr/bin/env python3

from __future__ import annotations

import sys

import matplotlib as mpl

mpl.use("Agg")

import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns

from paths import FIG_DIR, ROOT, SWEEP_CSV

TREES = ["rads", "secure-rads"]
PALETTE = {"rads": "#2E6F95", "secure-rads": "#C8542A"}
LABELS = {"rads": "rads (baseline)", "secure-rads": "secure-rads (enclave)"}

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
    if not SWEEP_CSV.exists():
        print(f"no sweep CSV at {SWEEP_CSV}; run `make report` (export step) first", file=sys.stderr)
        raise SystemExit(1)
    df = pd.read_csv(SWEEP_CSV)
    for column in (name for name, _ in PHASES):
        df[column] = pd.to_numeric(df[column], errors="coerce")
    df["total_s"] = pd.to_numeric(df["total_s"], errors="coerce")
    df["dataset_size"] = df["dataset_size"].astype(int)
    return df


def phases_figure(df: pd.DataFrame) -> None:
    # seaborn has no stacked horizontal bar helper; draw on a themed axes.
    sizes = sorted(df["dataset_size"].unique())
    # Extra figure height leaves room under the bars for legend + footnote
    # without relying on GridSpec rows that bbox_inches="tight" can crush together.
    fig, ax = plt.subplots(figsize=(12, 1.5 * len(sizes) + 6.5))

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
            for (column, _label), color in zip(PHASES, PHASE_COLORS, strict=True):
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

    # Keep axes clear of the footer; place legend + note in figure coords so they
    # cannot collide with each other or with the x-axis label.
    fig.subplots_adjust(left=0.18, right=0.96, top=0.92, bottom=0.38)
    fig.legend(
        handles=[plt.Rectangle((0, 0), 1, 1, color=color) for color in PHASE_COLORS],
        labels=[label for _, label in PHASES],
        loc="upper center",
        bbox_to_anchor=(0.5, 0.26),
        ncol=4,
        fontsize=8.5,
        frameon=False,
        columnspacing=1.6,
        handletextpad=0.6,
        labelspacing=0.9,
    )
    fig.text(
        0.5,
        0.06,
        "enclave init = per-run instance boot + tooling install (size-independent);\n"
        "data retrieval is the PDM fetch, which grows with the dataset.\n"
        "rads has no enclave, so attestation / sce unit / data decryption are blank for it.",
        ha="center",
        va="bottom",
        fontsize=8.5,
        color="#444444",
        linespacing=1.65,
    )
    out = FIG_DIR / "sweep-phases.png"
    # Don't use bbox_inches="tight" — it collapses the reserved footer gap.
    fig.savefig(out, dpi=200)
    plt.close(fig)
    print(f"wrote {out.relative_to(ROOT)}")


def scaling_figure(df: pd.DataFrame) -> None:
    means = (
        df.groupby(["tree", "dataset_size"], as_index=False)["total_s"]
        .mean()
        .sort_values("dataset_size")
    )
    means["label"] = means["tree"].map(LABELS)

    fig, ax = plt.subplots(figsize=(9, 5.2))
    sns.lineplot(
        data=means,
        x="dataset_size",
        y="total_s",
        hue="label",
        hue_order=[LABELS[tree] for tree in TREES if tree in means["tree"].unique()],
        palette={LABELS[tree]: color for tree, color in PALETTE.items()},
        marker="o",
        linewidth=2.0,
        ax=ax,
    )
    ax.set_xlabel("dataset size (records)")
    ax.set_ylabel("total execution time (seconds, mean per run)")
    ax.set_title("End-to-end execution time vs dataset size", fontsize=13, fontweight="bold")
    ax.grid(axis="x", visible=False)
    ax.set_axisbelow(True)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    legend = ax.legend(frameon=False, title=None)
    if legend is not None:
        legend.set_title(None)
    out = FIG_DIR / "sweep-scaling.png"
    fig.savefig(out, bbox_inches="tight", dpi=200)
    plt.close(fig)
    print(f"wrote {out.relative_to(ROOT)}")


def main() -> int:
    sns.set_theme(style="whitegrid", context="notebook")
    FIG_DIR.mkdir(parents=True, exist_ok=True)
    df = load()
    print(f"loaded {len(df)} runs across {df['dataset_size'].nunique()} sizes")
    phases_figure(df)
    scaling_figure(df)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
