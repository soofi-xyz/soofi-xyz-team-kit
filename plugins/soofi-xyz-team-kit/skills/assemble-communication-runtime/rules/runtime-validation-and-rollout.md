# Runtime Validation And Rollout

The SMS runtime is not ready when the model runs once. It is ready when the contracts, costs, outputs, and replay behavior are trustworthy.

See [`../reference/current-solver-parity.md`](../reference/current-solver-parity.md) for the parity checklist baseline.

## Companion Skills To Load

- [`build-batch-workflows`](../../build-batch-workflows/) for input validation, cost gate, throttling, response validation, and recoverability
- [`apply-engineering-guidelines`](../../apply-engineering-guidelines/) for language, CDK, testing, and observability standards
- [`build-ai-agents`](../../build-ai-agents/) when validating prompt capture, reusable skill boundaries, and runtime-vs-builder responsibilities

## Minimum Validation Sequence

1. validate the `xatu` intake contract against real filtered `results` JSON
2. write the internal enriched runtime contract and get sample data
3. run a small end-to-end subset
4. validate selected, overflow, summary, and scheduled-send outputs
5. replay a known day and compare decisions
6. run in shadow mode before production cutover

## What To Validate

### Builder Repeatability

- a golden prompt exists in the repo
- the golden prompt still matches the implementation
- builder-vs-runtime separation is explicit
- worker-skill ownership is still recognizable
- deleting the generated implementation and rebuilding from the prompt would reproduce the same architecture materially

### Contracts

- `xatu` intake schema
- internal candidate input schema
- candidate-hour schema
- selected-actions schema
- overflow schema
- run-summary schema
- scheduled-send row schema for execution handoff

### Behavior

- `xatu`-owned hard suppressions are not reimplemented in the runtime
- one best phone is chosen before hourly allocation
- template family is chosen after hour assignment
- daily cap is respected
- hourly distribution is respected
- same-hour or near-call logic behaves as intended
- recent 14-day texts contribute to the same soft recent-contact penalty shape as the call solver
- overflow behavior is deterministic and explainable
- execution handoff is complete enough for `chatot` to send without re-ranking

### Metrics

Track at least:

- candidates read
- candidates excluded
- actions scored
- actions selected
- overflow count
- sends accepted
- clicks or visits
- PTPs
- payments
- opt-outs and complaints

## Rollout Rules

- start with shadow mode and business review
- keep policy versions on every output artifact
- make reruns idempotent and recoverable
- add a cost ceiling before large production runs
- respect graph, vendor, and delivery-system throttling
- update prompts and ontology docs when defects are discovered, not only the generated code
