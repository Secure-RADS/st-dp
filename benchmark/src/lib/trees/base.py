from __future__ import annotations

import subprocess
import time
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, ClassVar

from lib import config, http
from paths import BUILD_DIR, REPO_ROOT

if TYPE_CHECKING:
    from pathlib import Path

    import httpx

    from lib.tree import Tree


class TreeHarness(ABC):
    """Strategy base: shared execute / sample tar; subclasses implement tree-specific upload."""

    name: ClassVar[Tree]

    def __init__(self, registry_url: str, execution_url: str) -> None:
        self._registry = registry_url
        self._execution = execution_url

    @staticmethod
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

    def execute(self, algorithm_id: str, size: int) -> tuple[str, str, str]:
        status, body = http.request(
            "POST",
            f"{self._execution}/run",
            json={"algorithmId": algorithm_id, "size": size},
        )
        http.require(status, http.HTTP_ACCEPTED, "/run", body)

        run_id = http.parse_json(body)["runId"]
        deadline = time.time() + http.POLL_TIMEOUT_SECONDS
        while time.time() < deadline:
            status, result_body = http.request("GET", f"{self._execution}/run/{run_id}")
            http.require(status, http.HTTP_OK, f"/run/{run_id}", result_body)
            result = http.parse_json(result_body)
            if result.get("status") != "pending":
                output = result.get("output", "") or ""
                return run_id, result.get("status", ""), output
            time.sleep(http.POLL_INTERVAL_SECONDS)

        msg = f"timed out after {http.POLL_TIMEOUT_SECONDS:.0f}s waiting for runId={run_id}"
        raise http.FlowError(msg)

    @abstractmethod
    async def upload(self, client: httpx.AsyncClient, algorithm_id: str) -> None: ...
