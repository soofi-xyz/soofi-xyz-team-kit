---
title: Critical Path Isolation
impact: CRITICAL
tags: workflow, reliability, side-effects, outbox, dlq, fault-injection
---

## Critical Path Isolation

Before selecting Glue or Step Functions, classify every dependency and side
effect:

- **Primary state** records the authoritative batch/work-item outcome.
- **Business/regulatory gate** must succeed before processing is valid or compliant.
- **Critical dependency** is required to perform or truthfully record the core outcome.
- **Auxiliary projection** creates a derived graph, report, metric, search index,
  notification, or analytical view.
- **Compensatable operation** is reversible or reconcilable through an explicit
  saga and durable compensation state.

## Coupling Decision

Keep work synchronous only when failure means the primary outcome is invalid,
unsafe, or prohibited. Document that business reason.

Otherwise:

1. Name the per-item or per-chunk authoritative terminal checkpoint and every
   worker slot, task token, lock, or concurrency permit it releases.
2. Validate business/regulatory gates before irreversible processing.
3. Commit primary state before auxiliary work.
4. Publish auxiliary work through a transactional outbox, queue, event, or
   replayable DLQ.
5. Give each side effect an idempotency key and independent retry budget.
6. Isolate auxiliary queues and concurrency from the critical path.
7. Do not let one failed projection fail unrelated work items or hold shared
   workflow capacity.

Use a transactional outbox when state commit and guaranteed handoff must be
atomic. Do not rely on an in-memory call after the state commit when losing that
call would lose required work.
A DLQ does not make a critical dependency auxiliary. Compensation failure must
remain explicit, durable, and redrivable.

## Failure Matrix

Document this before implementation:

| Dependency | Class | Why coupled/decoupled | Terminal checkpoint/capacity | Timeout | Retry/DLQ/outbox/compensation | Primary state after failure |
| --- | --- | --- | --- | --- | --- | --- |

## Required Tests

Inject timeout, rejection, throttling, and unavailable responses for every
dependency. Verify:

- primary state commits before auxiliary failure;
- critical-gate failure prevents primary work;
- retries do not repeat the primary operation;
- replay completes only the failed side effect;
- failed side effects do not hold unrelated concurrency, slots, locks, or
  workflow progress;
- crashes after outbox commit, publish, and pre-acknowledgement redeliver safely;
- compensation failure remains explicit and never appears as success.

## Incorrect

```typescript
const output = await processBatchItem(item);
await publishGraphProjection(output);
await writeReport(output);
await markItemComplete(output);
```

## Correct

```typescript
const output = await processBatchItem(item);
await commitOutcomeAndOutbox(output);
return output;
```

An independent worker consumes the outbox and retries each projection
idempotently.
