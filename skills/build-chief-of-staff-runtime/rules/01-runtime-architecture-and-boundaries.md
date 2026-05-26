---
title: Runtime Architecture And Boundaries
impact: CRITICAL
tags: chief-of-staff, runtime, backend, cursor, ownership
---

# Runtime Architecture And Boundaries

- Use this rule when the user wants the deployed backend designed or scaffolded.
- Keep Cursor as the owner of final synthesis and draft generation in v1.
- Keep backend ownership limited to retrieval, auth/linking, sync, scope/session, provenance, and source health.
- Never move provider OAuth, graph persistence, or vector-index internals into the prompt layer.

## Correct

```md
- The backend returns evidence, freshness, warnings, and session state.
- Cursor turns that evidence into the final user-facing answer or draft.
```

## Incorrect

```md
- The backend writes the final Gmail reply body for Cursor to display.
- Cursor stores provider refresh tokens so it can skip backend relink flows.
```
