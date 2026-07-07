---
name: manage-story-quality
description: "Operating guide for the WOW Story Quality Agent (soofi-xyz/wow-website): when someone @-mentions the bot (Kirlia) in a comment on an Asana task of custom type Story, a Vercel runtime rewrites the story via LLM into the WOW format (clear title, Context / Description / Acceptance Criteria bullets / Demo Script), updates the task, and creates or refreshes a review subtask assigned to the mention author. Covers enabling/disabling projects via bot membership (discovery sweep), the org seed script and PATs, the webhook + 15-min sweeper trigger paths, the idempotent story_agent_tasks ledger, diagnosing missed or failed stories, and changing the WOW format prompt. Triggers on: story quality agent, story agent, WOW story format, rewrite Asana stories, mention the story bot, enable the story agent on a project, story agent missed a task, story_agent_tasks, seed-story-agent."
---

# Manage Story Quality

The Story Quality Agent lives in **`soofi-xyz/wow-website`** and runs on Vercel. When someone
@-mentions the bot user (Kirlia) in a comment on a task of custom task type **Story** in a project
the bot is a member of, it rewrites the story with an LLM (clear imperative title;
WOW-structured description: Context / Description / a bulleted list of verb-first Acceptance Criteria /
Demo Script), updates the task, and creates a review subtask assigned to the mention author.
Mentioning the bot again on an already-rewritten story deliberately re-rewrites it from the
current content and refreshes the existing review subtask in place — it is never duplicated.
This skill is the operating contract: enable projects, trace processing, diagnose misses, and
change the format. Do not re-implement the agent; operate the one in `wow-website`.

Code map (all paths inside `wow-website`):

- `src/lib/story-agent/` — config, guards, events, mentions, discovery, prompt, LLM, processor, sweeper, Asana client
- `src/app/api/asana/webhooks/story-agent/route.ts` — webhook receiver (handshake + deliveries)
- `src/app/api/asana/webhooks/story-agent/sweep/route.ts` — sweeper endpoint (Vercel cron, `*/15 * * * *` in `vercel.json`)
- `scripts/seed-story-agent.mjs` — org identity registration (stored PATs only; projects come from membership discovery)
- DB tables (Drizzle, `src/lib/schema.ts`): `story_agent_orgs`, `story_agent_projects`, `story_agent_tasks`

## When To Use This Skill

- Enable or disable the agent on an Asana project, or onboard a new org.
- Diagnose a story the agent missed, skipped, mangled, or failed on.
- Change the WOW story format or the rewrite rules.
- Rotate an org PAT or move a project between orgs.

Do not use it for building new Asana agents from scratch — that is `build-ai-agents`.

## How Processing Works

The trigger is a **comment @-mention of the bot user**. Asana webhooks are filtered on
`story` / `comment_added` / `added` events; the agent fetches each comment and keeps only
human-authored comments whose HTML carries a real user-mention anchor for the agent user gid
(a bare gid or pasted task URL in plain text does not count). Two trigger paths feed one
idempotent pipeline:

1. **Webhook (primary):** Asana POSTs comment-added events to
   `/api/asana/webhooks/story-agent?project=<gid>`. The route verifies the `X-Hook-Signature`
   HMAC against the per-project stored secret, resolves mention triggers, enqueues them, and
   processes them in a background `after()` hook.
2. **Sweeper (fallback, every 15 min):** `runSweep` reconciles project membership (see
   enablement below), polls each active project's Asana events API with a stored sync token
   (catching any mention the webhook dropped), processes fresh tasks immediately (batch limit 2
   per sweep), retries rows stuck in `pending`/`processing` for over 10 minutes, marks rows with
   5+ attempts `failed`, and heals webhooks — it creates missing ones, recreates dead/inactive
   ones, and migrates existing healthy webhooks still carrying the old task-added filters to the
   story/comment_added filter set in place (`webhookFiltersUpdated` in the sweep result).

Idempotency is enforced by the `story_agent_tasks` ledger: one row per `task_gid` with
latest-trigger-wins semantics. A new mention on a task with a settled row re-arms it
(`status → pending`, attempts reset, `trigger_story_gid`/`trigger_user_gid` updated); a duplicate
delivery of the same trigger is a no-op; a mention landing mid-flight is recorded on the
`processing` row and re-queued after the current run instead of being lost. A row must be
atomically claimed `pending → processing` before work starts, and a rewritten story carries the
marker `Formatted by Kirlia` in its notes. The marker plus a matching
`rewritten_story_gid = trigger_story_gid` means crash-resume: the retry skips the LLM call and
only finishes the missing steps (including finding an already-created review subtask by its
`Review: agent-edited story — ` name prefix instead of duplicating it). A **new** trigger on a
marked task is a deliberate re-rewrite: the marker is stripped from the LLM input and the story
is rewritten from its current content, preserving the true original title in `original_name`.

The review subtask is created on the rewritten task, assigned to the **mention author** (falling
back to the task's creator for legacy rows without a trigger user), and shows the before/after
titles plus a permalink. On a re-rewrite the existing review subtask is updated in place — name,
notes, and assignee — never stacked; if it was deleted in Asana it is recreated. It is skipped
only when no assignee resolves or the assignee is the agent user itself.

Only tasks of Asana custom task type **Story** are rewritten — milestones, approvals, and plain
tasks are skipped with `not-story-type`. Override the required type with
`STORY_AGENT_REQUIRED_TYPE` (set it to `""` to disable the filter in workspaces without custom
task types, e.g. personal sandboxes).

## Enable Or Disable A Project

**Project membership is the source of truth.** There is no per-project seeding or config:

- **Enable:** add the Kirlia bot user to the Asana project. The next sweep's membership
  discovery (≤15 min) inserts/activates the project row, creates the webhook, and completes the
  `X-Hook-Secret` handshake automatically. To verify: call the sweep endpoint
  (`Authorization: Bearer $CRON_SECRET`) and check the `discovery` counters
  (`inserted`/`activated`) and `webhooksCreated`, then confirm
  `story_agent_projects.webhook_gid` is set. Then @-mention the bot on a Story task and confirm
  a `done` ledger row appears in `story_agent_tasks`.
- **Disable:** remove the bot from the project. The next sweep deactivates the row, deletes the
  webhook, and clears the stored secret. Setting `active = false` by hand does **not** stick —
  discovery re-activates any project the bot is still a member of; removing the bot IS the kill
  switch.

Discovery walks every workspace of every identity the deployment holds credentials for (the
`ASANA_STORY_AGENT_PAT` env fallback plus each org's stored PAT), fenced by
`STORY_AGENT_WORKSPACE_ALLOWLIST` (see Environment). Org rows are created and bound to
workspaces automatically; each workspace's org is owned by exactly one identity, and only the
owner reconciles it.

### Onboard A New Org Identity (rare)

The seed script is only needed when an org must use a PAT **other than** the
`ASANA_STORY_AGENT_PAT` env fallback (e.g. a sandbox org with its own bot user) — and for PAT
rotation. The bot must be a **dedicated agent user**: all rewrites and review subtasks are
attributed to it in Asana, and its `agent_user_gid` is what stops the agent from processing its
own tasks and comments — never reuse a teammate's personal PAT.

1. Write a config file (default `./story-agent.config.json`):

   ```json
   [{ "org": "acme", "pat": "env:ACME_ASANA_PAT" }]
   ```

   `pat` accepts a literal token, `env:VAR_NAME` (preferred — tokens never land on disk), or
   `null` for explicit env-fallback mode (no `pat_enc` stored). A `projects` array is accepted
   as a bootstrap convenience only — discovery overrides it against actual memberships.
2. Run it from the `wow-website` checkout with `DATABASE_URL` and a 64-char hex
   `ENCRYPTION_KEY` set (it also reads `.env.local`):

   ```bash
   node scripts/seed-story-agent.mjs ./story-agent.config.json
   ```

   It validates each PAT via `GET /users/me`, records the agent user gid, and encrypts the PAT
   (AES-256-GCM) into `story_agent_orgs.pat_enc`. Re-running is safe — it upserts by org name,
   so use it for PAT rotation too.
3. Do **not** register webhooks or seed projects by hand — add the bot to projects and let the
   sweep do the rest.

## Diagnose A Missed Or Broken Story

Start from the ledger — `story_agent_tasks` keyed by the Asana task gid:

| Status | Meaning | What to check |
|---|---|---|
| `pending` | Enqueued, not yet claimed | Next sweep retries it after the 10-min stuck cutoff; nothing to do unless it never moves |
| `processing` | Claimed, in flight (or crashed mid-flight) | Same — the sweeper re-claims stuck rows |
| `done` | Rewritten for the recorded trigger | `original_name`, `new_name`, `trigger_story_gid`, `trigger_user_gid`, `review_task_gid` record what happened |
| `skipped` | Deliberately not processed | Read `skip_reason` (table below) |
| `failed` | Gave up after 5 attempts, or project config missing | Read `last_error` and `attempts` |

Skip reasons: `task-not-found` (task deleted or invisible to the PAT), `not-in-project` (event
did not belong to the configured project), `review-task-name` (the task IS a review subtask),
`created-by-agent` (the agent user created it), `not-story-type` (custom task type is not
`Story`). A `done` row with `skip_reason = no-creator` means the task has no creator — the
rewrite succeeded, and the review subtask still exists when a mention author was recorded.

**No ledger row at all** means no mention trigger ever resolved. Check, in order:

1. Was the bot actually @-mentioned (a real Asana user mention, not just its name typed out) in
   a **comment on the task**, by someone other than the bot itself?
2. `story_agent_projects`: is the project `active` (is the bot still a project member?), and is
   `webhook_gid` set? Is `last_delivery_at` recent?
3. Run the sweep endpoint and read the JSON result: `projectsScanned`, `enqueued`, `retried`,
   `webhooksCreated`, `webhookFiltersUpdated`, `failedPermanently`, `discovery`, `errors[]`.
   Per-project errors name the failing project gid.
4. A dead or inactive webhook **auto-heals**: the sweeper deletes it, recreates it, and
   re-handshakes — expect `webhooksCreated ≥ 1` on that sweep and the mention to be picked up
   via the events poll.

Common causes:

- **412 on the events API is the baseline, not an error.** Asana returns 412 when the sync
  token is missing or expired; the sweeper stores the fresh token and reports zero events. The
  first sweep after a project activates only establishes the token — mentions posted before it
  are not back-filled; mention the bot again.
- **`Asana API 400` on `html_notes`** means the rendered story HTML used markup Asana rejects.
  Keep `renderStoryHtml` / `renderReviewTaskHtml` (`src/lib/story-agent/html-render.ts`) to the
  tag set already in use (`<body>`, `<h2>`, `<ol>/<li>`, `<strong>`, `<a>`, `<hr/>`) and keep
  every interpolated value passed through `escapeXml`.
- **`failed` with `No active story agent config`** — the project was deactivated (the bot was
  removed from it) or the org PAT is gone; re-add the bot, or re-run the seed script for a
  stored-PAT org.

## Change The WOW Format

The format lives in one constant: **`STORY_AGENT_SYSTEM_PROMPT` in
`src/lib/story-agent/prompt.ts`** — it is the founder's (Soofi's) own agent prompt, kept as
close to his wording as possible, with an output-contract section adapting it to the structured
pipeline. When a change goes beyond wording, update the three layers together, then run
`tests/story-agent/`:

1. `prompt.ts` — the system prompt rules (section order, sentence rules).
2. `llm.ts` (`rewriteSchema`) + `validate.ts` — structural schema and semantic validation; the
   validator's errors drive the one corrective LLM retry, so new rules belong there, not in
   ad-hoc post-processing.
3. `html-render.ts` — the `<h2>` sections written into Asana. Never remove the trailing
   `AGENT_MARKER` — it is the idempotency marker.

Model selection: plain `provider/model` strings resolve through the Vercel AI Gateway; default
is `anthropic/claude-opus-4.8`, overridable per deployment with `STORY_AGENT_MODEL`.

## Environment

| Variable | Purpose |
|---|---|
| `ASANA_STORY_AGENT_PAT` | Fallback PAT used when an org has no (decryptable) `pat_enc` — covers normal orgs; also a discovery identity |
| `AI_GATEWAY_API_KEY` | AI Gateway auth for **local runs only** — deployments use Vercel OIDC automatically; do not set it in Vercel |
| `ASANA_WEBHOOK_BASE_URL` | Optional webhook target base URL override; defaults to the Vercel production URL |
| `CRON_SECRET` | Authorizes the sweep endpoint (`Bearer` header or `?secret=`) |
| `ENCRYPTION_KEY` | 64-char hex AES-256-GCM key for PATs and webhook secrets |
| `STORY_AGENT_MODEL` | Optional model override (`provider/model` via AI Gateway) |
| `STORY_AGENT_REQUIRED_TYPE` | Custom task type required for rewriting (default `Story`; `""` disables the filter) |
| `STORY_AGENT_WORKSPACE_ALLOWLIST` | Comma-separated workspace gids discovery may touch. Unset in prod = all the bot's workspaces; non-prod deployments MUST set it (e.g. to the sandbox workspace) so they never reconcile production workspaces and steal their webhooks |

## Operational Cautions

- **PAT attribution is user-visible.** Every rewrite and review subtask shows as the PAT's user
  in Asana task history, and the mention target IS that user. Rotating to a different user
  changes `agent_user_gid` — re-run the seed script for stored-PAT orgs so self-authored tasks
  and comments are still skipped, and remember teammates must now mention the new user.
- **Never accept or replay a handshake outside the creation window.** The route stores an
  `X-Hook-Secret` only when no secret exists yet or the sweeper flagged webhook creation within
  the last 5 minutes (`webhook_creation_pending_at`); anything else is rejected with 403 by
  design, because an accepted rogue handshake would let an attacker forge signed deliveries. Do
  not "fix" a 403 handshake by clearing the stored secret manually — let the sweeper recreate
  the webhook, which gates the window itself.
- Do not create Asana webhooks for configured projects by hand; a second webhook double-delivers
  and its handshake will be rejected anyway.
- Never print or commit PATs, `ENCRYPTION_KEY`, `CRON_SECRET`, or decrypted webhook secrets.
- Reprocessing a story on purpose needs no DB surgery: post a new comment @-mentioning the bot
  and it re-rewrites from the current content. The `Formatted by Kirlia` marker (older tasks may
  carry the legacy `Formatted by Kadabra` marker, which is also recognized) only short-circuits
  crash-retries of the same trigger — do not remove it, and never deploy a build that stops
  recognizing the legacy marker.
