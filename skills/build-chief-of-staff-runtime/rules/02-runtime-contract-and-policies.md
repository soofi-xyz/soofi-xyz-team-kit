---
title: Runtime Contract And Policies
impact: CRITICAL
tags: chief-of-staff, runtime, contract, scope, freshness, warnings
---

# Runtime Contract And Policies

- Required operations:
  - `GetLinkedAccountStatus`
  - `RetrieveExecutiveContext`
  - `GetSyncHealth`
  - `GetScopeAndSessionState`
- `scope_valid=false` must always produce `status='error'`.
- `partial` is allowed only when every warning has `can_answer_without=true`.
- Required-source policy:
  - `meeting_prep` -> calendar required
  - `priority_summary` -> asana required
  - `email_draft` -> gmail required
  - `commitment_trace` -> asana required plus one of calendar or gmail
- Required-source staleness must also block synthesis.

## Correct

```json
{
  "status": "partial",
  "scope_valid": true,
  "warnings": [
    { "source": "gmail", "reason": "stale", "can_answer_without": true }
  ]
}
```

## Incorrect

```json
{
  "status": "partial",
  "scope_valid": true,
  "warnings": [
    { "source": "calendar", "reason": "required_source_stale", "can_answer_without": false }
  ]
}
```
