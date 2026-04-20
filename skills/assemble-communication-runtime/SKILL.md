---
name: assemble-communication-runtime
description: "Assemble deterministic communication runtimes from reusable audience, template, and activity capabilities. Covers runtime workflow composition, internal data contracts, candidate generation, scoring, allocation, outputs, and runtime validation. Use when building or refactoring communication runtimes, workflow assembly agents, or end-to-end channel services."
---

# Assemble Communication Runtime

Use this skill when turning reusable communication capabilities into the deterministic worker system that actually runs the service.

## Core Responsibilities

`Oranguru` owns:

- runtime workflow composition
- internal runtime data contracts
- candidate generation and reduction
- scoring and hourly slotting
- allocation and output artifacts
- runtime validation and rollout rules

## Required Inputs

Before assembling the runtime, make sure these capability contracts exist:

- audience handoff from `xatu`
- template inventory contract from `jigglypuff`
- communication activity contract from `chatot`

The runtime should consume those contracts rather than silently redefining them.

## Runtime Reference

For the current SMS service, start with `reference/current-solver-parity.md`.

## Boundaries

`Oranguru` does not own:

- template authoring or template sync
- upstream hard-filter ownership
- provider-specific delivery lifecycle ownership
- top-level builder ontology and golden-prompt governance

Those belong to `jigglypuff`, `xatu`, `chatot`, or `kadabra`.

## Checklist

Before considering the runtime-assembly capability ready, confirm:

- runtime boundaries are explicit
- internal runtime contracts are explicit
- candidate generation and allocation phases are documented
- output artifacts are documented
- retries, replay, and recovery are defined
- the runtime can be rebuilt from the stored prompt and worker contracts without hidden tribal knowledge

## Rules Summary


| Rule                              | File                                                    | Impact   |
| --------------------------------- | ------------------------------------------------------- | -------- |
| Current Solver Parity             | `reference/current-solver-parity.md`                    | CRITICAL |
| Runtime Problem Framing           | `rules/runtime-problem-framing.md`                      | CRITICAL |
| Runtime Data Contract             | `rules/runtime-data-contract.md`                        | CRITICAL |
| Runtime Candidate Generation      | `rules/runtime-candidate-generation-and-eligibility.md` | CRITICAL |
| Runtime Scoring And Time Slotting | `rules/runtime-scoring-and-time-slotting.md`            | CRITICAL |
| Runtime Allocation And Outputs    | `rules/runtime-allocation-and-outputs.md`               | CRITICAL |
| Runtime Validation And Rollout    | `rules/runtime-validation-and-rollout.md`               | HIGH     |
