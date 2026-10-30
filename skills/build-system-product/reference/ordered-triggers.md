# System ordered event triggers

An event trigger starts a flow from an EventBridge event (for example a Persist
process trigger). By default every matching event starts its own run, deduplicated
only by its `idempotencyKey`. When a later event must not be undone by an earlier
one that arrives or runs late, the trigger declares `order`. Zygarde builds the
framework; Celebi configures `order` on a flow whose events update one entity's
state.

This is a requirement for the System engine, not evidence of deployment. Verify
the target revision before claiming any part of it is supported.

## Why it matters

Each run applies the state its own event carries. Without ordering:

1. **Overlap.** An opt-in run reads the target, plans its write and is still
   running; a newer opt-out run sees nothing to change and finishes; the opt-in
   run then writes and undoes the opt-out.
2. **Late delivery.** EventBridge does not guarantee order, and replay queues
   re-send failed events later. An old event that arrives after a newer one has
   been applied overwrites it.
3. **Redrive.** Redriving an old failed run after a newer run finished writes the
   old state.

A "check the latest state, then write" step inside the template narrows (1) but
cannot close it; only per-key serialization in System does.

## Configuration artifact

```json
"trigger": {
  "source": "persist.process-trigger",
  "detailType": "Persist Person Phone Number Has DNT",
  "match": { "$.detail.trigger_id": ["person-phone-number-has-dnt"] },
  "input": { "phoneNumber.$": "$.detail.data.phone_number" },
  "idempotencyKey": "$.detail.occurrence_id",
  "order": {
    "key": "$.detail.data.phone_number",
    "version": "$.detail.data.edge_effective_at"
  }
}
```

| Field | Meaning |
| --- | --- |
| `order.key` | Simple JSONPath into the event. Events with the same value form one lane and run one at a time. A missing or empty key rejects the event. |
| `order.version` | Simple JSONPath to a number or an ISO-8601 time. Times compare as times, whatever their precision. A missing or unparsable version rejects the event. |

Triggers without `order` behave exactly as before. A System revision that does
not support `order` must reject it at registration, so a bundle that relies on it
cannot install on an older System.

## Lane semantics

Each `(flow, key)` lane is one item in the invocation table, keyed by a hash of
the key (never the raw key), written only with a conditional revision check.

1. **Superseded.** An event whose version is older than the newest the lane has
   accepted never runs. It is acknowledged with `200 SUPERSEDED`.
2. **One run at a time.** While a run holds the lane, the newest arriving event
   waits as the lane's single pending event and replaces any older pending one
   (`202 QUEUED`). Equal versions are accepted; a repeated idempotency key returns
   the existing state.
3. **Release.** A rule on Step Functions execution status changes (succeeded,
   failed, timed out, aborted) for System's state machines releases the lane and
   starts the pending event. Bound retries into a DLQ with an alarm.
4. **Claims.** A lane claimed before its run is recorded holds for a short,
   documented time (one minute), then expires.
5. **Next-event recovery.** An event for a lane whose run has ended frees the
   lane itself, so a lost release never blocks a key that receives more events.

## Redrive

Redrive must not bypass the lane. `POST /invocations/{id}/redrive` for a run of
an ordered flow:

- is refused with `409 ORDERED_REDRIVE_SUPERSEDED` when the lane has accepted a
  newer version than the run's, because redriving it would write older state;
- is refused with `409 ORDERED_LANE_BUSY` while another run holds the lane;
- otherwise claims the lane for the redriven run before redriving, so new events
  for the key wait until it ends and the release rule frees it.

Store the run's order key hash and version on its invocation record so the check
needs no event. Step Functions' own console or API redrive bypasses System; detect
it from the execution status rule (a run of an ordered flow becomes `RUNNING`
without holding its lane), emit `LaneBypassRedrive` and alarm on it. Document
that ordered flows are redriven only through System.

## Stuck pending events

A pending event must not depend on a later event for the same key. If the release
signal is lost (handler failure into the DLQ) and the key receives no more events,
the pending event would wait until someone redrives the DLQ.

- Run a scheduled sweep (every 10 minutes by default, an install setting) that
  starts the pending event of every lane whose run has ended or whose claim has
  expired, through the same offer path as an arriving event.
- Find those lanes with a query, not a table scan: keep a sparse index attribute
  (for example `pendingSince`) set only while a lane has a pending event.
- Emit `LaneSwept` per started event and alarm when a pending event is older than
  a threshold (for example 30 minutes) after a sweep.
- Keep the release DLQ and its alarm, and document the runbook: inspect the DLQ
  message, check the lane, redrive the DLQ (or let the sweep start the event), and
  confirm the pending event's run started.

## Retention

A lane expires with the invocation retention (for example 30 days after its last
write). An event delivered after its lane expired runs as if it were new. State
this limit in the README; a consumer whose events can arrive later than the
retention must bound that lateness (an SQS replay queue keeps messages at most
14 days) or reconcile separately.

## Observability

Metrics in `System/OrderedTriggers` with dimension `Flow`: `LaneStarted`,
`LaneQueued`, `LaneSuperseded`, `LaneReleased`, `LaneSwept`,
`LaneRedriveRefused`, `LaneBypassRedrive`. Logs carry the flow, lane hash,
idempotency key, versions and invocation id; never the raw key (it can be a phone
number or other PII) or event bodies.

## Acceptance

Verify on a deployment with mock leaves first:

1. Two events for the same key: the second waits and starts when the first ends.
2. An event older than an accepted one is `SUPERSEDED` and starts nothing.
3. Three events during one run: only the newest runs after it.
4. A failed, timed-out or aborted run releases its lane.
5. With the release handler failing, the sweep starts the pending event without
   another event for the key, and `LaneSwept` is emitted.
6. Redriving a run after a newer version was accepted returns
   `409 ORDERED_REDRIVE_SUPERSEDED` and redrives nothing; redriving while another
   run holds the lane returns `409 ORDERED_LANE_BUSY`; redriving the newest run on
   a free lane claims the lane and new events wait for it.
7. A Step Functions console redrive of an ordered run emits `LaneBypassRedrive`.
8. Triggers without `order` are unchanged.
9. No raw key or event body appears in logs.

Celebi configures `order` on concrete flows only after this support is verified on
the target deployment.
