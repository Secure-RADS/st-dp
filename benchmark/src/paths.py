from __future__ import annotations

from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
ROOT = PACKAGE_DIR.parent
REPO_ROOT = ROOT.parent
RESULTS_DIR = ROOT / "results"
RAW_DIR = RESULTS_DIR / "raw"
FIG_DIR = RESULTS_DIR / "figures"
BUILD_DIR = ROOT / "build"
PHASE_TIMINGS_CSV = RESULTS_DIR / "phase-timings.csv"
