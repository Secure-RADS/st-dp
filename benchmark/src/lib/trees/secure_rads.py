from __future__ import annotations

from typing import TYPE_CHECKING, ClassVar

from lib import http
from lib.trees.base import TreeHarness
from lib.trees.tree import Tree

if TYPE_CHECKING:
    from pathlib import Path

MULTIPART_BOUNDARY = "----benchmarkboundary7d9f3a"


class SecureRadsHarness(TreeHarness):
    """Strategy concrete: CSAV registry multipart upload + secure-rads execution."""

    name: ClassVar[Tree] = Tree.SECURE_RADS

    def upload(self, algorithm_id: str, tar_path: Path) -> None:
        head = (
            f"--{MULTIPART_BOUNDARY}\r\n"
            f'Content-Disposition: form-data; name="algorithmId"\r\n\r\n'
            f"{algorithm_id}\r\n"
            f"--{MULTIPART_BOUNDARY}\r\n"
            f'Content-Disposition: form-data; name="image"; filename="{tar_path.name}"\r\n'
            f"Content-Type: application/x-tar\r\n\r\n"
        ).encode()
        tail = f"\r\n--{MULTIPART_BOUNDARY}--\r\n".encode()

        status, body = http.request(
            "POST",
            f"{self._registry}/upload",
            data=head + tar_path.read_bytes() + tail,
            headers={"Content-Type": f"multipart/form-data; boundary={MULTIPART_BOUNDARY}"},
        )
        http.require(status, http.HTTP_OK, "/upload", body)
