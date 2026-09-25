#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/sync-claude-agents.sh [sync|check]

Generates Claude Code skill wrappers from source agent definitions.
Each agent in agents/*.md gets a skills/<name>/SKILL.md wrapper with
context: fork so it runs in its own context window.

Existing non-agent skills in skills/ are left untouched.

Commands:
  sync   Update skill wrappers to match agents/ (default).
  check  Verify skill wrappers are already synced.
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
from pathlib import Path

root = Path(sys.argv[1])
command = sys.argv[2]
source_dir_override = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None
target_dir_override = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else None

source_dir = Path(source_dir_override) if source_dir_override else root / "agents"
target_dir = Path(target_dir_override) if target_dir_override else root / "skills"

kebab_case = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

if not source_dir.is_dir():
    raise SystemExit(f"missing source agent directory: {source_dir}")

if command == "sync":
    target_dir.mkdir(parents=True, exist_ok=True)


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


def render_skill(source: Path) -> str:
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

    # Escape description for single-quoted YAML string
    desc_escaped = description.replace("'", "''")

    # Build SKILL.md content
    output = f"---\nname: {name}\ndescription: '{desc_escaped}'\ncontext: fork\n---\n{body}"
    if not output.endswith("\n"):
        output += "\n"
    return output


# Collect expected skill wrappers (one per source agent)
expected = {}
agent_names = set()
for source in sorted(source_dir.glob("*.md")):
    agent_names.add(source.stem)
    skill_dir = target_dir / source.stem
    expected[skill_dir / "SKILL.md"] = render_skill(source)

# In check/sync, only touch skill dirs that correspond to agents.
# Leave non-agent skills untouched.
stale = []
for child in sorted(target_dir.iterdir()):
    if not child.is_dir():
        continue
    skill_md = child / "SKILL.md"
    if not skill_md.is_file():
        continue
    if child.name in agent_names:
        continue
    # This is a non-agent skill — leave it alone.

# Find agent skill dirs that exist but shouldn't (agent was removed)
for child in sorted(target_dir.iterdir()):
    if not child.is_dir():
        continue
    skill_md = child / "SKILL.md"
    if not skill_md.is_file():
        continue
    # Only consider it stale if the SKILL.md contains the generated marker
    # and the agent name is not in the current source set
    if child.name not in agent_names:
        content = skill_md.read_text(encoding="utf-8-sig").replace("\r\n", "\n")
        if "context: fork" in content and content.startswith("---\nname:"):
            # Looks like a generated agent skill wrapper — check if it's stale
            # Only mark as stale if there's no source agent for it AND
            # it doesn't have any other files (rules/, reference/, etc.)
            other_files = [f for f in child.iterdir() if f.name != "SKILL.md"]
            if not other_files:
                stale.append(child)

changed = []
for target_path, content in expected.items():
    skill_dir = target_path.parent
    try:
        existing_content = target_path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        changed.append(target_path)
        continue
    existing_content = existing_content.replace("\r\n", "\n").replace("\r", "\n")
    if existing_content != content:
        changed.append(target_path)

if command == "check":
    if stale or changed:
        for path in stale:
            rel = path.relative_to(target_dir) if target_dir in path.parents else path
            print(f"stale: {rel}")
        for path in changed:
            rel = path.relative_to(target_dir) if target_dir in path.parents else path
            print(f"out of sync: {rel}")
        raise SystemExit("Claude Code agent skills are out of sync; run scripts/sync-claude-agents.sh sync")
    print(f"Claude Code agent skills are synced ({len(expected)} agents)")
    raise SystemExit(0)

# Sync: remove stale, write changed
import shutil
for path in stale:
    shutil.rmtree(path)

for target_path, content in expected.items():
    skill_dir = target_path.parent
    skill_dir.mkdir(parents=True, exist_ok=True)
    target_path.write_text(content, encoding="utf-8")

print(f"synced {len(expected)} Claude Code agent skill wrappers")
if stale:
    print(f"removed {len(stale)} stale agent skill directories")
PY
}

main "$@"
