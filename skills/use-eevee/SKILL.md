---
name: use-eevee
description: "Drafting editorial content in the organization's voice — pitches, propositions, website copy, papers, and decks grounded in the curated knowledge base."
---

# Use Eevee from Cursor

Eevee is a RAG-backed editorial agent. This skill governs how to operate it from Cursor:
retrieve grounding context from the live RAG, then draft using Eevee's own prompts. It does
NOT publish — drafting stops at a finished artifact in the editor.

## Prerequisites

- The **agent-eevee** repo is checked out and is the workspace (Eevee's editorial prompts live
  there). If it is elsewhere, read the prompts from that directory.
- Persist access: the soofi-safavi Persist API key, which the bundled `persist` MCP server uses too.
  Read [Get Persist access](#get-persist-access).

## Retrieve from Persist (read-only)

Eevee's knowledge (the guidance library, the thumbnail style corpus, and Soofi Safavi's articles
and posts) lives in soofi-safavi's Persist, in the `eevee-knowledge` graph. Retrieve with the CLI
bundled in this skill. It is plain `node` (18+) with no dependencies, so it runs under restricted
command sandboxes, including Cursor's, and from any directory:

```bash
node <this skill's directory>/scripts/eevee-retrieve.mjs "<query>" [--top-k N] \
  [--source guidance|thumbnail|founder|both] [--document-type <type>] [--json]
```

It sends the same Persist GraphQL `search` calls as agent-eevee's `lib/persist-knowledge.ts`
(`SEMANTIC` mode, scoped with `linkedTo`), so it returns the passages Eevee itself sees:

- **guidance** — passages of the Guidance library (books, frameworks, papers, RFPs).
- **founder** — Soofi Safavi's articles and X posts, one hit per post or article. Use these for
  **voice, tone, terminology, and framing** when drafting.
- **thumbnail** — the thumbnail style corpus, for thumbnail and visual-concept work only.
- **both** (default) — guidance and founder, merged by alternating rank.

`--document-type` narrows guidance or thumbnail passages to one Eevee document type, for example
`lite-paper-reference`, `white-paper-reference`, `framework`, `book`, `rfp`, or
`thumbnail-house-style`, and selects the matching source. Persist returns a ranking without scores.

Output line: `#n [<source>] <title> (id: …)` then the passage text. Use `--json` for an array of
`{ id, content, source, metadata }`. Derive 1–3 focused queries from the brief and run retrieval
before drafting. If the command fails, STOP and report the exact error and its fix. Do not draft
ungrounded.

Optional env: `PERSIST_SEARCH_MODE` (`SEMANTIC` default, `HYBRID`, `KEYWORD`) and
`PERSIST_API_URL` (default `https://soofi-safavi.account.prismteam.ai`).

### Get Persist access

1. Ask Saman Safavi for the soofi-safavi Persist API key (it is in the team password manager).
   Never paste it into a chat, a prompt, or a committed file.
2. Save it once, readable only by you:

   ```bash
   mkdir -p ~/.config/prism && (umask 077; read -rs KEY && printf '%s' "$KEY" > ~/.config/prism/soofi-safavi.key)
   ```

   Or export it as `PRISM_API_KEY` in your shell profile. The CLI and the bundled `persist` and
   `report` MCP servers read the same key, from `PRISM_API_KEY` first and then that file.
3. Check: `node <this skill's directory>/scripts/eevee-retrieve.mjs "what makes a strong pitch" --top-k 2`
   prints two passages. Without a key it fails with `No Persist API key. ...`.

### Fallback: the legacy Vercel path

Until every teammate has the Persist key, the old path still works. Set
`EEVEE_KNOWLEDGE_BACKEND=upstash`, then run the same command from the agent-eevee checkout. The CLI
hands the query to agent-eevee's `scripts/dist/eevee-retrieve.mjs`, which reads Upstash Vector +
Redis + Vercel Blob. It needs `npm install` in the checkout and `.env.local` from
`vercel env pull .env.local` (the OIDC token expires after about 12 hours; pull again on auth
errors). `--source thumbnail` and `--document-type` need Persist. This fallback will be removed
once Persist access works for everyone.

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
- Read-only: this flow retrieves; it does not write to Persist or the legacy stores.
- Hand-off: to publish a draft as a password-protected HTML page, direct the user to the
  publishing step (separate milestone task). Do not deploy from here.

## Publish as a password-protected HTML page

After drafting, you can publish the result as a standalone page with its own password:

1. Render the draft to a **single self-contained HTML file** (`out/<name>.html` in the agent-eevee
   checkout): inline `<style>`, no external CSS/JS/CDN. Reuse the Capgemini palette from
   `app/catalog/page.tsx` (`#0070AD`, `#1B365D`, `#F5F7FA`) for a consistent look.
2. Publish it via the prebuilt node bundle (sandbox-safe; built by `npm install`). Publishing
   still stores the page in Vercel Blob, so it needs `.env.local` from `vercel env pull .env.local`
   in the agent-eevee checkout; only retrieval moved to Persist.

   ```bash
   node scripts/dist/eevee-publish.mjs out/<name>.html --title "<Title>" [--password <p>]
   ```

   Omit `--password` to auto-generate a strong one. The CLI prints the shareable **URL** and the
   **password** (shown once — capture both).
3. Report the URL + password to the user. Each page has its **own** password (independent of the
   internal catalog), so it is safe to share a single page externally. Do not invent or reuse passwords.

The page is served at `<base>/p/<slug>` behind that per-page password (`base` = `PUBLISH_BASE_URL`
or the agent-eevee deployment; a soofi.xyz domain maps on later with no code change). The content
is stored privately (never at a public URL); the gate prompts for the per-page password.

## Future-compatibility

Retrieval reads Persist directly and mirrors agent-eevee's `lib/persist-knowledge.ts`; when that
module's queries change, change `scripts/eevee-retrieve.mjs` with it. Intent-driven prompts leave
room for ontology/KG.
