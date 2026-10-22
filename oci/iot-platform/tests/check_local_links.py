#!/usr/bin/env python3
"""Check local Markdown targets in the installed skill without network access."""

import json
import re
from pathlib import Path
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parent.parent


def heading_slugs(path):
    slugs, seen = set(), {}
    fenced = False
    for line in path.read_text(encoding="utf-8").splitlines():
        if re.match(r"^\s*(```|~~~)", line):
            fenced = not fenced
            continue
        if fenced:
            continue
        match = re.match(r"^#{1,6}\s+(.+?)\s*#*$", line)
        if match:
            slug = re.sub(r"\s", "-", re.sub(r"[^\w\s-]", "", match[1].lower()))
            count = seen.get(slug, 0)
            seen[slug] = count + 1
            slugs.add(slug + (f"-{count}" if count else ""))
    return slugs


def main():
    failures, count, anchor_count = [], 0, 0
    files = sorted(ROOT.rglob("*.md"))
    for path in files:
        if path.is_symlink() or not path.resolve().is_relative_to(ROOT):
            failures.append({"file": str(path.relative_to(ROOT)), "reason": "symlink"})
            continue
        content = path.read_text(encoding="utf-8")
        targets = list(re.finditer(r"\[[^\]\n]*\]\(([^)\n]+)\)", content))
        targets += list(re.finditer(r"^\s*\[[^\]]+\]:\s*(\S+)", content, re.MULTILINE))
        for match in targets:
            url = match[1].strip().split(' "', 1)[0].strip("<>")
            if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", url) or url.startswith("//"):
                continue
            count += 1
            name, _, fragment = url.partition("#")
            relative = Path(unquote(name))
            target = (path.parent / relative).resolve() if name else path.resolve()
            reason = None
            if relative.is_absolute() or not target.is_relative_to(ROOT):
                reason = "target outside installed skill"
            elif not target.is_file():
                reason = "missing target"
            elif fragment and target.suffix == ".md":
                anchor_count += 1
                if unquote(fragment) not in heading_slugs(target):
                    reason = "missing heading"
            if reason:
                failures.append({
                    "file": str(path.relative_to(ROOT)),
                    "line": content.count("\n", 0, match.start()) + 1,
                    "reason": reason,
                })
    print(json.dumps({"markdown_files": len(files), "local_links": count,
                      "heading_links": anchor_count, "failures": failures}))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
