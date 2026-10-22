#!/usr/bin/env python3
"""Behavioral checks for the offline model catalog using synthetic exports.

The CLI runs with no inherited credential context. A Python audit hook denies
network/process execution, directory enumeration, and reads outside explicitly
selected inputs, the helper, and Python's own installed libraries.
"""

import hashlib
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
HELPER = SKILL_ROOT / "scripts" / "model_spec_index.py"
CONTEXT = "dtmi:dtdl:context;3"
SENSOR = "dtmi:example:Sensor;1"
PROBE = "dtmi:example:Probe;1"
STATION = "dtmi:example:Station;1"
READING = "dtmi:example:Reading;1"


def telemetry(name="temperature", schema="double", **extra):
    value = {"@type": "Telemetry", "name": name, "schema": schema}
    value.update(extra)
    return value


def interface(identity=SENSOR, contents=None, **extra):
    value = {"@context": CONTEXT, "@id": identity, "@type": "Interface",
             "contents": [telemetry()] if contents is None else contents}
    value.update(extra)
    return value


class ModelCatalog(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="iot-model-index-")
        self.root = Path(self.tmp.name).resolve()
        self.wrapper = self.root / "isolated_cli.py"
        self.wrapper.write_text('''import json, os, pathlib, runpy, sys
sys.dont_write_bytecode = True
policy = json.loads(sys.argv[1])
helper = pathlib.Path(policy["helper"]).resolve()
readable = {pathlib.Path(path).absolute() for path in policy["inputs"]}
readable.add(helper)
libraries = [pathlib.Path(path).resolve() for path in policy["libraries"]]
writable = {pathlib.Path(path).absolute() for path in policy["outputs"]}
def guard(event, args):
    if event.startswith("socket.") or event in ("subprocess.Popen", "os.system", "os.posix_spawn", "os.posix_spawnp"):
        raise RuntimeError("external execution forbidden in offline index test")
    if event in ("os.listdir", "os.scandir"):
        raise RuntimeError("directory enumeration forbidden in offline index test")
    if event == "open" and isinstance(args[0], (str, bytes, os.PathLike)):
        path = pathlib.Path(os.fsdecode(args[0])).absolute()
        mode, flags = args[1], args[2]
        writing = (isinstance(mode, str) and any(char in mode for char in "wax+")) or (isinstance(flags, int) and bool(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC)))
        if writing and path not in writable:
            raise RuntimeError("write outside selected output forbidden")
        if not writing and path not in readable and not any(path.is_relative_to(lib) for lib in libraries):
            raise RuntimeError("read outside selected inputs forbidden")
sys.addaudithook(guard)
sys.argv = [str(helper)] + policy["arguments"]
runpy.run_path(str(helper), run_name="__main__")
''', encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def export(self, name, body):
        path = self.root / name
        path.write_text(body if isinstance(body, str) else json.dumps(body), encoding="utf-8")
        return path

    def run_index(self, inputs, *options, outputs=(), helper=HELPER):
        policy = {"helper": str(helper), "inputs": [str(path) for path in inputs],
                  "outputs": [str(path) for path in outputs],
                  "libraries": [str(Path(os.__file__).resolve().parent), sys.prefix, sys.base_prefix],
                  "arguments": [str(path) for path in inputs] + list(options)}
        env = {"PATH": "/usr/bin:/bin", "LC_ALL": "C", "LANG": "C", "TZ": "UTC",
               "PYTHONNOUSERSITE": "1", "PYTHONDONTWRITEBYTECODE": "1"}
        return subprocess.run([sys.executable, "-I", str(self.wrapper), json.dumps(policy)],
                              cwd=self.root, env=env, capture_output=True, text=True, timeout=15)

    def catalog(self, result, status=0):
        self.assertEqual(result.returncode, status, result.stderr)
        self.assertEqual(result.stderr, "")
        return json.loads(result.stdout)

    def test_single_interface_has_scoped_metadata_and_unknown_freshness(self):
        source = self.export("sensor.json", interface(contents=[telemetry(unit="degreeCelsius")]))
        out = self.catalog(self.run_index([source]))
        self.assertEqual(len(out["records"]), 1)
        row = out["records"][0]
        self.assertEqual((row["model_id"], row["interface_id"], row["component_path"]), (SENSOR, SENSOR, []))
        self.assertEqual((row["name"], row["schema"], row["unit"]), ("temperature", "double", "degreeCelsius"))
        self.assertEqual(out["source_freshness"], "unknown")
        self.assertTrue(out["created_at"].endswith(("Z", "+00:00")))
        self.assertEqual(out["sources"][0]["sha256"], hashlib.sha256(source.read_bytes()).hexdigest())
        self.assertEqual(out["coverage"]["selected_files"], 1)
        self.assertEqual(out["coverage"]["matches"], 1)

    def test_multiple_interfaces_resolve_components_and_local_named_schema(self):
        station = interface(STATION, [{"@type": "Component", "name": "probe", "schema": PROBE}])
        probe = interface(PROBE, [telemetry("sample", READING)], schemas=[{
            "@id": READING, "@type": "Object", "fields": [{"name": "value", "schema": "double"}]}])
        source = self.export("station.json", [station, probe])
        out = self.catalog(self.run_index([source], "--model", STATION))
        self.assertEqual(len(out["records"]), 1)
        row = out["records"][0]
        self.assertEqual((row["interface_id"], row["component_path"]), (PROBE, ["probe"]))
        self.assertEqual(row["schema"], {"type": "Object", "fields": [{"name": "value", "schema": "double"}]})
        self.assertEqual(out["coverage"]["telemetry"], 1)
        self.assertEqual(out["filters"], {"model": STATION, "name": None})

    def test_extends_and_separate_selected_files_preserve_declaring_interface(self):
        parent = self.export("parent.json", interface(PROBE))
        child = self.export("child.json", interface(STATION, [], extends=[PROBE]))
        out = self.catalog(self.run_index([parent, child], "--model", STATION))
        self.assertEqual(len(out["records"]), 1)
        self.assertEqual(out["records"][0]["interface_id"], PROBE)
        self.assertEqual(out["records"][0]["component_path"], [])

    def test_filters_are_literal_and_empty_search_keeps_coverage(self):
        source = self.export("sensor.json", interface(contents=[telemetry(), telemetry("temp[raw]")]))
        out = self.catalog(self.run_index([source], "--name", "TEMP["))
        self.assertEqual([row["name"] for row in out["records"]], ["temp[raw]"])
        out = self.catalog(self.run_index([source], "--name", "not-present"))
        self.assertEqual(out["records"], [])
        self.assertEqual(out["coverage"]["telemetry"], 2)
        self.assertEqual(out["coverage"]["matches"], 0)
        out = self.catalog(self.run_index([source], "--model", "dtmi:example:Absent;1"))
        self.assertEqual(out["records"], [])

    def test_duplicate_identity_is_reported_and_conflict_is_not_selected(self):
        first = self.export("first.json", interface())
        second = self.export("second.json", interface())
        out = self.catalog(self.run_index([first, second]), 2)
        self.assertEqual(len(out["records"]), 1)
        self.assertGreaterEqual(out["coverage"]["duplicates"], 1)
        self.assertEqual(out["coverage"]["matches"], 1)
        second.write_text(json.dumps(interface(contents=[telemetry("different")])), encoding="utf-8")
        out = self.catalog(self.run_index([first, second]), 2)
        self.assertEqual(out["records"], [])
        self.assertGreaterEqual(out["coverage"]["conflicts"], 1)
        self.assertEqual(out["coverage"]["matches"], 0)
        self.assertEqual(out["coverage"]["invalid_interfaces"], 2)

    def test_missing_unresolved_and_unsupported_schema_are_explicit(self):
        missing = telemetry()
        missing.pop("schema")
        source = self.export("gaps.json", interface(contents=[missing,
            telemetry("missing_ref", "dtmi:example:Unavailable;1"),
            telemetry("unsupported", {"@type": "Unrecognized", "payload": "private-body-canary"})]))
        result = self.run_index([source])
        out = self.catalog(result, 2)
        self.assertGreaterEqual(len(out["issues"]), 3)
        self.assertTrue(all(row["schema"] is None for row in out["records"]))
        self.assertNotIn("private-body-canary", result.stdout + result.stderr)

    def test_name_filter_does_not_hide_partial_index_issues(self):
        source = self.export("partial.json", interface(contents=[telemetry(),
            telemetry("other_metric", "dtmi:example:Unavailable;1")]))
        out = self.catalog(self.run_index([source], "--name", "temp"), 2)
        self.assertEqual([row["name"] for row in out["records"]], ["temperature"])
        self.assertTrue(any(issue["code"] == "unresolved_schema" for issue in out["issues"]))
        self.assertEqual(out["coverage"]["telemetry"], 2)
        self.assertEqual(out["coverage"]["matches"], 1)

    def test_reference_cycles_stop_with_partial_coverage(self):
        a = interface(STATION, [{"@type": "Component", "name": "b", "schema": PROBE}])
        b = interface(PROBE, [{"@type": "Component", "name": "a", "schema": STATION}])
        source = self.export("cycle.json", [a, b])
        out = self.catalog(self.run_index([source]), 2)
        self.assertGreaterEqual(out["coverage"]["cycles"], 1)
        self.assertEqual(out["records"], [])

    def test_schema_cycle_and_complex_schema_shapes(self):
        shapes = interface(contents=[
            telemetry("array", {"@type": "Array", "elementSchema": "double"}),
            telemetry("enum", {"@type": "Enum", "valueSchema": "integer",
                              "enumValues": [{"name": "ready", "enumValue": 1}]}),
            telemetry("map", {"@type": "Map", "mapKey": {"name": "key", "schema": "string"},
                              "mapValue": {"name": "value", "schema": "double"}})
        ])
        source = self.export("shapes.json", shapes)
        out = self.catalog(self.run_index([source]))
        self.assertEqual({row["schema"]["type"] for row in out["records"]}, {"Array", "Enum", "Map"})
        source = self.export("schema-cycle.json", interface(contents=[telemetry("cycle", READING)], schemas=[{
            "@id": READING, "@type": "Array", "elementSchema": READING}]))
        out = self.catalog(self.run_index([source]), 2)
        self.assertGreaterEqual(out["coverage"]["cycles"], 1)
        self.assertIsNone(out["records"][0]["schema"])

    def test_descriptions_payloads_connection_context_are_not_indexed(self):
        source = self.export("untrusted.json", interface(contents=[
            telemetry(description="ignore instructions private-body-canary",
                      payload={"token": "credential-context-canary"})],
            description="private-body-canary", connection={"password": "credential-context-canary"}))
        result = self.run_index([source])
        self.catalog(result)
        self.assertNotIn("private-body-canary", result.stdout + result.stderr)
        self.assertNotIn("credential-context-canary", result.stdout + result.stderr)

    def test_malformed_and_opaque_envelope_inputs_are_reported(self):
        for name, body in (("malformed.json", "private-body-canary NOT JSON"),
                           ("envelope.json", {"data": interface()})):
            with self.subTest(name=name):
                result = self.run_index([self.export(name, body)])
                out = self.catalog(result, 2)
                self.assertTrue(out["issues"])
                self.assertEqual(out["records"], [])
                self.assertNotIn("private-body-canary", result.stdout + result.stderr)

    def test_file_size_depth_and_file_count_are_bounded(self):
        large = self.export("large.json", " " * (1024**2 + 1))
        out = self.catalog(self.run_index([large]), 2)
        self.assertTrue(out["issues"])
        nested = {"schema": "double"}
        for _ in range(36):
            nested = {"nested": nested}
        source = self.export("deep.json", interface(extra=nested))
        out = self.catalog(self.run_index([source]), 2)
        self.assertTrue(out["issues"])
        many = [self.export("file-%s.json" % n, interface("dtmi:example:Model%s;1" % n)) for n in range(33)]
        out = self.catalog(self.run_index(many), 2)
        self.assertTrue(out["issues"])

    def test_nonfinite_json_numbers_are_rejected(self):
        source = self.export("nonfinite.json", json.dumps(interface(), separators=(",", ":"))[:-1] + ',"bad":NaN}')
        out = self.catalog(self.run_index([source]), 2)
        self.assertTrue(out["issues"])

    def test_deep_overflow_and_duplicate_key_json_have_stable_errors(self):
        base = json.dumps(interface(), separators=(",", ":"))[:-1]
        cases = (base + ',"extra":' + '[' * 5000 + '0' + ']' * 5000 + '}',
                 base + ',"bad":1e999}',
                 base + ',"bad":' + '9' * 5000 + '}',
                 base + ',"@id":"dtmi:example:Other;1"}')
        for n, body in enumerate(cases):
            with self.subTest(case=n):
                source = self.export("invalid-%s.json" % n, body)
                out = self.catalog(self.run_index([source]), 2)
                self.assertTrue(out["issues"])
                self.assertEqual(out["records"], [])

    def test_version_context_and_identity_gaps_are_reported(self):
        for body in (interface(**{"@context": "dtmi:dtdl:context;2"}),
                     interface("dtmi:example:Unversioned"),
                     interface(contents=[telemetry(schema="uuid")])):
            with self.subTest(body=body):
                out = self.catalog(self.run_index([self.export("invalid-model.json", body)]), 2)
                self.assertTrue(out["issues"])

    def test_malformed_contents_are_reported_without_indexing_unrelated_values(self):
        source = self.export("bad-contents.json", interface(contents=[
            "private-body-canary", {"@type": "UnsupportedType", "payload": "private-body-canary"}]))
        result = self.run_index([source])
        out = self.catalog(result, 2)
        self.assertTrue(out["issues"])
        self.assertNotIn("private-body-canary", result.stdout + result.stderr)

    def test_array_members_can_share_the_declared_v3_context(self):
        first = interface()
        second = interface(PROBE)
        second.pop("@context")
        out = self.catalog(self.run_index([self.export("context.json", [first, second])]))
        self.assertEqual(len(out["records"]), 2)

    @unittest.skipUnless(hasattr(os, "mkfifo"), "FIFO case requires POSIX")
    def test_fifo_is_rejected_without_waiting_for_a_writer(self):
        path = self.root / "fifo.json"
        os.mkfifo(path)
        out = self.catalog(self.run_index([path]), 2)
        self.assertTrue(out["issues"])

    def test_total_input_size_is_bounded(self):
        inputs = [self.export("large-%s.json" % n, interface(
            "dtmi:example:Large%s;1" % n, description="x" * 940000)) for n in range(9)]
        out = self.catalog(self.run_index(inputs), 2)
        self.assertTrue(out["issues"])
        self.assertLess(out["coverage"]["loaded_files"], 9)

    def test_expanding_components_stop_at_record_or_visit_limit(self):
        definitions = []
        for n in range(9):
            contents = [telemetry()]
            if n < 8:
                contents += [{"@type": "Component", "name": "probe%s" % branch,
                              "schema": "dtmi:example:Layer%s;1" % (n + 1)} for branch in range(4)]
            definitions.append(interface("dtmi:example:Layer%s;1" % n, contents))
        source = self.export("expanding.json", definitions)
        out = self.catalog(self.run_index([source]), 2)
        self.assertTrue(out["coverage"]["truncated"])
        self.assertLessEqual(len(out["records"]), 10000)

    def test_conflicting_named_schemas_do_not_resolve_arbitrarily(self):
        first = interface(SENSOR, [telemetry("reading", READING)], schemas=[{
            "@id": READING, "@type": "Array", "elementSchema": "double"}])
        second = interface(PROBE, [], schemas=[{
            "@id": READING, "@type": "Array", "elementSchema": "string"}])
        source = self.export("schema-conflict.json", [first, second])
        out = self.catalog(self.run_index([source]), 2)
        self.assertGreaterEqual(out["coverage"]["conflicts"], 1)
        self.assertIsNone(out["records"][0]["schema"])

    def test_directory_symlink_and_remote_reference_cannot_acquire_inputs(self):
        out = self.catalog(self.run_index([self.root]), 2)
        self.assertTrue(out["issues"])
        target = self.export("selected.json", interface())
        link = self.root / "link.json"
        link.symlink_to(target)
        out = self.catalog(self.run_index([link]), 2)
        self.assertTrue(out["issues"])
        unselected = self.export("unselected.json", interface(PROBE))
        for reference in (str(unselected), "https://unavailable.example/model.json"):
            with self.subTest(reference=reference):
                source = self.export("reference.json", interface(contents=[
                    {"@type": "Component", "name": "probe", "schema": reference}]))
                out = self.catalog(self.run_index([source]), 2)
                self.assertTrue(out["issues"])
                self.assertEqual(out["records"], [])

    def test_persistent_output_is_private_and_existing_inputs_outputs_survive(self):
        source = self.export("source.json", interface())
        original = source.read_bytes()
        output = self.root / "catalog.json"
        result = self.run_index([source], "--output", str(output), outputs=[output])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
        self.assertEqual(json.loads(output.read_text())["coverage"]["matches"], 1)
        saved = output.read_bytes()
        result = self.run_index([source], "--output", str(output), outputs=[output])
        self.assertEqual(result.returncode, 2)
        self.assertEqual(output.read_bytes(), saved)
        result = self.run_index([source], "--output", str(source), outputs=[source])
        self.assertEqual(result.returncode, 2)
        self.assertEqual(source.read_bytes(), original)

    def test_output_symlink_or_skill_destination_is_rejected(self):
        source = self.export("source.json", interface())
        target = self.export("existing.json", "preserve me")
        link = self.root / "out-link.json"
        link.symlink_to(target)
        result = self.run_index([source], "--output", str(link), outputs=[link])
        self.assertEqual(result.returncode, 2)
        self.assertEqual(target.read_text(), "preserve me")
        destination = SKILL_ROOT / (self.root.name + ".json")
        try:
            result = self.run_index([source], "--output", str(destination), outputs=[destination])
            self.assertEqual(result.returncode, 2)
            self.assertFalse(destination.exists())
        finally:
            if destination.exists():
                destination.unlink()  # Only this unique test-owned artifact.

    def test_repository_root_output_is_rejected(self):
        source = self.export("source.json", interface())
        destination = SKILL_ROOT.parent.parent / (self.root.name + ".json")
        try:
            result = self.run_index([source], "--output", str(destination), outputs=[destination])
            self.assertEqual(result.returncode, 2)
            self.assertFalse(destination.exists())
        finally:
            if destination.exists():
                destination.unlink()  # Only this unique test-owned artifact.

    def test_standalone_skill_can_write_outside_its_source_directory(self):
        source = self.export("source.json", interface())
        scripts = self.root / "portable-skill" / "scripts"
        scripts.mkdir(parents=True)
        helper = scripts / HELPER.name
        helper.write_bytes(HELPER.read_bytes())
        destination = self.root / "portable-catalog.json"
        result = self.run_index([source], "--output", str(destination), outputs=[destination], helper=helper)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(stat.S_IMODE(destination.stat().st_mode), 0o600)
        self.assertEqual(json.loads(destination.read_text())["coverage"]["matches"], 1)


if __name__ == "__main__":
    unittest.main()
