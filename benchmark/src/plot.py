#!/usr/bin/env python3

from __future__ import annotations

import matplotlib as mpl

mpl.use("Agg")

import matplotlib.pyplot as plt
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
    "result_delivery_s": "result delivery",
}
PHASE_COLORS = ["#1F4E79", "#4C9BE8", "#C0392B", "#6FBF73", "#F2C14E", "#E8873C", "#8E44AD", "#7F8C8D"]
COST_SERVICES = ["ec2", "dynamodb", "s3", "sqs", "lambda", "apigateway"]
COST_COLS = [f"{service}_cost_usd" for service in COST_SERVICES]
COST_COLORS = ["#1F4E79", "#4C9BE8", "#C0392B", "#6FBF73", "#F2C14E", "#8E44AD"]
NOTE = (
    "host provisioning = per-run instance boot + tooling install (size-independent); "
    "data retrieval is fetch through records.json write (secure-rads includes decrypt).\n"
    "rads has no enclave, so enclave boot / sce unit / attestation are blank for it."
)


def load() -> pd.DataFrame:
    if not PHASE_TIMINGS_CSV.exists():
        logger.error("no phase timings CSV at {}; run `make report` (export step) first", PHASE_TIMINGS_CSV)
        raise SystemExit(1)
    df = pd.read_csv(PHASE_TIMINGS_CSV)
    cols = [*PHASES, "total_s"]
    df[cols] = df[cols].apply(pd.to_numeric, errors="coerce")
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
    ax.set_title("Where an execution's wall clock goes, by dataset size")
    fig.subplots_adjust(left=0.28, right=0.98, top=0.9, bottom=0.34)
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


def scaling_figure(df: pd.DataFrame) -> None:
    fig, ax = plt.subplots(figsize=(9, 5))
    sns.lineplot(
        data=df,
        x="dataset_size",
        y="total_s",
        hue="label",
        hue_order=[LABELS[t] for t in Tree],
        palette={LABELS[t]: c for t, c in PALETTE.items()},
        marker="o",
        errorbar=("ci", 95),
        ax=ax,
    )
    ax.set_xlabel("dataset size (records)")
    ax.set_ylabel("total execution time (seconds)")
    ax.set_title("End-to-end execution time vs dataset size")
    ax.legend(title=None, frameon=False)
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
    ax.set_title("Execution cost vs dataset size")
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
    ax.set_title("Cost by AWS service")
    ax.legend(title=None, loc="center left", bbox_to_anchor=(1.02, 0.5), frameon=False, fontsize=8)
    fig.subplots_adjust(right=0.78)
    _save(fig, "sweep-cost-services.png")


def main() -> int:
    sns.set_theme(style="whitegrid", context="notebook")
    FIG_DIR.mkdir(parents=True, exist_ok=True)
    df = load()
    logger.info("loaded {} runs across {} sizes", len(df), df["dataset_size"].nunique())
    phases_figure(df)
    scaling_figure(df)
    if "total_cost_usd" in df.columns:
        cost_size_figure(df)
        cost_services_figure(df)
    else:
        logger.warning("no cost columns in {}; skipping cost figures", PHASE_TIMINGS_CSV)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
