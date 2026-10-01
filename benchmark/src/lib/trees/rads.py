from __future__ import annotations

from typing import ClassVar

from lib import http
from lib.trees.base import TreeHarness
from lib.trees.tree import Tree


class RadsHarness(TreeHarness):
    """Strategy concrete: classic RADS registry (presign + register) + execution."""

    name: ClassVar[Tree] = Tree.RADS

    def upload(self, algorithm_id: str) -> None:
        tar_path = self.build_sample_tar(self.name)
        status, body = http.request(
            "POST",
            f"{self._registry}/upload",
            json={"algorithmId": algorithm_id},
        )
        http.require(status, http.HTTP_OK, "/upload", body)

        upload_url = http.parse_json(body)["uploadUrl"]
        status, body = http.request(
            "PUT",
            upload_url,
            content=tar_path.read_bytes(),
            headers={"Content-Type": "application/x-tar"},
        )
        http.require(status, (http.HTTP_OK, http.HTTP_NO_CONTENT), "S3 PUT", body)

        status, body = http.request(
            "POST",
            f"{self._registry}/register",
            json={"algorithmId": algorithm_id},
        )
        http.require(status, http.HTTP_OK, "/register", body)
