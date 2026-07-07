---
title: WOW Personal CLI Workflows
impact: high
tags:
  - asana
  - hypno
  - wow
  - cli
---

# WOW personal CLI workflows

Hypno drives personal Asana work through `scripts/manage-initiatives.mjs` — a plain-node ESM CLI (no tsx/npx, sandbox-safe). It self-loads `.env.local` and resolves the Asana token from the selected account. Run commands from the hypno-agent repo root.

**WOW mode** is for individual contributors: surface assigned tasks, draft responses, create WOW user stories inside existing projects, and consolidate duplicates. It is **not** initiative project creation (`split`/`convert`/admin).

## Account selection

Accounts are configured in `accounts.local.json` at the repo root (gitignored). Each entry is `{ "label": string, "token": string, "workspaceGid"?: string }`. See `accounts.local.json.example`.

- `--account <label>` selects which configured account to use. Add it to every command.
- If no `accounts.local.json` exists, a single `default` account is synthesized from `ASANA_ACCESS_TOKEN` (and `ASANA_WORKSPACE_GID`).
- When `--account` is omitted, the first configured account is used.
- Task commands (`my-tasks`, `task-history`) scope to each account's `workspaceGid` when set; initiative read commands (`discover`, `list`, `details`) are portfolio-scoped.

```bash
node scripts/manage-initiatives.mjs accounts
```

`accounts` does not require a live Asana token but needs `.env.local` to exist.

## Read-only commands (WOW inspection)

```bash
node scripts/manage-initiatives.mjs discover --account <label>
node scripts/manage-initiatives.mjs list --account <label>
node scripts/manage-initiatives.mjs details <projectGid> --account <label>
node scripts/manage-initiatives.mjs my-tasks [--account <label>] [--json]
node scripts/manage-initiatives.mjs task-history [--account <label>] [--limit N] [--json]
node scripts/manage-initiatives.mjs story-examples [--account <label>] [--project <gid>] [--limit N] [--json]
```

### `my-tasks`

Lists incomplete tasks assigned to you. Omit `--account` for all configured accounts. `--json` → `{ "tasks": [...], "errors": [...] }`. Tasks tagged `[exec]` or `[story-type]`. Per-account error isolation.

### `task-history`

Recent completed assigned tasks + comments (default `--limit 25`, ~180 days). Learning corpus for response drafts.

### `story-examples`

Recent STORY-custom-typed tasks from configured sources (`--project`, `ASANA_INITIATIVES_PROJECT_GIDS`, or portfolio). Default `--limit 15`. Learning corpus for WOW story format.

## Gated story write — `create-story`

The **only** sanctioned Asana write in WOW mode. Dry-run by default.

```bash
node scripts/manage-initiatives.mjs create-story --project <gid> --title "<...>" (--notes-file <path> | --notes "<...>") [--confirm] [--account <label>]
```

- Default (no `--confirm`): dry-run preview only — no network call.
- `--confirm`: creates STORY-typed task after user explicitly approves the preview.
- Best-effort Story custom type; task body is always created.

## Local story store — `store-sync` / `store-search` / `store-mark`

Per-user gitignored `story-store.local.json` for duplicate/overlap search and consolidation tracking.

```bash
node scripts/manage-initiatives.mjs store-sync [--account <label>] [--project <gid>] [--json]
node scripts/manage-initiatives.mjs store-search (--query "<text>" | --against <gid> | --against-title "<text>") [--account <label>] [--limit N] [--json]
node scripts/manage-initiatives.mjs store-mark <gid> --account <label> --state <active|backlog|completed|consolidated> [--consolidated-into <gid>]
```

- `store-sync` reads Asana; never writes to it.
- `store-search` is pure-local (Jaccard over title + AC text).
- `store-mark` writes the local file only — not Asana. Consolidation never archives source stories in Asana.

## Write rules (WOW mode)

- Never mutate Asana except via documented CLI write commands after explicit user approval.
- Task responses: draft-only. "Post it" is not authorization to invent a write path.
- Do **not** run admin commands during WOW flows:

```bash
# Initiative-bot only — not WOW side effects
node scripts/manage-initiatives.mjs split ...
node scripts/manage-initiatives.mjs convert ...
node scripts/manage-initiatives.mjs duplicate ...
node scripts/manage-initiatives.mjs focus-sync ...
node scripts/manage-initiatives.mjs verify-types ...
node scripts/manage-initiatives.mjs verify-template ...
```

## WOW prompt modules (runtime repo)

- `lib/prompts/task-execution.md` — exec-vs-story classification, prioritization, draft responses
- `lib/prompts/wow-story-format.md` — WOW structure, clarify → draft → preview → confirm
- `lib/prompts/story-consolidation.md` — duplicate detection and consolidation flow

## Setup

See `docs/INSTALL-CURSOR.md` in hypno-agent. Verify with `accounts`, then `discover --account <label>`.

## Token safety

Never print, log, or surface token values. `accounts.local.json` is gitignored.
