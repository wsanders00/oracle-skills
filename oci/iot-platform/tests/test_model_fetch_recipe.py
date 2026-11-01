#!/usr/bin/env python3
"""Execute the marked selected-model recipe with contract-bound offline OCI.

The projected fixtures model CLI --query data, not a claim of live OCI coverage.
Only the selected interpreter and mock CLI execute in isolated HOME/config.
"""
import json
import os
import re
import shlex
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parents[1]
REFERENCE = SKILL_ROOT / "references" / "cli-workflows.md"
CONTEXT = "dtmi:dtdl:context;3"
A = "ocid1.digitaltwinmodel.oc1..synthetic-a"
B = "ocid1.digitaltwinmodel.oc1..synthetic-b"
PARENT = "dtmi:example:Parent;1.1"
CHILD = "dtmi:example:Child;1.1"


def interface(identity=CHILD, **extra):
    return {"@context": CONTEXT, "@id": identity, "@type": "Interface",
            "contents": [{"@type": "Telemetry", "name": "temperature", "schema": "double"}],
            **extra}


def recipe(name):
    match = re.search(r"<!-- recipe: MODEL-FETCH-" + name + r" -->\s*```bash\n(.*?)\n```",
                      REFERENCE.read_text(), re.S)
    if not match:
        raise AssertionError("missing executable recipe " + name)
    return match[1]


class ModelFetchRecipe(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="iot-model-recipe-")
        self.root = Path(self.tmp.name).resolve()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        (self.bin / "python3").symlink_to(sys.executable)
        (self.root / "scripts").symlink_to(SKILL_ROOT / "scripts", target_is_directory=True)
        self.home = self.root / "home"
        self.home.mkdir()
        self.calls = self.root / "calls.jsonl"
        self.fixtures = self.root / "fixtures.json"
        guard = self.root / "guard"
        guard.mkdir()
        # Deny credential/config reads outside this fixture and all networking;
        # imports may read only the skill, fixture and installed Python libraries.
        allowed = [str(self.root), str(SKILL_ROOT), str(Path(os.__file__).resolve().parent), sys.prefix, sys.base_prefix]
        (guard / "sitecustomize.py").write_text('''import os, sys
roots = ''' + repr(allowed) + '''
def guard(event, args):
    if event.startswith("socket.") or event in ("subprocess.Popen", "os.system", "os.posix_spawn", "os.posix_spawnp"):
        raise RuntimeError("external operation forbidden")
    if event == "open" and isinstance(args[0], (str, bytes, os.PathLike)):
        path = os.path.abspath(os.fsdecode(args[0]))
        if not any(path == root or path.startswith(root + os.sep) for root in roots):
            raise RuntimeError("read outside isolated recipe forbidden")
sys.addaudithook(guard)
''')
        mock = self.bin / "oci"
        mock.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
fixtures = json.loads(pathlib.Path(os.environ["MOCK_FIXTURES"]).read_text())
identity = args[args.index("--digital-twin-model-id") + 1]
expected = json.loads(os.environ["MOCK_GLOBAL_ARGS"]) + [
    "--region", "us-test-1", "--no-retry", "--connection-timeout", "10",
    "--read-timeout", "60", "iot", "digital-twin-model", "get-spec",
    "--digital-twin-model-id", identity, "--query", "data", "--output", "json"]
assert args == expected, args
assert identity in fixtures, "unselected request"
with open(os.environ["MOCK_CALLS"], "a") as out:
    out.write(json.dumps(args) + "\\n")
entry = fixtures[identity]
sys.stdout.write(entry["body"])
sys.stderr.write("private-service-error-canary")
sys.exit(entry.get("exit", 0))
''')
        mock.chmod(0o700)
        self.env = {"PATH": str(self.bin) + ":/usr/bin:/bin", "HOME": str(self.home),
                    "OCI_CLI_CONFIG_FILE": str(self.home / "config"), "TMPDIR": str(self.root),
                    "LANG": "C", "LC_ALL": "C", "TZ": "UTC",
                    "PYTHONPATH": str(guard), "PYTHONNOUSERSITE": "1", "PYTHONDONTWRITEBYTECODE": "1",
                    "MOCK_FIXTURES": str(self.fixtures), "MOCK_CALLS": str(self.calls)}
        self.existing = self.root / "existing.json"
        self.existing.write_text("preserve-existing-file")

    def tearDown(self):
        self.tmp.cleanup()

    def run_recipe(self, responses, selections=(A,), name=None, globals=("--auth", "instance_principal")):
        self.fixtures.write_text(json.dumps({key: {"body": value if isinstance(value, str) else json.dumps(value)}
                                           if not isinstance(value, tuple) else {"body": value[0], "exit": value[1]}
                                           for key, value in responses.items()}))
        env = dict(self.env, MOCK_GLOBAL_ARGS=json.dumps(globals))
        select = recipe("SELECT").replace("<oci_region>", "us-test-1")
        code = "OCI_CLI_GLOBAL_ARGS=(" + " ".join(map(shlex.quote, globals)) + ")\n" + recipe("SETUP").replace("/tmp/iot-model-fetch.", str(self.root / "iot-model-fetch.")) + "\n"
        code += "\n".join(select.replace("<model_ocid>", key) for key in selections) + "\n"
        catalog = recipe("CATALOG")
        if name:
            catalog += " --name " + shlex.quote(name)
        result = subprocess.run(["/bin/bash", "-c", code + catalog], cwd=self.root, env=env,
                                text=True, capture_output=True, timeout=15)
        self.assertEqual(self.existing.read_text(), "preserve-existing-file")
        self.assertNotIn("private-service-error-canary", result.stdout + result.stderr)
        calls = [json.loads(row) for row in self.calls.read_text().splitlines()]
        self.assertEqual([c[c.index("--digital-twin-model-id") + 1] for c in calls], list(selections))
        self.summaries = re.findall(r"selected=(\S+) status=exported path=(\S+)", result.stdout)
        for identity, filename in self.summaries:
            self.assertIn(identity, selections)
            path = Path(filename)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(path.parent.stat().st_mode), 0o700)
            self.assertEqual(path.read_text(), self.body(responses[identity]))
        return result

    @staticmethod
    def body(value):
        return value[0] if isinstance(value, tuple) else value if isinstance(value, str) else json.dumps(value)

    def catalog(self, result, status=0):
        self.assertEqual(result.returncode, status, result.stderr)
        out = json.loads(result.stdout[result.stdout.index("{"):])
        self.assertEqual([source["path"] for source in out["sources"]],
                         [filename for _, filename in self.summaries])
        return out

    def test_single_minor_success_preserves_full_spec_and_maps_path(self):
        value = interface(description="private-full-spec-field", properties={"retained": True})
        out = self.catalog(self.run_recipe({A: value}))
        self.assertEqual(out["records"][0]["model_id"], CHILD)
        self.assertEqual(out["coverage"]["selected_files"], 1)
        self.assertEqual([key for key, _ in self.summaries], [A])
        self.assertNotIn("private-full-spec-field", json.dumps(out))

    def test_two_selected_references_resolve_with_same_auth_region(self):
        out = self.catalog(self.run_recipe({A: interface(contents=[], extends=[PARENT]), B: interface(PARENT)},
                                          (A, B), globals=("--profile", "synthetic", "--auth", "security_token")))
        self.assertEqual(out["issues"], [])
        self.assertEqual(out["coverage"]["selected_files"], 2)
        self.assertEqual([key for key, _ in self.summaries], [A, B])
        self.assertTrue(any(row["model_id"] == CHILD and row["interface_id"] == PARENT for row in out["records"]))

    def test_wrong_projected_outputs_and_failed_commands_stop_before_catalog(self):
        cases = [(json.dumps(interface()), 1), "", "null", "not json", {"data": interface()},
                 42, "true", [], [{"@type": "Telemetry"}], json.dumps(interface()) + " " * (1024**2 + 1)]
        for value in cases:
            with self.subTest(value=str(value)[:60]):
                if self.calls.exists():
                    self.calls.unlink()
                result = self.run_recipe({A: value})
                self.assertEqual(result.returncode, 1)
                self.assertIn("zero successful exports", result.stderr)
                self.assertNotIn("catalog_version", result.stdout)
                self.assertEqual(self.summaries, [])
                self.assertIn("status=failed", result.stdout)

    def test_mixed_success_and_failure_includes_only_success(self):
        out = self.catalog(self.run_recipe({A: interface(), B: (json.dumps(interface(PARENT)), 2)}, (A, B)))
        self.assertEqual(out["coverage"]["selected_files"], 1)
        self.assertEqual([key for key, _ in self.summaries], [A])

    def test_unresolved_reference_is_partial_coverage(self):
        out = self.catalog(self.run_recipe({A: interface(contents=[], extends=[PARENT])}), 2)
        self.assertTrue(out["issues"])
        self.assertEqual(out["records"], [])

    def test_successful_no_match_and_array_export(self):
        out = self.catalog(self.run_recipe({A: [interface()]}, name="no-such-name", globals=()))
        self.assertEqual(out["records"], [])
        self.assertEqual(out["issues"], [])
        self.assertEqual(out["source_freshness"], "unknown")

    def test_all_failed_selections(self):
        result = self.run_recipe({A: "null", B: ("private-failure-output", 1)}, (A, B))
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("catalog_version", result.stdout)
        self.assertNotIn("private-failure-output", result.stdout + result.stderr)

    def test_fixture_guard_denies_network_and_outside_config_reads(self):
        for script in ("import socket; socket.socket()", "open('/unselected-recipe-config/config')"):
            result = subprocess.run([str(self.bin / "python3"), "-c", script], env=self.env,
                                    cwd=self.root, text=True, capture_output=True, timeout=5)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("forbidden", result.stderr)


if __name__ == "__main__":
    unittest.main()
