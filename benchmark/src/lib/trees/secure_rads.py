from __future__ import annotations

from typing import ClassVar

from lib import http
from lib.trees.base import TreeHarness
from lib.trees.tree import Tree


class SecureRadsHarness(TreeHarness):
    """Strategy concrete: CSAV registry multipart upload + secure-rads execution."""

    name: ClassVar[Tree] = Tree.SECURE_RADS

    def upload(self, algorithm_id: str) -> None:
        tar_path = self.build_sample_tar(self.name)
        with tar_path.open("rb") as image:
            status, body = http.request(
                "POST",
                f"{self._registry}/upload",
                data={"algorithmId": algorithm_id},
                files={"image": (tar_path.name, image, "application/x-tar")},
            )
        http.require(status, http.HTTP_OK, "/upload", body)
