from __future__ import annotations

from lib.trees.base import TreeHarness
from lib.trees.rads import RadsHarness
from lib.trees.secure_rads import SecureRadsHarness

__all__ = ["RadsHarness", "SecureRadsHarness", "TreeHarness", "harness_for"]


def harness_for(tree: str, endpoints: dict[str, str]) -> TreeHarness:
    """Factory: pick the Strategy and wire endpoints once at construction."""
    if tree == "rads":
        return RadsHarness(endpoints["registry"], endpoints["execution"])
    if tree == "secure-rads":
        return SecureRadsHarness(endpoints["registry"], endpoints["execution"])
    msg = f"unknown tree {tree!r}"
    raise ValueError(msg)
