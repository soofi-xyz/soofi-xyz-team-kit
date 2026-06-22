#!/usr/bin/env bash
set -euo pipefail

repo_root() {
  local script_dir
  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  cd -- "${script_dir}/.." && pwd
}

main() {
  local root
  root="$(repo_root)"

  "${root}/scripts/sync-copilot-agents.sh" check
  "${root}/scripts/sync-codex-agents.sh" check

  local python_bin="${PYTHON:-}"
  if [[ -z "${python_bin}" ]]; then
    if command -v python3 >/dev/null 2>&1; then
      python_bin="python3"
    else
      python_bin="python"
    fi
  fi

  "${python_bin}" - "$root" <<'PY'
import json
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
kebab_case = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
errors = []


def fail(message):
    errors.append(message)


def parse_frontmatter(path):
    try:
        text = path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError as exc:
        fail(f"{path.relative_to(root)}: must be valid UTF-8 ({exc})")
        return {}, ""

    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if not text.startswith("---\n"):
        fail(f"{path.relative_to(root)}: missing YAML frontmatter")
        return {}, text

    end = text.find("\n---\n", 4)
    if end == -1:
        fail(f"{path.relative_to(root)}: malformed YAML frontmatter")
        return {}, text

    fields = {}
    for line_number, line in enumerate(text[4:end].splitlines(), start=2):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if not match:
            fail(f"{path.relative_to(root)}:{line_number}: frontmatter must use simple key: value entries")
            continue
        key, value = match.groups()
        fields[key] = value.strip().strip("\"'")

    return fields, text[end + len("\n---\n") :]


def require_frontmatter(path, expected_name, kind):
    fields, body = parse_frontmatter(path)
    name = fields.get("name", "")
    description = fields.get("description", "")

    if not name:
        fail(f"{path.relative_to(root)}: frontmatter must include name")
    elif not kebab_case.fullmatch(name):
        fail(f"{path.relative_to(root)}: name must be lowercase kebab-case")
    elif name != expected_name:
        fail(f"{path.relative_to(root)}: name must match {kind} path ({expected_name})")

    if not description:
        fail(f"{path.relative_to(root)}: frontmatter must include description")

    if not body.strip():
        fail(f"{path.relative_to(root)}: body must not be empty")


def validate_manifests():
    manifest_paths = [
        root / ".cursor-plugin" / "plugin.json",
        root / ".codex-plugin" / "plugin.json",
        root / "plugin.json",
        root / ".github" / "plugin" / "marketplace.json",
        root / ".agents" / "plugins" / "marketplace.json",
    ]
    for path in manifest_paths:
        if not path.is_file():
            fail(f"{path.relative_to(root)}: required manifest is missing")
            return

    cursor_manifest = json.loads((root / ".cursor-plugin" / "plugin.json").read_text(encoding="utf-8"))
    codex_manifest = json.loads((root / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
    copilot_manifest = json.loads((root / "plugin.json").read_text(encoding="utf-8"))
    copilot_marketplace = json.loads((root / ".github" / "plugin" / "marketplace.json").read_text(encoding="utf-8"))
    codex_marketplace = json.loads((root / ".agents" / "plugins" / "marketplace.json").read_text(encoding="utf-8"))

    versions = {
        ".cursor-plugin/plugin.json": cursor_manifest.get("version"),
        ".codex-plugin/plugin.json": codex_manifest.get("version"),
        "plugin.json": copilot_manifest.get("version"),
        ".github/plugin/marketplace.json metadata": copilot_marketplace.get("metadata", {}).get("version"),
        ".github/plugin/marketplace.json plugin": (copilot_marketplace.get("plugins") or [{}])[0].get("version"),
    }
    if len(set(versions.values())) != 1:
        details = ", ".join(f"{path}={version}" for path, version in versions.items())
        fail(f"manifest versions must match: {details}")

    if codex_manifest.get("name") != cursor_manifest.get("name"):
        fail(".codex-plugin/plugin.json: name must match .cursor-plugin/plugin.json")
    if codex_manifest.get("skills") != "./skills/":
        fail('.codex-plugin/plugin.json: skills must be "./skills/"')
    if copilot_manifest.get("agents") != "agents-copilot/":
        fail('plugin.json: agents must be "agents-copilot/"')
    if copilot_manifest.get("skills") != "skills/":
        fail('plugin.json: skills must be "skills/"')

    codex_plugins = codex_marketplace.get("plugins")
    if not isinstance(codex_plugins, list) or not codex_plugins:
        fail(".agents/plugins/marketplace.json: plugins must contain the Codex plugin entry")
        return

    codex_entry = next((entry for entry in codex_plugins if entry.get("name") == codex_manifest.get("name")), None)
    if not codex_entry:
        fail(".agents/plugins/marketplace.json: missing plugin entry for .codex-plugin/plugin.json name")
        return

    source = codex_entry.get("source", {})
    if source.get("source") != "local":
        fail('.agents/plugins/marketplace.json: source.source must be "local"')
    if source.get("path") != "./plugins/soofi-xyz":
        fail('.agents/plugins/marketplace.json: source.path must be "./plugins/soofi-xyz"')
    codex_plugin_root = root / "plugins" / "soofi-xyz"
    if not (codex_plugin_root / ".codex-plugin" / "plugin.json").is_file():
        fail("plugins/soofi-xyz/.codex-plugin/plugin.json: missing Codex marketplace plugin manifest")
    if not (codex_plugin_root / "skills").is_dir():
        fail("plugins/soofi-xyz/skills: missing Codex marketplace plugin skills directory")

    policy = codex_entry.get("policy", {})
    if policy.get("installation") not in {"NOT_AVAILABLE", "AVAILABLE", "INSTALLED_BY_DEFAULT"}:
        fail(".agents/plugins/marketplace.json: policy.installation has an unsupported value")
    if policy.get("authentication") not in {"ON_INSTALL", "ON_USE"}:
        fail(".agents/plugins/marketplace.json: policy.authentication has an unsupported value")
    if not codex_entry.get("category"):
        fail(".agents/plugins/marketplace.json: plugin entry must include category")


def validate_agents():
    source_dir = root / "agents"
    target_dir = root / "agents-copilot"
    codex_target_dir = root / ".codex" / "agents"
    source_agents = sorted(source_dir.glob("*.md"))
    if not source_agents:
        fail("agents/: must contain at least one source agent")

    expected_targets = {target_dir / f"{agent.stem}.agent.md" for agent in source_agents}
    actual_targets = set(target_dir.glob("*.agent.md"))
    for stale in sorted(actual_targets - expected_targets):
        fail(f"{stale.relative_to(root)}: no matching source agent")

    for agent in source_agents:
        require_frontmatter(agent, agent.stem, "agent filename")
        target = target_dir / f"{agent.stem}.agent.md"
        if not target.is_file():
            fail(f"{target.relative_to(root)}: missing Copilot agent copy")
        elif target.is_symlink():
            fail(f"{target.relative_to(root)}: must be a real file, not a symlink")

    expected_codex_targets = {codex_target_dir / f"{agent.stem}.toml" for agent in source_agents}
    actual_codex_targets = set(codex_target_dir.glob("*.toml")) if codex_target_dir.is_dir() else set()
    for stale in sorted(actual_codex_targets - expected_codex_targets):
        fail(f"{stale.relative_to(root)}: no matching source agent")

    for agent in source_agents:
        target = codex_target_dir / f"{agent.stem}.toml"
        if not target.is_file():
            fail(f"{target.relative_to(root)}: missing Codex agent copy")
        elif target.is_symlink():
            fail(f"{target.relative_to(root)}: must be a real file, not a symlink")


def validate_skills():
    skills_dir = root / "skills"
    skill_files = sorted(skills_dir.glob("*/SKILL.md"))
    if not skill_files:
        fail("skills/: must contain at least one skill")

    for skill in skill_files:
        skill_name = skill.parent.name
        require_frontmatter(skill, skill_name, "skill directory")
        line_count = len(skill.read_text(encoding="utf-8-sig").splitlines())
        if line_count > 500:
            fail(f"{skill.relative_to(root)}: must stay under 500 lines ({line_count})")

    for child in sorted(skills_dir.iterdir()):
        if child.is_dir() and not (child / "SKILL.md").is_file():
            fail(f"{child.relative_to(root)}: skill directory must contain SKILL.md")


validate_manifests()
validate_agents()
validate_skills()

if errors:
    print("Plugin validation failed:", file=sys.stderr)
    for error in errors:
        print(f"- {error}", file=sys.stderr)
    raise SystemExit(1)

print("plugin manifests, agents, and skills are valid")
PY
}

main "$@"
