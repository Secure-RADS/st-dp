from __future__ import annotations

import json
import time
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, ClassVar

from lib import http

if TYPE_CHECKING:
    from lib.trees.tree import Tree


class TreeHarness(ABC):
    """Strategy base: shared execute; subclasses implement tree-specific upload."""

    name: ClassVar[Tree]

    def __init__(self, registry_url: str, execution_url: str) -> None:
        self._registry = registry_url
        self._execution = execution_url

    def execute(self, algorithm_id: str, size: int) -> tuple[str, str, str]:
        payload: dict[str, object] = {"algorithmId": algorithm_id, "size": size}
        status, body = http.request(
            "POST",
            f"{self._execution}/run",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        http.require(status, http.HTTP_ACCEPTED, "/run", body)

        run_id = http.parse_json(body)["runId"]
        deadline = time.time() + http.POLL_TIMEOUT_SECONDS
        while time.time() < deadline:
            status, result_body = http.request("GET", f"{self._execution}/run/{run_id}")
            http.require(status, http.HTTP_OK, f"/run/{run_id}", result_body)
            result = http.parse_json(result_body)
            if result.get("status") != "pending":
                output = result.get("output", "") or ""
                return run_id, result.get("status", ""), output
            time.sleep(http.POLL_INTERVAL_SECONDS)

        msg = f"timed out after {http.POLL_TIMEOUT_SECONDS:.0f}s waiting for runId={run_id}"
        raise http.FlowError(msg)

    @abstractmethod
    def upload(self, algorithm_id: str) -> None: ...
