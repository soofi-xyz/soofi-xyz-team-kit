# Contributing

This repo is a [Cursor plugin](https://cursor.com/docs/plugins). Follow the conventions in [`AGENTS.md`](./AGENTS.md) and the Cursor [Plugins reference](https://cursor.com/docs/reference/plugins).

## Ground rules

1. Every component goes in its canonical directory so Cursor's auto-discovery picks it up:
   - Agents → `agents/<name>.md`
   - Skills → `skills/<name>/SKILL.md`
   - Rules (inside a skill) → `skills/<name>/rules/*.md`
   - Commands → `commands/<name>.md`
   - Hooks → `hooks/hooks.json`
   - MCP servers → `mcp.json`
2. Every agent, skill, rule, and command MUST have valid YAML frontmatter (`name` + `description` at minimum).
3. Keep `SKILL.md` under 500 lines — push detail into `rules/` or `reference/` files.
4. Update the relevant table in `README.md` whenever you add, rename, or remove a component.

## Local testing

Symlink this repo into Cursor's local plugin directory, then reload the window:

```bash
mkdir -p ~/.cursor/plugins/local
ln -s "$(pwd)" ~/.cursor/plugins/local/soofi-xyz-cursor-plugin
```

Run **Developer: Reload Window** in Cursor and confirm your new agent / skill appears.

## Submitting changes

- Open a PR with a short description of what the agent or skill does and when it should trigger.
- Bump `version` in `.cursor-plugin/plugin.json` for user-visible changes.
- Include before/after examples for rule changes where applicable.
