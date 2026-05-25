---
name: build-chief-of-staff-system
description: "Use when implementing or changing the Chief of Staff system from its approved design: lock the Cursor prompt vs backend runtime boundary first, keep v1 read-only with Cursor-side synthesis/drafting, and integrate required Connect, Persist, and Lexicon platform dependencies under the Golden Path."
---

# Build Chief of Staff System

Use this skill when building or refactoring the `chief-of-staff` system.

Treat `chief-of-staff` as a paired system:

1. a Cursor-side subagent prompt in this repo
2. a deployed backend/runtime that owns secure operations and persistent state

Do not collapse those layers into one prompt, one runtime, or one vague "agent."

## Workflow

Follow this order:

1. Lock the **repo-prompt vs backend-runtime boundary** before planning implementation details.
2. Keep **v1 Cursor-side synthesis and drafting** in the repo prompt. The backend returns structured evidence, provenance, freshness, scope, session, and source-health state.
3. Treat the backend/runtime as the owner of:
   - retrieval APIs and retrieval indexes
   - provider account linking and token refresh
   - ingestion and normalization
   - sync health and freshness state
   - scope and session state
   - provenance and source-health state
4. Treat **Connect** and **Persist** as required dependencies for a working v1 system. Treat **Lexicon** as the governed vocabulary and metrics dependency for new concepts and metrics.
5. Keep v1 **read-only and draft-only**: no outbound mutations, no sending, no proactive notification workflows.

## Boundary Rules

- The Cursor prompt owns user conversation, intent framing, deciding which backend capability to call, final answer synthesis, draft generation, and surfacing provenance/caveats.
- The backend owns provider auth, linked-account status, sync orchestration, retrieval, scope/session state, and persistent executive-context state.
- The backend must return structured contract data. The Cursor prompt must not reimplement connector logic, OAuth, graph persistence, or ad hoc session handling.

## Required Rules

Read these rules first and keep them authoritative:

| Rule | File | Focus |
| --- | --- | --- |
| Chief of Staff Boundary And Ownership | `rules/01-boundary-and-ownership.md` | prompt/runtime split and v1 ownership |
| Chief of Staff Runtime Contract | `rules/02-runtime-contract.md` | fixed backend operations and response invariants |
| Chief of Staff Platform Dependencies | `rules/03-platform-dependencies.md` | Connect, Persist, Lexicon, and Golden Path constraints |

## Review Checklist

Before considering a design or implementation acceptable, confirm:

- the Cursor prompt does not own provider auth, token storage, or connector execution
- the backend does not own end-user conversational UX or final drafted prose in v1
- `RetrieveExecutiveContext` returns evidence and warnings, not opaque conclusions
- scope and session state come from `GetScopeAndSessionState`, not prompt guesses
- source availability and sync freshness come from backend contract operations
- Connect is used or explicitly extended for linking and connector control-plane behavior
- Persist remains the graph system of record
- Lexicon owns governed vocabulary and metrics registration for new concepts

## Related Skills

| Skill | Load when |
| --- | --- |
| `[apply-engineering-guidelines](../apply-engineering-guidelines/)` | applying the TypeScript, CDK, testing, observability, and AI standards |
| `[build-ai-agents](../build-ai-agents/)` | designing typed backend AI/tool workflows when backend-side LLM behavior is added |
| `[build-rag-systems](../build-rag-systems/)` | designing retrieval, projection, and evidence-oriented RAG behavior |
