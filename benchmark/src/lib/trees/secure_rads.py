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
