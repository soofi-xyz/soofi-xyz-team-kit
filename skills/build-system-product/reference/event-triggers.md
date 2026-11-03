# System event triggers: route only what a flow asks for

A flow trigger declares the events that start it: `source`, `detailType` and
optional literal `match` filters on event paths. System must apply that filter in
EventBridge, not after delivery. A rule that matches by `source` alone sends every
event from that source into System's trigger queue and ingest Lambda, where all
but a few are dropped as "matched no flow trigger".

This is a requirement for the System engine, not evidence of deployment. Verify
the target revision before claiming any part of it is supported.

## Why it matters

A busy source can produce far more events than the flows use. In SOC PROD,
Persist's process-trigger bus carries 0.4–1.1 million events a day (peaks around
15,000 a minute) across every trigger, while the SMS opt-out flow needs only the
DNT events. Routing all of them to System's ingest Lambda (reserved concurrency 5)
throttles it, fills the trigger DLQ after its retries and fires the DLQ alarm,
which texts the people on the failure-text topic. It also costs a queue message,
a Lambda run, a configuration read and a log line for every unused event.

## Rules

1. **One rule per triggered flow.** For each flow with a trigger, keep an
   EventBridge rule on the trigger bus, named `system-trigger-<flow>` (or a stable
   hash when the name is too long), with pattern `source: [trigger.source]`,
   `detail-type: [trigger.detailType]` and the trigger's literal `match` values as
   EventBridge content filters. Its target is the trigger queue. No rule matches
   by source alone.
2. **Managed with the flow.** Saving a flow with a trigger creates or updates its
   rule; changing the trigger updates it; removing the trigger or deleting the flow
   deletes it. Registration fails, and nothing is saved, when the rule cannot be
   written, so the stored flow and its rule never disagree.
3. **Reconciled on install.** Installing a System revision reconciles rules with
   the stored flows (create missing, update changed, delete orphaned
   `system-trigger-*` rules), so existing flows keep their routing and a stack
   update never drops it. Remove the catch-all source rule only in the same
   install that creates the per-flow rules, with the per-flow rules created first.
4. **The ingest check stays.** The ingest Lambda still evaluates the trigger
   (including non-literal paths EventBridge cannot express) and still records
   "matched no flow trigger"; with per-flow rules that should be rare. Alarm if it
   is not.
5. **Bus changes are cheap.** With per-flow rules, pointing System at a busy bus
   (`TriggerEventBusName`) only delivers the events registered flows use. State
   this in the README, and check the expected volume per rule before switching a
   PROD installation's bus.

## Observability

Per-rule `MatchedEvents` (AWS/Events) shows each flow's volume. Log rule writes
with the flow name and rule name, never event bodies.

## Acceptance

Verify on a deployment with mock leaves first:

1. Saving a flow with a trigger creates its rule with source, detail-type and
   literal match filters; events of another detail-type on the same bus never
   reach the trigger queue.
2. Changing the trigger updates the rule; removing it or deleting the flow
   deletes the rule.
3. A rule write failure rejects the save and leaves the stored flow unchanged.
4. An install over an existing deployment creates rules for stored flows before
   the catch-all rule is removed, and no matching event is lost during the update.
5. Switching `TriggerEventBusName` to a bus with unrelated traffic delivers only
   the registered flows' events (compare trigger-queue receives with the bus).
6. Flows without a trigger, S3 triggers and ordered triggers are unchanged.

Celebi configures concrete triggers only after this support is verified on the
target deployment.
