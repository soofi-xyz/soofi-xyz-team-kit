---
name: select-communication-audience
description: "Define audience-selection and eligibility-handoff patterns — filter boundaries, runtime intake contracts, external input schemas, and eligible-population packaging."
---

# Select Communication Audience

Use this skill when deciding who is allowed to enter a communication process and how that eligible population is handed to the runtime.

## Core Responsibilities

`Xatu` owns:

- audience entrypoint design
- eligibility boundary definition
- external runtime intake contract
- communication-population packaging for downstream optimization

## What Xatu Owns

Use `Xatu` to define:

- what upstream system owns hard suppressions
- what rows are allowed to reach the runtime
- what outer schema and transport the runtime accepts
- what identifiers and evidence must travel with each eligible record

For the current SMS service, load `reference/sms-runtime-intake-contract.md`.

## Boundaries

`Xatu` does not own:

- template CRUD or template synchronization
- provider execution and feedback processing
- runtime scoring, allocation, or rollout mechanics

Those belong to `wigglytuff`, `chatot`, or `oranguru`.

## Checklist

Before considering the audience capability ready, confirm:

- the audience entrypoint is explicit
- hard-filter ownership is explicit
- the runtime intake contract is documented
- required identifiers and evidence fields are present
- the runtime does not need to re-derive the eligible population from raw source systems
- the handoff shape is replayable and auditable

## Rules Summary


| Rule                        | File                                       | Impact   |
| --------------------------- | ------------------------------------------ | -------- |
| SMS Runtime Intake Contract | `reference/sms-runtime-intake-contract.md` | CRITICAL |
