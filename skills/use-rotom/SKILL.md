---
name: use-rotom
description: "Operate and extend the rotom-agent Google Chat runtime for formal weekly stakeholder progress emails grounded in Asana facts and saved template memory."
---

# Use Rotom

Rotom is the company Google Chat bot for drafting **formal weekly stakeholder progress emails**.
This skill is the operating contract for the runtime in
[`elephant-xyz/rotom-agent`](https://github.com/elephant-xyz/rotom-agent).

## Runtime summary

- **Framework:** Next.js App Router on Vercel
- **Chat surface:** Chat SDK + `@chat-adapter/gchat`
- **Memory:** Upstash Redis transcript replay
- **RAG:** Upstash Vector for user templates, saved examples, and instructions
- **Facts:** Asana REST via **per-user OAuth**
- **Observability:** LangSmith

## Canonical sources

- `ROTOM-SPEC.md` at the runtime root is the single source of truth for product behavior.
- `.cursor/skills/rotom-agent/SKILL.md` in the runtime repo is the upstream contributor guide.

## Non-negotiables

1. Webhook stays on `app/api/webhooks/[platform]/route.ts` with Node runtime.
2. Delivery stays on Chat SDK / `@chat-adapter/gchat`; direct Google Chat fetches are fallback-only
   for attachments.
3. RAG keeps exactly two responsibilities: templates, examples, and user instructions.
   **Do not store Asana task or project bodies in the vector index.**
4. Factual project/task data comes from Asana REST with per-user OAuth tokens stored by Google Chat
   `userId`.
5. Model path stays on Vercel AI SDK + Vercel AI Gateway.
6. LangSmith must wrap and flush the AI path before handlers return.

## Repo map

| Area | Location |
| --- | --- |
| Bot orchestration | `lib/bot.ts` |
| Runtime env | `lib/env.ts` |
| Transcript memory | `lib/conversation-memory.ts` |
| Vector retrieval and KB tools | `lib/vector.ts`, `lib/tools.ts` |
| Asana API + OAuth | `lib/asana-*.ts`, `app/api/auth/asana/**` |
| Prompt assembly | `lib/system-prompt.ts` |
| Product contract | `ROTOM-SPEC.md` |

## Typical tasks

- change the weekly email draft format
- add or refine Chat commands like template save/list/delete flows
- adjust template selection and saved-example retrieval
- debug Asana OAuth or per-user fact retrieval
- improve hosted HTML email rendering

## Setup

1. Copy `.env.example` to `.env.local` or pull env from Vercel.
2. Configure the Asana OAuth redirect URI as
   `{APP_BASE_URL}/api/auth/asana/callback`.
3. Connect Upstash Redis and Upstash Vector.
4. Enable AI Gateway for the Vercel project.
5. Add `GOOGLE_CHAT_CREDENTIALS`.

## Verification

Run from the `rotom-agent` checkout:

```bash
npm install
npm run build
npm run typecheck
```

Then verify the specific flow you changed:

- Google Chat webhook behavior for prompt/tool changes
- Asana OAuth connect/disconnect for auth changes
- template save/list/select flows for KB changes
- hosted HTML output for email rendering changes

## Routing notes

- Hand initiative portfolio and WOW task work to `hypno`.
- Hand new Asana-ingress Lambda agents to `ash`.
- Hand general editorial drafting to `eevee`.

## Expected output

Return:

- the feature area being changed
- the runtime boundaries that constrain the change
- files to edit and why
- commands run and key results
- verification completed
- any human setup still required
