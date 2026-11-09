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
- The bundled `persist` MCP server is connected. It needs the soofi-safavi Persist API key; read
  [Get Persist access](#get-persist-access).

## Retrieve from Persist (read-only)

Eevee's knowledge (the guidance library, the thumbnail style corpus, and Soofi Safavi's articles
and posts) lives in soofi-safavi's Persist, in the `eevee-knowledge` graph. Retrieve it with the
`persist` MCP server's `search` tool, always with `mode: "SEMANTIC"` (the tool defaults to
`HYBRID`) and `linked_to` one of these anchors:

| Source | `linked_to` id | `labels` |
|---|---|---|
| guidance (books, frameworks, papers, RFPs) | `knowledge_corpus:eevee:corpus/guidance` | `["knowledge_passage"]` |
| thumbnail style (thumbnail and visual-concept work only) | `knowledge_corpus:eevee:corpus/thumbnail-style` | `["knowledge_passage"]` |
| founder content (Soofi Safavi's articles and X posts) | `author_profile:eevee:author/soofisafavi` | `["social_post", "article_segment"]` |

```js
search({ query, mode: "SEMANTIC", limit: 2 * n, labels: ["knowledge_passage"],
         linked_to: { ids: ["knowledge_corpus:eevee:corpus/guidance"] } })
```

Derive 1–3 focused queries from the brief and run them against guidance and founder content
before drafting. Use founder content for **voice, tone, terminology, and framing**. Hits come in
ranking order without scores. `limit` is capped at 25; page with `after: next_cursor`.

**Full text.** A hit's `text` is a snippet of about 240 characters ending in `…`. Before you
quote or cite a hit, fetch its full text and citation fields in one `run_graphql` call, with an
alias per hit:

```graphql
query {
  p0: knowledge_passage(id: "eevee:passage/…") { text
    rev_knowledge_document_has_knowledge_passage(first: 1) { id title author_display source_reference
      document_type style_reference_type
      supersededBy: rev_knowledge_document_supersedes_knowledge_document(first: 1) { id } } }
  a0: article_segment(id: "article_segment:eevee:segment/…") { text
    rev_article_has_article_segment(first: 1) { id title source_uri } }
  s0: social_post(id: "…") { text title source_uri }
}
```

Drop a passage whose document has a `supersededBy` entry: Eevee wrote a newer revision of it.
Ask `search` for twice the passages you need so that this still leaves enough.

**Type filter.** To narrow guidance or thumbnail passages to one Eevee document type, list the
corpus documents with `run_graphql`
(`knowledge_corpus(id) { knowledge_corpus_has_knowledge_document(first: 50, after: "<offset>") { id document_type style_reference_type supersededBy: … } }`),
keep the current documents of that type, and then:

- 10 or fewer documents: pass their ids as `linked_to.ids`.
- More than 10: search the corpus and keep hits whose `knowledge_document` source is in the set,
  paging with `after` (up to about 6 pages).

| Eevee type | Persist `document_type` |
|---|---|
| `book`, `framework`, `rfp`, `essay` | `BOOK`, `FRAMEWORK`, `RFP`, `ESSAY` |
| `white-paper-reference` | `WHITE_PAPER` |
| `lite-paper-reference` (also `light-paper-reference`) | `LITEPAPER` |
| `rfp-strategy`, `rfp-supporting-material` | `RFP_RESPONSE_STRATEGY`, `RFP_SUPPORTING_MATERIAL` |
| `agent-definition`, `funding-application`, `vendor-agreement` | `AGENT_DEFINITION`, `FUNDING_APPLICATION`, `VENDOR_AGREEMENT` |
| `thumbnail-<x>` (for example `thumbnail-house-style`) | `STYLE_REFERENCE`, with `style_reference_type` `<X>` in upper snake case (`HOUSE_STYLE`); `thumbnail-style-recipe`, `-taxonomy`, `-observation` map to `RECIPE`, `TAXONOMY`, `OBSERVATION` |

**Founder results.** Ask `search` for three times the items you need. Keep one result per post
or per article: an `article_segment` belongs to the article in its `article_has_article_segment`
source, and the article keeps the rank of its best segment. For each article, use its best-ranked
segment that holds more than the article title. Use a segment whose text is only the title (the
article's headline) only when no fuller segment of that article was returned. Cite the article
or post `title` and `source_uri`.

If the `persist` tools are missing or return an authentication error, STOP and point the user to
[Get Persist access](#get-persist-access). Do not draft ungrounded.

### Get Persist access

1. Ask Saman Safavi for the soofi-safavi Persist API key (it is in the team password manager).
   Never paste it into a chat, a prompt, or a committed file.
2. Save it once, readable only by you, or export it as `PRISM_API_KEY` in your shell profile:

   ```bash
   mkdir -p ~/.config/prism && (umask 077; read -rs KEY && printf '%s' "$KEY" > ~/.config/prism/soofi-safavi.key)
   ```

3. Restart the editor or reload its MCP servers. The bundled `persist` and `report` servers read
   the key from `PRISM_API_KEY` first, then from that file. Check by asking the agent to run
   `search({ query: "pitch narrative", mode: "SEMANTIC", limit: 2, linked_to: { ids: ["knowledge_corpus:eevee:corpus/guidance"] } })`.

Teammates without Persist access can still use the old Vercel path in agent-eevee:
`EEVEE_KNOWLEDGE_BACKEND=upstash node scripts/dist/eevee-retrieve.mjs "<query>"` with `.env.local`
from `vercel env pull .env.local` (see agent-eevee `docs/INSTALL-CURSOR.md`).

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

Retrieval follows agent-eevee's `lib/persist-knowledge.ts` through the `persist` MCP server; when
that module's scoping or type mapping changes, change this skill with it. Intent-driven prompts leave
room for ontology/KG.
