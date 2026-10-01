from __future__ import annotations

from typing import TYPE_CHECKING

from lib import http
from lib.sample_tar import build_sample_tar

if TYPE_CHECKING:
    from pathlib import Path

MULTIPART_BOUNDARY = "----benchmarkboundary7d9f3a"


class SecureRadsHarness:
    """Strategy concrete: CSAV registry multipart upload + secure-rads execution."""

    name = "secure-rads"

    def __init__(self, registry_url: str, execution_url: str) -> None:
        self._registry = registry_url
        self._execution = execution_url

    def build_tar(self) -> Path:
        return build_sample_tar(self.name)

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

    def execute(self, algorithm_id: str, size: int) -> tuple[str, str, str]:
        return http.execute_run(self._execution, algorithm_id, size)
