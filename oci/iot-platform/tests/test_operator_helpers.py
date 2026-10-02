#!/usr/bin/env python3
"""Offline behavior tests for the installed OCI IoT operator helpers.

All external commands used by the shell helpers are supplied from a temporary
directory placed first on PATH. The subprocess environment is allowlisted, so
local OCI profiles and credential variables cannot affect the tests.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_SKILL_ROOT = Path(__file__).resolve().parents[1]


def skill_root_from_args():
    if len(sys.argv) == 3 and sys.argv[1] == "--skill-root":
        root = Path(sys.argv.pop(2)).resolve()
        sys.argv.pop(1)
        return root
    return DEFAULT_SKILL_ROOT


SKILL_ROOT = skill_root_from_args()
DERIVE = SKILL_ROOT / "scripts" / "derive_domain_context.sh"
TWIN = SKILL_ROOT / "scripts" / "twin_tools.py"
PUBLISH = SKILL_ROOT / "templates" / "publish-curl.template.sh"


class OperatorHelpers(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="operator-helper-")
        self.root = Path(self.tmp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.calls = self.root / "calls.jsonl"
        self._write_mock("oci", self._oci_mock())
        self._write_mock("jq", self._jq_mock())
        self._write_mock("curl", self._curl_mock())
        self._write_mock("date", self._date_mock())
        self._write_mock("cat", "#!/usr/bin/env python3\nimport sys\nsys.stdout.write(sys.stdin.read())\n")

    def tearDown(self):
        self.tmp.cleanup()

    def _write_mock(self, name, content):
        path = self.bin / name
        path.write_text(content, encoding="utf-8")
        path.chmod(0o700)

    def _oci_mock(self):
        calls = str(self.calls)
        return f'''#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
profile = args[args.index("--profile") + 1] if "--profile" in args else None
auth = args[args.index("--auth") + 1] if "--auth" in args else None
with open({calls!r}, "a", encoding="utf-8") as f:
    f.write(json.dumps({{"command": args[0] if args else "", "profile": bool(profile), "auth": auth or "default"}}) + "\\n")
if os.environ.get("MOCK_OCI_FAIL") == "1":
    sys.exit(43)
if args and args[0] == "iot" and "domain" in args and "domain-group" not in args:
    print(json.dumps({{"data": {{"device-host": "device-host.device.iot.us-test-1.oci.oraclecloud.com", "iot-domain-group-id": "synthetic-group"}}}}))
elif args and "domain-group" in args:
    print(json.dumps({{"data": {{"data-host": "group-host.data.iot.us-test-1.oci.oraclecloud.com"}}}}))
else:
    sys.exit(91)
'''

    def _jq_mock(self):
        return '''#!/usr/bin/env python3
import json, sys
query = sys.argv[-1]
data = json.load(sys.stdin)
if query == '-r':
    query = sys.argv[-2]
parts = query.strip().lstrip('.').replace('"', '').split('.')
value = data
for part in parts:
    value = value.get(part) if isinstance(value, dict) else None
if value is None:
    print('null')
elif isinstance(value, (dict, list)):
    print(json.dumps(value))
else:
    print(value)
'''

    def _curl_mock(self):
        calls = str(self.calls)
        return f'''#!/usr/bin/env python3
import json, os, sys
with open({calls!r}, "a", encoding="utf-8") as f:
    f.write(json.dumps({{"command": "curl", "args": sys.argv[1:], "status": int(os.environ.get("MOCK_CURL_HTTP_STATUS", "200")), "transport_fail": os.environ.get("MOCK_CURL_TRANSPORT_FAIL") == "1"}}) + "\\n")
if os.environ.get("MOCK_CURL_TRANSPORT_FAIL") == "1":
    sys.exit(7)
status = int(os.environ.get("MOCK_CURL_HTTP_STATUS", "200"))
if status >= 400 and "--fail" in sys.argv[1:]:
    sys.exit(22)
print("mock publish accepted")
'''

    @staticmethod
    def _date_mock():
        return '''#!/usr/bin/env python3
print("2026-10-01T12:34:56")
'''

    def _env(self, extra=None):
        env = {
            "PATH": f"{self.bin}{os.pathsep}/usr/bin:/bin",
            "LC_ALL": "C",
            "LANG": "C",
            "TZ": "UTC",
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONNOUSERSITE": "1",
        }
        if extra:
            env.update(extra)
        return env

    def _run(self, args, extra=None, input_text=None):
        return subprocess.run(
            args,
            cwd=self.root,
            env=self._env(extra),
            input=input_text,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )

    def _calls(self):
        if not self.calls.exists():
            return []
        return [json.loads(row) for row in self.calls.read_text().splitlines()]

    def _json_input(self, name, payload):
        path = self.root / name
        path.write_text(json.dumps(payload), encoding="utf-8")
        return str(path)

    def _assert_condition(self, condition, label):
        if not condition:
            self.fail(label)

    def test_derive_default_auth_on_both_calls(self):
        result = self._run(["bash", str(DERIVE), "--iot-domain-id", "synthetic-domain"])
        calls = self._calls()
        self._assert_condition(result.returncode == 0, "derive_default_succeeds")
        self._assert_condition(len(calls) == 2, "derive_makes_two_reads")
        self._assert_condition(all(c["auth"] == "default" and not c["profile"] for c in calls), "derive_default_auth_consistent")
        self._assert_condition("REGION=us-test-1" in result.stdout and "DOMAIN_SHORT_ID=device-host" in result.stdout, "derive_metadata_extracted")

    def test_derive_metadata_with_actual_jq_when_available(self):
        jq_path = shutil.which("jq")
        if jq_path is None:
            self.skipTest("jq executable unavailable")
        mock_jq = self.bin / "jq"
        hidden_mock = self.root / "jq.mock"
        mock_jq.rename(hidden_mock)
        try:
            env = {"PATH": f"{self.bin}{os.pathsep}{Path(jq_path).parent}{os.pathsep}/usr/bin:/bin"}
            result = self._run(["bash", str(DERIVE), "--iot-domain-id", "synthetic-domain"], env)
        finally:
            hidden_mock.rename(mock_jq)
        calls = self._calls()
        self._assert_condition(result.returncode == 0 and len(calls) == 2, "derive_actual_jq_succeeds")
        self._assert_condition("REGION=us-test-1" in result.stdout and "DOMAIN_SHORT_ID=device-host" in result.stdout, "derive_actual_jq_extracts_metadata")

    def test_derive_named_profile_on_both_calls(self):
        result = self._run(["bash", str(DERIVE), "--profile", "named", "--iot-domain-id", "synthetic-domain"])
        calls = self._calls()
        self._assert_condition(result.returncode == 0 and len(calls) == 2, "derive_named_succeeds")
        self._assert_condition(all(c["profile"] and c["auth"] == "default" for c in calls), "derive_named_profile_consistent")

    def test_derive_security_token_profile_consistent(self):
        result = self._run(["bash", str(DERIVE), "--profile", "named", "--auth", "security_token", "--iot-domain-id", "synthetic-domain"])
        calls = self._calls()
        self._assert_condition(result.returncode == 0 and len(calls) == 2, "derive_token_succeeds")
        self._assert_condition(all(c["profile"] and c["auth"] == "security_token" for c in calls), "derive_token_auth_consistent")

    def test_derive_workload_auth_without_profile(self):
        result = self._run(["bash", str(DERIVE), "--auth", "oke_workload_identity", "--iot-domain-id", "synthetic-domain"])
        calls = self._calls()
        self._assert_condition(result.returncode == 0 and len(calls) == 2, "derive_workload_succeeds")
        self._assert_condition(all(not c["profile"] and c["auth"] == "oke_workload_identity" for c in calls), "derive_workload_auth_consistent")

    def test_derive_missing_domain_fails_before_oci(self):
        result = self._run(["bash", str(DERIVE)])
        self._assert_condition(result.returncode != 0 and not self._calls(), "derive_requires_domain")

    def test_derive_oci_failure_propagates(self):
        result = self._run(["bash", str(DERIVE), "--iot-domain-id", "synthetic-domain"], {"MOCK_OCI_FAIL": "1"})
        self._assert_condition(result.returncode == 43 and len(self._calls()) == 1, "derive_oci_failure_propagates")

    def test_derive_missing_option_value_is_usage_error(self):
        result = self._run(["bash", str(DERIVE), "--auth"])
        self._assert_condition(result.returncode == 2 and not self._calls(), "derive_missing_value_usage_error")

    def test_derive_missing_required_metadata_fails(self):
        original = (self.bin / "oci").read_text(encoding="utf-8")
        mock = self.bin / "oci"
        cases = (
            (original.replace('"device-host": "device-host.device.iot.us-test-1.oci.oraclecloud.com", ', ""), "device_host"),
            (original.replace(', "iot-domain-group-id": "synthetic-group"', ""), "domain_group_id"),
            (original.replace('"data-host": "group-host.data.iot.us-test-1.oci.oraclecloud.com"', ""), "data_host"),
        )
        for source, label in cases:
            with self.subTest(case=f"derive_missing_{label}"):
                mock.write_text(source, encoding="utf-8")
                result = self._run(["bash", str(DERIVE), "--iot-domain-id", "synthetic-domain"])
                self._assert_condition(result.returncode != 0, f"derive_missing_{label}_fails")

    def test_last_known_wrapped_records_dot_paths_offsets_and_filter(self):
        path = self._json_input("wrapped.json", {"data": [
            {"device": {"id": "a"}, "observed": {"at": "2026-10-01T08:00:00-04:00"}, "reading": {"value": 1}},
            {"device": {"id": "b"}, "observed": {"at": "2026-10-01T14:30:00+02:00"}, "reading": {"value": 7}},
            {"device": {"id": "a"}, "observed": {"at": "2026-10-01T13:00:00Z"}, "reading": {"value": 2}},
        ]})
        result = self._run([sys.executable, str(TWIN), "last-known", "--input", path, "--device-key", "device.id", "--device-id", "a", "--timestamp-key", "observed.at", "--value-key", "reading.value"])
        data = json.loads(result.stdout)
        self._assert_condition(result.returncode == 0, "last_known_succeeds")
        self._assert_condition(data["record"]["device"]["id"] == "a" and data["selected_value"] == 2, "last_known_filters_and_uses_dot_path")
        self._assert_condition(data["latest_timestamp"] == "2026-10-01T13:00:00+00:00", "last_known_normalizes_offsets")

    def test_last_known_list_of_wrapped_records(self):
        path = self._json_input("list.json", [{"data": [{"timestamp": "2026-10-01T00:00:00Z", "value": 1}]}, {"timestamp": "2026-10-01T01:00:00Z", "value": 2}])
        result = self._run([sys.executable, str(TWIN), "last-known", "--input", path])
        self._assert_condition(result.returncode == 0 and json.loads(result.stdout)["record"]["value"] == 2, "last_known_list_records")

    def test_last_known_unwrapped_records_with_nested_timestamps(self):
        path = self._json_input("unwrapped-nested.json", [
            {"deviceId": "a", "_metadata": {"timeLastHeard": "2026-10-01T10:00:00Z"}},
            {"deviceId": "b", "_metadata": {"timeLastHeard": "2026-10-01T11:00:00Z"}},
            {"deviceId": "a", "_metadata": {"timeLastHeard": "2026-10-01T12:00:00Z"}},
        ])
        result = self._run([sys.executable, str(TWIN), "last-known", "--input", path, "--device-key", "deviceId", "--device-id", "a", "--timestamp-key", "_metadata.timeLastHeard"])
        data = json.loads(result.stdout)
        self._assert_condition(result.returncode == 0 and data["record"]["deviceId"] == "a", "last_known_unwrapped_records_filter")
        self._assert_condition(data["latest_timestamp"] == "2026-10-01T12:00:00+00:00", "last_known_unwrapped_records_nested_timestamp")

    def test_last_known_oci_object_wrapper_with_metadata_timestamp(self):
        path = self._json_input("oci-object-wrapper.json", {"data": {
            "deviceId": "synthetic-device",
            "_metadata": {"timeLastHeard": "2026-10-01T12:34:56Z"},
        }})
        result = self._run([sys.executable, str(TWIN), "last-known", "--input", path, "--device-key", "deviceId", "--device-id", "synthetic-device", "--timestamp-key", "_metadata.timeLastHeard"])
        data = json.loads(result.stdout)
        self._assert_condition(result.returncode == 0 and data["record"]["deviceId"] == "synthetic-device", "last_known_oci_object_wrapper_filter")
        self._assert_condition(data["latest_timestamp"] == "2026-10-01T12:34:56+00:00", "last_known_oci_object_wrapper_timestamp")

    def test_last_known_no_timestamp_is_nonzero(self):
        path = self._json_input("empty.json", {"data": [{"timestamp": "invalid"}]})
        result = self._run([sys.executable, str(TWIN), "last-known", "--input", path])
        self._assert_condition(result.returncode == 1, "last_known_rejects_unparseable")

    def test_last_known_malformed_json_is_clean_error(self):
        path = self.root / "malformed.json"
        path.write_text("{", encoding="utf-8")
        result = self._run([sys.executable, str(TWIN), "last-known", "--input", str(path)])
        self._assert_condition(result.returncode != 0, "last_known_malformed_json_nonzero")

    def test_offline_threshold_includes_equal_boundary_and_uses_latest(self):
        path = self._json_input("offline.json", {"items": [
            {"deviceId": "boundary", "lastSeen": "2026-10-01T09:30:00-01:00"},
            {"deviceId": "boundary", "lastSeen": "2026-10-01T11:30:00Z"},
            {"deviceId": "online", "lastSeen": "2026-10-01T11:31:00Z"},
        ]})
        result = self._run([sys.executable, str(TWIN), "offline", "--input", path, "--threshold-minutes", "30", "--now", "2026-10-01T12:00:00Z"])
        data = json.loads(result.stdout)
        self._assert_condition(result.returncode == 0, "offline_succeeds")
        self._assert_condition(data["offline_count"] == 1 and data["offline_devices"][0]["device_id"] == "boundary", "offline_threshold_boundary_and_latest")

    def test_offline_threshold_above_boundary_keeps_device_online(self):
        path = self._json_input("offline-boundary.json", [{"deviceId": "d", "lastSeen": "2026-10-01T11:30:00Z"}])
        result = self._run([sys.executable, str(TWIN), "offline", "--input", path, "--threshold-minutes", "30.01", "--now", "2026-10-01T12:00:00Z"])
        self._assert_condition(result.returncode == 0 and json.loads(result.stdout)["offline_count"] == 0, "offline_above_boundary_online")

    def test_offline_invalid_now_fails(self):
        path = self._json_input("offline-invalid-now.json", [])
        result = self._run([sys.executable, str(TWIN), "offline", "--input", path, "--threshold-minutes", "30", "--now", "bad"])
        self._assert_condition(result.returncode != 0, "offline_invalid_now_fails")

    def test_offline_invalid_threshold_fails(self):
        path = self._json_input("offline-invalid-threshold.json", [])
        result = self._run([sys.executable, str(TWIN), "offline", "--input", path, "--threshold-minutes", "NaN", "--now", "2026-10-01T12:00:00Z"])
        self._assert_condition(result.returncode != 0, "offline_nonfinite_threshold_fails")

    def test_offline_negative_threshold_fails(self):
        path = self._json_input("offline-negative-threshold.json", [])
        result = self._run([sys.executable, str(TWIN), "offline", "--input", path, "--threshold-minutes", "-1", "--now", "2026-10-01T12:00:00Z"])
        self._assert_condition(result.returncode != 0, "offline_negative_threshold_fails")

    def test_offline_infinite_threshold_fails(self):
        path = self._json_input("offline-infinite-threshold.json", [])
        result = self._run([sys.executable, str(TWIN), "offline", "--input", path, "--threshold-minutes", "inf", "--now", "2026-10-01T12:00:00Z"])
        self._assert_condition(result.returncode != 0, "offline_infinite_threshold_fails")

    def test_telemetry_metric_parsing_and_output_file(self):
        out = self.root / "telemetry.json"
        result = self._run([sys.executable, str(TWIN), "telemetry-template", "--device-id", "synthetic-device", "--twin-id", "synthetic-twin", "--metric", "integer=7", "--metric", "decimal=2.5", "--metric", "label=warm", "--output", str(out)])
        data = json.loads(out.read_text(encoding="utf-8"))
        self._assert_condition(result.returncode == 0 and data["metrics"] == {"integer": 7, "decimal": 2.5, "label": "warm"}, "telemetry_parses_metric_types")
        self._assert_condition(data["deviceId"] == "synthetic-device" and data["digitalTwinId"] == "synthetic-twin", "telemetry_required_identifiers")
        self._assert_condition(parse_utc(data["observedAt"]) is not None, "telemetry_timestamp_is_utc")

    def test_telemetry_output_stdout(self):
        result = self._run([sys.executable, str(TWIN), "telemetry-template", "--device-id", "synthetic-device", "--twin-id", "synthetic-twin"])
        self._assert_condition(result.returncode == 0 and isinstance(json.loads(result.stdout), dict), "telemetry_writes_json_to_stdout")

    def test_telemetry_malformed_metric_fails(self):
        result = self._run([sys.executable, str(TWIN), "telemetry-template", "--device-id", "synthetic-device", "--twin-id", "synthetic-twin", "--metric", "missing-separator"])
        self._assert_condition(result.returncode != 0, "telemetry_malformed_metric_fails")

    def test_publish_default_reference_path_and_required_values(self):
        env = {"DEVICE_USER": "synthetic-user", "DEVICE_SECRET": "synthetic-secret", "DOMAIN_SHORT_ID": "synthetic-domain", "OCI_REGION": "us-test-1"}
        result = self._run(["bash", str(PUBLISH)], env)
        calls = self._calls()
        call = next((item for item in calls if item["command"] == "curl"), {})
        args = call.get("args", [])
        self._assert_condition(result.returncode == 0 and call != {}, "publish_default_succeeds")
        self._assert_condition(args[-1].endswith("/sampletopic"), "publish_default_reference_path")
        self._assert_condition("-u" in args and "synthetic-user:synthetic-secret" in args, "publish_basic_auth_supplied")

    def test_publish_reference_path_gets_one_leading_slash(self):
        env = {"DEVICE_USER": "synthetic-user", "DEVICE_SECRET": "synthetic-secret", "DOMAIN_SHORT_ID": "synthetic-domain", "OCI_REGION": "us-test-1", "REFERENCE_ENDPOINT": "nested/sample"}
        result = self._run(["bash", str(PUBLISH)], env)
        call = next((item for item in self._calls() if item["command"] == "curl"), {})
        args = call.get("args", [])
        self._assert_condition(result.returncode == 0 and args[-1].endswith("/nested/sample"), "publish_reference_path_constructed")

    def test_publish_multiple_leading_slashes_are_normalized(self):
        env = {"DEVICE_USER": "synthetic-user", "DEVICE_SECRET": "synthetic-secret", "DOMAIN_SHORT_ID": "synthetic-domain", "OCI_REGION": "us-test-1", "REFERENCE_ENDPOINT": "///nested/sample"}
        result = self._run(["bash", str(PUBLISH)], env)
        call = next((item for item in self._calls() if item["command"] == "curl"), {})
        args = call.get("args", [])
        self._assert_condition(result.returncode == 0 and args[-1].endswith("/nested/sample"), "publish_multiple_slashes_normalized")

    def test_publish_malformed_reference_fails_before_curl(self):
        values = {"DEVICE_USER": "synthetic-user", "DEVICE_SECRET": "synthetic-secret", "DOMAIN_SHORT_ID": "synthetic-domain", "OCI_REGION": "us-test-1"}
        for endpoint, label in (("https://other.invalid/path", "scheme"), ("/bad path", "whitespace")):
            with self.subTest(case=f"publish_malformed_{label}"):
                result = self._run(["bash", str(PUBLISH)], {**values, "REFERENCE_ENDPOINT": endpoint})
                self._assert_condition(result.returncode == 2 and not self._calls(), f"publish_malformed_{label}_rejected")

    def test_publish_empty_reference_uses_default_path(self):
        env = {"DEVICE_USER": "synthetic-user", "DEVICE_SECRET": "synthetic-secret", "DOMAIN_SHORT_ID": "synthetic-domain", "OCI_REGION": "us-test-1", "REFERENCE_ENDPOINT": ""}
        result = self._run(["bash", str(PUBLISH)], env)
        call = next((item for item in self._calls() if item["command"] == "curl"), {})
        self._assert_condition(result.returncode == 0 and call.get("args", [])[-1].endswith("/sampletopic"), "publish_empty_reference_uses_default")

    def test_publish_each_required_value_fails_before_curl(self):
        values = {"DEVICE_USER": "synthetic-user", "DEVICE_SECRET": "synthetic-secret", "DOMAIN_SHORT_ID": "synthetic-domain", "OCI_REGION": "us-test-1"}
        for missing in tuple(values):
            with self.subTest(case=f"publish_missing_{missing.lower()}"):
                env = {key: value for key, value in values.items() if key != missing}
                result = self._run(["bash", str(PUBLISH)], env)
                self._assert_condition(result.returncode != 0 and not any(c["command"] == "curl" for c in self._calls()), "publish_missing_required_rejected")
        for empty in tuple(values):
            with self.subTest(case=f"publish_empty_{empty.lower()}"):
                env = {**values, empty: ""}
                result = self._run(["bash", str(PUBLISH)], env)
                self._assert_condition(result.returncode != 0 and not any(c["command"] == "curl" for c in self._calls()), "publish_empty_required_rejected")

    def test_publish_curl_failure_propagates(self):
        env = {"DEVICE_USER": "synthetic-user", "DEVICE_SECRET": "synthetic-secret", "DOMAIN_SHORT_ID": "synthetic-domain", "OCI_REGION": "us-test-1", "MOCK_CURL_TRANSPORT_FAIL": "1"}
        result = self._run(["bash", str(PUBLISH)], env)
        self._assert_condition(result.returncode == 7, "publish_transport_failure_propagates")

    def test_publish_http_status_uses_curl_fail_semantics(self):
        values = {"DEVICE_USER": "synthetic-user", "DEVICE_SECRET": "synthetic-secret", "DOMAIN_SHORT_ID": "synthetic-domain", "OCI_REGION": "us-test-1"}
        for status, expected, label in (("200", 0, "success"), ("401", 22, "unauthorized")):
            with self.subTest(case=f"publish_http_{label}"):
                result = self._run(["bash", str(PUBLISH)], {**values, "MOCK_CURL_HTTP_STATUS": status})
                call = next((item for item in reversed(self._calls()) if item["command"] == "curl"), {})
                self._assert_condition(result.returncode == expected, f"publish_http_{label}_exit")
                self._assert_condition("--fail" in call.get("args", []), f"publish_http_{label}_curl_fail_flag")

    def test_publish_url_has_expected_https_host(self):
        env = {"DEVICE_USER": "synthetic-user", "DEVICE_SECRET": "synthetic-secret", "DOMAIN_SHORT_ID": "synthetic-domain", "OCI_REGION": "us-test-1"}
        self._run(["bash", str(PUBLISH)], env)
        call = next((item for item in self._calls() if item["command"] == "curl"), {})
        url = call.get("args", [])[-1]
        self._assert_condition(url.startswith("https://") and ".device.iot." in url and ".oci.oraclecloud.com/" in url, "publish_https_url_constructed")


def parse_utc(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else None


if __name__ == "__main__":
    unittest.main(verbosity=2)
