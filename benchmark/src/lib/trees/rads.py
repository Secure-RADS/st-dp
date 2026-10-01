from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, ClassVar

from lib import http
from lib.tree import Tree
from lib.trees.base import TreeHarness

if TYPE_CHECKING:
    import httpx


class RadsHarness(TreeHarness):
    """Strategy concrete: classic RADS registry (presign + register) + execution."""

    name: ClassVar[Tree] = Tree.RADS

    async def upload(self, client: httpx.AsyncClient, algorithm_id: str) -> None:
        tar_path = await asyncio.to_thread(self.build_sample_tar, self.name)
        status, body = await http.arequest(
            client,
            "POST",
            f"{self._registry}/upload",
            json={"algorithmId": algorithm_id},
        )
        http.require(status, http.HTTP_OK, "/upload", body)

        upload_url = http.parse_json(body)["uploadUrl"]
        status, body = await http.arequest(
            client,
            "PUT",
            upload_url,
            content=await asyncio.to_thread(tar_path.read_bytes),
            headers={"Content-Type": "application/x-tar"},
        )
        http.require(status, (http.HTTP_OK, http.HTTP_NO_CONTENT), "S3 PUT", body)

        status, body = await http.arequest(
            client,
            "POST",
            f"{self._registry}/register",
            json={"algorithmId": algorithm_id},
        )
        http.require(status, http.HTTP_OK, "/register", body)
