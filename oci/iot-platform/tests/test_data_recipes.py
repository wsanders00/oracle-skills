#!/usr/bin/env python3
"""Execute the documented diagnostics with fake curl and synthetic responses.

No OCI configuration or credentials are inherited. The actual Markdown recipe
blocks are executed rather than a second implementation of their behavior.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
REFERENCE = SKILL_ROOT / "references" / "data-diagnostics.md"


def recipe(name):
    text = REFERENCE.read_text(encoding="utf-8")
    pattern = r"<!--\s*recipe:\s*" + re.escape(name) + r"\s*-->\s*```(?:bash|sh)\n(.*?)\n```"
    match = re.search(pattern, text, re.DOTALL)
    if match is None:
        raise AssertionError("missing executable recipe: " + name)
    return match.group(1)


class DataRecipes(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="iot-data-recipes-")
        self.root = Path(self.tmp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        (self.bin / "python3").symlink_to(sys.executable)
        self.calls = self.root / "calls.jsonl"
        self.responses = self.root / "responses.json"
        self.responses.write_text("{}", encoding="utf-8")
        self.config = self.root / "auth.conf"
        self.config.write_text('header = "Authorization: Bearer synthetic-token-canary"\n', encoding="utf-8")
        self.config.chmod(0o600)
        guard = self.root / "guard"
        guard.mkdir()
        (guard / "sitecustomize.py").write_text(
            "import socket\n"
            "def deny(*args, **kwargs):\n"
            "    raise RuntimeError('network forbidden in offline recipe tests')\n"
            "socket.socket.connect = deny\n"
            "socket.socket.connect_ex = deny\n"
            "socket.create_connection = deny\n", encoding="utf-8"
        )
        mock = self.bin / "curl"
        mock.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
if args == ["--version"]:
    print("curl 8.7.1 synthetic-offline-client")
    sys.exit(0)
with open(os.environ["MOCK_CALLS"], "a", encoding="utf-8") as out:
    out.write(json.dumps(args) + "\\n")
if os.environ.get("MOCK_TRANSPORT_FAIL") == "1":
    sys.stderr.write("synthetic transport failure\\n")
    sys.exit(7)
status = int(os.environ.get("MOCK_HTTP_STATUS", "200"))
if status >= 400 and "--fail" in args:
    sys.stderr.write("synthetic HTTP failure\\n")
    sys.exit(22)
url = next((a for a in args if a.startswith("https://")), "")
resource = url.rstrip("/").split("/")[-1]
fixtures = json.loads(pathlib.Path(os.environ["MOCK_RESPONSES"]).read_text())
data = fixtures.get(resource, {"items": []})
body = data if isinstance(data, str) else json.dumps(data)
if "--max-filesize" in args:
    raw_limit = args[args.index("--max-filesize") + 1]
    suffixes = {"K": 1024, "M": 1024**2, "G": 1024**3}
    limit = int(raw_limit[:-1]) * suffixes[raw_limit[-1].upper()] if raw_limit[-1].upper() in suffixes else int(raw_limit)
    if len(body.encode()) > limit:
        sys.stderr.write("synthetic response size limit\\n")
        sys.exit(63)
output = None
for key in ("--output", "-o"):
    if key in args:
        output = args[args.index(key) + 1]
        break
if output:
    pathlib.Path(output).write_text(body)
else:
    sys.stdout.write(body)
if "--write-out" in args or "-w" in args:
    sys.stdout.write(str(status))
''', encoding="utf-8")
        mock.chmod(0o700)
        for name in ("oci", "sql", "sqlcl"):
            deny = self.bin / name
            deny.write_text("#!/bin/sh\necho 'unexpected live tool' >&2\nexit 97\n", encoding="utf-8")
            deny.chmod(0o700)
        self.env = {
            "PATH": str(self.bin) + os.pathsep + "/usr/bin:/bin",
            "LC_ALL": "C", "LANG": "C", "TZ": "UTC",
            "PYTHONPATH": str(guard), "PYTHONNOUSERSITE": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
            "MOCK_CALLS": str(self.calls), "MOCK_RESPONSES": str(self.responses),
            "IOT_DATA_API_BASE": "https://synthetic.data.iot.us-test-1.oci.oraclecloud.com/ords/example",
            "IOT_DATA_EXPECTED_ORIGIN": "https://synthetic.data.iot.us-test-1.oci.oraclecloud.com",
            "IOT_DATA_CURL_CONFIG": str(self.config),
            "IOT_TWIN_ID": "synthetic-twin",
            "IOT_FROM_UTC": "2026-01-01T00:00:00Z",
            "IOT_TO_UTC": "2026-01-02T00:00:00Z",
            "IOT_CONTENT_PATH": "temperature",
            "IOT_METRIC_UNIT": "degreeCelsius",
            "IOT_RESOURCE": "historizedData",
        }

    def tearDown(self):
        self.tmp.cleanup()

    def run_recipe(self, name, fixtures, extra=None):
        self.responses.write_text(json.dumps(fixtures), encoding="utf-8")
        env = dict(self.env)
        for resource, variable in (("historizedData", "IOT_RESPONSE_FILE"),
                                   ("rawData", "IOT_RAW_RESPONSE_FILE"),
                                   ("rejectedData", "IOT_REJECTED_RESPONSE_FILE")):
            path = self.root / (resource + ".json")
            data = fixtures.get(resource, {"items": []})
            path.write_text(data if isinstance(data, str) else json.dumps(data), encoding="utf-8")
            env[variable] = str(path)
        if name == "COMMAND-SUMMARY":
            path = self.root / "rawCommandData.json"
            data = fixtures.get("rawCommandData", {"items": []})
            path.write_text(data if isinstance(data, str) else json.dumps(data), encoding="utf-8")
            env["IOT_RESPONSE_FILE"] = str(path)
        if extra:
            for key, value in extra.items():
                if value is None:
                    env.pop(key, None)
                else:
                    env[key] = value
        code = recipe(name)
        return subprocess.run(["bash", "-c", code], cwd=self.root, env=env,
                              text=True, capture_output=True, timeout=15)

    def summary(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def calls_list(self):
        if not self.calls.exists():
            return []
        return [json.loads(row) for row in self.calls.read_text().splitlines()]

    def assert_private(self, result):
        for marker in ("synthetic-token-canary", "private-payload-canary", "private-id-canary"):
            self.assertNotIn(marker, result.stdout + result.stderr)
            self.assertNotIn(marker, self.calls.read_text() if self.calls.exists() else "")

    @staticmethod
    def history(value=20, **overrides):
        row = {"id": 1, "digital_twin_instance_id": "synthetic-twin",
               "content_path": "temperature", "time_observed": "2026-01-01T12:00:00Z",
               "value": value}
        row.update(overrides)
        return row

    def test_history_one_page_statistics_are_explicitly_incomplete(self):
        result = self.run_recipe("HISTORIAN-SUMMARY", {"historizedData": {
            "items": [self.history(10), self.history(30, id=2)], "hasMore": False}})
        out = self.summary(result)
        self.assertEqual(out["numeric_records"], 2)
        self.assertEqual(out["mean"], 20)
        self.assertEqual(out["completeness"], "unknown")
        self.assertEqual(self.calls_list(), [])
        self.assert_private(result)

    def test_request_is_scoped_encoded_and_has_no_token_argument(self):
        twin = 'synthetic-"twin\\with&syntax'
        result = self.run_recipe("COMMON-FETCH", {"rawData": {"items": []}},
                                 {"IOT_TWIN_ID": twin})
        self.summary(result)
        args = self.calls_list()[0]
        self.assertEqual(args[0], "--disable")
        self.assertIn("--config", args)
        self.assertIn(str(self.config), args)
        self.assertIn("--get", args)
        self.assertIn("--fail", args)
        self.assertIn("--connect-timeout", args)
        self.assertIn("--max-time", args)
        self.assertIn("--max-filesize", args)
        self.assertNotIn("--location", args)
        self.assertNotIn("--retry", args)
        self.assertNotIn("--insecure", args)
        self.assertTrue(any(a.endswith("/ords/example/20250531/rawData") for a in args))
        q = args[args.index("--data-urlencode") + 1]
        self.assertTrue(q.startswith("q="))
        parsed = json.loads(q[2:])
        self.assertEqual(parsed, {"$and": [{"digital_twin_instance_id": twin}]})
        self.assert_private(result)

    def test_history_filters_window_metric_and_twin_locally(self):
        fixtures = {"historizedData": {"items": [
            self.history(20), self.history(90, id=2, digital_twin_instance_id="another-twin"),
            self.history(90, id=3, content_path="humidity"),
            self.history(90, id=4, time_observed="2026-01-02T00:00:00Z")
        ]}}
        out = self.summary(self.run_recipe("HISTORIAN-SUMMARY", fixtures))
        self.assertEqual(out["numeric_records"], 1)
        self.assertEqual(out["mean"], 20)

    def test_history_excludes_bad_values_and_detects_duplicates(self):
        fixtures = {"historizedData": {"items": [
            self.history(20), self.history(20), self.history(None, id=2),
            self.history(True, id=3), self.history("20", id=4),
            self.history({"token": "private-payload-canary"}, id=5)
        ]}}
        result = self.run_recipe("HISTORIAN-SUMMARY", fixtures)
        out = self.summary(result)
        self.assertEqual(out["numeric_records"], 1)
        self.assertGreaterEqual(out["duplicate_records"], 1)
        self.assert_private(result)

    def test_empty_data_is_not_a_zero_average(self):
        out = self.summary(self.run_recipe("HISTORIAN-SUMMARY", {"historizedData": {"items": []}}))
        self.assertEqual(out["numeric_records"], 0)
        self.assertIsNone(out.get("mean"))
        self.assertEqual(out["completeness"], "unknown")

    def test_http_and_transport_failures_stop_without_private_output(self):
        for extra in ({"MOCK_HTTP_STATUS": "401"}, {"MOCK_TRANSPORT_FAIL": "1"}):
            with self.subTest(extra=extra):
                result = self.run_recipe("COMMON-FETCH", {}, extra)
                self.assertNotEqual(result.returncode, 0)
                self.assert_private(result)

    def test_malformed_json_does_not_echo_server_body(self):
        result = self.run_recipe("HISTORIAN-SUMMARY", {"historizedData": "private-payload-canary NOT JSON"})
        self.assertNotEqual(result.returncode, 0)
        self.assert_private(result)

    def test_missing_required_input_fails_before_fetch(self):
        for name, extra in (("COMMON-FETCH", {"IOT_DATA_CURL_CONFIG": None}),
                            ("HISTORIAN-SUMMARY", {"IOT_METRIC_UNIT": None}),
                            ("HISTORIAN-SUMMARY", {"IOT_RESPONSE_FILE": None})):
            with self.subTest(name=name, extra=extra):
                if self.calls.exists():
                    self.calls.unlink()
                result = self.run_recipe(name, {}, extra)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.calls_list(), [])
                self.assert_private(result)

    def test_offline_summaries_do_not_require_auth_or_api_base(self):
        for name in ("HISTORIAN-SUMMARY", "TRIAGE-SUMMARY", "COMMAND-SUMMARY"):
            with self.subTest(name=name):
                result = self.run_recipe(name, {}, {
                    "IOT_DATA_CURL_CONFIG": None, "IOT_DATA_API_BASE": None})
                out = self.summary(result)
                self.assertEqual(out["completeness"], "unknown")
                self.assertEqual(self.calls_list(), [])

    def test_single_known_id_record_and_invalid_timestamp_are_handled(self):
        out = self.summary(self.run_recipe("HISTORIAN-SUMMARY", {
            "historizedData": self.history(20)}))
        self.assertEqual(out["numeric_records"], 1)
        out = self.summary(self.run_recipe("HISTORIAN-SUMMARY", {
            "historizedData": {"items": [self.history(20, time_observed={"private": "private-payload-canary"})]}}))
        self.assertEqual(out["numeric_records"], 0)
        self.assertGreaterEqual(out["invalid_records"], 1)

    def test_triage_counts_only_scoped_records_without_payloads(self):
        base = {"id": 1, "digital_twin_instance_id": "synthetic-twin",
                "time_received": "2026-01-01T12:00:00Z",
                "content": {"secret": "private-payload-canary"}}
        rows = [base, base, dict(base, id=2, digital_twin_instance_id="other-twin")]
        rejected = [dict(base, reason_code=3), dict(base, id=2, reason_code="private-payload-canary")]
        result = self.run_recipe("TRIAGE-SUMMARY", {
            "rawData": {"items": rows}, "rejectedData": {"items": rejected}})
        out = self.summary(result)
        self.assertEqual(out["rawData"]["matching_records"], 1)
        self.assertEqual(out["rawData"]["duplicate_records"], 1)
        self.assertEqual(out["rejectedData"]["reason_code_counts"], {"3": 1})
        self.assertEqual(self.calls_list(), [])
        self.assert_private(result)

    def test_command_status_is_sanitized_and_does_not_claim_device_effect(self):
        base = {"id": "synthetic-command-1", "digital_twin_instance_id": "synthetic-twin",
                "time_created": "2026-01-01T12:00:00Z", "delivery_status": "SENT",
                "time_finished": "2026-01-01T12:30:00Z",
                "content": {"secret": "private-payload-canary"}}
        result = self.run_recipe("COMMAND-SUMMARY", {"rawCommandData": {"items": [
            base, dict(base, id="synthetic-command-2", delivery_status="private-payload-canary"),
            dict(base, id="synthetic-command-3", digital_twin_instance_id="other-twin")
        ]}})
        out = self.summary(result)
        self.assertEqual(out["matching_records"], 2)
        self.assertEqual(out["delivery_status_counts"], {"SENT": 1})
        self.assertEqual(out["unknown_status_records"], 1)
        self.assertEqual(out["device_effect"], "not established")
        self.assertEqual(self.calls_list(), [])
        self.assert_private(result)

    def test_fetch_body_size_limit_and_insecure_url_stop(self):
        result = self.run_recipe("COMMON-FETCH", {"rawData": "private-payload-canary" + "x" * (4 * 1024**2)})
        self.assertNotEqual(result.returncode, 0)
        self.assert_private(result)
        self.calls.unlink()
        result = self.run_recipe("COMMON-FETCH", {}, {"IOT_DATA_API_BASE": "http://example.invalid/ords/example"})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.calls_list(), [])

    def test_invalid_window_stops_offline_summary(self):
        result = self.run_recipe("HISTORIAN-SUMMARY", {}, {"IOT_TO_UTC": "2025-12-31T00:00:00Z"})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.calls_list(), [])

    def test_unrelated_https_origin_or_url_credentials_fail_before_fetch(self):
        for base in ("https://unrelated.example/ords/example",
                     "https://user@synthetic.data.iot.us-test-1.oci.oraclecloud.com/ords/example",
                     self.env["IOT_DATA_API_BASE"] + "?q=untrusted",
                     self.env["IOT_DATA_API_BASE"] + "/20250531"):
            with self.subTest(base=base):
                result = self.run_recipe("COMMON-FETCH", {}, {"IOT_DATA_API_BASE": base})
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.calls_list(), [])
                self.assert_private(result)


if __name__ == "__main__":
    unittest.main()
