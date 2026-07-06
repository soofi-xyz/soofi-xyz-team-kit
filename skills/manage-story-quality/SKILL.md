---
name: manage-story-quality
description: "Operating guide for the WOW Story Quality Agent (soofi-xyz/wow-website): on new Asana task creation in configured projects, a Vercel runtime rewrites the story via LLM into the WOW format (clear title, Context / Description / Acceptance Criteria bullets / Demo Script), updates the task, and opens a review subtask assigned to the creator. Covers onboarding new orgs/projects (seed script, PATs, webhook auto-registration), the webhook + 15-min sweeper trigger paths, the idempotent story_agent_tasks ledger, diagnosing missed or failed stories, and changing the WOW format prompt. Triggers on: story quality agent, story agent, WOW story format, rewrite Asana stories, onboard a project to the story agent, story agent missed a task, story_agent_tasks, seed-story-agent."
---

# Manage Story Quality

The Story Quality Agent lives in **`soofi-xyz/wow-website`** and runs on Vercel. When a task is
created in a configured Asana project, it rewrites the story with an LLM (clear imperative title;
WOW-structured description: Context / Description / a bulleted list of verb-first Acceptance Criteria /
Demo Script), updates the task, and creates a review subtask assigned to the story's creator.
This skill is the operating contract: onboard projects, trace processing, diagnose misses, and
change the format. Do not re-implement the agent; operate the one in `wow-website`.

Code map (all paths inside `wow-website`):

- `src/lib/story-agent/` — config, guards, prompt, LLM, processor, sweeper, Asana client
- `src/app/api/asana/webhooks/story-agent/route.ts` — webhook receiver (handshake + deliveries)
- `src/app/api/asana/webhooks/story-agent/sweep/route.ts` — sweeper endpoint (Vercel cron, `*/15 * * * *` in `vercel.json`)
- `scripts/seed-story-agent.mjs` — org/project onboarding script
- DB tables (Drizzle, `src/lib/schema.ts`): `story_agent_orgs`, `story_agent_projects`, `story_agent_tasks`

## When To Use This Skill

- Onboard a new Asana org or project to the agent.
- Diagnose a story the agent missed, skipped, mangled, or failed on.
- Change the WOW story format or the rewrite rules.
- Rotate an org PAT or move a project between orgs.

Do not use it for building new Asana agents from scratch — that is `build-ai-agents`.

## How Processing Works

Two trigger paths feed one idempotent pipeline:

1. **Webhook (primary):** Asana POSTs task-added events to
   `/api/asana/webhooks/story-agent?project=<gid>`. The route verifies the `X-Hook-Signature`
   HMAC against the per-project stored secret, enqueues the tasks, and processes them in a
   background `after()` hook.
2. **Sweeper (fallback, every 15 min):** `runSweep` polls each active project's Asana events API
   with a stored sync token (catching anything the webhook dropped), processes fresh tasks
   immediately (batch limit 2 per sweep), retries rows stuck in `pending`/`processing` for over
   10 minutes, marks rows with 5+ attempts `failed`, and heals webhooks (creates missing ones,
   recreates dead/inactive ones).

Idempotency is enforced by the `story_agent_tasks` ledger: `task_gid` is the primary key
(duplicate events are no-ops), a row must be atomically claimed `pending → processing` before
work starts, and a rewritten story carries the marker `Formatted by WOW Story Agent` in its
notes — a resumed attempt sees the marker, skips the rewrite, and only finishes the missing
steps (including finding an already-created review subtask by its `Review: agent-edited story — `
name prefix instead of duplicating it).

The review subtask is created on the rewritten task, assigned to the task's creator, and shows
the before/after titles plus a permalink. It is skipped when the task has no creator or the
creator is the agent user itself.

## Onboard A New Org / Project

1. Get a PAT for a **dedicated agent user** in the target Asana org. The user must have access
   to every configured project. All rewrites and review subtasks are attributed to this user in
   Asana, and its `agent_user_gid` is what stops the agent from processing its own tasks — never
   reuse a teammate's personal PAT.
2. Write a config file (default `./story-agent.config.json`):

   ```json
   [
     {
       "org": "acme",
       "pat": "env:ACME_ASANA_PAT",
       "projects": [{ "gid": "1201234567890123", "name": "Acme Delivery" }]
     }
   ]
   ```

   `pat` accepts a literal token or `env:VAR_NAME`. Prefer `env:` so tokens never land on disk.
3. Run the seed script from the `wow-website` checkout with `DATABASE_URL` and a 64-char hex
   `ENCRYPTION_KEY` set (it also reads `.env.local`):

   ```bash
   node scripts/seed-story-agent.mjs ./story-agent.config.json
   ```

   It validates each PAT via `GET /users/me`, records the agent user gid, encrypts the PAT
   (AES-256-GCM) into `story_agent_orgs.pat_enc`, and upserts projects as `active`. Re-running
   is safe — it upserts by org name and project gid, so use it for PAT rotation too.
4. **Do not register webhooks by hand.** The next sweep (≤15 min) creates the webhook for any
   active project without one and completes the `X-Hook-Secret` handshake automatically. To
   verify: call the sweep endpoint (`Authorization: Bearer $CRON_SECRET`) and confirm
   `webhooksCreated` increments, then check `story_agent_projects.webhook_gid` is set.
5. Create a test task in the project and confirm it gets rewritten and a `done` ledger row
   appears in `story_agent_tasks`.

## Diagnose A Missed Or Broken Story

Start from the ledger — `story_agent_tasks` keyed by the Asana task gid:

| Status | Meaning | What to check |
|---|---|---|
| `pending` | Enqueued, not yet claimed | Next sweep retries it after the 10-min stuck cutoff; nothing to do unless it never moves |
| `processing` | Claimed, in flight (or crashed mid-flight) | Same — the sweeper re-claims stuck rows |
| `done` | Rewritten (review subtask created when a creator exists) | `original_name`, `new_name`, `review_task_gid` record what happened |
| `skipped` | Deliberately not processed | Read `skip_reason` (table below) |
| `failed` | Gave up after 5 attempts, or project config missing | Read `last_error` and `attempts` |

Skip reasons: `task-not-found` (task deleted or invisible to the PAT), `not-in-project` (event
did not belong to the configured project), `review-task-name` (the task IS a review subtask),
`created-by-agent` (the agent user created it). A `done` row with `skip_reason = no-creator`
means the rewrite succeeded but no review subtask was assignable.

**No ledger row at all** means no event ever arrived. Check, in order:

1. `story_agent_projects`: is the project `active`, and is `webhook_gid` set? Is
   `last_delivery_at` recent?
2. Run the sweep endpoint and read the JSON result: `projectsScanned`, `enqueued`, `retried`,
   `webhooksCreated`, `failedPermanently`, `errors[]`. Per-project errors name the failing
   project gid.
3. A dead or inactive webhook **auto-heals**: the sweeper deletes it, recreates it, and
   re-handshakes — expect `webhooksCreated ≥ 1` on that sweep and the story to be picked up via
   the events poll.

Common causes:

- **412 on the events API is the baseline, not an error.** Asana returns 412 when the sync
  token is missing or expired; the sweeper stores the fresh token and reports zero events. The
  first sweep after seeding only establishes the token — tasks created before it are not
  back-filled.
- **`Asana API 400` on `html_notes`** means the rendered story HTML used markup Asana rejects.
  Keep `renderStoryHtml` / `renderReviewTaskHtml` (`src/lib/story-agent/html-render.ts`) to the
  tag set already in use (`<body>`, `<h2>`, `<ol>/<li>`, `<strong>`, `<a>`, `<hr/>`) and keep
  every interpolated value passed through `escapeXml`.
- **`failed` with `No active story agent config`** — the project row was deactivated or the org
  PAT is gone; re-run the seed script.

## Change The WOW Format

The format lives in one constant: **`STORY_AGENT_SYSTEM_PROMPT` in
`src/lib/story-agent/prompt.ts`** (it currently carries a placeholder block pending the
canonical format — replace that block, keep the rules). When a change goes beyond wording,
update the three layers together, then run `tests/story-agent/`:

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
| `ASANA_STORY_AGENT_PAT` | Fallback PAT used only when an org has no (decryptable) `pat_enc` |
| `AI_GATEWAY_API_KEY` | AI Gateway auth for **local runs only** — deployments use Vercel OIDC automatically; do not set it in Vercel |
| `ASANA_WEBHOOK_BASE_URL` | Optional webhook target base URL override; defaults to the Vercel production URL |
| `CRON_SECRET` | Authorizes the sweep endpoint (`Bearer` header or `?secret=`) |
| `ENCRYPTION_KEY` | 64-char hex AES-256-GCM key for PATs and webhook secrets |
| `STORY_AGENT_MODEL` | Optional model override (`provider/model` via AI Gateway) |

## Operational Cautions

- **PAT attribution is user-visible.** Every rewrite and review subtask shows as the PAT's user
  in Asana task history. Rotating to a different user changes `agent_user_gid` — re-run the seed
  script so self-authored tasks are still skipped.
- **Never accept or replay a handshake outside the creation window.** The route stores an
  `X-Hook-Secret` only when no secret exists yet or the sweeper flagged webhook creation within
  the last 5 minutes (`webhook_creation_pending_at`); anything else is rejected with 403 by
  design, because an accepted rogue handshake would let an attacker forge signed deliveries. Do
  not "fix" a 403 handshake by clearing the stored secret manually — let the sweeper recreate
  the webhook, which gates the window itself.
- Do not create Asana webhooks for configured projects by hand; a second webhook double-delivers
  and its handshake will be rejected anyway.
- Never print or commit PATs, `ENCRYPTION_KEY`, `CRON_SECRET`, or decrypted webhook secrets.
- Reprocessing a story on purpose: delete its `story_agent_tasks` row AND remove the
  `Formatted by WOW Story Agent` marker from the task notes, or the resume path will skip the
  rewrite.
