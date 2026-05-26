---
title: Chief of Staff Platform Dependencies
impact: HIGH
tags: [chief-of-staff, connect, persist, lexicon, golden-path]
---

# Chief of Staff Platform Dependencies

Build the system on the existing platform. Do not create fallback subsystems that re-own platform responsibilities.

## Required Dependencies

### Connect

Treat Connect as the required control plane for:

- provider linking
- token refresh
- webhook or polling execution
- connector orchestration

Use a Connect-first rule:

- integrate with an existing Connect deployment when it already covers the need
- otherwise extend or provision Connect deliberately
- do not hide a mini-Connect inside `chief-of-staff`

### Persist

Treat Persist as the system of record for:

- executive-context graph persistence
- graph query semantics
- unlink cleanup and correctness verification

All authoritative writes must flow through Persist.

### Lexicon

Treat Lexicon as the owner of:

- governed graph vocabulary
- entity and metric meanings
- registration for any new Chief-of-Staff metrics

Do not introduce ad hoc graph concepts or top-level metrics outside Lexicon governance.

## No Fallback OAuth Subsystem

Do not implement a backup OAuth/token subsystem inside `chief-of-staff` because Connect is unavailable.

If Connect is missing and the operator declines to provision or extend it, stop setup with a clear not-ready state.

## No Fallback Graph Store

Do not introduce a second graph source of truth such as a standalone Neo4j, ad hoc DynamoDB graph model, or direct OpenSearch-owned graph state.

- Persist is authoritative.
- OpenSearch is only a retrieval projection over persisted evidence.
- Direct connector writes to OpenSearch are not the source of truth path.

## Golden Path Constraints

- backend services and runtime adapters must be TypeScript
- Python is allowed only for approved PySpark or Glue jobs
- infrastructure must use AWS CDK
- backend-side LLM behavior must use the Vercel AI SDK with Zod schemas
- TypeScript services should use the repo-standard linting, type-checking, bundling, and Vitest testing flow
- Lambda observability must use Powertools Logger, Tracer, and Metrics with X-Ray enabled

## Correct Example

```text
Chief-of-Staff API in TypeScript CDK
→ Connect owns provider linking and token refresh
→ Persist stores canonical executive-context entities and links
→ OpenSearch indexes are built from Persist-authoritative state
→ Lexicon defines new entities and registers new metrics
```

This follows the approved dependency graph and Golden Path.

## Incorrect Example

```text
Chief-of-Staff service adds its own OAuth tables and refresh workers
→ writes relationship data directly into OpenSearch
→ skips Lexicon because the graph terms feel app-specific
→ uses a Python FastAPI service for the main runtime
```

This duplicates Connect, bypasses Persist, ignores Lexicon governance, and violates the Golden Path.
