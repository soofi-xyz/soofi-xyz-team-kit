---
name: use-eevee
description: "Operate the Eevee editorial agent from Cursor: retrieve from the live Eevee RAG via the agent-eevee retrieve CLI, then draft pitches/propositions/website copy in Eevee's voice using Eevee's prompts. Triggers on: eevee, editorial draft, pitch, proposition, capability deck, white paper, rfp response, website copy, founder content."
---

# Use Eevee from Cursor

Eevee is a RAG-backed editorial agent. This skill governs how to operate it from Cursor:
retrieve grounding context from the live RAG, then draft using Eevee's own prompts. It does
NOT publish — drafting stops at a finished artifact in the editor.

## Prerequisites

- The **agent-eevee** repo is checked out and is the Cursor workspace (the retrieve CLI and the
  editorial prompts live there). If it is elsewhere, run CLI commands from that directory.
- `.env.local` is present in the agent-eevee checkout (`vercel env pull .env.local`).
  See `agent-eevee/docs/INSTALL-CURSOR.md`.

## Retrieve from the RAG (read-only)

Run from the agent-eevee checkout:

```bash
npm run eevee:retrieve -- "<query>" [--top-k N] [--source guidance|founder|both] [--json]
```

Returns top-K passages merged across Eevee's two text-bearing corpora, each labeled by source:

- **guidance** — the Guidance library (books/frameworks); text from Upstash Redis.
- **founder** — Soofi Safavi's articles & X posts; full text from Vercel Blob. Use this for
  **voice, tone, terminology, and framing** when drafting.

Output line: `#n [<source> | score …] <name> (id: …)` then passage text. Use `--json` for an
array of `{ id, content, score, source, metadata }`. Derive 1–3 focused queries from the user's
brief and run retrieval before drafting. If the command errors with a credentials/auth message,
STOP and tell the user to run `vercel env pull .env.local` (the OIDC token expires ~12h). Do not
draft ungrounded.

## Eevee's editorial prompts (authoring guide)

Read these from the agent-eevee checkout and follow them when drafting:

- `lib/prompts/core.md` — Eevee's base editorial system prompt.
- `lib/prompts/intents/<intent>.md` — the intent-specific prompt.
- `.cursor/skills/chief-editor-pitch-agent/` — Chief-Editor workflow and quality bar.

Intent catalog (see `lib/intent.ts`): `pitch`, `yc-application`, `a16z-speedrun`, `lite-paper`,
`white-paper`, `rfp-response`, `brain-dump-eval`, `battle-card`, `client-deck`, `website-design`.
Default to `pitch` when ambiguous.

## Rules

- Retrieve first, then write. Ground claims in retrieved passages; cite which passages support
  key points. Never invent metrics, logos, quotes, or commitments — mark gaps as assumptions.
- Read-only: this flow retrieves; it does not write to the RAG.
- Hand-off: to publish a draft as a password-protected HTML page, direct the user to the
  publishing step (separate milestone task). Do not deploy from here.

## Future-compatibility

Retrieval goes through agent-eevee's `lib/vector.ts` + `lib/investor-content.ts` interfaces; a
future centralized RAG swap behind those interfaces needs no change here. Intent-driven prompts
leave room for ontology/KG.
