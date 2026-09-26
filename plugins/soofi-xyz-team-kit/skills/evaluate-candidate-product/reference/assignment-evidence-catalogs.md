# Assignment-Specific Evidence Catalogs

Use these catalogs when the candidate assignment matches one of the known PrismTeam assignments. They list the runtime/data/output/demo evidence to look for and the access boundaries to enforce. When the assignment is not listed, derive an equivalent catalog from the story's evidence model (`evaluate-candidate-intent`).

Treat each catalog item as an **evidence probe** for the intent, not a checklist that replaces the outcome. Cite observed runtime behavior, data, or output for each item.

## X Engagement Reply Agent

Intent shape: an agent monitors a watchlist, finds relevant new posts, matches them against MCP-served articles, and drafts grounded replies into Asana for review.

Evidence to look for:

- **Watchlist authors** configured and used.
- **Posts fetched** from the source and **new posts processed** (de-duplicated against prior runs).
- **MCP article matches** with **match scores**.
- **Generated replies** grounded in matched articles.
- **Prompt files used** (versioned, inspectable).
- **Asana parent and subtask outputs** created for review.
- **Dry-run mode** support.
- **Run logs** showing a real end-to-end run.

Access boundaries (enforce strictly):

- Must use the **hosted investors-mcp read tools** for article retrieval.
- **Direct database, vector-store, or blob access is a violation.** Flag any code path or runtime call that bypasses the hosted MCP read interface.

## Oracle Property Intelligence Platform

Intent shape: a platform ingests real property/permit (and related) records and lets a user explore and inquire over canonical, provenance-tracked entities with RAG-backed retrieval.

Evidence to look for:

- **Loaded dataset coverage** — real records at realistic scale, not a toy sample.
- **Canonical entity and relationship modeling** across sources.
- **Source provenance** for ingested records.
- **RAG-backed retrieval** over the real records.
- **Exploration UI** for browsing entities/relationships.
- **Required inquiry workflows** executed over real records (not mocked).

Scale signal: coverage and record counts are central to the outcome; sparse data scores extremely low on functional outcome.

## Agent Network Registration and Certification Platform

Intent shape: a marketplace where agents are discovered, registered, reviewed/certified, and published, with certified-only publishing enforced and usage tracked.

Evidence to look for:

- **Discovery** of agents.
- **Registration** workflow.
- **Certification review** workflow.
- **Marketplace publication**.
- **Certified-only publish enforcement** (uncertified agents cannot be published).
- **Profile views**.
- **Usage tracking**.
- **Dashboard metrics**.

## investors-mcp reference fork

Use the reference fork to judge correctness and access boundaries for assignments that depend on it (notably X Engagement). Compare the candidate's integration against the reference fork's intended read-tool surface; treat deviations that bypass the hosted read tools as access-boundary violations.
