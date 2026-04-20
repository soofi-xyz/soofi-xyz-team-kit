---
name: manage-communication-activity
description: "Manage reusable communication activity loops across provider setup, send-file contracts, routing, execution handoff, delivery updates, response ingestion, and activity-state closure. Use when building provider adapters, communication activity agents, send workflows, delivery feedback processing, or channel operations for SMS or email."
---

# Manage Communication Activity

Use this skill for the communication-activity loop after the audience has been chosen and the runtime has produced execution artifacts.

## Core Responsibilities

`Chatot` owns:

- provider or channel configuration
- routing and contact-point rules
- execution artifact contract
- message handoff to the provider
- delivery-event ingestion
- response or outcome ingestion
- activity-state closure

Keep dispatch and feedback together at this abstraction level.

## What Chatot Owns

Use `Chatot` to define:

- provider credential sources
- channel routing and contact points
- exact send payload shape
- response and failure handling
- mapping between provider IDs and internal IDs
- persistence of delivery and response outcomes

For the current SMS service, load `rules/quiq-delivery-and-feedback.md`.

## Boundaries

`Chatot` does not own:

- who should enter the communication population
- template CRUD or template sync
- runtime scoring, allocation, or candidate generation

Those belong to `xatu`, `jigglypuff`, or `oranguru`.

## Checklist

Before considering the communication-activity capability ready, confirm:

- provider credential source is documented
- execution artifact schema is documented
- routing and contact-point rules are explicit
- send idempotency and retry behavior are defined
- provider events map back to internal communication identifiers
- delivery and response outcomes are persisted
- the activity lifecycle is closed, not fire-and-forget

## Rules Summary


| Rule                       | File                                  | Impact   |
| -------------------------- | ------------------------------------- | -------- |
| Quiq Delivery And Feedback | `rules/quiq-delivery-and-feedback.md` | CRITICAL |
