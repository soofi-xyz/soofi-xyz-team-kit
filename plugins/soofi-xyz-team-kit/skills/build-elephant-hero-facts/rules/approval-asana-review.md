---
title: Human Approval in Asana
impact: CRITICAL
tags: asana, approval, review, ledger, task-token, chat-sdk, authorization, stale
---

## Human Approval in Asana

No hero fact reaches the website without an authorized human approval that still matches the current data. The approval is the gate between "verified candidate" and "content-only PR."

### The fact ledger (separate from Chat SDK state)

Track each candidate in a dedicated DynamoDB ledger, distinct from Chat SDK thread/lock state and from AgentCore Memory. States:

```
detected → eligible → drafted → verified → pending_approval
        → approved | revision_requested | rejected | stale
        → publishing → published | publish_failed
```

- The ledger is the source of truth for "what is pending, approved, or published."
- Chat SDK DynamoDB state (via `@soofi-xyz/chat-state-dynamodb`, `keyPrefix: 'watchog-agent'`, `onLockConflict: 'force'`) owns thread subscriptions, locks, and dedupe only.
- AgentCore Memory holds reviewer conversation/revision history only — never workflow state.

### Orchestration: WaitForTaskToken

Use the `build-batch-workflows` + `build-ai-agents` pattern: a Step Functions Standard state machine reaches a `WaitForTaskToken` state that creates the Asana approval task; the Asana webhook (single Chat SDK Lambda) completes the token with `SendTaskSuccess` / `SendTaskFailure`. The running execution is the pending lock — do not build a second locking mechanism.

### The approval task

Create the task in the configured review project (per-env SSM `asana-project-gid`). Include:

- the rendered hero fact (location lead, statistic, description)
- alternate banner variants for the reviewer to choose from
- a human-readable evidence summary and a link/reference to the immutable evidence manifest
- `datasetRevision` and the fact fingerprint
- an expiration / approval timeout
- an opaque `watchog-approval-id`

Keep the Step Functions task token **server-side**, correlated to `watchog-approval-id` in the ledger. Do **not** print a raw task token in the task body. Never put secrets (Asana PAT, GitHub key, data credentials) in the task.

### Completion authorization

Accept an approval only when **all** hold:

1. the completed task is in the configured review project;
2. its `watchog-approval-id` and `datasetRevision` match a `pending_approval` ledger record;
3. the completer is in the configured approver list (per-env `asana-approver-gids`);
4. current-revision re-verification still passes (the evidence gate in `fact-recipes-and-evidence.md`).

If the completer is not an authorized approver, call `SendTaskFailure`, comment "approval not recognized," reopen the task, and never publish.

### Revisions, rejection, expiry, and replay

- **Reopening** a completed task = cancellation of that approval.
- A **comment requesting changes** produces a new candidate revision that supersedes the prior one; the superseded approval cannot publish.
- **Stale data**: if `datasetRevision` changed between draft and completion, mark `stale` and require a fresh candidate + approval.
- **Timeout**: on `approval-timeout-hours`, transition to a terminal expired state, comment on the task, and end the branch cleanly.
- **Replay safety**: a duplicate Asana webhook delivery calls `SendTaskSuccess`/`SendTaskFailure` again; Step Functions returns `TaskDoesNotExist` — treat it as a successful no-op, never a double-publish.

### Task I/O convention

Keep the reviewer's ask/answer in the task and the agent's status in comments; do not overwrite the original recommendation with the outcome (per `build-ai-agents` Asana rules).

### ✅ Correct

```typescript
// Authorize before completing the token; re-verify current revision.
if (!inProject(task) || !matchesPending(task.approvalId, task.datasetRevision)) return;
if (!approvers.includes(task.completedBy)) {
  await sfn.sendTaskFailure({ taskToken, error: 'non-approver' });
  return;
}
if (await gateway.currentRevision(countyKey) !== task.datasetRevision) {
  await ledger.markStale(task.approvalId); // requires a fresh approval
  await sfn.sendTaskFailure({ taskToken, error: 'stale-revision' });
  return;
}
await sfn.sendTaskSuccess({ taskToken, output: { approvalId: task.approvalId } });
```

### ❌ Incorrect

```typescript
// Publishing on any task completion, without approver checks or revision re-verification.
onTaskCompleted(task => publishHeroFact(task)); // anyone completing the task can publish; no staleness guard
```

### References

- `skills/build-ai-agents/rules/integration-asana-bot-and-webhook.md`
- `skills/build-ai-agents/rules/state-chat-sdk-state.md`
- `agents/meowth.md` — the production WaitForTaskToken + Asana approval reference (approval mechanics only)
