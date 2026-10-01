from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from lib.rads import RadsHarness
from lib.secure_rads import SecureRadsHarness

if TYPE_CHECKING:
    from pathlib import Path


class TreeHarness(Protocol):
    """Strategy: interchangeable per-tree upload / build / execute behind one Protocol."""

    name: str

    def build_tar(self) -> Path: ...
    def upload(self, algorithm_id: str, tar_path: Path) -> None: ...
    def execute(self, algorithm_id: str, size: int) -> tuple[str, str, str]: ...


def harness_for(tree: str, endpoints: dict[str, str]) -> TreeHarness:
    """Factory: pick the Strategy and wire endpoints once at construction."""
    if tree == "rads":
        return RadsHarness(endpoints["registry"], endpoints["execution"])
    if tree == "secure-rads":
        return SecureRadsHarness(endpoints["registry"], endpoints["execution"])
    msg = f"unknown tree {tree!r}"
    raise ValueError(msg)
