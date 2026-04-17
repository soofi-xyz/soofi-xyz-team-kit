# Cursor Plugin — Agent Guidance

This repository is a [Cursor plugin](https://cursor.com/docs/plugins) that ships subagents and (optionally) agent skills.

Follow these conventions whenever you touch files in this repo.

## Manifest (`.cursor-plugin/plugin.json`)

- MUST exist at the repo root under `.cursor-plugin/`.
- `name` MUST be lowercase kebab-case and match the intended plugin identifier.
- Bump `version` (semver) whenever you ship a meaningful change.

## Agents (`agents/*.md`)

- One agent per file. Filename SHOULD match the agent `name`.
- Frontmatter MUST have `name` (kebab-case) and `description` (what + when to trigger).
- Keep the body imperative ("Do X", "Return Y"). Describe the runtime contract: inputs, tools, outputs, verification.
- Add a row to the Agents table in `README.md` when adding or renaming an agent.

## Skills (`skills/<name>/SKILL.md`)

- One skill per directory. Directory name MUST match the skill `name`.
- Frontmatter MUST have `name` (kebab-case, matches directory) and `description` (what + when to trigger).
- Keep `SKILL.md` under 500 lines. Split detail into `rules/` or `reference/` subdirectories.
- Use imperative style ("Use X", "Do not Y") — not passive or suggestive.

### Rule files (`skills/<name>/rules/*.md`)

- One rule per file, named `{section-prefix}-{topic}.md`.
- Files prefixed with `_` are meta files (templates, section indexes).
- Each rule file SHOULD have YAML frontmatter with `title`, `impact`, and `tags`.
- Include concrete correct / incorrect code examples where applicable.

## Paths

- All paths referenced from the manifest MUST be relative and stay inside the repo (no `..`, no absolute paths).
- Cursor auto-discovers `agents/`, `skills/`, `rules/`, `commands/`, `hooks/hooks.json`, and `mcp.json` — only set an explicit path in `plugin.json` to override discovery.

## Checklist before committing

- [ ] Frontmatter is valid on every new or changed agent / skill / rule.
- [ ] `README.md` tables reflect the new state.
- [ ] Plugin still loads locally via `~/.cursor/plugins/local/<name>` after a reload.
