import re
import unittest
from pathlib import Path

import export
from paths import REPO_ROOT


def event_names(path: Path) -> set[str]:
    declaration = path.read_text().split("] as const")[0]
    return set(re.findall(r'"([a-z-]+)"', declaration))


class EventContractTests(unittest.TestCase):
    def test_documented_events_are_accepted(self) -> None:
        for tree in ("rads", "secure-rads"):
            with self.subTest(tree=tree):
                documented = set(re.findall(r"emit ([a-z-]+)", (REPO_ROOT / f"docs/e2e-{tree}.txt").read_text()))
                accepted = event_names(REPO_ROOT / tree / "log-service/src/lib/events.ts")
                self.assertTrue(documented)
                self.assertFalse(documented - accepted, f"unaccepted documented events: {documented - accepted}")

    def test_result_consumers_mirror_ingest_authority(self) -> None:
        for tree in ("rads", "secure-rads"):
            with self.subTest(tree=tree):
                accepted = event_names(REPO_ROOT / tree / "log-service/src/lib/events.ts")
                mirrored = event_names(REPO_ROOT / tree / "result-consumer/src/lib/events.ts")
                self.assertEqual(mirrored, accepted)

    def test_benchmark_phase_endpoints_are_accepted(self) -> None:
        for tree, phases in export.PHASES.items():
            with self.subTest(tree=tree):
                accepted = event_names(REPO_ROOT / tree / "log-service/src/lib/events.ts")
                endpoints = {event for window in phases.values() for event in window if event is not None}
                self.assertFalse(endpoints - accepted, f"unaccepted benchmark endpoints: {endpoints - accepted}")


if __name__ == "__main__":
    unittest.main()
