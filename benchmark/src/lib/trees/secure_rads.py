from __future__ import annotations

import asyncio
import json
import os
from typing import TYPE_CHECKING, ClassVar

from lib import http
from lib.tree import Tree
from lib.trees.base import TreeHarness

if TYPE_CHECKING:
    import httpx


class SecureRadsHarness(TreeHarness):
    """Strategy concrete: CSAV registry multipart upload + secure-rads execution."""

    name: ClassVar[Tree] = Tree.SECURE_RADS

    async def execute(self, client: httpx.AsyncClient, algorithm_id: str, size: int) -> tuple[str, str, str]:
        if not self._telemetry:
            msg = "secure-rads telemetry URL is required to follow a webhook run"
            raise http.FlowError(msg)
        webhook = os.environ.get("SECURE_WEBHOOK_URL", "https://httpbin.org/post")
        status, body = await http.arequest(
            client,
            "POST",
            f"{self._execution}/run",
            json={"algorithmId": algorithm_id, "size": size, "webhookUrl": webhook},
        )
        http.require(status, http.HTTP_ACCEPTED, "/run", body)

        run_id = http.parse_json(body)["runId"]
        deadline = asyncio.get_running_loop().time() + http.POLL_TIMEOUT_SECONDS
        while asyncio.get_running_loop().time() < deadline:
            status, event_body = await http.arequest(
                client, "GET", f"{self._telemetry}/logs/{algorithm_id}?runId={run_id}"
            )
            http.require(status, http.HTTP_OK, f"GET logs/{algorithm_id}", event_body)
            events = {event["event"] for event in json.loads(event_body)}
            if "run-failed" in events:
                return run_id, "exit:1", ""
            if "output-sent" in events or "executor-finished" in events:
                return run_id, "exit:0", ""
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
