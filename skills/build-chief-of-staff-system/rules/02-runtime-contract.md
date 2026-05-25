---
title: Chief of Staff Runtime Contract
impact: CRITICAL
tags: [chief-of-staff, api-contract, retrieval, session]
---

# Chief of Staff Runtime Contract

Use a small fixed backend contract. Do not invent ad hoc prompt-to-runtime calls.

## Required Operations

### 1. `GetLinkedAccountStatus`

Return linked providers, linked identities, auth state, and per-source availability.

Each source should expose an availability reason such as:

- `available`
- `unavailable_auth_required`
- `unavailable_cleanup_in_progress`
- `unavailable_sync_failed`

### 2. `RetrieveExecutiveContext`

Accept:

- `question`
- `question_family`
- explicit scope or session-derived scope

Use typed `question_family` values such as:

- `meeting_prep`
- `priority_summary`
- `email_draft`
- `commitment_trace`
- `general`

Return at minimum:

- `status: 'complete' | 'partial' | 'error'`
- `scope_used`
- `scope_valid`
- `evidence`
- `warnings`
- `provenance`
- `freshness`

### 3. `GetSyncHealth`

Return:

- per-source health
- last successful sync
- staleness
- known sync failures

### 4. `GetScopeAndSessionState`

Return:

- `active_scope`
- `available_scopes`
- `proposed_scope` when safe after cleanup
- `session_status: 'valid' | 'expired' | 'invalid_scope' | 'relink_required' | 'bootstrap_pending' | 'cleanup_in_progress'`
- `required_action: 'none' | 'reinitialize_session' | 'relink_provider' | 'select_scope' | 'wait_for_cleanup'`

Valid v1 pairs are only:

- `(valid, none)`
- `(expired, reinitialize_session)`
- `(invalid_scope, select_scope)`
- `(relink_required, relink_provider)`
- `(bootstrap_pending, reinitialize_session)`
- `(cleanup_in_progress, wait_for_cleanup)`

## Contract Invariants

- If `scope_valid=false`, return `status='error'`.
- Do not return `scope_valid=false` with `status='complete'` or `status='partial'`.
- Use `status='partial'` only when every warning has `can_answer_without=true`.
- If any warning has `can_answer_without=false`, return `status='error'`.
- The Cursor prompt must not synthesize a final answer from `status='error'`.

Each `EvidenceItem` should include at least:

- `source`
- `source_id`
- `sync_timestamp`
- `confidence_or_link_reason`
- record payload fields needed by the canonical contract

Each `freshness` record should include:

- `source`
- `last_sync_time`
- `staleness_seconds`
- `stale_beyond_policy`
- `projection_lag_seconds` when applicable

## Required-Source Mapping

Start v1 with this mapping:

- `meeting_prep` or meeting-context questions → **Calendar required**, Asana and Gmail optional
- `priority_summary` or "what needs attention today" → **Asana required**, Calendar and Gmail optional
- `email_draft` or reply drafting → **Gmail required**, Asana and Calendar optional
- `commitment_trace` → **Asana plus at least one communication or calendar source required**

If a required source is missing or stale beyond policy, return `status='error'` instead of a best-effort answer.

Use these initial staleness policies:

- Calendar stale beyond policy after 15 minutes
- Gmail stale beyond policy after 15 minutes
- Asana stale beyond policy after 30 minutes

## Correct Example

```json
{
  "operation": "RetrieveExecutiveContext",
  "request": {
    "question": "Prep me for my 2pm design review.",
    "question_family": "meeting_prep",
    "scope": "exec:work"
  },
  "response": {
    "status": "partial",
    "scope_used": "exec:work",
    "scope_valid": true,
    "evidence": [
      {
        "source": "calendar",
        "source_id": "evt_123",
        "sync_timestamp": "2026-05-25T13:50:00Z",
        "confidence_or_link_reason": "matched attendees and time window"
      }
    ],
    "warnings": [
      {
        "source": "gmail",
        "reason": "sync_delayed",
        "can_answer_without": true,
        "last_sync_time": "2026-05-25T13:20:00Z"
      }
    ],
    "provenance": {},
    "freshness": [
      {
        "source": "calendar",
        "last_sync_time": "2026-05-25T13:50:00Z",
        "staleness_seconds": 120,
        "stale_beyond_policy": false
      }
    ]
  }
}
```

This is valid because Calendar is present for `meeting_prep`, the scope is valid, and all warnings are non-blocking.

## Incorrect Example

```json
{
  "operation": "RetrieveExecutiveContext",
  "request": {
    "question_family": "meeting_prep"
  },
  "response": {
    "status": "complete",
    "scope_valid": false,
    "warnings": [
      {
        "source": "calendar",
        "reason": "auth_required",
        "can_answer_without": false
      }
    ]
  }
}
```

This is invalid because `scope_valid=false` requires `status='error'`, and a blocking Calendar warning cannot be labeled `complete`.
