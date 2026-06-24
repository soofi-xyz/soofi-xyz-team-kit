---
title: Transaction Boundary Exits
impact: CRITICAL
tags: reliability, transactions, expiration, dlq, safe-exit, queues, side-effects, negative-tests
---

## Transaction Boundary Exits

Every externally visible transaction MUST have explicit boundary exits before the
transaction is performed. The safest fallback for an unsafe, expired, over-cost,
or over-capacity transaction is **do not perform the transaction**.

This is not a stress-test requirement. Stress tests can be useful, but they are
expensive and incomplete. Boundary exits are the design control that prevents an
agent-built workflow from continuing past the point where the transaction is no
longer allowed.

### What Counts As A Transaction

Treat any irreversible or externally visible action as a transaction, including:

- sending SMS, email, push notifications, calls, or provider messages
- charging money, issuing refunds, or moving funds
- writing to a customer, vendor, provider, or partner system
- publishing production graph facts or state transitions
- exporting files to an external destination
- starting a downstream workflow with side effects
- calling any external API that changes state or creates an obligation

### Required Design Questions

Before implementing the transaction path, the agent MUST answer:

1. What exact transaction are we about to perform?
2. What makes this transaction unsafe, stale, expired, too expensive, or no longer
   allowed?
3. What is the latest allowed time, TTL, deadline, cost ceiling, queue age,
   policy window, or capacity boundary?
4. Where is the boundary checked immediately before the side effect?
5. What is the safe exit if the boundary is crossed?
6. Where is the exited transaction durably recorded?
7. Is the exit a DLQ, expired output, skipped artifact, manual-review queue, or
   terminal failure?
8. Is replay allowed? If yes, who approves it and under which new boundary?
9. What metric, alarm, or report proves boundary exits are happening?

### Implementation Requirements

Every transaction path MUST include:

- **Pre-transaction guard:** Re-check all relevant boundaries immediately before
  the external side effect. Do not rely only on an earlier scheduler, planner, or
  batch start time.
- **Expiration criteria:** Define a concrete deadline or boundary such as legal
  window, max queue age, TTL, cost cap, rate-limit budget, stale input cutoff, or
  downstream capacity limit.
- **Safe exit path:** If the guard fails, do not call the provider. Route the work
  to a DLQ, expired output, skipped artifact, manual-review queue, or explicit
  terminal state.
- **Reason metadata:** Record a machine-readable reason such as
  `outside_recipient_send_window`, `deadline_expired`, `cost_ceiling_exceeded`,
  `queue_age_expired`, `capacity_exhausted`, or `policy_window_closed`.
- **Durable evidence:** Store enough context to investigate the exit without
  replaying the transaction: source id, transaction id, reason, evaluated
  boundary, failure time, and original payload or pointer.
- **Focused negative test:** Prove the side effect is not called when the
  boundary is crossed.
- **Metrics and alarms:** Count exits by reason and wire the appropriate alarm or
  report. A boundary exit is only useful if operators can see it.

### Queues And Delayed Execution

Queued work MUST be revalidated by the worker that performs the side effect. A
message can be legal when planned and illegal when consumed because of backlog,
retry delay, downstream slowness, or rate-limit pressure.

Do not assume "the workflow started on time" makes every later item safe. The
worker closest to the transaction owns the final guard.

### Correct

```typescript
export async function sendSms(record: RenderedSms): Promise<void> {
  const decision = evaluateSmsSendWindow(record, new Date());
  if (!decision.allowed) {
    await outboundSendDlq.send({
      reason: "outside_recipient_send_window",
      messageId: record.messageId,
      evaluatedAt: decision.evaluatedAt,
      recipientLocalTime: decision.recipientLocalTime,
      originalRecord: record,
    });
    metrics.addMetric("transaction_boundary_exits_total", MetricUnit.Count, 1);
    return; // Do not call the SMS provider.
  }

  await smsProvider.send(record);
}
```

```typescript
it("does not call the provider after the send window closes", async () => {
  const provider = { send: vi.fn() };

  await sendSmsWithDependencies({
    now: new Date("2026-04-21T00:30:00.000Z"),
    provider,
    record: smsOutsideRecipientWindow,
  });

  expect(provider.send).not.toHaveBeenCalled();
  expect(outboundSendDlq.send).toHaveBeenCalledWith(
    expect.objectContaining({
      reason: "outside_recipient_send_window",
    }),
  );
});
```

### Incorrect

```typescript
// The scheduler checked this hours ago. Backlog can make it unsafe now.
await smsProvider.send(record);
```

```typescript
// Logs only, then continues to the side effect anyway.
if (isExpired(record)) {
  logger.warn("record is expired", { messageId: record.messageId });
}
await externalSystem.write(record);
```

```typescript
// Boundary exit exists but cannot be investigated or counted.
if (isPastDeadline(record)) {
  return;
}
```

### Review Checklist

- [ ] The transaction side effect is named explicitly.
- [ ] The expiration/boundary criteria are explicit and testable.
- [ ] The guard runs immediately before the side effect.
- [ ] The safe exit avoids the transaction completely.
- [ ] The exit records a machine-readable reason and enough context.
- [ ] Negative tests prove the provider/external write is not called.
- [ ] Metrics/alarms/reports make exits visible.
- [ ] Replay behavior is explicit, even if the answer is "no replay".

