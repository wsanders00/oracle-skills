#!/usr/bin/env python3
"""Build a bounded, offline search index from explicitly selected DTDL v3 models.

This is a metadata catalog, not a DTDL validator or OCI inventory tool.
"""

import argparse
import hashlib
import json
import math
import os
import re
import stat
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

MAX_FILES = 32
MAX_FILE_BYTES = 1024 * 1024
MAX_TOTAL_BYTES = 8 * 1024 * 1024
MAX_JSON_DEPTH = 32
MAX_JSON_NODES = 50_000
MAX_REFERENCE_HOPS = 16
MAX_RECORDS = 10_000
MAX_VISITS = 50_000

DTMI_RE = re.compile(r"^dtmi:[A-Za-z][A-Za-z0-9_]*(?::[A-Za-z][A-Za-z0-9_]*)*;[1-9][0-9]*$")
DTMI_MAX_LENGTH = 128
DTDL_V3_CONTEXT = "dtmi:dtdl:context;3"
PRIMITIVES = {
    "boolean", "date", "dateTime", "decimal", "double", "duration", "float",
    "integer", "long", "string", "time",
}


def is_dtmi(value: Any) -> bool:
    return (isinstance(value, str) and len(value) <= DTMI_MAX_LENGTH
            and DTMI_RE.fullmatch(value) is not None)


def json_object(pairs: List[Tuple[str, Any]]) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate key")
        result[key] = value
    return result


def bounded_int(raw: str) -> int:
    digits = raw[1:] if raw.startswith("-") else raw
    if len(digits) > 128:
        raise ValueError("integer limit")
    return int(raw)


def finite_float(raw: str) -> float:
    value = float(raw)
    if not math.isfinite(value):
        raise ValueError("non-finite number")
    return value


def context_strings(value: Any) -> List[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [entry for entry in value if isinstance(entry, str)]
    return []


def context_issue(value: Any, array_v3_context: bool) -> Optional[str]:
    if value is None:
        return None if array_v3_context else "missing_context"
    values = context_strings(value)
    dtdl_contexts = [entry for entry in values if entry.startswith("dtmi:dtdl:context;")]
    if any(entry != DTDL_V3_CONTEXT for entry in dtdl_contexts):
        return "unsupported_context"
    if DTDL_V3_CONTEXT in dtdl_contexts:
        return None
    return "invalid_context"


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def depth_and_nodes(value: Any) -> Tuple[int, int]:
    """Return maximum container depth and total JSON values, iteratively."""
    stack = [(value, 1)]
    maximum = 0
    count = 0
    while stack:
        current, depth = stack.pop()
        count += 1
        if isinstance(current, (dict, list)):
            maximum = max(maximum, depth)
            children = list(current.values()) if isinstance(current, dict) else current
            stack.extend((child, depth + 1) for child in children)
        if count > MAX_JSON_NODES or maximum > MAX_JSON_DEPTH:
            break
    return maximum, count


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Index telemetry metadata from explicitly selected local DTDL v3 Interface JSON files."
    )
    parser.add_argument("inputs", nargs="+", metavar="INPUT", help="Raw Interface object or array of Interface objects")
    parser.add_argument("--model", metavar="EXACT_DTMI", help="Include only the exact root Interface DTMI")
    parser.add_argument("--name", help="Case-insensitive literal substring of telemetry names")
    parser.add_argument("--output", metavar="NEW_PATH", help="Create a new JSON output file (exclusive, mode 0600)")
    return parser.parse_args()


class Catalog:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.issues: List[Dict[str, Any]] = []
        self.sources: List[Dict[str, Any]] = []
        self.definitions: Dict[str, Dict[str, Any]] = {}
        self.schemas: Dict[str, Dict[str, Any]] = {}
        self.source_by_model: Dict[str, str] = {}
        self.conflicted_interfaces = set()
        self.conflicted_schemas = set()
        self.duplicate_count = 0
        self.conflict_count = 0
        self.selected_interfaces = 0
        self.invalid_interfaces = 0
        self.invalid_files = 0
        self.selected_files = len(args.inputs)
        self.loaded_files = 0
        self.telemetry_count = 0
        self.truncated = False
        self.record_limit_reported = False
        self.bytes_total = 0
        self.visits = 0
        self.visit_limit_reported = False
        self.records: List[Dict[str, Any]] = []
        self.record_by_identity: Dict[Tuple[str, str, Tuple[str, ...], str], Dict[str, Any]] = {}
        self.conflicted_records = set()

    def issue(self, code: str, source: Optional[str] = None, **safe_fields: Any) -> None:
        item: Dict[str, Any] = {"code": code}
        if source is not None:
            item["source"] = source
        for key in ("model_id", "interface_id", "schema_id", "name", "component_path"):
            value = safe_fields.get(key)
            if value is not None:
                item[key] = value
        self.issues.append(item)

    def read_inputs(self) -> None:
        if len(self.args.inputs) > MAX_FILES:
            self.truncated = True
            self.issue("file_limit_exceeded")
        for raw_path in self.args.inputs[:MAX_FILES]:
            display_path = raw_path
            remaining = MAX_TOTAL_BYTES - self.bytes_total
            try:
                nofollow = getattr(os, "O_NOFOLLOW", 0)
                flags = os.O_RDONLY | getattr(os, "O_NONBLOCK", 0) | nofollow
                before = None
                if not nofollow:
                    before = os.lstat(raw_path)
                    if stat.S_ISLNK(before.st_mode):
                        raise OSError("symlink input")
                fd = os.open(raw_path, flags)
                try:
                    info = os.fstat(fd)
                    if before is not None and (info.st_dev, info.st_ino) != (before.st_dev, before.st_ino):
                        self.invalid_files += 1
                        self.issue("input_unavailable", display_path)
                        continue
                    if not stat.S_ISREG(info.st_mode):
                        self.invalid_files += 1
                        self.issue("input_not_regular_file", display_path)
                        continue
                    if remaining < 0:
                        remaining = 0
                    max_read = min(MAX_FILE_BYTES, remaining) + 1
                    chunks = []
                    total = 0
                    while total < max_read:
                        part = os.read(fd, max_read - total)
                        if not part:
                            break
                        chunks.append(part)
                        total += len(part)
                    raw = b"".join(chunks)
                finally:
                    os.close(fd)
            except OSError:
                self.invalid_files += 1
                self.issue("input_unavailable", display_path)
                continue

            if len(raw) > MAX_FILE_BYTES:
                self.invalid_files += 1
                self.issue("file_size_limit_exceeded", display_path)
                continue
            if len(raw) > remaining:
                self.invalid_files += 1
                self.issue("total_size_limit_exceeded", display_path)
                continue
            self.bytes_total += len(raw)
            source = {"path": display_path, "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}
            self.sources.append(source)
            try:
                text = raw.decode("utf-8")
                payload = json.loads(
                    text,
                    parse_constant=lambda _: (_ for _ in ()).throw(ValueError("constant")),
                    parse_int=bounded_int,
                    parse_float=finite_float,
                    object_pairs_hook=json_object,
                )
            except RecursionError:
                self.invalid_files += 1
                self.issue("json_complexity_limit_exceeded", display_path)
                continue
            except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
                self.invalid_files += 1
                self.issue("invalid_json", display_path)
                continue
            max_depth, nodes = depth_and_nodes(payload)
            if max_depth > MAX_JSON_DEPTH or nodes > MAX_JSON_NODES:
                self.invalid_files += 1
                self.issue("json_complexity_limit_exceeded", display_path)
                continue
            if isinstance(payload, dict):
                payload_items = [payload]
                array_v3_context = False
            elif isinstance(payload, list):
                payload_items = payload
                array_v3_context = any(
                    self.is_interface(item) and context_issue(item.get("@context"), False) is None
                    for item in payload_items
                )
            else:
                self.invalid_files += 1
                self.issue("unsupported_input_shape", display_path)
                continue
            self.loaded_files += 1
            for item in payload_items:
                self.add_interface(item, display_path, array_v3_context)
        if self.args.model and not is_dtmi(self.args.model):
            self.issue("invalid_model_filter")

    @staticmethod
    def is_interface(item: Any) -> bool:
        if not isinstance(item, dict):
            return False
        kind = item.get("@type")
        return kind == "Interface" or (isinstance(kind, list) and "Interface" in kind)

    def add_interface(self, item: Any, source: str, array_v3_context: bool = False) -> None:
        if not self.is_interface(item):
            self.invalid_interfaces += 1
            self.issue("invalid_interface_definition", source)
            return
        self.selected_interfaces += 1
        invalid_context = context_issue(item.get("@context"), array_v3_context)
        if invalid_context:
            self.invalid_interfaces += 1
            self.issue(invalid_context, source)
            return
        model_id = item.get("@id")
        if not is_dtmi(model_id) or not isinstance(item.get("contents", []), list):
            self.invalid_interfaces += 1
            self.issue("invalid_interface_definition", source)
            return
        existing = self.definitions.get(model_id)
        if existing is None and model_id not in self.conflicted_interfaces:
            self.definitions[model_id] = {"item": item, "source": source}
            self.source_by_model[model_id] = source
        elif model_id in self.conflicted_interfaces:
            self.invalid_interfaces += 1
            return
        elif canonical(existing["item"]) == canonical(item):
            self.duplicate_count += 1
            self.issue("duplicate_interface", source, model_id=model_id)
        else:
            self.conflicted_interfaces.add(model_id)
            self.definitions.pop(model_id, None)
            self.source_by_model.pop(model_id, None)
            self.conflict_count += 1
            self.invalid_interfaces += 2
            self.issue("conflicting_interface", source, model_id=model_id)

        schemas = item.get("schemas", [])
        if schemas is None:
            schemas = []
        if not isinstance(schemas, list):
            self.issue("invalid_schema_collection", source, model_id=model_id)
            return
        for schema in schemas:
            if not isinstance(schema, dict):
                self.issue("invalid_schema_definition", source, model_id=model_id)
                continue
            schema_id = schema.get("@id")
            if not is_dtmi(schema_id):
                # Anonymous inline schemas are handled at their use site.
                continue
            old = self.schemas.get(schema_id)
            if old is None and schema_id not in self.conflicted_schemas:
                self.schemas[schema_id] = {"item": schema, "source": source}
            elif schema_id in self.conflicted_schemas:
                continue
            elif canonical(old["item"]) == canonical(schema):
                self.duplicate_count += 1
                self.issue("duplicate_schema", source, model_id=model_id, schema_id=schema_id)
            else:
                self.conflicted_schemas.add(schema_id)
                self.schemas.pop(schema_id, None)
                self.conflict_count += 1
                self.issue("conflicting_schema", source, model_id=model_id, schema_id=schema_id)

    @staticmethod
    def type_names(value: Any) -> List[str]:
        if isinstance(value, str):
            return [value]
        if isinstance(value, list):
            return sorted({entry for entry in value if isinstance(entry, str)})
        return []

    def resolve_schema(self, value: Any, source: str, model_id: str, interface_id: str,
                       component_path: Sequence[str], name: str,
                       seen: Optional[set] = None, hops: int = 0) -> Optional[Any]:
        self.visits += 1
        if self.visits > MAX_VISITS:
            self.truncated = True
            if not self.visit_limit_reported:
                self.visit_limit_reported = True
                self.issue("schema_traversal_limit_exceeded", source, model_id=model_id,
                           interface_id=interface_id, component_path=list(component_path), name=name)
            return None
        if hops > MAX_REFERENCE_HOPS:
            self.issue("schema_reference_limit_exceeded", source, model_id=model_id,
                       interface_id=interface_id, component_path=list(component_path), name=name)
            return None
        if isinstance(value, str):
            if value in PRIMITIVES:
                return value
            if not is_dtmi(value):
                self.issue("unsupported_schema", source, model_id=model_id,
                           interface_id=interface_id, component_path=list(component_path), name=name)
                return None
            if value in self.conflicted_schemas or value in self.conflicted_interfaces:
                self.issue("conflicting_schema_reference", source, model_id=model_id,
                           interface_id=interface_id, component_path=list(component_path), name=name)
                return None
            target = self.schemas.get(value) or self.definitions.get(value)
            if target is None:
                self.issue("unresolved_schema", source, model_id=model_id,
                           interface_id=interface_id, component_path=list(component_path), name=name)
                return None
            seen = set(seen or ())
            if value in seen:
                self.issue("schema_reference_cycle", source, model_id=model_id,
                           interface_id=interface_id, component_path=list(component_path), name=name)
                return None
            seen.add(value)
            return self.resolve_schema(target["item"], source, model_id, interface_id,
                                       component_path, name, seen, hops + 1)
        if not isinstance(value, dict):
            self.issue("unsupported_schema", source, model_id=model_id,
                       interface_id=interface_id, component_path=list(component_path), name=name)
            return None

        kind = value.get("@type")
        if isinstance(kind, list):
            kind = next((entry for entry in kind if entry in ("Object", "Array", "Enum", "Map")), None)
        if kind == "Object":
            fields = value.get("fields")
            if not isinstance(fields, list):
                self.issue("unsupported_schema", source, model_id=model_id,
                           interface_id=interface_id, component_path=list(component_path), name=name)
                return None
            safe_fields = []
            for field in fields:
                if not isinstance(field, dict) or not isinstance(field.get("name"), str):
                    self.issue("unsupported_schema", source, model_id=model_id,
                               interface_id=interface_id, component_path=list(component_path), name=name)
                    return None
                field_schema = self.resolve_schema(field.get("schema"), source, model_id, interface_id,
                                                   component_path, name, seen, hops)
                if field_schema is None:
                    return None
                safe_fields.append({"name": field["name"], "schema": field_schema})
            return {"type": "Object", "fields": safe_fields}
        if kind == "Array":
            element = self.resolve_schema(value.get("elementSchema"), source, model_id, interface_id,
                                          component_path, name, seen, hops)
            return None if element is None else {"type": "Array", "element_schema": element}
        if kind == "Enum":
            value_schema = self.resolve_schema(value.get("valueSchema"), source, model_id, interface_id,
                                               component_path, name, seen, hops)
            enum_values = value.get("enumValues")
            if value_schema is None or not isinstance(enum_values, list):
                self.issue("unsupported_schema", source, model_id=model_id,
                           interface_id=interface_id, component_path=list(component_path), name=name)
                return None
            safe_values = []
            for enum_value in enum_values:
                if (not isinstance(enum_value, dict) or not isinstance(enum_value.get("name"), str)
                        or not isinstance(enum_value.get("enumValue"), (str, int))
                        or isinstance(enum_value.get("enumValue"), bool)):
                    self.issue("unsupported_schema", source, model_id=model_id,
                               interface_id=interface_id, component_path=list(component_path), name=name)
                    return None
                safe_values.append({"name": enum_value["name"], "value": enum_value["enumValue"]})
            return {"type": "Enum", "value_schema": value_schema, "values": safe_values}
        if kind == "Map":
            map_key = value.get("mapKey")
            map_value = value.get("mapValue")
            safe_pair = []
            for pair in (map_key, map_value):
                if not isinstance(pair, dict) or not isinstance(pair.get("name"), str):
                    self.issue("unsupported_schema", source, model_id=model_id,
                               interface_id=interface_id, component_path=list(component_path), name=name)
                    return None
                pair_schema = self.resolve_schema(pair.get("schema"), source, model_id, interface_id,
                                                  component_path, name, seen, hops)
                if pair_schema is None:
                    return None
                safe_pair.append({"name": pair["name"], "schema": pair_schema})
            return {"type": "Map", "key": safe_pair[0], "value": safe_pair[1]}
        self.issue("unsupported_schema", source, model_id=model_id,
                   interface_id=interface_id, component_path=list(component_path), name=name)
        return None

    def append_record(self, model_id: str, interface_id: str, component_path: Sequence[str],
                      content: Dict[str, Any], fallback_source: str) -> None:
        name = content.get("name")
        self.telemetry_count += 1
        if self.telemetry_count > MAX_RECORDS:
            self.truncated = True
            if not self.record_limit_reported:
                self.record_limit_reported = True
                self.issue("record_limit_exceeded", fallback_source, model_id=model_id,
                           interface_id=interface_id, component_path=list(component_path),
                           name=name if isinstance(name, str) else None)
            return
        if not isinstance(name, str) or not name:
            self.issue("invalid_telemetry_definition", fallback_source,
                       model_id=model_id, interface_id=interface_id,
                       component_path=list(component_path))
            return
        source = self.source_by_model.get(interface_id, fallback_source)
        if "schema" not in content or content.get("schema") is None:
            schema = None
            self.issue("missing_schema", source, model_id=model_id, interface_id=interface_id,
                       component_path=list(component_path), name=name)
        else:
            before = len(self.issues)
            schema = self.resolve_schema(content.get("schema"), source, model_id, interface_id,
                                         component_path, name)
            if schema is None and len(self.issues) == before:
                self.issue("unsupported_schema", source, model_id=model_id,
                           interface_id=interface_id, component_path=list(component_path), name=name)
        types = self.type_names(content.get("@type"))
        unit = content.get("unit") if isinstance(content.get("unit"), str) else None
        record = {
            "model_id": model_id,
            "interface_id": interface_id,
            "component_path": list(component_path),
            "name": name,
            "types": types,
            "unit": unit,
            "schema": schema,
            "source": source,
        }
        identity = (model_id, interface_id, tuple(component_path), name)
        if identity in self.conflicted_records:
            return
        previous = self.record_by_identity.get(identity)
        if previous is not None:
            if canonical(previous) == canonical(record):
                self.duplicate_count += 1
                self.issue("duplicate_telemetry", source, model_id=model_id,
                           interface_id=interface_id, component_path=list(component_path), name=name)
            else:
                self.record_by_identity.pop(identity, None)
                self.conflicted_records.add(identity)
                self.records.remove(previous)
                self.conflict_count += 1
                self.issue("conflicting_telemetry", source, model_id=model_id,
                           interface_id=interface_id, component_path=list(component_path), name=name)
            return
        if len(self.records) >= MAX_RECORDS:
            self.truncated = True
            if not self.record_limit_reported:
                self.record_limit_reported = True
                self.issue("record_limit_exceeded", source, model_id=model_id,
                           interface_id=interface_id, component_path=list(component_path), name=name)
            return
        self.record_by_identity[identity] = record
        self.records.append(record)

    def traverse_interface(self, root_id: str, interface_id: str, component_path: Sequence[str],
                           stack: Sequence[str], depth: int) -> None:
        if self.truncated:
            return
        self.visits += 1
        if self.visits > MAX_VISITS:
            self.truncated = True
            if not self.visit_limit_reported:
                self.visit_limit_reported = True
                self.issue("traversal_limit_exceeded", self.source_by_model.get(root_id), model_id=root_id)
            return
        if depth > MAX_REFERENCE_HOPS:
            self.issue("reference_limit_exceeded", self.source_by_model.get(root_id), model_id=root_id,
                       interface_id=interface_id, component_path=list(component_path))
            return
        if interface_id in stack:
            self.issue("reference_cycle", self.source_by_model.get(root_id), model_id=root_id,
                       interface_id=interface_id, component_path=list(component_path))
            return
        definition = self.definitions.get(interface_id)
        if definition is None:
            code = "conflicting_interface_reference" if interface_id in self.conflicted_interfaces else "unresolved_interface"
            self.issue(code, self.source_by_model.get(root_id), model_id=root_id,
                       interface_id=interface_id, component_path=list(component_path))
            return
        source = definition["source"]
        interface = definition["item"]
        next_stack = tuple(stack) + (interface_id,)
        extends = interface.get("extends", [])
        if isinstance(extends, str):
            extends = [extends]
        if extends is not None:
            if not isinstance(extends, list):
                self.issue("invalid_interface_reference", source, model_id=root_id, interface_id=interface_id)
            else:
                for parent in extends:
                    if not is_dtmi(parent):
                        self.issue("invalid_interface_reference", source, model_id=root_id, interface_id=interface_id)
                        continue
                    self.traverse_interface(root_id, parent, component_path, next_stack, depth + 1)
        contents = interface.get("contents", [])
        if not isinstance(contents, list):
            self.issue("invalid_contents", source, model_id=root_id, interface_id=interface_id)
            contents = []
        for content in contents:
            if not isinstance(content, dict):
                self.issue("invalid_content", source, model_id=root_id, interface_id=interface_id)
                continue
            kind = self.type_names(content.get("@type"))
            if "Telemetry" in kind:
                self.append_record(root_id, interface_id, component_path, content, source)
            elif "Component" in kind:
                component_name = content.get("name")
                target = content.get("schema")
                if not isinstance(component_name, str) or not component_name:
                    self.issue("invalid_component_definition", source, model_id=root_id, interface_id=interface_id)
                elif not is_dtmi(target):
                    self.issue("unsupported_component_schema", source, model_id=root_id,
                               interface_id=interface_id, name=component_name)
                else:
                    self.traverse_interface(root_id, target, list(component_path) + [component_name],
                                            next_stack, depth + 1)
            elif not any(entry in kind for entry in ("Property", "Relationship", "Command")):
                self.issue("unsupported_content", source, model_id=root_id, interface_id=interface_id)
            if self.truncated:
                break

    def build(self) -> Dict[str, Any]:
        self.read_inputs()
        roots = sorted(self.definitions)
        if self.args.model:
            roots = [self.args.model] if is_dtmi(self.args.model) and self.args.model in self.definitions else []
        for model_id in roots:
            if self.truncated:
                break
            self.traverse_interface(model_id, model_id, [], (), 0)
        records = [record for record in self.records
                   if not self.args.name or self.args.name.casefold() in record["name"].casefold()]
        records.sort(key=lambda row: (
            row["model_id"], row["interface_id"], row["component_path"], row["name"]
        ))
        return {
            "catalog_version": 1,
            "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "source_freshness": "unknown",
            "filters": {"model": self.args.model, "name": self.args.name},
            "sources": self.sources,
            "coverage": {
                "selected_files": self.selected_files,
                "loaded_files": self.loaded_files,
                "invalid_files": self.invalid_files,
                "selected_interfaces": self.selected_interfaces,
                "loaded_interfaces": len(self.definitions),
                "invalid_interfaces": self.invalid_interfaces,
                "telemetry": self.telemetry_count,
                "matches": len(records),
                "errors": len(self.issues),
                "cycles": sum(1 for item in self.issues if item["code"] in ("reference_cycle", "schema_reference_cycle")),
                "duplicates": self.duplicate_count,
                "conflicts": self.conflict_count,
                "truncated": self.truncated,
            },
            "records": records,
            "issues": self.issues,
        }


def output_path(path_text: str, checkout_root: Path, payload: str) -> int:
    """Write is handled separately; return a stable failure code on unsafe paths."""
    path = Path(path_text)
    try:
        # Require existing, non-symlink parent components and an absent final path.
        absolute = path.absolute()
        cursor = Path(absolute.anchor)
        for part in absolute.parts[1:-1]:
            cursor = cursor / part
            if cursor.is_symlink():
                return 1
        parent = absolute.parent
        if not parent.is_dir() or parent.is_symlink():
            return 1
        resolved_parent = parent.resolve(strict=True)
        resolved_checkout = checkout_root.resolve(strict=True)
        if resolved_parent == resolved_checkout or resolved_checkout in resolved_parent.parents:
            return 1
        if absolute.exists() or absolute.is_symlink():
            return 1
        fd = os.open(absolute, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
        except Exception:
            try:
                os.unlink(absolute)
            except OSError:
                pass
            return 1
        return 0
    except OSError:
        return 1


def main() -> int:
    args = parse_args()
    catalog = Catalog(args)
    result = catalog.build()
    rendered = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
    if args.output:
        skill_root = Path(__file__).resolve().parents[1]
        if skill_root.name == "iot-platform" and skill_root.parent.name == "oci":
            excluded_root = skill_root.parent.parent
        else:
            excluded_root = skill_root
        if output_path(args.output, excluded_root, rendered) != 0:
            # Stable, data-only failure. Never include exception text or file contents.
            print(json.dumps({"error": "unsafe_or_unavailable_output"}), file=sys.stderr)
            return 2
    else:
        sys.stdout.write(rendered)
    return 2 if result["coverage"]["errors"] or result["coverage"]["truncated"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
