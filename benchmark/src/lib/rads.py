from __future__ import annotations

import json
from typing import TYPE_CHECKING

from lib import http
from lib.sample_tar import build_sample_tar

if TYPE_CHECKING:
    from pathlib import Path


class RadsHarness:
    """Strategy concrete: classic RADS registry (presign + register) + execution."""

    name = "rads"

    def __init__(self, registry_url: str, execution_url: str) -> None:
        self._registry = registry_url
        self._execution = execution_url

    def build_tar(self) -> Path:
        return build_sample_tar(self.name)

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

    def execute(self, algorithm_id: str, size: int) -> tuple[str, str, str]:
        return http.execute_run(self._execution, algorithm_id, size)
