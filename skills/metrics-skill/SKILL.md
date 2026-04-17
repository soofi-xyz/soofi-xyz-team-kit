---
name: metrics-skill
description: "Design and implement lexicon-first metrics workflows across the repositories, including candidate metric discovery, snapshot semantics, dashboard delivery, and PR follow-up. Use when defining a new metric, mapping vendor metrics to canonical names, extending CloudWatch metric registration, integrating a metric into a pipeline, adding dashboard widgets, or preparing coordinated lexicon/pipeline/dashboard delivery. Triggers on: new metric, metrics workflow, cloudwatch metric, vendor metric mapping, metric pipeline, dashboard widget, lexicon metric, livevox metric, business metric."
---

# Metrics

Use this skill to run the reusable `metrics` workflow across `skills`, `lexicon`, `livevox-metrics-pipeline`, and `main-dashboard`.

This skill replaces the older analysis-only metrics unification workflow. Use it for end-to-end metrics work that must move in order from definition to delivery.

## Related Skills

Mandatory:

| Skill | When |
| --- | --- |
| [`build-batch-workflows`](../build-batch-workflows/) | Choose the right ingestion strategy for landed files, snapshots, or historical batch metrics. |
| [`apply-engineering-guidelines`](../apply-engineering-guidelines/) | Enforce repository standards for TypeScript, CDK, testing, observability, and dashboard registration. |

Use when needed:

| Skill | When |
| --- | --- |
| [`atomic-data`](../atomic-data/) | Contact-center / operational metrics that combine **atomic facts** and **vendor rollups**, Parquet layers, reconciliation, direction rules (`LIVEVOX_*_RULES_JSON`), and per-agent plans; **LiveVox** implementation notes in `livevox-metrics-pipeline/docs/agent-metrics-atomic-integration.md`. |
| [`integrate-ci-cd`](../integrate-ci-cd/) | Wire or update shared GitHub Actions workflows and `justfile` recipes. |
| [`build-ai-agents`](../build-ai-agents/) | Only when packaging the metrics workflow into a separate deployed agent runtime. |

## Mandatory Execution Chain

Always follow this exact order:

1. `Repository Understanding`
2. `Metrics Definition Flow`
3. `Data Integration Flow`
4. `Dashboard Visualization Flow`
5. `Delivery Flow`

Do not skip a gate. Stop and ask instead of guessing.

## Domain Operating Rules

1. Treat vendor metrics as potentially non-equivalent, even when names match.
2. Prioritize semantic correctness over convenience.
3. Prioritize explainability over automation.
4. Assume high regulatory and audit scrutiny.
5. Preserve lineage from source metric to canonical metric.
6. Ask the user before unifying ambiguous mappings.

## Hard Gates

- Do not propose pipeline or dashboard changes until the user confirms the lexicon mapping.
- Do not let metric names drift from the confirmed lexicon name.
- If a temporary mismatch is explicitly requested, ask for permission twice before proceeding.
- If sample data, source access, rate limits, or ownership boundaries are unclear, stop and ask.
- If lexicon confirmation has not been given, end the response after repository understanding, the lexicon proposal table, and the explicit confirmation request.
- Before lexicon confirmation, do not include pipeline design, dashboard design, delivery steps, implementation sequencing, or PR guidance.
- If the user asks for candidate metric discovery before naming, stop after repository understanding, the candidate inventory table, the selection request, and the lexicon confirmation request.

## Phase Guide

### 1. Repository Understanding

Start by scanning the target repositories and summarizing what can be reused. Read [`reference/repo-map.md`](./reference/repo-map.md) first.

### 2. Metrics Definition Flow

Treat lexicon confirmation as the first hard gate. Read [`rules/02-lexicon-phase.md`](./rules/02-lexicon-phase.md).

If the user asks for "all possible metrics" or wants to choose from candidate metrics first, run the inventory-first path in the lexicon phase before proposing canonical mappings.

If the user asks for end-to-end design before confirmation, limit the response to:

1. a brief repo-understanding summary
2. the lexicon comparison table
3. the confirmation question

Do not preview downstream implementation details until the user confirms the lexicon mapping.

### 3. Data Integration Flow

Choose the correct ingestion lane only after the lexicon mapping is confirmed. Read [`rules/03-pipeline-phase.md`](./rules/03-pipeline-phase.md).

### 4. Dashboard Visualization Flow

Create or update widgets only after naming, units, and dimensions are stable. Read [`rules/04-dashboard-phase.md`](./rules/04-dashboard-phase.md).

### 5. Delivery Flow

When implementation or PR follow-up is requested, group changes by repo, validate locally, remediate CI failures, then branch, commit, push, and open or update PRs. Read [`rules/05-delivery-phase.md`](./rules/05-delivery-phase.md).

## Required User Questions

Ask these when the answer is not already explicit:

- What vendor and metric family are we working on?
- Do you want candidate metric discovery first, or do you already have approved metrics?
- Can you share a redacted sample payload, file, or schema?
- Is the metric `realtime`, `snapshot`, `historical`, or clearly derived?
- What business decision should this metric support?
- What unit should users see on the dashboard?
- Where does the source data live and how is it accessed?
- What rate limits, batch sizes, or cost ceilings apply?
- Should this metric reuse an existing canonical name or add a new one?
- Which dashboard section or audience should see it?
- Should dashboard titles use business-friendly labels or exact metric names?
- Is any temporary name mismatch being requested intentionally?
- Should delivery stop at local validation, or continue through PR creation and CI follow-up?

## Stop Conditions

Stop and ask instead of guessing when:

- no sample data or schema is available
- the vendor definition conflicts with an existing canonical metric
- the metric belongs in `cloudwatch-metrics.json` but the requested workflow also needs graph-level modeling in `lexicon.json`
- the source contract does not support the requested business metric
- requested dimensions are high-cardinality or unsuitable for CloudWatch dashboards
- the correct dashboard section, title, period, or owning repo is unclear

## Files To Read

- [`reference/repo-map.md`](./reference/repo-map.md)
- [`rules/01-repo-understanding.md`](./rules/01-repo-understanding.md)
- [`rules/02-lexicon-phase.md`](./rules/02-lexicon-phase.md)
- [`rules/03-pipeline-phase.md`](./rules/03-pipeline-phase.md)
- [`rules/04-dashboard-phase.md`](./rules/04-dashboard-phase.md)
- [`rules/05-delivery-phase.md`](./rules/05-delivery-phase.md)
