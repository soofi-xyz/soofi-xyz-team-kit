#!/usr/bin/env bash
set -euo pipefail

LOCAL_PLUGIN_NAME="${LOCAL_PLUGIN_NAME:-soofi-xyz-team-kit-local}"
LOCAL_PLUGIN_ROOT="${CURSOR_LOCAL_PLUGIN_ROOT:-$HOME/.cursor/plugins/local}"
TARGET_DIR="${LOCAL_PLUGIN_ROOT}/${LOCAL_PLUGIN_NAME}"

usage() {
  cat <<'USAGE'
Usage:
  scripts/local-cursor-plugin.sh install
  scripts/local-cursor-plugin.sh remove
  scripts/local-cursor-plugin.sh path

Copies this repository into Cursor's local plugin directory as:
  ~/.cursor/plugins/local/soofi-xyz-team-kit-local

The install command rewrites only the copied manifests so the local Cursor plugin
name is distinct from the published plugin.

Environment overrides:
  LOCAL_PLUGIN_NAME        Local plugin directory and manifest name.
  CURSOR_LOCAL_PLUGIN_ROOT Local Cursor plugin root.
USAGE
}

repo_root() {
  local script_dir
  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  cd -- "${script_dir}/.." && pwd
}

ensure_target_is_safe() {
  case "${TARGET_DIR}" in
    "${LOCAL_PLUGIN_ROOT}"/*) ;;
    *)
      echo "Refusing to modify path outside Cursor local plugin root: ${TARGET_DIR}" >&2
      exit 1
      ;;
  esac
}

install_plugin() {
  local source_dir
  source_dir="$(repo_root)"

  ensure_target_is_safe
  mkdir -p "${LOCAL_PLUGIN_ROOT}"

  python - "$source_dir" "$TARGET_DIR" "$LOCAL_PLUGIN_NAME" "$LOCAL_PLUGIN_ROOT" <<'PY'
import json
import shutil
import sys
from pathlib import Path

source = Path(sys.argv[1]).resolve()
target = Path(sys.argv[2]).expanduser().resolve()
local_name = sys.argv[3]
local_root = Path(sys.argv[4]).expanduser().resolve()

if not (source / ".cursor-plugin" / "plugin.json").is_file():
    raise SystemExit(f"missing Cursor manifest: {source / '.cursor-plugin' / 'plugin.json'}")

if source == target or source in target.parents:
    raise SystemExit(f"target must not be inside the source repository: {target}")

try:
    target.relative_to(local_root)
except ValueError as exc:
    raise SystemExit(f"target must stay under {local_root}: {target}") from exc

if target.exists() or target.is_symlink():
    if target.is_symlink() or target.is_file():
        target.unlink()
    else:
        shutil.rmtree(target)

ignore = shutil.ignore_patterns(
    ".git",
    ".DS_Store",
    "__pycache__",
    ".pytest_cache",
    ".ruff_cache",
    ".mypy_cache",
    ".turbo",
    "node_modules",
    ".venv",
    "venv",
)
shutil.copytree(source, target, symlinks=False, ignore=ignore)

def rewrite_json(path: Path, mutator):
    if not path.is_file():
        return
    data = json.loads(path.read_text(encoding="utf-8"))
    mutator(data)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

rewrite_json(target / ".cursor-plugin" / "plugin.json", lambda data: data.__setitem__("name", local_name))
rewrite_json(target / "plugin.json", lambda data: data.__setitem__("name", local_name))

def rewrite_marketplace(data):
    data["name"] = local_name
    for plugin in data.get("plugins", []):
        if plugin.get("name") == "soofi-xyz":
            plugin["name"] = local_name

rewrite_json(target / ".github" / "plugin" / "marketplace.json", rewrite_marketplace)

print(target)
PY

  echo
  echo "Installed local Cursor plugin copy:"
  echo "  ${TARGET_DIR}"
  echo
  echo "Next test steps:"
  echo "  1. In Cursor, run Developer: Reload Window. If the plugin is not detected, fully restart Cursor."
  echo "  2. Open Settings > Plugins and confirm '${LOCAL_PLUGIN_NAME}' is installed."
  echo "  3. Disable or remove other soofi-xyz plugin installs while testing if duplicate agent/skill names appear."
  echo "  4. Run a small smoke prompt, for example: /arceus Reply with exactly: ok"
}

remove_plugin() {
  ensure_target_is_safe

  if [[ -e "${TARGET_DIR}" || -L "${TARGET_DIR}" ]]; then
    rm -rf -- "${TARGET_DIR}"
    echo "Removed local Cursor plugin copy: ${TARGET_DIR}"
    echo "Reload or restart Cursor so the removal is reflected in the UI."
  else
    echo "No local Cursor plugin copy found at: ${TARGET_DIR}"
  fi
}

case "${1:-install}" in
  install)
    install_plugin
    ;;
  remove|delete|clean)
    remove_plugin
    ;;
  path)
    echo "${TARGET_DIR}"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
