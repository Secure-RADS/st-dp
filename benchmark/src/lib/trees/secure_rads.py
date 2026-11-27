from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, ClassVar

from lib import http
from lib.tree import Tree
from lib.trees.base import TreeHarness

if TYPE_CHECKING:
    import httpx


class SecureRadsHarness(TreeHarness):
    """Strategy concrete: CSAV registry multipart upload + secure-rads execution."""

    name: ClassVar[Tree] = Tree.SECURE_RADS

    def __init__(self, registry_url: str, execution_url: str, result_webhook_url: str) -> None:
        super().__init__(registry_url, execution_url)
        self._webhook = result_webhook_url

    async def execute(self, client: httpx.AsyncClient, algorithm_id: str, size: int) -> tuple[str, str, str]:
        status, body = await http.arequest(
            client,
            "POST",
            f"{self._execution}/run",
            json={"algorithmId": algorithm_id, "size": size, "webhookUrl": self._webhook},
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
                return run_id, result.get("status", ""), result.get("output", "") or ""
            await asyncio.sleep(http.POLL_INTERVAL_SECONDS)

        msg = f"timed out after {http.POLL_TIMEOUT_SECONDS:.0f}s waiting for runId={run_id}"
        raise http.FlowError(msg)

    async def upload(self, client: httpx.AsyncClient, algorithm_id: str) -> None:
        tar_path = await asyncio.to_thread(self.build_sample_tar, self.name)
        content = await asyncio.to_thread(tar_path.read_bytes)
        status, body = await http.arequest(
            client,
            "POST",
            f"{self._registry}/upload",
            data={"algorithmId": algorithm_id},
            files={"image": (tar_path.name, content, "application/x-tar")},
        )
        http.require(status, http.HTTP_OK, "/upload", body)
