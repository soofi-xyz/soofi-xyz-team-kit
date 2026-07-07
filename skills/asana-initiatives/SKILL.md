---
name: asana-initiatives
description: "Extend the hypno Google Chat Asana initiative portfolio bot and WOW personal CLI workflows. Covers prompt-in-Markdown, gchat webhook flow, initiative project CRUD, acceptance-criteria parsing, portfolio analysis, my-tasks/story creation/store consolidation via manage-initiatives.mjs. Triggers on: hypno, asana initiatives, initiative portfolio, acceptance criteria, golden overlap, war plan initiatives, manage-initiatives, google chat asana bot, my tasks, WOW story, create-story, store-sync."
---

# Asana Initiatives (Hypno Runtime)

Guide for designing and extending the **hypno-agent** runtime — a Google Chat assistant for Asana initiative portfolio operations on Vercel.

**Runtime repository:** [github.com/elephant-xyz/hypno-agent](https://github.com/elephant-xyz/hypno-agent)

**Not** the same as `skills/build-ai-agents/` (Lambda + `@soofi-xyz/chat-adapter-asana`). Hypno uses `@chat-adapter/gchat` and Next.js.

## When to use

- Change Google Chat bot behavior, tools, or prompts
- Create, split, convert, or analyze initiative projects
- Draft initiative recommendations (Context, Description, Acceptance Criteria)
- Run portfolio dedup, golden-overlap, or war-plan analysis
- Extend `scripts/manage-initiatives.mjs` or analysis scripts
- **WOW personal mode:** surface/prioritize assigned tasks, draft responses, create WOW stories (`create-story`), consolidate duplicates (`store-*`)

## Repository layout

| Path | Purpose |
| --- | --- |
| `app/api/webhooks/[platform]/route.ts` | Google Chat webhook route |
| `lib/bot.ts` | Chat SDK wiring and turn handling |
| `lib/system-prompt.ts` | Joins runtime prompt Markdown |
| `lib/prompts/` | Active prompt modules |
| `lib/asana.ts` | Asana API client and formatting |
| `lib/criteria-parser.ts` | Acceptance-criteria parser |
| `lib/initiative-domain.mjs` | Shared initiative naming/domain helpers |
| `lib/tools.ts` | AI tool definitions |
| `lib/conversation-memory.ts` | Redis-backed transcript memory |
| `scripts/manage-initiatives.mjs` | CLI: discover, list, split, convert, my-tasks, create-story, store-* |
| `scripts/analyze-initiatives.mjs` | Category, dedup, AC analysis |
| `scripts/analyze-golden-overlap.mjs` | Golden initiative overlap scoring |

Runtime config identifiers use `hypno-agent` (`keyPrefix`, `userName`, Redis transcript prefix).

## Prompt-in-Markdown pattern

Runtime behavior lives in `lib/prompts/`, joined by `lib/system-prompt.ts`:

- `asana-agent.md` — persona and core behavior
- `asana-integrations.md` — Asana model and date rules
- `asana-tools.md` — when to call each tool
- `output-format.md` — response formatting

**Rules:** keep product behavior in Markdown when possible; document new tools in `asana-tools.md`. Read [`rules/prompt-modules.md`](rules/prompt-modules.md) for edit guidance.

## Initiative notes format

New-style initiatives are Asana **projects** in the Initiatives portfolio, created from a template with **Story** and **Acceptance Criteria** custom task types.

Project notes use plain headings (not `##`):

```
Context
<why this initiative exists>

Description
<what will be done>

Acceptance Criteria
    First criterion
    Second criterion
```

Read [`rules/initiative-notes.md`](rules/initiative-notes.md) for drafting conventions.

## Asana creation pattern

1. Duplicate AVE reference project `1215689031697627` (Story + AC custom types)
2. Add to Initiatives portfolio (`ASANA_INITIATIVES_PORTFOLIO_GID`)
3. Delete copied template tasks; set notes, phase, category, dates
4. Set owner, `privacy_setting: public_to_workspace`, admin membership
5. Seed AC tasks by **duplicating** an existing AC task — do not POST new tasks with `AC_CUSTOM_TYPE_GID` on template projects

Read [`rules/asana-api-gotchas.md`](rules/asana-api-gotchas.md) for API pitfalls.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `ASANA_ACCESS_TOKEN` | Yes | Asana PAT |
| `ASANA_INITIATIVES_PORTFOLIO_GID` | Yes | Initiative projects portfolio |
| `ASANA_INITIATIVE_TEMPLATE_PROJECT_GID` | Yes | Template to clone sections from |
| `ASANA_INITIATIVE_PROJECT_GID` | Yes | Legacy flat initiatives project |
| `ASANA_WORKSPACE_GID` | No | Auto-discovered |
| `REDIS_URL` | Yes | Conversation memory |
| `GOOGLE_CHAT_CREDENTIALS` | Yes | Service account JSON |
| `GOOGLE_CHAT_WEBHOOK_AUDIENCE` | No | HTTP endpoint audience |

Use `vercel env pull .env.local` for team setup. Sensitive `ASANA_ACCESS_TOKEN` may come through empty — see runtime README.

## CLI commands

```bash
node scripts/manage-initiatives.mjs discover
node scripts/manage-initiatives.mjs list
node scripts/manage-initiatives.mjs details <projectGid>
node scripts/manage-initiatives.mjs split <gid> --into "Name A" "Name B" [--dry-run]
node scripts/manage-initiatives.mjs convert <taskGid> [--dry-run]
node scripts/manage-initiatives.mjs verify-types --out reports/task-types.csv

node scripts/analyze-initiatives.mjs [--dry-run] [--out reports/]
node scripts/analyze-golden-overlap.mjs [--out reports/]
```

## Implementation rules

1. Keep modules narrow: bot orchestration, Asana client, criteria parser, tools.
2. Do not expand write scope casually — v1 writes are limited to gantt-related date updates unless the user explicitly expands scope.
3. Prefer deterministic AC parsing; report unclear checkbox-free bullets as unclear.
4. Legacy flat-task initiatives migrate via `convert`; new model uses per-initiative projects.
5. Semantic search uses Upstash Vector (`scripts/setup-hybrid-vector.mjs`).

## Verification

1. `node scripts/manage-initiatives.mjs discover` — env and portfolio OK
2. Targeted CLI command for the change
3. Google Chat smoke test when bot prompts or tools changed
4. LangSmith traces when AI path changed

## WOW personal CLI workflows

For **WOW-personal** mode (assigned tasks, story creation, consolidation), read [`rules/wow-cli.md`](rules/wow-cli.md) and the runtime prompt modules:

- `lib/prompts/task-execution.md`
- `lib/prompts/wow-story-format.md`
- `lib/prompts/story-consolidation.md`

WOW mode write guardrail: only sanctioned Asana write is `create-story --confirm`; task responses are draft-only; never run initiative admin CLI as a side effect.

## Related rules

- [`rules/_index.md`](rules/_index.md) — section map
- [`rules/prompt-modules.md`](rules/prompt-modules.md)
- [`rules/initiative-notes.md`](rules/initiative-notes.md)
- [`rules/asana-api-gotchas.md`](rules/asana-api-gotchas.md)
