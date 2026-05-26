---
name: build-local-rag-pocs
description: Build simple local TypeScript RAG CLIs for agents to query, with libSQL file databases, embedding-backed search, machine-readable commands, and AGENTS.md usage instructions. Use when prototyping local RAG, evaluating corpora, building query-only RAG tools, or teaching agents to use local retrieval from the terminal.
---

# Build Local RAG CLIs

Use this skill to design and implement a local-first RAG proof-of-concept as a small CLI that agents can call from the terminal. Keep the POC TypeScript-only, use whatever embedding SDK is available in the runtime environment, and make every data and credential decision explicit before writing code.

Do not build an autonomous RAG agent or chat loop by default. The deliverable is a query-only CLI plus written instructions that teach future agents which commands to run and how to interpret the JSON output.

This is a local CLI workflow, not the AWS production RAG path. For production AWS RAG agents, use `../build-rag-systems/`.

## Default Database Decision

Default to a local libSQL file database when the user wants a simple agent-friendly RAG tool, SQL metadata, a prebuilt database located by path, or a later migration path to hosted Turso.

For small corpora, store embeddings as JSON arrays and compute cosine similarity in TypeScript. This keeps the CLI portable and avoids relying on local vector extensions. Use libSQL vector columns or LanceDB only when corpus size makes in-memory scoring too slow.

Avoid Docker-first stores such as Qdrant, Chroma, or OpenSearch for a first local POC unless the user specifically asks for them or the POC must mirror an existing production vector store.

## Embedding SDK Setup

Use the Vercel AI SDK when it is already available or when the target project can adopt it cleanly. In that case, install the skill and base package with the target project's package manager; examples use `pnpm`:

```bash
npx -y skills add vercel/ai
pnpm add ai
```

Then load the installed `ai-sdk` skill and verify current embedding APIs from `node_modules/ai/docs/` or the AI SDK docs before writing code.

If the Vercel AI SDK is not available or is a poor fit for the environment where the CLI runs, use the official provider SDK or another locally supported SDK instead. Examples include AWS SDK Bedrock Runtime, OpenAI's SDK, Azure OpenAI SDKs, Google Vertex AI SDKs, or a provider-specific HTTP client. Keep the rest of the CLI contract the same: embed the query, search the local database, and print JSON.

Recommended CLI dependencies for the libSQL path:

```bash
pnpm add @libsql/client zod dotenv
```

Add an embedding provider package after provider selection, verifying current package names first. If using Vercel AI SDK, examples include `@ai-sdk/amazon-bedrock`, `@ai-sdk/openai`, `@ai-sdk/google-vertex`, `@ai-sdk/azure`, or `@ai-sdk/voyage`. If using another SDK, use the provider's current package instead.

## Workflow

Follow these phases in order.

### Phase 1 - CLI Purpose And Data Boundary

Ask only the questions needed to start safely:

- What should the CLI help agents answer: matching stories, likely file paths, implementation evidence, source examples, or another retrieval task?
- Is the database prebuilt, or should this project include a local import command for approved files?
- Where will the local database live, and should `data/` be gitignored?
- Which APIs may the CLI call at query time? Prefer embeddings only.
- What credentials are required for embeddings, and how should they be loaded from `.env`?
- Does the source contain PII, secrets, customer data, regulated data, or records that must not be sent to an LLM?
- What proves the CLI works: sample queries, expected matches, expected path suggestions, latency target, or a tiny fixture database?

Do not embed or send source content to a provider until the user approves the data boundary and credentials. Do not add live SaaS ingestion such as Asana or GitHub unless explicitly requested; prefer a prebuilt local database for the first tool.

### Phase 2 - Model The Data

Define the local database contract before implementation:

- source record shape and stable IDs
- chunking strategy used by the prebuilt database or import command
- `text_for_embedding`: exactly what text is embedded
- `text_for_context`: exactly what text may be returned to agents
- metadata: source URI, title, source type, chunk role, timestamps, tenant/workspace, tags, source hash, chunk index, access scope, and domain-specific fields such as PR number or file path
- embedding model, dimension, provider, and embedding version
- link relations between sources, such as story-to-PR or PR-to-diff links
- filters needed before ranking, such as source type, document family, status, date, repo, or path prefix

Prefer deterministic chunk IDs based on source ID, chunk index, and source hash so ingestion can be re-run idempotently.

Recommended tables:

```text
rag_sources(id, source_uri, source_type, title, source_hash, metadata_json, text_for_context)
rag_chunks(id, source_id, chunk_index, chunk_role, text_for_embedding, text_for_context, metadata_json, embedding_json, embedding_model, embedding_dimension, source_hash)
rag_links(source_id, target_source_id, relation, metadata_json)
```

### Phase 3 - Choose Embeddings

Ask which embedding provider and SDK the user wants: AWS Bedrock, OpenAI, GitHub Models, Google Vertex AI, Azure OpenAI, Voyage, or another provider available in the runtime environment.

Suggest only current best embedding choices for the selected provider:

- OpenAI: `text-embedding-3-large` for highest-quality text retrieval.
- Azure OpenAI: a deployment of `text-embedding-3-large`.
- GitHub Models: `openai/text-embedding-3-large` through GitHub Models embeddings.
- Google Cloud: `gemini-embedding-2` for multimodal or high-quality text retrieval.
- AWS Bedrock: Cohere Embed v4, model ID `cohere.embed-v4:0`.
- For an AWS-only internal CLI, Amazon Titan Text Embeddings v2 may be acceptable when the existing database was built with `amazon.titan-embed-text-v2:0`.
- Anthropic has no first-party embedding model. Ask for a separate embedding provider; recommend Voyage `voyage-4-large` when the user wants the Anthropic-documented path.

For every provider, verify current model IDs from provider docs, the chosen SDK docs, or the AI SDK Gateway model list immediately before writing code.

### Phase 4 - Implement The CLI

Use a small, inspectable TypeScript layout:

```text
src/config.ts
src/cli.ts
src/db.ts
src/embed.ts
src/search.ts
src/debug.ts
src/types.ts
AGENTS.md
README.md
data/<name>.local.db
```

Implement repeatable commands:

- `pnpm inspect` prints source, chunk, and link counts.
- `pnpm query -- "query text"` embeds the query and returns ranked source matches with linked evidence.
- `pnpm paths -- "acceptance criteria"` returns likely file paths inferred from linked diff or implementation chunks when the corpus supports it.
- `pnpm paths -- --file ./prompt.txt` accepts long or multiline criteria.
- `RAG_DEBUG=true pnpm query -- "query text"` prints summarized debug logs to stderr while stdout stays valid JSON.

Make JSON the default stdout format so agents can parse command output. If a text mode exists, keep it optional with `--format text`.

The CLI should:

- load `.env` with Zod-validated config
- open `file:${RAG_DB_PATH}` with `@libsql/client`
- embed only the user query at command time
- use the same embedding model family and dimension used to build the database
- use parameterized SQL for every database read
- rank with cosine similarity over stored embeddings
- include source URIs, titles, scores or distances, metadata, and compact snippets in results
- close the database client in `finally`

### Phase 5 - Teach Agents To Use It

Add or update `AGENTS.md` in the target CLI project. Keep it operational and command-oriented:

- state that the project is a query-only local RAG CLI
- say whether live ingestion is forbidden or allowed
- list required environment variables and safe defaults
- document where the gitignored database should live
- tell agents to run `pnpm inspect` before relying on the database
- tell agents to use `pnpm paths` for acceptance criteria and "what files likely change?" questions
- tell agents to use `pnpm query` for matching stories, documents, PRs, or evidence
- state that normal output is JSON on stdout and debug logs go to stderr
- define what each output field means
- warn agents not to invent file paths or facts when matches or suggestions are empty

Use this command vocabulary unless the domain requires different names:

```bash
pnpm inspect
pnpm query -- "End-to-End test in CD pipeline"
pnpm paths -- "Acceptance Criteria: cookie consent banner, cookie preference modal, consent storage"
pnpm paths -- --top-k 10 "cookie consent"
pnpm paths -- --file ./acceptance-criteria.txt
```

## Agent Usage Rules

When using a local RAG CLI built by this skill:

- Run `pnpm inspect` first to confirm the database exists and has the expected corpus.
- Run one targeted query before making a recommendation.
- Parse stdout as JSON. Ignore stderr except for debug diagnostics.
- Treat retrieved source titles, URIs, snippets, scores, and linked evidence as hints, not proof by themselves.
- If `paths` returns no suggestions, say that no linked implementation evidence was found instead of guessing file paths.
- If retrieval is weak, ask for a narrower query or inspect the codebase normally.

## Verification

Before returning the CLI:

- run `pnpm typecheck` or the project's closest validation command
- run `pnpm inspect`
- run `pnpm query -- "<known query>"`
- if implemented, run `pnpm paths -- "<known acceptance criteria>"`
- verify stdout is valid JSON for normal commands
- verify debug logs go to stderr when `RAG_DEBUG=true`
- verify no secrets or local databases are committed
- verify `AGENTS.md` teaches agents when to use `inspect`, `query`, and `paths`

## Output Contract

Return:

- selected local database and storage format
- source-data, prebuilt database, and credential contract
- corpus, chunk, link, embedding, and metadata model
- embedding provider choice
- TypeScript file layout
- command surface and JSON output shapes
- `AGENTS.md` usage instructions for future agents
- verification results and remaining limitations
