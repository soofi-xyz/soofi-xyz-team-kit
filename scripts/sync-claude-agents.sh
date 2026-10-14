#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/sync-claude-agents.sh [sync|check]

Materializes agents/*.md into agents-claude/*.md for Claude Code plugin packaging
and rewrites the `agents` file list in .claude-plugin/plugin.json.

Transforms applied per agent:
  - `model:` is dropped (source values are Cursor model ids; Claude inherits the session model).
  - `readonly: true` becomes `disallowedTools: Write, Edit, MultiEdit, NotebookEdit`.

Commands:
  sync   Update agents-claude/ and the manifest to match agents/ (default).
  check  Verify they are already synced.
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
target_dir = root / "agents-claude"
manifest_path = root / ".claude-plugin" / "plugin.json"
READONLY_TOOLS = "Write, Edit, MultiEdit, NotebookEdit"

if not source_dir.is_dir():
    raise SystemExit(f"missing source agent directory: {source_dir}")
if not manifest_path.is_file():
    raise SystemExit(f"missing Claude Code manifest: {manifest_path}")

if command == "sync":
    target_dir.mkdir(exist_ok=True)
elif not target_dir.is_dir():
    raise SystemExit(f"missing Claude agent directory: {target_dir}")


def render_agent(source: Path) -> str:
    text = source.read_text(encoding="utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
    if not text.startswith("---\n"):
        raise SystemExit(f"{source.relative_to(root)}: missing YAML frontmatter")
    end = text.find("\n---\n", 4)
    if end == -1:
        raise SystemExit(f"{source.relative_to(root)}: malformed YAML frontmatter")
    frontmatter = text[4:end]
    body = text[end + len("\n---\n") :]
    if not re.search(r"(?m)^description:\s*\S", frontmatter):
        raise SystemExit(f"{source.relative_to(root)}: frontmatter must include description")

    kept = []
    readonly = False
    for line in frontmatter.splitlines():
        key = line.split(":", 1)[0].strip() if ":" in line else ""
        if key == "model":
            continue
        if key == "readonly":
            readonly = line.split(":", 1)[1].strip().strip("\"'").lower() == "true"
            continue
        kept.append(line)
    if readonly:
        kept.append(f"disallowedTools: {READONLY_TOOLS}")

    out = f"---\n# Generated from {source.relative_to(root)}. Do not edit directly.\n"
    out += "\n".join(kept).strip("\n") + "\n---\n" + body
    return out if out.endswith("\n") else out + "\n"


expected = {}
for source in sorted(source_dir.glob("*.md")):
    expected[target_dir / source.name] = render_agent(source)

manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
expected_agents = [f"./agents-claude/{path.name}" for path in expected]
manifest_synced = manifest.get("agents") == expected_agents

existing = set(target_dir.glob("*.md"))
stale = sorted(existing - set(expected))
changed = []
for target, content in expected.items():
    if target.is_symlink():
        changed.append(target)
        continue
    try:
        current = target.read_text(encoding="utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
    except FileNotFoundError:
        changed.append(target)
        continue
    if current != content:
        changed.append(target)

if command == "check":
    if stale or changed or not manifest_synced:
        for path in stale:
            print(f"stale: {path.relative_to(root)}")
        for path in changed:
            print(f"out of sync: {path.relative_to(root)}")
        if not manifest_synced:
            print("out of sync: .claude-plugin/plugin.json agents list")
        raise SystemExit("agents-claude is out of sync; run scripts/sync-claude-agents.sh sync")
    print(f"agents-claude is synced ({len(expected)} agents)")
    raise SystemExit(0)

for path in stale:
    path.unlink()
for target, content in expected.items():
    if target.is_symlink():
        target.unlink()
    target.write_text(content, encoding="utf-8")
if not manifest_synced:
    manifest["agents"] = expected_agents
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

print(f"synced {len(expected)} Claude Code agent files")
if stale:
    print(f"removed {len(stale)} stale Claude Code agent files")
PY
}

main "$@"
