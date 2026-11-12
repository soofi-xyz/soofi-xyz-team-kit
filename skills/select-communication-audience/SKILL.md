---
name: select-communication-audience
description: "Defining audience selection and eligibility for communications — filter boundaries, intake contracts, input schemas, and packaging eligible populations for downstream runtimes."
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
- what campaign-scoped launch context must be preserved for downstream validation

For the current SMS service, load `reference/sms-runtime-intake-contract.md`.
Use `gallade` for Filter/Rules implementation and operations. Read its
[batch contract](../build-rules-product/reference/implementation/batch-contract.md) when defining
rule selection, phone/email candidates, or upstream evidence; keep downstream
intake and suppression acceptance criteria with `xatu`.

## Boundaries

`Xatu` does not own:

- template CRUD or template synchronization
- provider execution and feedback processing
- runtime scoring, allocation, or rollout mechanics

Those belong to `wigglytuff`, `chatot`, or `oranguru`.

## Campaign Assignment Context

When a communication campaign needs template-scoped values such as
`last_day_to_prevent_placement`, collect and validate them before or during
Campaign Assignment, not inside the SMS or email workflow start input.

- preserve the audience artifact and campaign identifier needed to create or
  reuse the campaign through Campaign Assignment
- place every named template parameter on the campaign record before previews
  or workflow start
- render previews and downstream sends by `campaign_id`, so workflows do not
  need to know parameter names
- start SMS or email workflows with `campaign_id` and
  `template_identifier` only
- if a reused campaign needs a parameter because the template declares it,
  require the parameter to already exist in Persist or the campaign record
  rather than treating omission as an empty default

## Checklist

Before considering the audience capability ready, confirm:

- the audience entrypoint is explicit
- hard-filter ownership is explicit
- the runtime intake contract is documented
- required identifiers and evidence fields are present
- campaign-scoped template parameters are attached at Campaign Assignment before workflow start
- the runtime does not need to re-derive the eligible population from raw source systems
- the handoff shape is replayable and auditable

## Rules Summary


| Rule                        | File                                       | Impact   |
| --------------------------- | ------------------------------------------ | -------- |
| SMS Runtime Intake Contract | `reference/sms-runtime-intake-contract.md` | CRITICAL |
