---
name: build-local-rag-pocs
description: Build local TypeScript RAG proof-of-concepts with Vercel AI SDK, a local vector database, source-data intake, embedding/model selection, semantic-search tools, and a CLI chat interface. Use when prototyping local RAG, evaluating corpora, building RAG POCs, or deciding between Turso/libSQL and embedded vector databases.
---

# Build Local RAG POCs

Use this skill to design and implement a local-first RAG proof-of-concept. Keep the POC TypeScript-only, use Vercel AI SDK for inference, embeddings, and tool calling, and make every data and credential decision explicit before writing code.

This is a POC workflow, not the AWS production RAG path. For production AWS RAG agents, use `../build-rag-systems/`.

## Default Database Decision

Default to Turso/libSQL for local RAG POCs when the user wants a simple file-backed database, SQL tables, easy later migration to hosted Turso, or relational metadata next to vectors.

Use LanceDB instead when the fastest possible embedded vector-search API is more important than SQL portability, or when the local corpus is large enough that Turso's linear vector scans become the bottleneck.

Avoid Docker-first stores such as Qdrant, Chroma, or OpenSearch for a first local POC unless the user specifically asks for them or the POC must mirror an existing production vector store.

## Required Setup

Before implementing the POC in the target project, install the Vercel AI SDK skill and base package:

```bash
npx -y skills add vercel/ai
npm install ai
```

Then load the installed `ai-sdk` skill and verify current APIs from `node_modules/ai/docs/` or the AI SDK docs before writing code. Install provider and database packages only after the user chooses the provider and database.

Recommended POC dependencies for the Turso/libSQL path:

```bash
npm install @libsql/client zod dotenv
```

Add provider packages after provider selection, for example `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google-vertex`, `@ai-sdk/amazon-bedrock`, `@ai-sdk/azure`, or `@ai-sdk/voyage`, verifying current package names first.

## Workflow

Follow these phases in order.

### Phase 1 - Source, Credentials, And API Contract

Ask only the questions needed to start safely:

- What is the source data: local files, URLs, GitHub repo, database export, API responses, tickets, docs, emails, logs, or mixed sources?
- Where can the POC read it from, and what credentials are required?
- Which APIs may the POC call during ingestion and chat?
- Does the source contain PII, secrets, customer data, regulated data, or records that must not be sent to an LLM?
- What is the expected chat task: answer questions, summarize, compare, classify, map fields, retrieve examples, or support an agent workflow?
- What proves the POC works: sample queries, expected sources, answer style, latency target, or a small eval set?

Do not embed or send source content to a provider until the user approves the data boundary and credentials.

### Phase 2 - Model The Data

Define the corpus before implementation:

- source record shape and stable IDs
- chunking strategy: chunk size, overlap, boundary rules, and how tables/code/frontmatter are preserved
- `text_for_embedding`: exactly what text is embedded
- `text_for_context`: exactly what text may be shown to the LLM
- metadata: source URI, title, section, page, heading path, timestamps, tenant/workspace, content type, language, tags, source hash, chunk index, and access scope
- embedding model, dimension, provider, and embedding version
- filters needed before vector ranking, such as tenant, source type, document family, status, or date

Prefer deterministic chunk IDs based on source ID, chunk index, and source hash so ingestion can be re-run idempotently.

### Phase 3 - Choose Inference And Embeddings

Ask which inference provider the user wants for chat: OpenAI, Anthropic, GitHub Models, AWS Bedrock, Google Vertex AI, Azure OpenAI, or another cloud available through the AI SDK.

Suggest only current best embedding choices for the selected provider:

- OpenAI: `text-embedding-3-large` for highest-quality text retrieval.
- Azure OpenAI: a deployment of `text-embedding-3-large`.
- GitHub Models: `openai/text-embedding-3-large` through GitHub Models embeddings.
- Google Cloud: `gemini-embedding-2` for multimodal or high-quality text retrieval.
- AWS Bedrock: Cohere Embed v4, model ID `cohere.embed-v4:0`.
- Anthropic: Anthropic has no first-party embedding model. Use Claude for chat only, then ask for an embedding provider; recommend Voyage `voyage-4-large` when the user wants the Anthropic-documented default.

For every provider, verify current model IDs from provider docs or the AI SDK Gateway model list immediately before writing code. Do not hard-code stale chat model IDs from memory.

### Phase 4 - Implement The POC

Use a small, inspectable TypeScript layout:

```text
src/rag/config.ts
src/rag/sources.ts
src/rag/chunk.ts
src/rag/db.ts
src/rag/embed.ts
src/rag/search.ts
src/rag/agent.ts
src/cli.ts
data/rag.local.db
```

For Turso/libSQL, initialize a local file database with SQL tables for sources and chunks:

- `rag_sources(id, source_uri, source_type, title, source_hash, metadata_json, created_at)`
- `rag_chunks(id, source_id, chunk_index, text_for_embedding, text_for_context, metadata_json, embedding, embedding_model, embedding_dimension, source_hash, created_at)`

Store embeddings as vector BLOBs using `vector32(?)`, and query with `vector_distance_cos(embedding, vector32(?))`. Use parameterized SQL for all user input and vector JSON strings.

Implement ingestion as repeatable commands:

- `npm run rag:init` creates or migrates the local database.
- `npm run rag:ingest -- <source>` loads source data, chunks it, embeds chunks with `embedMany`, and upserts records.
- `npm run rag:search -- "query"` embeds a query and prints top matches with distances and metadata.
- `npm run rag:chat` opens the CLI chat.

### Phase 5 - Build The Chat Interface

Prefer a simple CLI chat for the first POC. The chat agent must have a semantic-search tool, not direct uncontrolled database access.

The search tool contract:

- input: `{ query: string, topK?: number, filters?: Record<string, string> }`
- behavior: embed the query with the same provider family, run semantic search, return ranked chunks with IDs, distances, metadata, and short context snippets
- output: `{ results: Array<{ id, sourceUri, title, distance, metadata, text }> }`

Use AI SDK `tool({ inputSchema, execute })` with Zod, and run the agent with `generateText` plus `stopWhen` or `ToolLoopAgent`. Keep the system prompt outcome-first:

```text
You answer using the local RAG database through the semanticSearch tool.
Use retrieved evidence for factual claims. If retrieval is weak or missing, say what is missing and ask for the smallest useful follow-up.
Keep answers concise, cite source titles or URIs from tool results, and do not claim the local corpus contains facts that were not retrieved.
```

## Prompting Rules

Follow GPT-5.5 prompt guidance:

- Start prompts with the outcome and success criteria.
- Keep process instructions short; use strict words only for true invariants.
- Add a retrieval budget: search once, search again only when evidence is missing or filters need correction.
- Add stopping rules: answer when retrieved evidence is sufficient; ask a narrow question when it is not.
- Add validation loops: run search smoke tests and at least two chat questions before calling the POC complete.

## Verification

Before returning the POC:

- run `npm run rag:init`
- run ingestion on a tiny fixture and one real approved source
- run `npm run rag:search -- "<known query>"`
- run `npm run rag:chat` and ask at least two corpus-grounded questions
- verify citations point to retrieved chunks
- verify no secrets were stored in `data/`, logs, prompts, or committed fixtures
- run TypeScript typecheck or the project's closest validation command

## Output Contract

Return:

- selected local database and why
- source-data and credential contract
- corpus, chunk, embedding, and metadata model
- inference and embedding provider choice
- TypeScript file layout
- commands to initialize, ingest, search, and chat
- verification results and remaining limitations
