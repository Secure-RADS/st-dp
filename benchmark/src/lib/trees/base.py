from __future__ import annotations

import asyncio
import subprocess
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, ClassVar

from lib import config, http
from lib.tree import Tree
from paths import BUILD_DIR, REPO_ROOT

if TYPE_CHECKING:
    from pathlib import Path

    import httpx


class TreeHarness(ABC):
    """Strategy base: shared execute / sample tar; subclasses implement tree-specific upload."""

    name: ClassVar[Tree]

    def __init__(self, registry_url: str, execution_url: str, telemetry_url: str | None = None) -> None:
        self._registry = registry_url
        self._execution = execution_url
        self._telemetry = telemetry_url

    @staticmethod
    def build_sample_tar(tree: Tree) -> Path:
        tree_dir = "secure" if tree is Tree.SECURE_RADS else str(tree)
        tar_path = BUILD_DIR / f"{tree}-{config.TRIAL_SAMPLE}.tar"
        context = REPO_ROOT / tree_dir / "samples" / config.TRIAL_SAMPLE
        # Rebuild when source is newer than the cached tar (stale cache overwrote a good EIF once).
        if tar_path.exists():
            tar_mtime = tar_path.stat().st_mtime
            newest_src = max(
                (p.stat().st_mtime for p in context.rglob("*") if p.is_file()),
                default=0.0,
            )
            if newest_src <= tar_mtime:
                return tar_path
        BUILD_DIR.mkdir(parents=True, exist_ok=True)
        tag = f"bench-{tree}-{config.TRIAL_SAMPLE}:local"
        subprocess.run(
            ["docker", "build", "--platform", "linux/arm64", "-t", tag, str(context)],
            check=True,
            cwd=REPO_ROOT,
        )
        subprocess.run(["docker", "save", tag, "-o", str(tar_path)], check=True)
        return tar_path

    async def execute(self, client: httpx.AsyncClient, algorithm_id: str, size: int) -> tuple[str, str, str]:
        status, body = await http.arequest(
            client,
            "POST",
            f"{self._execution}/run",
            json={"algorithmId": algorithm_id, "size": size},
        )
        http.require(status, http.HTTP_ACCEPTED, "/run", body)

        run_id = http.parse_json(body)["runId"]
        deadline = asyncio.get_running_loop().time() + http.POLL_TIMEOUT_SECONDS
        while asyncio.get_running_loop().time() < deadline:
            status, result_body = await http.arequest(
                client, "GET", f"{self._execution}/run/{run_id}?algorithmId={algorithm_id}"
            )
            http.require(status, http.HTTP_OK, f"/run/{run_id}", result_body)
            result = http.parse_json(result_body)
            if result.get("status") != "pending":
                output = result.get("output", "") or ""
                return run_id, result.get("status", ""), output
            await asyncio.sleep(http.POLL_INTERVAL_SECONDS)

        msg = f"timed out after {http.POLL_TIMEOUT_SECONDS:.0f}s waiting for runId={run_id}"
        raise http.FlowError(msg)

    @abstractmethod
    async def upload(self, client: httpx.AsyncClient, algorithm_id: str) -> None: ...
