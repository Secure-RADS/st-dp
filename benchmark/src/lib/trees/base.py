from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, ClassVar

from lib import http
from lib.trees.sample_tar import build_sample_tar

if TYPE_CHECKING:
    from pathlib import Path


class TreeHarness(ABC):
    """Strategy base: shared build/execute; subclasses implement tree-specific upload."""

    name: ClassVar[str]

    def __init__(self, registry_url: str, execution_url: str) -> None:
        self._registry = registry_url
        self._execution = execution_url

    def build_tar(self) -> Path:
        return build_sample_tar(self.name)

    def execute(self, algorithm_id: str, size: int) -> tuple[str, str, str]:
        return http.execute_run(self._execution, algorithm_id, size)

    @abstractmethod
    def upload(self, algorithm_id: str, tar_path: Path) -> None: ...
