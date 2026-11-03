---
name: team-kit-check
description: "Check a person's Claude Code and team-kit setup: Claude Code install and sign-in, prerequisites, the installed Soofi team kit, available agents, and MCP server connections, with the exact fix for each failure. Use when someone asks whether their setup works, after installing or updating the team kit, or when an agent or MCP server is missing or failing."
---

# Team-kit check

Run the bundled read-only check and report its result. The check never installs,
signs in, or changes settings; it prints a fix for each failure instead.

## Run it

Run the script from this skill's directory:

```bash
bash <this-skill-dir>/scripts/team-kit-check.sh          # install, sign-in, kit, agents, MCP
bash <this-skill-dir>/scripts/team-kit-check.sh --agents # also list every agent name
bash <this-skill-dir>/scripts/team-kit-check.sh --test   # also send one test prompt per kit and MCP server
```

- In Claude Code, `<this-skill-dir>` is `${CLAUDE_SKILL_DIR}`.
- In Cursor, Copilot, or Codex, use the directory that holds this `SKILL.md`.
- When the person is not inside an agent, give them the one-line form for a regular
  terminal:

  ```bash
  curl -fsSL https://raw.githubusercontent.com/soofi-xyz/soofi-xyz-team-kit/main/skills/team-kit-check/scripts/team-kit-check.sh | bash
  ```

  Add `-s -- --test` after `bash` to include the test prompts.

Prefer `--test` from a regular terminal: it starts `claude -p` sessions and uses a few
requests from the person's Claude plan. Do not run `--test` repeatedly in a loop.

## What it checks

| Section | Passes when | Typical fix it prints |
| --- | --- | --- |
| Claude Code | `claude` is on `PATH` and signed in with a Claude subscription on a `@prismteam.ai` account | Add `~/.local/bin` to `PATH`; `/login` inside Claude Code |
| Prerequisites | `git`, Node 22.18+ | `xcode-select --install`; `brew install node` |
| Team kit | `soofi-xyz-team-kit@soofi-xyz` installed, enabled, and current | `claude plugin marketplace add …`, `claude plugin install …`, `claude plugin update …` |
| Agents | Each kit exposes its agents | Reinstall the kit |
| MCP servers | Every server in `claude mcp list` is `✔ Connected` | Per-status fix; for `elephant`, Node 22.18+ and network |
| Test prompts (`--test`) | `soofi-xyz-team-kit:arceus` and an `elephant` tool call each answer `ok` | Accept the updated Consumer Terms; open `/mcp` |

## Report

1. Show the person the script output as-is, including every `✘` and `!` line with its fix.
2. Say for each fix whether it runs in a **regular terminal** or **inside Claude Code**.
3. When the exit code is 1, offer to walk through the fixes one at a time, then run the
   check again. Do not apply fixes that sign in, buy plans, or accept terms on the
   person's behalf.
4. When everything passes, say so in one sentence and point to the next step in
   [`docs/move-to-claude-code.md`](../../docs/move-to-claude-code.md).
