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

## Campaign Launch Context

When a campaign launch accepts `last_day_to_prevent_placement`, keep it optional at the launch boundary but pass enough context for downstream template-aware validation.

- preserve the launch-by-S3 plus inline `campaign` handoff shape; do not
  collapse the launch contract to a campaign-only by-ID launch
- preserve the campaign identifier and any provided parameter values in the
  audience handoff context
- place provided values inside `campaign.parameters` as:
  ```json
  "parameters": {
    "last_day_to_prevent_placement": {
      "type": "DATE",
      "value": "YYYY-MM-DD"
    }
  }
  ```
- reject flat `campaign.last_day_to_prevent_placement` and top-level
  `last_day_to_prevent_placement` forms
- derive required parameter keys from the selected template query
  `has('parameter_key', ...)` plus the template's variables listing
- use the same `campaign.parameters` container for SMS and email launches
- workflows validate the container and pass the whole `campaign` object to
  Campaign Assignment
- the only business rule for this key is that the DATE value is strictly after
  the `America/New_York` run day
- if a reused campaign needs the value because the template declares it, require the parameter to already exist in Persist rather than treating omission as an empty default

## Checklist

Before considering the audience capability ready, confirm:

- the audience entrypoint is explicit
- hard-filter ownership is explicit
- the runtime intake contract is documented
- required identifiers and evidence fields are present
- campaign-scoped launch parameters required by templates are carried in
  `campaign.parameters` or resolved explicitly
- the runtime does not need to re-derive the eligible population from raw source systems
- the handoff shape is replayable and auditable

## Rules Summary


| Rule                        | File                                       | Impact   |
| --------------------------- | ------------------------------------------ | -------- |
| SMS Runtime Intake Contract | `reference/sms-runtime-intake-contract.md` | CRITICAL |
