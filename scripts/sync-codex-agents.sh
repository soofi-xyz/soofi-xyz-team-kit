#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/sync-codex-agents.sh [sync|check]

Materializes source agent definitions from agents/*.md into .codex/agents/*.toml
as project-scoped OpenAI Codex custom agents.

Commands:
  sync   Update .codex/agents/ to match agents/ (default).
  check  Verify .codex/agents/ is already synced.
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

  "${python_bin}" - "$root" "$command" <<'PY'
import json
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
command = sys.argv[2]
source_dir = root / "agents"
target_dir = root / ".codex" / "agents"
kebab_case = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

if not source_dir.is_dir():
    raise SystemExit(f"missing source agent directory: {source_dir}")

if command == "sync":
    target_dir.mkdir(parents=True, exist_ok=True)
elif not target_dir.is_dir():
    raise SystemExit(f"missing Codex agent directory: {target_dir}")


def parse_frontmatter(path: Path):
    text = path.read_text(encoding="utf-8-sig")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if not text.startswith("---\n"):
        raise SystemExit(f"{path.relative_to(root)}: missing YAML frontmatter")

    frontmatter_end = text.find("\n---\n", 4)
    if frontmatter_end == -1:
        raise SystemExit(f"{path.relative_to(root)}: malformed YAML frontmatter")

    fields = {}
    for line_number, line in enumerate(text[4:frontmatter_end].splitlines(), start=2):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if not match:
            raise SystemExit(
                f"{path.relative_to(root)}:{line_number}: frontmatter must use simple key: value entries"
            )
        key, value = match.groups()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        fields[key] = value

    body = text[frontmatter_end + len("\n---\n") :]
    return fields, body


def toml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def render_agent(source: Path) -> str:
    fields, body = parse_frontmatter(source)
    name = fields.get("name", "")
    description = fields.get("description", "")

    if not name:
        raise SystemExit(f"{source.relative_to(root)}: frontmatter must include name")
    if not kebab_case.fullmatch(name):
        raise SystemExit(f"{source.relative_to(root)}: name must be lowercase kebab-case")
    if name != source.stem:
        raise SystemExit(f"{source.relative_to(root)}: name must match agent filename ({source.stem})")
    if not description:
        raise SystemExit(f"{source.relative_to(root)}: frontmatter must include description")
    if not body.strip():
        raise SystemExit(f"{source.relative_to(root)}: body must not be empty")
    if "'''" in body:
        raise SystemExit(
            f"{source.relative_to(root)}: body contains TOML multiline literal delimiter '''"
        )

    lines = [
        f"# Generated from {source.relative_to(root)}. Do not edit directly.",
    ]

    source_model = fields.get("model")
    if source_model:
        lines.append(f"# Source model: {source_model} (Codex inherits the active model).")

    lines.extend(
        [
            f"name = {toml_string(name)}",
            f"description = {toml_string(description)}",
        ]
    )

    if fields.get("readonly", "").lower() == "true":
        lines.append('sandbox_mode = "read-only"')

    if not body.endswith("\n"):
        body += "\n"
    lines.append("developer_instructions = '''\n" + body + "'''")
    return "\n".join(lines) + "\n"


expected = {}
for source in sorted(source_dir.glob("*.md")):
    expected[target_dir / f"{source.stem}.toml"] = render_agent(source)

existing = set(target_dir.glob("*.toml"))
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
            print(f"stale: {path.relative_to(root)}")
        for path in changed:
            print(f"out of sync: {path.relative_to(root)}")
        raise SystemExit(".codex/agents is out of sync; run scripts/sync-codex-agents.sh sync")
    print(f".codex/agents is synced ({len(expected)} agents)")
    raise SystemExit(0)

for path in stale:
    path.unlink()

for target, content in expected.items():
    if target.is_symlink():
        target.unlink()
    target.write_text(content, encoding="utf-8")

print(f"synced {len(expected)} Codex agent files")
if stale:
    print(f"removed {len(stale)} stale Codex agent files")
PY
}

main "$@"
