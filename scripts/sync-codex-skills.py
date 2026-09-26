#!/usr/bin/env python3
"""Build the Codex-only plugin package from canonical skills and agents."""

from __future__ import annotations

import argparse
import json
import re
import stat
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "agents"
PACKAGE = ROOT / "plugins" / "soofi-xyz-team-kit"
TARGET = PACKAGE / "skills"
GENERATED_MARKER = "<!-- Generated from "
KEBAB_CASE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
COPIED_ROOTS = ("agents", "docs", "skills")
COPIED_FILES = ("README.md", ".codex-plugin/plugin.json")


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

    # Keep host-specific invocation guidance out of the shared Cursor/Copilot
    # agent source. Only its Codex skill needs the plugin-qualified syntax.
    if name == "arceus":
        replacements = {
            "the right agent(s) and skill(s) in this Cursor plugin":
                "the right specialist workflows and skills in this Codex plugin",
            "The user receives a copy-pasteable invocation hint for the primary recommendation.":
                "The user receives a copy-pasteable Codex invocation hint for the primary recommendation.",
            "a copy-pasteable line such as `/<name> <short task summary>` or `Use the <name> subagent to <short task summary>`":
                "a copy-pasteable line such as `$soofi-xyz-team-kit:agent-<name> <short task summary>`",
        }
        for old, new in replacements.items():
            if old not in body:
                raise ValueError(f"{source.relative_to(ROOT)}: expected Arceus text missing: {old}")
            body = body.replace(old, new)

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
        f"{GENERATED_MARKER}{source.relative_to(ROOT)} in the source repository. Do not edit directly. -->",
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


def source_files() -> dict[Path, tuple[bytes, int]]:
    """Read tracked and unignored new source files, excluding Codex-only skills."""
    output = subprocess.check_output(
        [
            "git", "ls-files", "-z", "--cached", "--others", "--exclude-standard",
            "--", *COPIED_FILES, *COPIED_ROOTS,
        ],
        cwd=ROOT,
    )
    expected: dict[Path, tuple[bytes, int]] = {}
    for raw in output.split(b"\0"):
        if not raw:
            continue
        relative = Path(raw.decode("utf-8"))
        if relative.parts[0] == "skills" and relative.parts[1].startswith("agent-"):
            continue
        source = ROOT / relative
        if not source.exists():  # A staged deletion can still appear in ls-files.
            continue
        if source.is_symlink():
            raise ValueError(f"source file must be real: {relative}")
        if source.is_file():
            expected[PACKAGE / relative] = (
                source.read_bytes(), stat.S_IMODE(source.stat().st_mode)
            )
    return expected


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="?", choices=("sync", "check"), default="sync")
    args = parser.parse_args()

    leaked = sorted((ROOT / "skills").glob("agent-*/SKILL.md"))
    if leaked:
        raise ValueError(
            "Codex specialist skills must not live in shared skills/: "
            + ", ".join(str(path.relative_to(ROOT)) for path in leaked)
        )

    expected = source_files()
    for source in sorted(SOURCE.glob("*.md")):
        expected[TARGET / f"agent-{source.stem}" / "SKILL.md"] = (
            render_skill(source).encode("utf-8"), 0o644
        )
    specialist_count = len(list(SOURCE.glob("*.md")))
    if not specialist_count:
        raise ValueError("no source agents found")

    actual = {path for path in PACKAGE.rglob("*") if path.is_file() or path.is_symlink()}
    stale = actual - expected.keys()

    def out_of_sync(path: Path, item: tuple[bytes, int]) -> bool:
        content, mode = item
        return (
            path.is_symlink()
            or not path.is_file()
            or path.read_bytes() != content
            or stat.S_IMODE(path.stat().st_mode) != mode
        )

    changed = [path for path, item in expected.items() if out_of_sync(path, item)]

    if args.command == "check":
        for path in sorted(stale):
            print(f"stale: {path.relative_to(ROOT)}", file=sys.stderr)
        for path in changed:
            print(f"out of sync: {path.relative_to(ROOT)}", file=sys.stderr)
        if stale or changed:
            return 1
        print(f"Codex package is synced ({specialist_count} specialist skills)")
        return 0

    for path in sorted(stale):
        path.unlink()
    for path, item in expected.items():
        if not out_of_sync(path, item):
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        content, mode = item
        path.write_bytes(content)
        path.chmod(mode)
    for directory in sorted((p for p in PACKAGE.rglob("*") if p.is_dir()), reverse=True):
        if directory != PACKAGE:
            try:
                directory.rmdir()
            except OSError:
                pass
    print(f"synced Codex package ({specialist_count} specialist skills, {len(expected)} files)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ValueError as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)
