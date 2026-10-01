from __future__ import annotations

import json
from typing import TYPE_CHECKING, ClassVar

from lib import http
from lib.trees.base import TreeHarness

if TYPE_CHECKING:
    from pathlib import Path


class RadsHarness(TreeHarness):
    """Strategy concrete: classic RADS registry (presign + register) + execution."""

    name: ClassVar[str] = "rads"

    def upload(self, algorithm_id: str, tar_path: Path) -> None:
        status, body = http.request(
            "POST",
            f"{self._registry}/upload",
            data=json.dumps({"algorithmId": algorithm_id}).encode(),
            headers={"Content-Type": "application/json"},
        )
        http.require(status, http.HTTP_OK, "/upload", body)

        upload_url = http.parse_json(body)["uploadUrl"]
        status, body = http.request(
            "PUT",
            upload_url,
            data=tar_path.read_bytes(),
            headers={"Content-Type": "application/x-tar"},
        )
        http.require(status, (http.HTTP_OK, http.HTTP_NO_CONTENT), "S3 PUT", body)

        status, body = http.request(
            "POST",
            f"{self._registry}/register",
            data=json.dumps({"algorithmId": algorithm_id}).encode(),
            headers={"Content-Type": "application/json"},
        )
        http.require(status, http.HTTP_OK, "/register", body)
