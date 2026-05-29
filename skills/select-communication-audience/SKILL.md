---
name: select-communication-audience
description: "Define reusable audience-selection and eligibility-handoff patterns for communication services. Covers upstream filter boundaries, runtime intake contracts, external input schemas, and how eligible populations are packaged for downstream optimization. Use when building audience-selection agents, filter-to-runtime handoffs, communication segmentation, or `input_s3_uri`-style intake contracts."
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

## SMS Filter Handoff

Kadabra SMS orchestration expects filtering before solving:

- pass `rule_context: { channel: "SMS" }`
- enable `save_rules_reports: true` in development/debug runs
- preserve stable debt, person, phone, and evidence identifiers
- write the eligible population to S3 so the solver run is replayable
- treat hard suppressions as filter-owned; the solver must not resurrect suppressed rows

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
- filter output is an auditable S3 handoff that the solver can replay
- the runtime does not need to re-derive the eligible population from raw source systems
- the handoff shape is replayable and auditable

## Rules Summary


| Rule                        | File                                       | Impact   |
| --------------------------- | ------------------------------------------ | -------- |
| SMS Runtime Intake Contract | `reference/sms-runtime-intake-contract.md` | CRITICAL |
