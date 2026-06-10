#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/sync-copilot-agents.sh [sync|check]

Copies source agent definitions from agents/*.md into agents-copilot/*.agent.md
as real files for GitHub Copilot CLI packaging. Agent source files must stay
valid Cursor agent files; Copilot-only model overrides live in this script.

Commands:
  sync   Update agents-copilot/ to match agents/ (default).
  check  Verify agents-copilot/ is already synced.
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
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
command = sys.argv[2]
source_dir = root / "agents"
target_dir = root / "agents-copilot"
copilot_model_overrides = {
    "chansey": "gpt-5.4-mini",
}

if not source_dir.is_dir():
    raise SystemExit(f"missing source agent directory: {source_dir}")

if command == "sync":
    target_dir.mkdir(exist_ok=True)
elif not target_dir.is_dir():
    raise SystemExit(f"missing Copilot agent directory: {target_dir}")

def read_agent(path: Path) -> str:
    text = path.read_text(encoding="utf-8-sig")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if not text.startswith("---\n"):
        raise SystemExit(f"{path.relative_to(root)}: missing YAML frontmatter")
    frontmatter_end = text.find("\n---\n", 4)
    if frontmatter_end == -1:
        raise SystemExit(f"{path.relative_to(root)}: malformed YAML frontmatter")
    frontmatter = text[4:frontmatter_end]
    if not re.search(r"(?m)^description:\s*\S", frontmatter):
        raise SystemExit(f"{path.relative_to(root)}: frontmatter must include description")
    body = text[frontmatter_end + len("\n---\n"):]
    copilot_model = copilot_model_overrides.get(path.stem)
    lines = []
    for line in frontmatter.splitlines():
        lines.append(line)
    if copilot_model:
        replaced = False
        for index, line in enumerate(lines):
            if re.match(r"^model:\s*", line):
                lines[index] = f"model: {copilot_model}"
                replaced = True
                break
        if not replaced:
            lines.append(f"model: {copilot_model}")
    transformed = "---\n" + "\n".join(lines) + "\n---\n" + body
    return transformed if transformed.endswith("\n") else transformed + "\n"

expected = {}
for source in sorted(source_dir.glob("*.md")):
    expected[target_dir / f"{source.stem}.agent.md"] = read_agent(source)

existing = set(target_dir.glob("*.agent.md"))
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
        raise SystemExit("agents-copilot is out of sync; run scripts/sync-copilot-agents.sh sync")
    print(f"agents-copilot is synced ({len(expected)} agents)")
    raise SystemExit(0)

for path in stale:
    path.unlink()

for target, content in expected.items():
    if target.is_symlink():
        target.unlink()
    target.write_text(content, encoding="utf-8", newline="\n")

print(f"synced {len(expected)} Copilot agent files")
if stale:
    print(f"removed {len(stale)} stale Copilot agent files")
PY
}

main "$@"
