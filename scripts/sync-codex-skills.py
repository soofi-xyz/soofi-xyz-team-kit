#!/usr/bin/env python3
"""Materialize Codex specialist skills from the canonical agent definitions."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "agents"
TARGET = ROOT / "skills"
GENERATED_MARKER = "<!-- Generated from "
KEBAB_CASE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def parse_agent(path: Path) -> tuple[dict[str, str], str]:
    content = path.read_text(encoding="utf-8-sig").replace("\r\n", "\n")
    if not content.startswith("---\n"):
        raise ValueError(f"{path.relative_to(ROOT)}: missing frontmatter")
    end = content.find("\n---\n", 4)
    if end < 0:
        raise ValueError(f"{path.relative_to(ROOT)}: unclosed frontmatter")
    fields: dict[str, str] = {}
    for line in content[4:end].splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = re.fullmatch(r"([A-Za-z0-9_-]+):\s*(.*)", line)
        if not match:
            raise ValueError(f"{path.relative_to(ROOT)}: unsupported frontmatter line: {line}")
        key, value = match.groups()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        fields[key] = value
    return fields, content[end + len("\n---\n") :].strip() + "\n"


def render_skill(source: Path) -> str:
    fields, body = parse_agent(source)
    name = fields.get("name", "")
    description = fields.get("description", "")
    if name != source.stem or not KEBAB_CASE.fullmatch(name):
        raise ValueError(f"{source.relative_to(ROOT)}: name must match its kebab-case filename")
    if not description:
        raise ValueError(f"{source.relative_to(ROOT)}: description is required")
    if not body.strip():
        raise ValueError(f"{source.relative_to(ROOT)}: body is required")

    # Source links are written from agents/<name>.md. The generated file lives
    # under skills/agent-<name>/, so adjust only those relative Markdown links.
    body = body.replace("](../skills/", "](../")
    body = body.replace("](../README.md)", "](../../README.md)")

    skill_name = f"agent-{name}"
    lines = [
        "---",
        f"name: {skill_name}",
        f"description: {json.dumps(description, ensure_ascii=False)}",
        "---",
        "",
        f"{GENERATED_MARKER}{source.relative_to(ROOT)}. Run scripts/sync-codex-skills.py; do not edit directly. -->",
        "",
        f"# {name} specialist workflow",
        "",
        "Apply this specialist workflow in the current Codex task. This is a skill,",
        "not a separately installed custom agent. Resolve kit paths such as",
        "`README.md`, `agents/`, and `skills/` from the installed plugin root",
        "(`../..` from this skill directory); resolve application paths from the",
        "active project. In Codex, recommend another kit specialist by its",
        "plugin-qualified skill name, `$soofi-xyz-team-kit:agent-<name>`.",
    ]
    if fields.get("readonly", "").lower() == "true":
        lines += ["", "This workflow is read-only: do not modify project files."]
    lines += ["", "## Workflow", "", body.rstrip(), ""]
    return "\n".join(lines)


def is_generated(path: Path) -> bool:
    return path.is_file() and GENERATED_MARKER in path.read_text(encoding="utf-8")[:800]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="?", choices=("sync", "check"), default="sync")
    args = parser.parse_args()

    expected: dict[Path, str] = {}
    for source in sorted(SOURCE.glob("*.md")):
        expected[TARGET / f"agent-{source.stem}" / "SKILL.md"] = render_skill(source)
    if not expected:
        raise ValueError("no source agents found")

    existing = {path for path in TARGET.glob("agent-*/SKILL.md") if is_generated(path)}
    stale = existing - expected.keys()
    changed = []
    for path, content in expected.items():
        if path.exists() and not is_generated(path):
            raise ValueError(f"refusing to overwrite non-generated skill: {path.relative_to(ROOT)}")
        if not path.is_file() or path.read_text(encoding="utf-8") != content:
            changed.append(path)

    if args.command == "check":
        for path in sorted(stale):
            print(f"stale: {path.relative_to(ROOT)}", file=sys.stderr)
        for path in changed:
            print(f"out of sync: {path.relative_to(ROOT)}", file=sys.stderr)
        if stale or changed:
            return 1
        print(f"Codex specialist skills are synced ({len(expected)} skills)")
        return 0

    for path in sorted(stale):
        path.unlink()
        path.parent.rmdir()
    for path in changed:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(expected[path], encoding="utf-8")
    print(f"synced {len(expected)} Codex specialist skills")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ValueError as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)
