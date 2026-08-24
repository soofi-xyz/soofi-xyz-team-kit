#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/sync-claude-agents.sh [sync|check]

Materializes source agent definitions from agents/*.md into agents-claude/*.md
as project-scoped Claude Code custom agents.

Commands:
  sync   Update agents-claude/ to match agents/ (default).
  check  Verify agents-claude/ is already synced.
USAGE
}

repo_root() {
  local script_dir
  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  cd -- "${script_dir}/.." && pwd
}

main() {
  local command="${1:-sync}"
  case "${command}" in
    sync|check) ;;
    -h|--help|help)
      usage
      return 0
      ;;
    *)
      usage >&2
      return 2
      ;;
  esac

  local root
  root="$(repo_root)"

  local python_bin="${PYTHON:-}"
  if [[ -z "${python_bin}" ]]; then
    if command -v python3 >/dev/null 2>&1; then
      python_bin="python3"
    else
      python_bin="python"
    fi
  fi

  "${python_bin}" - "$root" "$command" "${SYNC_SOURCE_DIR:-}" "${SYNC_TARGET_DIR:-}" <<'PY'
import re
import sys
import os
from pathlib import Path

root = Path(sys.argv[1])
command = sys.argv[2]
source_dir_override = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None
target_dir_override = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else None

source_dir = Path(source_dir_override) if source_dir_override else root / "agents"
target_dir = Path(target_dir_override) if target_dir_override else root / "agents-claude"

kebab_case = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

MODEL_MAP = {
    "gpt-5.5-high": "opus",
    "gpt-5.5-medium": "sonnet",
    "gpt-5.4-high": "sonnet",
}

if not source_dir.is_dir():
    raise SystemExit(f"missing source agent directory: {source_dir}")

if command == "sync":
    target_dir.mkdir(parents=True, exist_ok=True)
elif not target_dir.is_dir():
    raise SystemExit(f"missing Claude agent directory: {target_dir}")


def parse_frontmatter(path: Path):
    text = path.read_text(encoding="utf-8-sig")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if not text.startswith("---\n"):
        raise SystemExit(f"{path.name}: missing YAML frontmatter")

    frontmatter_end = text.find("\n---\n", 4)
    if frontmatter_end == -1:
        raise SystemExit(f"{path.name}: malformed YAML frontmatter")

    fields = {}
    for line_number, line in enumerate(text[4:frontmatter_end].splitlines(), start=2):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if not match:
            raise SystemExit(
                f"{path.name}:{line_number}: frontmatter must use simple key: value entries"
            )
        key, value = match.groups()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        fields[key] = value

    body = text[frontmatter_end + len("\n---\n") :]
    return fields, body


def render_agent(source: Path) -> str:
    fields, body = parse_frontmatter(source)
    name = fields.get("name", "")
    description = fields.get("description", "")

    if not name:
        raise SystemExit(f"{source.name}: frontmatter must include name")
    if not kebab_case.fullmatch(name):
        raise SystemExit(f"{source.name}: name must be lowercase kebab-case")
    if name != source.stem:
        raise SystemExit(f"{source.name}: name must match agent filename ({source.stem})")
    if not description:
        raise SystemExit(f"{source.name}: frontmatter must include description")
    if not body.strip():
        raise SystemExit(f"{source.name}: body must not be empty")

    # Build frontmatter lines
    fm_lines = []
    fm_lines.append(f"name: {name}")
    fm_lines.append(f"description: {description}")

    # Map model
    source_model = fields.get("model", "")
    mapped_model = MODEL_MAP.get(source_model, "inherit")
    fm_lines.append(f"model: {mapped_model}")

    # Readonly translation
    is_readonly = fields.get("readonly", "").lower() == "true"
    if is_readonly:
        fm_lines.append("permissionMode: plan")
        fm_lines.append("tools: Read, Glob, Grep, Bash")

    # Pass through all other fields (not name, description, model, readonly)
    skip_keys = {"name", "description", "model", "readonly"}
    for key, value in fields.items():
        if key not in skip_keys:
            fm_lines.append(f"{key}: {value}")

    # Build output
    lines = []
    lines.append("---")
    for fl in fm_lines:
        lines.append(fl)
    lines.append("---")
    lines.append(f"<!-- Generated from agents/{source.name}. Do not edit directly. -->")

    if not body.endswith("\n"):
        body += "\n"
    # body starts right after the closing ---\n of source frontmatter
    output = "\n".join(lines) + "\n" + body
    return output


expected = {}
for source in sorted(source_dir.glob("*.md")):
    expected[target_dir / f"{source.stem}.md"] = render_agent(source)

existing = set(target_dir.glob("*.md"))
expected_paths = set(expected)
stale = sorted(existing - expected_paths)

changed = []
for target, content in expected.items():
    if target.is_symlink():
        changed.append(target)
        continue
    try:
        existing_content = target.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        changed.append(target)
        continue
    existing_content = existing_content.replace("\r\n", "\n").replace("\r", "\n")
    if existing_content != content:
        changed.append(target)

if command == "check":
    if stale or changed:
        for path in stale:
            print(f"stale: {path.name}")
        for path in changed:
            print(f"out of sync: {path.name}")
        raise SystemExit("agents-claude is out of sync; run scripts/sync-claude-agents.sh sync")
    print(f"agents-claude is synced ({len(expected)} agents)")
    raise SystemExit(0)

for path in stale:
    path.unlink()

for target, content in expected.items():
    if target.is_symlink():
        target.unlink()
    target.write_text(content, encoding="utf-8")

print(f"synced {len(expected)} Claude agent files")
if stale:
    print(f"removed {len(stale)} stale Claude agent files")
PY
}

main "$@"
