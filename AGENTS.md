# Cursor, Copilot, And Codex Plugin — Agent Guidance

This repository is a [Cursor plugin](https://cursor.com/docs/plugins), [GitHub Copilot CLI plugin](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating), and OpenAI Codex plugin that ships subagents and agent skills.

Follow these conventions whenever you touch files in this repo.

## Manifests

- Cursor manifest MUST exist at `.cursor-plugin/plugin.json`.
- Codex manifest MUST exist at `.codex-plugin/plugin.json`.
- Copilot manifest MUST exist at `plugin.json`.
- Codex repo marketplace manifest MUST exist at `.agents/plugins/marketplace.json`.
- Copilot marketplace manifest MUST exist at `.github/plugin/marketplace.json`.
- `name` MUST be lowercase kebab-case and match the intended plugin identifier.
- Bump `version` (semver) in all plugin manifests and the Copilot marketplace entry whenever you ship a meaningful change.

## Agents (`agents/*.md`)

- One agent per file. Filename SHOULD match the agent `name`.
- Frontmatter MUST have `name` (kebab-case) and `description` (what + when to trigger).
- Keep the body imperative ("Do X", "Return Y"). Describe the runtime contract: inputs, tools, outputs, verification.
- `agents/` is the source of truth. Do not edit files in `agents-copilot/` or `.codex/agents/` directly.
- Each source agent MUST have a matching materialized Copilot file at `agents-copilot/<name>.agent.md`.
- Each source agent MUST have a matching materialized Codex file at `.codex/agents/<name>.toml`.
- After adding, removing, renaming, or editing agents, run `scripts/sync-copilot-agents.sh sync` and `scripts/sync-codex-agents.sh sync` to refresh generated targets.
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
- Cursor auto-discovers `agents/`, `skills/`, `rules/`, `commands/`, `hooks/hooks.json`, and `mcp.json` — only set explicit component paths in `.cursor-plugin/plugin.json` to override discovery.
- Copilot reads component paths from the root `plugin.json`; keep `"agents": "agents-copilot/"` and `"skills": "skills/"` unless the repository layout changes deliberately.
- Codex reads plugin metadata from `.codex-plugin/plugin.json`; keep `"skills": "./skills/"` unless the repository layout changes deliberately.
- Codex repo marketplace points at `plugins/soofi-xyz-team-kit/`, whose `.codex-plugin` and `skills` entries are symlinks back to the canonical root manifest and `skills/` tree. Do not edit through the nested symlink path.
- Codex custom agents are project-scoped TOML files in `.codex/agents/` generated from `agents/`.

## Self-contained Elephant ingestion (`skills/use-oracle/runtime/`)

- The bundled Oracle ingestion runtime at `skills/use-oracle/runtime/` is self-contained.
  Never instruct an operator to clone `oracle-node`, `Counties-trasform-scripts`, or
  `elephant-query-db` as a prerequisite, and never run `npx skills add elephant-xyz/skills`
  — stage skills and the runtime already ship in this repo.
- Any shell script under `skills/use-oracle/scripts/` that needs this plugin's root or the
  bundled runtime path MUST derive it from the script's own on-disk location (see
  [`skills/use-oracle/scripts/oracle-paths.sh`](./skills/use-oracle/scripts/oracle-paths.sh)),
  never from the caller's `cwd`.
- Never commit `.env*` (other than `.env.example`), `node_modules/`, `downloads/`, or any
  generated capture/Parquet/ZIP artifact. A real captured HTML page, ZIP, or Parquet shard
  belongs on Filebase/IPFS, referenced by public URL — not in Git.
- Run `python3 scripts/check-plugin-clean-room.py` before creating a PR that touches
  `skills/use-oracle/runtime/` or any operator-facing install instructions. It scans tracked
  content for secrets, prohibited source-repo installs, oversized generated artifacts, and
  broken symlinks — see the script's module docstring for the exact gates.
- See
  [`skills/use-oracle/reference/self-contained-ingestion.md`](./skills/use-oracle/reference/self-contained-ingestion.md)
  for the full install → replay → pilot → publish command sequence and the team-facing test
  evidence template.

## AWS access guidance

- Do not hardcode a developer-specific AWS profile name in agents, skills, docs, or command examples.
- Reuse the profile selected and verified through the agent's existing AWS access flow, and show it as `AWS_PROFILE=<selected-profile>` or a clearly defined shell variable.
- Keep account and region checks explicit so a reusable profile name cannot silently target the wrong environment.

## Repository layout

```text
soofi-xyz-plugin-kit/
├── .agents/
│   └── plugins/
│       └── marketplace.json          # OpenAI Codex repo marketplace manifest
├── .codex/
│   └── agents/                       # Materialized `.toml` copies for Codex custom agents
├── .codex-plugin/
│   └── plugin.json                   # OpenAI Codex plugin manifest
├── .github/
│   └── plugin/
│       └── marketplace.json          # GitHub Copilot CLI marketplace manifest
├── .cursor-plugin/
│   └── plugin.json                   # Cursor plugin manifest
├── plugin.json                       # GitHub Copilot CLI plugin manifest
├── agents/                           # Source agent definitions
├── agents-copilot/                   # Materialized `.agent.md` copies for Copilot CLI
├── plugins/
│   └── soofi-xyz-team-kit/           # Codex marketplace plugin folder with symlinked manifest and skills
├── skills/                           # Agent skills, one directory per skill
├── scripts/                          # Local validation and maintenance helpers
├── docs/                             # User-facing usage guides
├── AGENTS.md                         # Contributor guidance
├── CONTRIBUTING.md                   # Contribution entry point
└── README.md                         # Usage guide
```

## Local validation

Run the plugin validation script before preparing a PR. It checks that Copilot and Codex agent copies are synced, manifests are consistent, agent and skill frontmatter is valid, source names match paths, generated agents are real files, skills stay under 500 lines, `oracle-paths.sh` resolves independent of cwd, and the bundled Oracle runtime package/catalog are present.

```bash
scripts/validate-plugin.sh
```

If you touched `skills/use-oracle/runtime/`, also install and test it (Node **22.18+**), and
run the dedicated clean-room scan:

```bash
(cd skills/use-oracle/runtime && npm ci)
npm test --prefix skills/use-oracle/runtime
python3 scripts/check-plugin-clean-room.py
```

Use `cd` (not `npm ci --prefix`) for the install step: some npm releases (observed on 11.13.0)
mis-derive the expected lockfile package identity from the `--prefix` directory's basename
instead of its `package.json`, and fail every `ci` with a spurious `Missing: <basename>@<version>
from lock file` error. `npm test --prefix` is unaffected (no lockfile sync check).

CI (`.github/workflows/validate-plugin.yml`) runs all of the above plus `git diff --check` on
every PR — see
[`skills/use-oracle/reference/self-contained-ingestion.md`](./skills/use-oracle/reference/self-contained-ingestion.md)
for the full clean-room-clone gate and the broader test evidence template.

Validate Cursor by copying this repo into Cursor's local plugin directory and reloading the window. Copying is preferred for local testing because Cursor's supported local path is `~/.cursor/plugins/local/<plugin-name>/`, the plugin manifest must exist at the copied plugin root, and symlinked local plugins may fail to load in some Cursor versions.

```bash
scripts/local-cursor-plugin.sh install
```

The script installs a real local copy at `~/.cursor/plugins/local/soofi-xyz-team-kit-local` and rewrites only the copied manifests so the local plugin name is distinct from the published `soofi-xyz-team-kit` plugin.

After every meaningful change to agents, skills, rules, docs, manifests, hooks, commands, or MCP config, run `scripts/local-cursor-plugin.sh install` before handing back the work. Prompt the user to test the copied plugin like this:

1. Run **Developer: Reload Window** in Cursor. If the plugin is not detected, fully restart Cursor.
2. Open **Settings > Plugins** and confirm `soofi-xyz-team-kit-local` is installed.
3. Disable or remove other `soofi-xyz-team-kit` plugin installs while testing if duplicate agent or skill names appear.
4. Run a smoke prompt such as `/arceus Reply with exactly: ok`, then test the changed agent or skill directly.

When preparing or creating a PR, delete the local test copy so the review is not tied to a developer-only install:

```bash
scripts/local-cursor-plugin.sh remove
```

Validate Copilot through the marketplace path, because marketplace installation is the supported user path:

```bash
scripts/sync-copilot-agents.sh check
copilot plugin uninstall soofi-xyz-team-kit
copilot plugin marketplace remove soofi-xyz
copilot plugin marketplace add ./
copilot plugin install soofi-xyz-team-kit@soofi-xyz
copilot plugin list
copilot --agent soofi-xyz-team-kit:arceus -p "Reply with exactly: ok" --allow-all-tools --no-remote
```

For development-only direct install checks, use `copilot plugin install ./`. The installed CLI may reject bare `.` even though docs show local paths generally.

Validate Codex through the repo marketplace path:

```bash
scripts/sync-codex-agents.sh check
codex plugin marketplace add ./
codex plugin add soofi-xyz-team-kit@soofi-xyz-team-kit
codex plugin list
```

Start a new Codex thread after installing or updating the plugin so Codex reloads skills and project-scoped custom agents.

## Checklist before committing

- [ ] Frontmatter is valid on every new or changed agent / skill / rule.
- [ ] `agents-copilot/` contains one real `.agent.md` file for every source file in `agents/`, generated by `scripts/sync-copilot-agents.sh sync`.
- [ ] `.codex/agents/` contains one real `.toml` file for every source file in `agents/`, generated by `scripts/sync-codex-agents.sh sync`.
- [ ] `scripts/validate-plugin.sh` passes before preparing or creating a PR.
- [ ] `README.md` tables reflect the new state.
- [ ] `.cursor-plugin/plugin.json`, `.codex-plugin/plugin.json`, `plugin.json`, and `.github/plugin/marketplace.json` versions are in sync.
- [ ] `scripts/local-cursor-plugin.sh install` has refreshed `~/.cursor/plugins/local/soofi-xyz-team-kit-local`.
- [ ] User has been prompted to reload/restart Cursor, confirm `soofi-xyz-team-kit-local` under Settings > Plugins, and smoke-test the changed agent or skill.
- [ ] Plugin installs locally via `copilot plugin install ./` and lists expected agents / skills.
- [ ] Plugin installs locally via the Codex repo marketplace and lists expected skills.
- [ ] Before creating a PR, `scripts/local-cursor-plugin.sh remove` has deleted the local Cursor test copy.
- [ ] If `skills/use-oracle/runtime/` changed: `npm ci` and `npm test` pass under Node 22.18+, and `python3 scripts/check-plugin-clean-room.py` passes.

## References

- [Cursor Plugins overview](https://cursor.com/docs/plugins)
- [Cursor Plugins reference](https://cursor.com/docs/reference/plugins)
- [Cursor plugin template](https://github.com/cursor/plugin-template)
- [Creating a plugin for GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating)
- [Creating a plugin marketplace for GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-marketplace)
- [GitHub Copilot CLI plugin reference](https://docs.github.com/en/copilot/reference/cli-plugin-reference)
- [Creating custom agents for Copilot](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/create-custom-agents-in-your-ide)
- [OpenAI Codex plugins](https://developers.openai.com/codex/plugins)
- [OpenAI Codex skills](https://developers.openai.com/codex/skills)
- [OpenAI Codex custom agents](https://developers.openai.com/codex/subagents)
