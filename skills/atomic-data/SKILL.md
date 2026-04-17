---
name: atomic-data
description: "Lexicon-first metrics for contact-center / operational platforms: combine row-level (atomic) facts with vendor daily rollups, Parquet in object storage, CloudWatch publication, and clear lineage in cloudwatch-metrics.json and lexicon.json. Use when designing or implementing atomic vs rollup layers, reconciliation, inbound/outbound classification rules (e.g. LIVEVOX_INBOUND_RULES_JSON), metrics_mapper business keys, Athena reconciliation views, or per-agent daily reporting. Triggers on: atomic metrics, call_fact, vendor rollup, contact center metrics, agent daily metrics, metrics reconciliation, Parquet derived layer, blob vs atomic storage, operational platform metrics."
---

# Atomic Data Metrics

Use this skill when integrating **third-party contact-center or operational platforms** where you must preserve **auditability**: explain metrics from **atomic facts** where possible, use **vendor rollups** where necessary, store **pipeline-owned analytics as partitioned Parquet**, publish **lexicon-registered CloudWatch** metrics, and keep **one clear lineage** per KPI in the org lexicon.

This skill **specializes** the general [`metrics-skill`](../metrics-skill/) workflow for **atomic + rollup** data models. Run [`discover-skills`](../discover-skills/) first so the registry is current, then follow the mandatory chain below.

## Related Skills

| Kind | Skill | When |
| --- | --- | --- |
| Mandatory | [`discover-skills`](../discover-skills/) | Refresh global skills before starting. |
| Mandatory | [`metrics-skill`](../metrics-skill/) | End-to-end metrics definition, pipeline, dashboard, and delivery gates. |
| Mandatory | [`build-batch-workflows`](../build-batch-workflows/) | Step Functions, Glue, batch transforms, idempotency, cost gate, and batch metrics emission. |
| Often | [`apply-engineering-guidelines`](../apply-engineering-guidelines/) | TypeScript/Lambda/Glue standards, observability, testing. |
| Optional | [`build-ai-agents`](../build-ai-agents/) | Only when packaging this workflow as a **deployed** agent runtime (Asana, webhooks, ToolLoopAgent). Not required for pipeline-only work. |

## Mandatory Execution Chain

Always follow this order. Do not skip a gate.

1. **Repository understanding** — metrics pipeline repo, ETL repo, lexicon repo, dashboard repo (see [`rules/01-repo-and-layering.md`](./rules/01-repo-and-layering.md)).
2. **Lexicon / CloudWatch gate** — confirm or define metrics in lexicon workflows before code or dashboard wiring (see [`rules/02-lexicon-gates.md`](./rules/02-lexicon-gates.md)).
3. **Data integration** — atomic path vs vendor rollup path, Parquet layout, batch strategy (see [`rules/03-parquet-batch-and-emission.md`](./rules/03-parquet-batch-and-emission.md)).
4. **Reconciliation and classification** — overlap KPIs, direction rules, tolerances (see [`rules/04-reconciliation-and-rules.md`](./rules/04-reconciliation-and-rules.md)).
5. **Delivery** — metrics inventory, dashboard contract, tests, PRs — defer to `metrics-skill` delivery phase when coordinating repos.

## Hard Gates

- Do not implement pipeline or dashboard changes until **lexicon implications** are confirmed (reuse vs new entries in `cloudwatch-metrics.json` / `lexicon.json` as applicable).
- Do not invent canonical metric names without going through **`metrics-skill`** lexicon phase.
- Do not treat vendor field names as interchangeable with canonical names until mappings are explicit.
- Prefer **Parquet-only** analytics outputs under `derived/<vendor>/...`; do not maintain parallel JSON artifacts for analytics (see rules).

## Plan Artifact: Per-Agent Metrics Analysis

When the user asks for a structured plan, produce **Per-agent metrics analysis** with at least:

- Agent daily report **atomic validation matrix** (which KPIs are fact-backed vs rollup-only).
- Inbound/outbound derivation from daily call facts (tenant-wide vs service-scoped where required).
- **Parquet storage diagram** (blob/rollup layer vs atomic layer, partitions).
- **Proposed lexicon metrics** for agent KPIs (grain, source, unit).
- Gaps, assumptions, risks.
- Per-agent / per-day: what atomic data unlocks.

Details: [`rules/05-plan-artifact-per-agent-metrics.md`](./rules/05-plan-artifact-per-agent-metrics.md).

## Reference implementation (LiveVox)

The **`livevox-metrics-pipeline`** repo is the concrete implementation of this skill’s patterns. Use it as a template for layering, docs, and contracts:

| Topic | Where |
| --- | --- |
| Team/join keys, productive/login definitions, landed-data prerequisites | [`livevox-metrics-pipeline/docs/agent-metrics-atomic-integration.md`](../../../livevox-metrics-pipeline/docs/agent-metrics-atomic-integration.md) |
| End-to-end lanes, batch metrics, blob vs facts overview | [`livevox-metrics-pipeline/README.md`](../../../livevox-metrics-pipeline/README.md) |
| Every emitted metric, units, `operation` | [`livevox-metrics-pipeline/docs/metrics-inventory.md`](../../../livevox-metrics-pipeline/docs/metrics-inventory.md) |
| Business metric keys and CloudWatch mapping | [`livevox-metrics-pipeline/app/services/metrics_mapper.py`](../../../livevox-metrics-pipeline/app/services/metrics_mapper.py) |
| Dashboard + publication contract | [`livevox-metrics-pipeline/app/services/livevox_dashboard_contract.py`](../../../livevox-metrics-pipeline/app/services/livevox_dashboard_contract.py) |
| Example Athena pivot / reconciliation | [`livevox-metrics-pipeline/sql/athena/011_atomic_integration_example_views.sql`](../../../livevox-metrics-pipeline/sql/athena/011_atomic_integration_example_views.sql) |
| Derived agent-daily lexicon types (e.g. `productive_time_seconds`, `productive_pct`) | [`lexicon/src/data/cloudwatch-metrics.json`](../../../lexicon/src/data/cloudwatch-metrics.json) (org-wide) |

**Cursor plan (analysis only, do not edit from repos):** *LiveVox per-agent metrics analysis* — validation matrix, empirical Activity vs Summary notes, blob+atomic mermaid. Paths under `~/.cursor/plans/` when present locally.

## Bootstrap Prompt (Optional)

For a short agent or session preamble, read [`reference/bootstrap-prompt.md`](./reference/bootstrap-prompt.md).

## Files To Read

- [`rules/01-repo-and-layering.md`](./rules/01-repo-and-layering.md)
- [`rules/02-lexicon-gates.md`](./rules/02-lexicon-gates.md)
- [`rules/03-parquet-batch-and-emission.md`](./rules/03-parquet-batch-and-emission.md)
- [`rules/04-reconciliation-and-rules.md`](./rules/04-reconciliation-and-rules.md)
- [`rules/05-plan-artifact-per-agent-metrics.md`](./rules/05-plan-artifact-per-agent-metrics.md)
