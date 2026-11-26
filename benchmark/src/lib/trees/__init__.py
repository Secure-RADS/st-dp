from __future__ import annotations

from lib.tree import Tree
from lib.trees.base import TreeHarness
from lib.trees.rads import RadsHarness
from lib.trees.secure_rads import SecureRadsHarness

__all__ = ["RadsHarness", "SecureRadsHarness", "Tree", "TreeHarness", "harness_for"]


def harness_for(tree: Tree, endpoints: dict[str, str]) -> TreeHarness:
    """Factory: pick the Strategy and wire endpoints once at construction."""
    if tree is Tree.RADS:
        return RadsHarness(endpoints["registry"], endpoints["execution"])
    if tree is Tree.SECURE_RADS:
        return SecureRadsHarness(endpoints["registry"], endpoints["execution"], endpoints.get("telemetry"))
    msg = f"unknown tree {tree!r}"
    raise ValueError(msg)
