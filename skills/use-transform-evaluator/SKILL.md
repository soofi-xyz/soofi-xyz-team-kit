---
name: use-transform-evaluator
description: "Use elephant-xyz/AI-Agent's LangGraph test-evaluator-agent to generate, repair, and validate county or seed transform outputs while keeping Oracle as the owning ingestion agent."
---

# Use Transform Evaluator

This skill wraps the standalone LangGraph CLI in
[`elephant-xyz/AI-Agent`](https://github.com/elephant-xyz/AI-Agent). It is a helper for
**Oracle** and transform authors, not a separate company runtime.

## When to use

- you need AI assistance generating or repairing a county transform output package
- you want to validate extraction quality on prepared county ZIP input
- you need seed-group transform help from CSV input
- `transform-v2-builder` is not enough because you need the evaluator/generator loop itself

## When not to use

- general county ingestion orchestration -> use `oracle` + `use-oracle`
- MCP data exploration -> use `donphan` + `use-elephant-mcp`
- Elephant CLI source-code changes -> work in `elephant-cli`, not here, unless explicitly asked

## Tool contract

The upstream tool is `test-evaluator-agent`.

County/group transform flow:

```bash
uvx --from git+https://github.com/elephant-xyz/AI-Agent test-evaluator-agent --transform --group county --input-zip path/to/input.zip [--output-zip path/to/output.zip]
```

Seed flow:

```bash
uvx --from git+https://github.com/elephant-xyz/AI-Agent test-evaluator-agent --transform --group seed --input-csv path/to/seed.csv
```

## Inputs

Prepared county ZIPs should include the mining seed classes plus the raw county capture, such as:

1. `unnormalized_address.json`
2. `property_seed.json`
3. county HTML or other source payloads to transform

## Environment

- `MODEL_NAME` default `gpt-4.1`
- `TEMPERATURE` default `0`
- `OPENAI_API_KEY` required for the upstream tool

## How it fits with Oracle

Use this skill as a **sub-step** under `oracle`:

1. `county-discovery`
2. `county-appraisal-onboarding`
3. `transform-v2-builder`
4. `use-transform-evaluator`
5. `validate-county-transform`

The evaluator helps generate or repair transform outputs; Oracle still owns the ingestion,
validation, and publish path.

## Verification

- inspect the produced ZIP contents
- run the next validation step in the Oracle flow
- compare output against raw captures before scaling the county run

## Expected output

Return:

- whether the task is county or seed
- exact command to run and required inputs
- expected output artifact
- follow-on Oracle stage after the evaluator finishes
- blockers such as missing ZIP structure or credentials
