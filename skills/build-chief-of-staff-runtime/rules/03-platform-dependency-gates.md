---
title: Platform Dependency Gates
impact: CRITICAL
tags: chief-of-staff, connect, persist, lexicon, opensearch, dependencies
---

# Platform Dependency Gates

- Treat Connect as the required home for provider OAuth, token refresh, webhook/poll control, and connector execution.
- Treat Persist as the required system of record for executive-context state.
- Treat Lexicon as the owner of governed vocabulary and metric registration.
- Treat OpenSearch as a retrieval projection, never the source of truth.
- If Connect or Persist is missing and the operator declines to extend or provision it, the build should stop in a not-ready state.

## Incorrect

```md
- Add a small Chief-of-Staff-only OAuth table so Gmail can work before Connect is ready.
- Write retrieval documents straight into OpenSearch and skip Persist.
```
