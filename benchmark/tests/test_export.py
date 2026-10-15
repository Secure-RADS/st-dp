import unittest

import export


class PhaseTimingTests(unittest.TestCase):
    def test_file_write_belongs_to_retrieval_not_processing(self) -> None:
        events = {
            "artifact-retrieved": "2026-10-15T00:00:00Z",
            "attested": "2026-10-15T00:00:00Z",
            "records-fetched": "2026-10-15T00:00:03Z",
            "records-decrypted": "2026-10-15T00:00:05Z",
            "records-stored-locally": "2026-10-15T00:00:07Z",
            "dc-app-completed": "2026-10-15T00:00:11Z",
            "compute-completed": "2026-10-15T00:00:11Z",
        }
        for tree in ("rads", "secure-rads"):
            with self.subTest(tree=tree):
                phases = export.PHASES[tree]
                self.assertEqual(export.window_seconds(events, phases["data_retrieval"]), "7.00")
                self.assertEqual(export.window_seconds(events, phases["algorithm_processing"]), "4.00")

    def test_host_provisioning_uses_ec2_launch_not_enclave_launch(self) -> None:
        events = {
            "executor-launched": "2026-10-15T00:00:00Z",
            "executor-ready": "2026-10-15T00:01:00Z",
            "enclave-launched": "2026-10-15T00:01:10Z",
        }
        self.assertEqual(export.window_seconds(events, export.PHASES["secure-rads"]["host_provisioning"]), "60.00")

    def test_historical_events_do_not_fabricate_new_milestones(self) -> None:
        events = {
            "attested": "2026-10-15T00:00:00Z",
            "data-decrypted": "2026-10-15T00:00:07Z",
        }
        self.assertEqual(export.window_seconds(events, export.PHASES["secure-rads"]["data_retrieval"]), "")


if __name__ == "__main__":
    unittest.main()
