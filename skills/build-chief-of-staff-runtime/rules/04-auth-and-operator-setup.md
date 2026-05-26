---
title: Auth And Operator Setup
impact: CRITICAL
tags: chief-of-staff, auth, operator, bootstrap, session
---

# Auth And Operator Setup

- Keep auth explicit by plane:
  - operator AWS access/setup
  - provider OAuth linking/token capture
  - internal service auth with IAM/SigV4 where possible
  - Cursor-to-backend short-lived opaque session handle
- Do not allow manual token pasting into Cursor.
- Do not store provider tokens or long-lived secrets in the repo prompt.
- Require the runtime build plan to document bootstrap timeout, relink flow, cleanup-in-progress behavior, and scope invalidation behavior.

## Correct

```md
- Cursor stores only a revocable opaque session handle in a local secret store.
- Backend-owned linking happens outside Cursor and reports status back through typed APIs.
```

## Incorrect

```md
- Ask the user to paste a Gmail refresh token into chat.
- Reuse one long-lived backend API key for every executive session.
```
