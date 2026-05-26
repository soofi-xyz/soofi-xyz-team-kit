---
title: Chief of Staff Boundary And Ownership
impact: CRITICAL
tags: [chief-of-staff, architecture, boundary, ownership]
---

# Chief of Staff Boundary And Ownership

Lock the Cursor prompt vs backend-runtime boundary first. Do not design features until the ownership split is explicit.

## Cursor Prompt Owns

- user-facing conversation in Cursor
- intent interpretation and task framing
- choosing which backend operation to call
- synthesizing final answers from backend-returned evidence
- generating grounded drafts from backend-returned evidence
- showing provenance, caveats, and source gaps clearly
- enforcing the v1 product boundary: on-demand, read-only, draft-only

## Backend Runtime Owns

- provider account linking, token refresh, and auth state
- source ingestion and normalization for Asana, Google Calendar, and Gmail
- retrieval indexes and retrieval APIs
- linked-account status, source health, and sync status
- scope state, session state, and cleanup/relink transitions
- provenance state and persistent executive-context storage
- secure communication with platform products such as Connect and Persist

## Never Blur These Responsibilities

- Do not make the Cursor prompt hold provider tokens or AWS secrets.
- Do not make the Cursor prompt call provider APIs directly.
- Do not make the backend return final user-facing prose as its primary contract in v1.
- Do not make the backend own the executive-facing conversational UX.

## Correct Example

```text
User asks for meeting prep in Cursor
→ prompt calls RetrieveExecutiveContext(question_family=meeting_prep, scope=...)
→ backend returns structured evidence, provenance, freshness, and warnings
→ prompt shows caveats and synthesizes the final meeting-prep response in Cursor
```

This keeps retrieval and state in the backend while keeping final synthesis in the prompt.

## Incorrect Example

```text
User asks for meeting prep in Cursor
→ prompt queries Gmail and Calendar directly with stored OAuth tokens
→ prompt decides sync freshness itself
→ backend is bypassed or used only as an optional cache
```

This turns the repo prompt into a hidden runtime and breaks the approved architecture.

## Incorrect Example

```json
{
  "operation": "RetrieveExecutiveContext",
  "response": {
    "final_answer": "You should tell Alex the launch is blocked by design review."
  }
}
```

This is not a valid v1 ownership split. The backend should return evidence and status, not final drafted prose as the contract.
