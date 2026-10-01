from __future__ import annotations

import subprocess
from typing import TYPE_CHECKING

from lib import config
from paths import BUILD_DIR, REPO_ROOT

if TYPE_CHECKING:
    from pathlib import Path

    from lib.trees.tree import Tree


def build_sample_tar(tree: Tree) -> Path:
    tar_path = BUILD_DIR / f"{tree}-{config.TRIAL_SAMPLE}.tar"
    if tar_path.exists():
        return tar_path
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    tag = f"bench-{tree}-{config.TRIAL_SAMPLE}:local"
    context = REPO_ROOT / str(tree) / "samples" / config.TRIAL_SAMPLE
    subprocess.run(
        ["docker", "build", "--platform", "linux/arm64", "-t", tag, str(context)],
        check=True,
        cwd=REPO_ROOT,
    )
    subprocess.run(["docker", "save", tag, "-o", str(tar_path)], check=True)
    return tar_path
