#!/usr/bin/env python3
"""End-to-end tests for the twin_tools command-line interface."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "twin_tools.py"


class LastKnownTests(unittest.TestCase):
    def run_last_known(
        self, payload: Any, *extra_args: str
    ) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "input.json"
            input_path.write_text(json.dumps(payload), encoding="utf-8")
            return subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "last-known",
                    "--input",
                    str(input_path),
                    *extra_args,
                ],
                check=False,
                capture_output=True,
                text=True,
            )

    def assert_successful_result(
        self,
        completed: subprocess.CompletedProcess[str],
        expected: Dict[str, Any],
    ) -> None:
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        self.assertEqual(json.loads(completed.stdout), expected)

    def test_last_known_preserves_output_shape_for_direct_record(self) -> None:
        record = {"timestamp": "2026-06-29T10:00:00Z", "temperature": 21.5}

        completed = self.run_last_known(
            record, "--value-key", "temperature"
        )

        self.assert_successful_result(
            completed,
            {
                "latest_timestamp": "2026-06-29T10:00:00+00:00",
                "record": record,
                "selected_value": 21.5,
            },
        )

    def test_last_known_traverses_dict_valued_data_wrapper(self) -> None:
        record = {
            "_metadata": {"timeLastHeard": "2026-06-29T11:00:00Z"},
            "value": 22.75,
        }

        completed = self.run_last_known(
            {"data": record},
            "--timestamp-key",
            "_metadata.timeLastHeard",
            "--value-key",
            "value",
        )

        self.assert_successful_result(
            completed,
            {
                "latest_timestamp": "2026-06-29T11:00:00+00:00",
                "record": record,
                "selected_value": 22.75,
            },
        )

    def test_last_known_selects_latest_record_from_nested_known_wrappers(self) -> None:
        older = {"timestamp": "2026-06-29T09:00:00Z", "value": "older"}
        latest = {"timestamp": "2026-06-29T12:00:00Z", "value": "latest"}

        completed = self.run_last_known(
            {"data": {"items": [latest, older]}}, "--value-key", "value"
        )

        self.assert_successful_result(
            completed,
            {
                "latest_timestamp": "2026-06-29T12:00:00+00:00",
                "record": latest,
                "selected_value": "latest",
            },
        )


if __name__ == "__main__":
    unittest.main()
