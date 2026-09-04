---
name: use-magnezone
description: "Operate and extend the magnezone-agent relationship-intelligence scaffold for Google Chat, web query, Google Workspace event ingestion, and OpenClaw-aware deployment."
---

# Use Magnezone

Magnezone is the company relationship-intelligence scaffold in
[`elephant-xyz/magnezone-agent`](https://github.com/elephant-xyz/magnezone-agent). This skill is
the operator contract for working on that runtime from the team kit.

## Current reality

Magnezone is **implementation-first and partially complete**:

- deployable Next.js App Router app on Vercel
- shared execution path for web UI and Google Chat
- user-scoped transcript storage
- user-scoped vector retrieval
- Google Workspace webhook ingestion scaffold
- OpenClaw-aware deploy automation

It does **not** yet fully implement:

- direct runtime OpenClaw reads
- durable sync orchestration
- Convex-backed state or subscriptions
- full Gmail / Calendar / Drive chunk pipelines
- agent-time OpenClaw reads during query execution

Keep that status explicit in both code and user-facing explanations.

## Runtime summary

- **Framework:** Next.js App Router on Vercel
- **Surfaces:** web query console + Google Chat
- **Storage:** Redis / KV transcripts with in-memory fallback
- **Retrieval:** Upstash Vector with in-memory fallback
- **Workspace ingest:** Google Workspace webhook path
- **Observability:** optional LangSmith
- **Companion dependency:** OpenClaw, treated as an external control plane

## Canonical sources

- `MAGNEZONE-SPEC.md` at the runtime root
- `README.md` in the runtime repo for actual implemented behavior and deploy flow

## Repo map

Use the runtime checkout to confirm exact paths, then classify the request into:

- web UI / query console
- Google Chat behavior
- Google Workspace event ingestion
- retrieval / transcript boundaries
- deployment / OpenClaw bootstrapping

## Deployment contract

Prefer the documented flows:

```bash
npx @vercel/vclaw create --scope <team>
npm run deploy:vercel
```

Deployment must keep org-safe targeting explicit through env vars such as:

- `MAGNEZONE_VERCEL_SCOPE`
- `MAGNEZONE_VERCEL_PROJECT_NAME`
- `OPENCLAW_VERCEL_SCOPE`
- `OPENCLAW_PROJECT_NAME`

Do not rely on the operator's currently logged-in personal Vercel context.

## Verification

Run from the `magnezone-agent` checkout:

```bash
npm install
npm run lint
npm run typecheck
npm run build
```

Then do targeted verification for any changed routes, status endpoints, deployment logic, or
webhook paths.

## Routing notes

- Hand initiative portfolio and WOW task work to `hypno`.
- Hand weekly stakeholder email generation to `rotom`.
- Hand new Asana-triggered Lambda agents to `ash`.
- Hand general RAG architecture questions to `alakazam` or `espeon`.

## Expected output

Return:

- the feature area being changed
- implemented vs not-yet-implemented status relevant to that change
- files to edit and why
- commands run and key results
- verification completed
- any required human dependencies or deployment configuration
