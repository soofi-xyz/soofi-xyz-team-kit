---
name: build-sms-communication-service
description: "Guides top-level construction of the SMS communication service. Covers builder-vs-runtime separation, reusable worker-skill composition (`manage-channel-templates`, `select-communication-audience`, `manage-communication-activity`, `assemble-communication-runtime`), golden prompt expectations, and rebuild-from-scratch governance. Use when building or refactoring the SMS communication service itself, its worker-skill composition, or the builder prompt."
---

# Build SMS Communication Service

Use this skill when Kadabra is building the SMS communication service.

Kadabra is the top-level builder. It should not be the daily runtime and it should not be the canonical owner of low-level runtime mechanics.

## Related Skills


| Skill                                                              | Load when                                                                              |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `[manage-channel-templates](../manage-channel-templates/)`         | defining template inventory, CRUD, and template sync                                   |
| `[select-communication-audience](../select-communication-audience/)` | defining audience boundaries and runtime intake contracts                              |
| `[manage-communication-activity](../manage-communication-activity/)` | defining provider execution, routing, and feedback loops                               |
| `[assemble-communication-runtime](../assemble-communication-runtime/)` | defining the runtime workflow, data contracts, allocation, and validation              |
| `[orchestrate-sms-workflow](../orchestrate-sms-workflow/)`         | defining the filter -> solver -> Jigglypuff -> lifecycle -> export workflow            |
| `[building-ai-agents](../building-ai-agents/)`                     | capturing builder prompts, reusable agent structure, and runtime-vs-builder boundaries |
| `[building-solver-services](../building-solver-services/)`         | implementing the Glue + OR-Tools architecture inside the runtime                       |
| `[building-batch-workflows](../building-batch-workflows/)`         | defining input contracts, cost gates, throttling, and recoverability                   |
| `[apply-engineering-guidelines](../apply-engineering-guidelines/)` | applying language, CDK, testing, and observability standards                           |


## Builder Contract

Kadabra should behave like a communication-service builder, not like a monolithic engineer that directly owns every layer.

Read `rules/kadabra-communication-ontology.md` first.

Kadabra must keep these roles separate:

- **Kadabra**: top-level builder/orchestrator that takes the business prompt and composes reusable worker skills
- **Worker skills**: reusable top-level skills that own stable subproblems across channels
- **Runtime worker**: the deterministic daily SMS workflow/service produced by `oranguru`

Do not collapse those three roles into one prompt, one skill, or one code path.

## Worker Composition

Kadabra should explicitly compose these worker skills:

- `[manage-channel-templates](../manage-channel-templates/)` / Wigglytuff for template inventory, CRUD, and synchronization
- `[select-communication-audience](../select-communication-audience/)` / Xatu for audience boundaries and runtime intake contracts
- `[manage-communication-activity](../manage-communication-activity/)` / Chatot for provider setup, execution handoff, and feedback loops
- `[assemble-communication-runtime](../assemble-communication-runtime/)` / Oranguru for runtime assembly, scheduling logic, allocation, and validation
- `[orchestrate-sms-workflow](../orchestrate-sms-workflow/)` for the deterministic Step Functions contract that connects filter, solver, Jigglypuff rendering, SMS lifecycle, Quiq feedback, daily export, and SFTP delivery

Kadabra may set requirements on the produced runtime, but the detailed runtime rulebook belongs to the worker skills, not to Kadabra.

## Current SMS Runtime Shape

The current SMS communication service is built as a deterministic workflow:

```text
Filter -> SmsSolverWorkflow -> Jigglypuff render fanout -> SmsLifecycleWorkflow -> raw Quiq S3 batch processing -> DailyInterproseExportWorkflow
```

Important learned requirements:

- filter runs before solver with `rule_context: { channel: "SMS" }`; development runs should preserve rule reports
- solver emits UUID `message_id` values and scheduled send partitions
- Jigglypuff rendering must return `rendered_message`, `asset_id`, and `interaction_identifier`
- Quiq payload assets use `{ "assetId": "<asset_id>" }`
- send context stores local `messageId` and Quiq `providerMessageId`
- daily export can batch-read raw Quiq S3 date folders directly; S3 notifications are optional
- export scans a small rolling raw-folder window and filters rows into the legacy 10PM Eastern export day
- `sms_log` ends with `interaction_identifier`

## Golden Prompt Standard

Kadabra's main deliverable is the reusable prompt and knowledge base that can recreate the service.

The golden prompt should contain at least:

- the business goal
- where the audience comes from
- where templates live
- where templates are sourced from initially
- which provider/channel is used
- where communication events and outcomes must persist
- what runtime and deployment constraints apply
- which worker skills own which parts of the system

Expected quality bar:

- capture the prompt in the repo
- refine the prompt when defects are found
- improve worker-skill contracts when boundaries are wrong
- get to the point where deleting the generated implementation and rerunning the prompt rebuilds the same service correctly

## Builder Review Checklist

Before considering Kadabra ready, confirm:

- builder vs runtime separation is explicit
- Kadabra composes worker skills instead of rebuilding everything ad hoc
- `wigglytuff` owns template management and sync
- `xatu` owns audience selection and intake handoff
- `chatot` owns communication activity execution and feedback
- `oranguru` owns runtime assembly and detailed runtime rules
- `orchestrate-sms-workflow` owns the cross-step workflow contract and E2E acceptance path
- a golden prompt exists and is auditable
- the golden prompt is good enough to support rebuild-from-scratch validation
- worker boundaries are clear enough that runtime details do not need to live in Kadabra

## Out Of Scope

This skill does NOT directly own:

- runtime intake schemas
- candidate generation details
- scoring formulas
- OR-Tools allocation mechanics
- provider API invocation details
- send-file execution contracts

Those belong to `xatu`, `oranguru`, and `chatot`.

## Rules Summary


| Rule                           | File                                      | Impact   |
| ------------------------------ | ----------------------------------------- | -------- |
| Kadabra Communication Ontology | `rules/kadabra-communication-ontology.md` | CRITICAL |
