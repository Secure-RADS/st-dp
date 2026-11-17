#!/usr/bin/env python3

from __future__ import annotations

import argparse
import math

import matplotlib as mpl

mpl.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns

from lib.log import logger
from lib.tree import Tree
from paths import FIG_DIR, PHASE_TIMINGS_CSV, ROOT

PALETTE = {Tree.RADS: "#2E6F95", Tree.SECURE_RADS: "#C8542A"}
LABELS = {Tree.RADS: "CE (baseline)", Tree.SECURE_RADS: "SCE (enclave)"}
PHASES = {
    "host_provisioning_s": "host provisioning",
    "algorithm_retrieval_s": "algorithm retrieval",
    "enclave_boot_s": "enclave boot",
    "sce_unit_s": "sce unit",
    "attestation_s": "attestation",
    "data_retrieval_s": "data retrieval",
    "algorithm_processing_s": "algorithm processing",
    "subject_access_s": "subject access",
    "output_handoff_s": "output handoff",
    "result_delivery_s": "result delivery",
}
PHASE_COLORS = [
    "#1F4E79",
    "#4C9BE8",
    "#C0392B",
    "#6FBF73",
    "#F2C14E",
    "#E8873C",
    "#8E44AD",
    "#56B4E9",
    "#D55E00",
    "#7F8C8D",
]
COST_SERVICES = ["ec2", "dynamodb", "s3", "sqs", "lambda", "apigateway"]
COST_COLS = [f"{service}_cost_usd" for service in COST_SERVICES]
COST_COLORS = ["#1F4E79", "#4C9BE8", "#C0392B", "#6FBF73", "#F2C14E", "#8E44AD"]
NOTE = (
    "host provisioning = per-run instance boot + tooling install (size-independent); "
    "data retrieval is fetch through records.json write (secure-rads includes decrypt).\n"
    "Both trees end algorithm processing at app completion and measure subject access separately; "
    "output handoff is the secure-rads enclave-to-host stream. rads has no enclave, so enclave "
    "boot / sce unit / attestation / output handoff are blank for it."
)


def load() -> pd.DataFrame:
    if not PHASE_TIMINGS_CSV.exists():
        logger.error("no phase timings CSV at {}; run `make report` (export step) first", PHASE_TIMINGS_CSV)
        raise SystemExit(1)
    df = pd.read_csv(PHASE_TIMINGS_CSV)
    cols = [*PHASES, "total_s"]
    for col in cols:
        df[col] = pd.to_numeric(df[col], errors="coerce") if col in df.columns else float("nan")
    cost_cols = [c for c in [*COST_COLS, "total_cost_usd"] if c in df.columns]
    if cost_cols:
        df[cost_cols] = df[cost_cols].apply(pd.to_numeric, errors="coerce")
    df["dataset_size"] = df["dataset_size"].astype(int)
    df["label"] = df["tree"].map(LABELS)
    return df


def _save(fig: plt.Figure, name: str, *, tight: bool = True) -> None:
    out = FIG_DIR / name
    fig.savefig(out, bbox_inches="tight" if tight else None, dpi=200)
    plt.close(fig)
    logger.info("wrote {}", out.relative_to(ROOT))


def phases_figure(df: pd.DataFrame) -> None:
    means = (
        df.groupby(["dataset_size", "tree", "label"], as_index=False)[[*PHASES, "total_s"]]
        .mean()
        .sort_values(["dataset_size", "tree"])
    )
    means["row"] = means.apply(
        lambda r: f"{r.dataset_size // 1000}K  {r.label}  ({r.total_s:.0f}s)",
        axis=1,
    )
    plot_df = means.set_index("row")[list(PHASES)].rename(columns=PHASES)

    # Extra height + fixed bottom margin so legend and footnote do not collide under tight bbox.
    fig, ax = plt.subplots(figsize=(11, max(5.5, 0.7 * len(plot_df) + 3.8)))
    plot_df.plot.barh(stacked=True, color=PHASE_COLORS, width=0.8, ax=ax, legend=False)
    ax.invert_yaxis()
    ax.set_xlabel("seconds (mean per run)")
    ax.set_ylabel("")
    fig.subplots_adjust(left=0.28, right=0.98, top=0.98, bottom=0.34)
    ax.legend(
        list(PHASES.values()),
        loc="upper center",
        bbox_to_anchor=(0.5, -0.22),
        ncol=4,
        frameon=False,
        fontsize=8.5,
    )
    fig.text(0.5, 0.06, NOTE, ha="center", va="bottom", fontsize=8, color="#555555")
    _save(fig, "sweep-phases.png", tight=False)


def phases_figure_selected(df: pd.DataFrame) -> None:
    selected_sizes = [10_000, 80_000, 150_000]
    label_names = {"rads (baseline)": "CE", "secure-rads (enclave)": "Sec-CE"}

    means = (
        df[df["dataset_size"].isin(selected_sizes)]
        .groupby(["dataset_size", "tree", "label"], as_index=False)[[*PHASES, "total_s"]]
        .mean()
        .sort_values(["dataset_size", "tree"])
    )
    means["col"] = means.apply(
        lambda r: f"{label_names.get(r.label, r.label)}\n{r.dataset_size // 1000}K",
        axis=1,
    )
    plot_df = means.set_index("col")[list(PHASES)].rename(columns=PHASES)

    fig, ax = plt.subplots(figsize=(9, 6))
    plot_df.plot.bar(stacked=True, color=PHASE_COLORS, width=0.8, ax=ax, legend=False, rot=0)

    for i, total in enumerate(means["total_s"]):
        ax.text(i, total, f"{total:.0f}s", ha="center", va="bottom", fontsize=8.5)

    ax.set_ylabel("Time (seconds)")
    ax.set_xlabel("")
    ax.set_ylim(0, means["total_s"].max() * 1.08)
    fig.subplots_adjust(left=0.1, right=0.98, top=0.92, bottom=0.30)
    ax.legend(
        list(PHASES.values()),
        loc="upper center",
        bbox_to_anchor=(0.5, -0.14),
        ncol=4,
        frameon=False,
        fontsize=8.5,
    )
    _save(fig, "sweep-selected-phases.png", tight=False)


def lowess(x: np.ndarray, y: np.ndarray, frac: float = 0.35) -> np.ndarray:
    """Tricube-weighted local linear fit, evaluated at each x (Cleveland LOWESS)."""
    k = max(3, math.ceil(frac * len(x)))
    out = np.empty_like(y, dtype=float)
    for i, x0 in enumerate(x):
        dist = np.abs(x - x0)
        idx = np.argsort(dist)[:k]
        h = dist[idx].max() or 1.0
        weights = (1 - np.clip(dist[idx] / h, 0, 1) ** 3) ** 3
        design = np.column_stack([np.ones(k), x[idx] - x0])
        root_w = np.sqrt(weights)
        beta, *_ = np.linalg.lstsq(design * root_w[:, None], y[idx] * root_w, rcond=None)
        out[i] = beta[0]
    return out


def scaling_figure(df: pd.DataFrame, *, smooth: bool = True) -> None:
    fig, ax = plt.subplots(figsize=(9, 5))
    sns.lineplot(
        data=df,
        x="dataset_size",
        y="total_s",
        hue="label",
        hue_order=[LABELS[t] for t in Tree],
        palette={LABELS[t]: c for t, c in PALETTE.items()},
        marker="o",
        alpha=0.45,
        errorbar=("ci", 95),
        ax=ax,
    )
    if smooth:
        means = df.groupby(["dataset_size", "tree"], as_index=False)["total_s"].mean()
        for tree in Tree:
            points = means[means["tree"] == tree].sort_values("dataset_size")
            x = points["dataset_size"].to_numpy(dtype=float)
            y = points["total_s"].to_numpy(dtype=float)
            ax.plot(x, lowess(x, y), color=PALETTE[tree], linewidth=2.5, label="_smooth")
    ax.set_xlabel("dataset size (records)")
    ax.set_ylabel("total execution time (seconds)")
    ax.legend(title=None, frameon=False)
    ax.set_xticks([10_000, 30_000, 50_000, 70_000, 90_000, 110_000, 130_000, 150_000])
    ax.set_xticklabels([f"{x // 1000}K" for x in ax.get_xticks()])
    _save(fig, "sweep-scaling.png")


def cost_size_figure(df: pd.DataFrame) -> None:
    fig, ax = plt.subplots(figsize=(9, 5))
    sns.lineplot(
        data=df,
        x="dataset_size",
        y="total_cost_usd",
        hue="label",
        hue_order=[LABELS[t] for t in Tree],
        palette={LABELS[t]: c for t, c in PALETTE.items()},
        marker="o",
        errorbar=("ci", 95),
        ax=ax,
    )
    ax.set_xlabel("dataset size (records)")
    ax.set_ylabel("execution cost (USD)")
    ax.legend(title=None, frameon=False)
    _save(fig, "sweep-cost.png")


def cost_services_figure(df: pd.DataFrame) -> None:
    by_service = df.groupby("label", as_index=False)[COST_COLS].mean().set_index("label")
    by_service.columns = [column.removesuffix("_cost_usd") for column in by_service.columns]
    present = [service for service in COST_SERVICES if service in by_service.columns]
    by_service = by_service[present]
    fig, ax = plt.subplots(figsize=(10, 5))
    by_service.plot.barh(stacked=True, color=COST_COLORS, width=0.7, ax=ax)
    ax.set_xlabel("mean execution cost (USD)")
    ax.set_ylabel("")
    ax.legend(title=None, loc="center left", bbox_to_anchor=(1.02, 0.5), frameon=False, fontsize=8)
    fig.subplots_adjust(right=0.78)
    _save(fig, "sweep-cost-services.png")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-smooth", action="store_true", help="plot raw runs without the LOWESS overlay")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    sns.set_theme(style="whitegrid", context="notebook")
    FIG_DIR.mkdir(parents=True, exist_ok=True)
    df = load()
    logger.info("loaded {} runs across {} sizes", len(df), df["dataset_size"].nunique())
    phases_figure(df)
    phases_figure_selected(df)
    scaling_figure(df, smooth=not args.no_smooth)
    if "total_cost_usd" in df.columns:
        cost_size_figure(df)
        cost_services_figure(df)
    else:
        logger.warning("no cost columns in {}; skipping cost figures", PHASE_TIMINGS_CSV)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
