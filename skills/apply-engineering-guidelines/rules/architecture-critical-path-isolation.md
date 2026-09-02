---
title: Critical Path Isolation
impact: CRITICAL
tags: architecture, reliability, workflows, side-effects, failure-isolation, outbox, dlq
---

## Critical Path Isolation

Map the workflow dependency graph before implementation. Classify every external
call and side effect:

| Class | Meaning | Failure behavior |
| --- | --- | --- |
| **Primary state** | Durable state that authorizes progress or records the operation's outcome | Commit before auxiliary work |
| **Business/regulatory gate** | Approval, policy, legal, or contractual proof required before core work | Keep synchronous, bounded, and fail closed |
| **Critical dependency** | Required to perform or truthfully record the core outcome | Prevent false success; use bounded retries and idempotency |
| **Auxiliary projection** | Graph, analytics, reporting, search, notification, or other derived view | Decouple through an outbox, queue, event, or replayable DLQ |
| **Compensatable operation** | Reversible or reconcilable work in an explicit saga | Record durable compensation state and retry |

### Ordering Rules

1. Name the authoritative terminal checkpoint and the capacity, locks, or task
   tokens it releases.
2. Validate business/regulatory gates before irreversible primary work.
3. Persist the primary outcome immediately after the primary operation succeeds.
4. Trigger auxiliary projections only after primary state is durable.
5. Use a transactional outbox when primary state and guaranteed event publication
   must be atomic. If they cannot share a transaction, make the primary operation
   idempotent and persist explicit pending-handoff state before returning.
6. If auxiliary work remains in the same handler, isolate its failure so it
   cannot erase, delay, or regress primary progress.
7. Isolate auxiliary consumers with separate queues and concurrency budgets so
   their backlog cannot consume critical-path capacity.
8. Keep a dependency synchronous only when its success is part of the operation's
   business correctness. Document that decision.

Do not call a dependency "critical" merely because its data is important. A
source of truth may still be an asynchronous projection when the primary
operation already happened and can be reconciled later.
A DLQ does not make a critical dependency auxiliary. Compensation failure must
produce explicit durable state such as `COMPENSATION_PENDING`; it must not appear
as successful completion.

### Required Failure Tests

For every external dependency, inject timeout, rejection, throttling, and
unavailable responses. Assert:

- critical-gate failure prevents the primary operation;
- auxiliary failure does not block or regress primary state;
- compensatable work records a durable pending state;
- retries are idempotent and cannot duplicate the primary operation;
- DLQ/outbox replay completes the side effect without reopening workflow
  capacity or ownership;
- crashes after outbox commit, after publish, and before acknowledgement still
  converge through idempotent delivery;
- auxiliary backlog cannot hold worker slots, task tokens, locks, or critical
  concurrency.

### Correct

```typescript
const result = await executePrimaryOperation(input);
await commitPrimaryOutcomeAndOutbox(result);
return result;
```

An independent worker consumes the outbox and retries each projection
idempotently.

### Incorrect

```typescript
const result = await executePrimaryOperation(input);
await updateAnalytics(result);
await publishGraphProjection(result);
await recordPrimaryOutcome(result);
return result;
```

### Review Checklist

- [ ] Every dependency and side effect has an explicit class.
- [ ] The authoritative terminal checkpoint and released resources are named.
- [ ] Primary state is identifiable and durable before auxiliary work.
- [ ] Synchronous coupling has a documented correctness reason.
- [ ] Auxiliary and compensatable paths have idempotent recovery.
- [ ] Fault-injection tests verify each failure boundary.
