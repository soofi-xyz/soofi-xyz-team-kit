---
title: Transaction Boundary Exits
impact: CRITICAL
tags: reliability, batch, queues, dlq, expiration, safe-exit, side-effects, negative-tests
---

## Transaction Boundary Exits

Every batch workflow that performs an external or irreversible transaction MUST
define and implement boundary exits for each item before the transaction occurs.
When an item is no longer safe to process, the workflow MUST choose the safe
exit: **do not perform the transaction**.

This is separate from stress testing. Stress testing large batches can be costly
and still miss timing failures. Boundary exits protect production when queue
delay, retries, slow workers, cost pressure, or policy windows make originally
valid work invalid by the time it reaches the worker.

### Batch-Specific Rule

Do not rely on a scheduler, planner, solver, or campaign builder as the only
place where validity is checked. Any queue, map, retry, or fanout can delay work.
The worker that owns the side effect MUST re-check the boundary immediately
before the external transaction.

Examples:

- SMS planned for a legal hour but consumed after the legal send window closes.
- Email campaign item delayed past an unsubscribe snapshot or campaign deadline.
- File export that starts after the recipient's delivery window closes.
- Vendor API update that would exceed a cost, quota, or rate-limit budget.
- Payment/refund item whose approval or quote has expired.

### Required Design Questions

For each batch transaction, ask:

1. What is the per-item transaction?
2. What makes this item expired, stale, unsafe, too expensive, or disallowed?
3. Which boundary can change while the item waits in a queue or map?
4. Which worker performs the final guard before the side effect?
5. What is the safe exit destination?
6. What reason code will operators see?
7. Does the item ever replay? If yes, who authorizes it and what boundary is
   re-evaluated?
8. What metric/alarm/report makes boundary exits visible?

### Required Pattern

- Plan/schedule only work that appears valid at planning time.
- Revalidate each item at the worker immediately before the side effect.
- If the item is outside the boundary, do not call the provider.
- Move the item to a DLQ, expired output, skipped artifact, manual-review queue,
  or terminal failure with a reason.
- Include original payload or a durable pointer, source identifiers, evaluated
  boundary, failure time, and machine-readable reason metadata.
- Emit business metrics by reason.
- Add negative tests proving the external transaction is not called.

### Correct

```typescript
for (const record of event.Records) {
  const item = parseBatchItem(record.body);
  const boundary = evaluateTransactionBoundary(item, new Date());

  if (!boundary.allowed) {
    await transactionDlq.send({
      reason: boundary.reason,
      evaluatedAt: boundary.evaluatedAt,
      originalPayload: item,
      sourceMessageId: record.messageId,
    });
    metrics.addMetric("batch_transaction_boundary_exits_total", MetricUnit.Count, 1);
    continue;
  }

  await externalProvider.performTransaction(item);
}
```

```typescript
it("routes expired queued work to DLQ without calling the provider", async () => {
  await worker(expiredQueuedItem);

  expect(externalProvider.performTransaction).not.toHaveBeenCalled();
  expect(transactionDlq.send).toHaveBeenCalledWith(
    expect.objectContaining({
      reason: "deadline_expired",
    }),
  );
});
```

### Incorrect

```typescript
// Validity was checked when the batch was planned, but the queued item may be stale now.
for (const record of event.Records) {
  await externalProvider.performTransaction(JSON.parse(record.body));
}
```

```typescript
// Fails closed for exceptions only, but not for boundary exits that are normal negative cases.
try {
  await externalProvider.performTransaction(item);
} catch (error) {
  await dlq.send({ reason: "provider_error", item });
}
```

### Relationship To Other Batch Rules

- Cost gates prevent starting work that is too expensive.
- Throttling prevents overrunning provider limits.
- Idempotency prevents duplicate work.
- PagerDuty alerting surfaces critical failures.
- Transaction boundary exits prevent work that should no longer happen from
  happening at all.

All five are required for batch workflows that perform external side effects.

