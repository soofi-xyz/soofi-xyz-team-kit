---
name: manage-communication-activity
description: "Managing the communication send lifecycle — provider setup, routing, execution handoff, delivery updates, response ingestion, and activity closure for SMS or email."
---

# Manage Communication Activity

Use this skill for the communication-activity loop after the audience has been chosen and the runtime has produced execution artifacts.

## Core Responsibilities

`Chatot` owns:

- provider or channel configuration
- routing and contact-point rules
- execution artifact contract
- message handoff to the provider
- provider-correlation storage that maps provider message identifiers back to internal communication identifiers
- delivery-event ingestion
- response or outcome ingestion
- normalized EventBridge event publication for engagement outcomes that other products consume
- idempotent persistence of provider outcomes to the product's internal source of truth
- activity-state closure

Keep dispatch and feedback together at this abstraction level.

## What Chatot Owns

Use `Chatot` to define:

- provider credential sources
- channel routing and contact points
- exact send payload shape
- campaign and render identifiers that execution artifacts must preserve
- response and failure handling
- mapping between provider IDs and internal IDs
- persistence of delivery and response outcomes
- EventBridge source/detail-type contracts for provider feedback and replies
- retry and DLQ behavior for provider events that cannot yet be correlated or persisted

For the current SMS service, load `rules/quiq-delivery-and-feedback.md`.

## Boundaries

`Chatot` does not own:

- who should enter the communication population
- template CRUD or template sync
- runtime scoring, allocation, or candidate generation

Keep those boundaries outside Chatot.

## Campaign-Aware Execution Handoff

When upstream templates or assignments depend on campaign-scoped parameters, keep the execution artifact faithful to the runtime decision.

- preserve `campaign_id` and `campaign_identifier` in the execution artifact
- if rendering happens inside the send workflow, include the campaign identifier on every Jigglypuff render batch so template lookups can resolve campaign parameters consistently
- consume the runtime-approved `campaign.parameters` data and assignment
  outputs as data; do not re-derive, mutate, or backfill campaign parameters at
  provider dispatch time
- treat `last_day_to_prevent_placement` as:
  ```json
  "parameters": {
    "last_day_to_prevent_placement": {
      "type": "DATE",
      "value": "YYYY-MM-DD"
    }
  }
  ```
  inside the `campaign` object; reject flat
  `campaign.last_day_to_prevent_placement` and top-level forms
- accept only the parameter keys upstream derived from the selected template's
  `has('parameter_key', ...)` query plus its variables listing
- use the same `campaign.parameters` container for SMS and email launches and
  keep email dry runs at `submit_to_arda: false`
- validate the container before Campaign Assignment and pass the whole
  `campaign` object through unchanged

## Provider Feedback Persistence

Provider feedback should be normalized before any product-specific write:

```text
provider status event
  -> provider message id
  -> correlation layer lookup
  -> internal communication / interaction id
  -> normalized provider-feedback event
  -> EventBridge or product engagement bus
  -> graph, Persist, or equivalent internal system of record
```

The correlation layer is product-owned infrastructure. Chatot should define the contract for it, but generic Chatot guidance must not hard-code table names, bucket names, state machine names, or graph labels from one runtime.

Status persistence must be idempotent. Use a stable key composed from the internal communication identifier, provider status, and provider status timestamp. Exact duplicate provider events should not create duplicate internal facts.

Unresolved provider events must remain retryable. If the provider id cannot be mapped to an internal communication id, or the internal persistence write fails, route the event through retry/DLQ or a pending-event mechanism rather than dropping it.

External reporting systems are downstream of the internal source of truth. A communication activity is not closed just because a provider accepted the send or an export file was produced; delivery and response outcomes must be persisted internally first.

## Checklist

Before considering the communication-activity capability ready, confirm:

- provider credential source is documented
- execution artifact schema is documented
- campaign-aware execution identifiers are documented
- routing and contact-point rules are explicit
- send idempotency and retry behavior are defined
- provider events map back to internal communication identifiers
- delivery and response outcomes are persisted
- provider-feedback persistence is idempotent by internal identifier, status, and provider timestamp
- unresolved provider events have retry/DLQ handling
- response events that other products need are published to the shared engagement bus
- the activity lifecycle is closed, not fire-and-forget

## Rules Summary


| Rule                       | File                                  | Impact   |
| -------------------------- | ------------------------------------- | -------- |
| Quiq Delivery And Feedback | `rules/quiq-delivery-and-feedback.md` | CRITICAL |
