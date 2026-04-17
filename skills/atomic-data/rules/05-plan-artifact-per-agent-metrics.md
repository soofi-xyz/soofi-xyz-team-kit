---
title: Plan artifact — Per-agent metrics analysis
impact: MEDIUM
tags: planning, agent-daily, validation-matrix, documentation
---

## When to use

Produce this artifact when the user asks for a plan, design review, or stakeholder handoff for **per-agent / per-day** operational metrics.

## Required sections

1. **Agent daily report atomic validation matrix** — Rows: KPIs; columns: fact-backed vs rollup-only, source object or API, grain, notes.
2. **Inbound/outbound derivation** — How all-services counts are derived from daily call facts; call out tenant-wide vs service-filtered metrics.
3. **Parquet storage diagram** — Atomic layer (for example `call_fact`, optional `agent_state_fact`, `agent_dim`) vs vendor rollup layer under `derived/<vendor>/...`, partitions.
4. **Proposed lexicon metrics** — Canonical names, grains, units, CloudWatch vs dashboard-only.
5. **Gaps, assumptions, risks** — Data completeness, classification field stability, API limits, cost.
6. **What atomic unlocks** — Per-agent / per-day: which decisions or audits require row-level data.

## Optional follow-ons (document as backlog)

- Athena views over `call_fact` plus `agent_dim` (see example: `livevox-metrics-pipeline/sql/athena/011_atomic_integration_example_views.sql`).
- Agent Activity **Parquet** landing lane if missing (no parallel JSON analytics dump).
- Per-service breakdown as phase 2.

## Implemented companion doc (LiveVox)

For operational definitions and join-key guidance that mirror this artifact, see **`livevox-metrics-pipeline/docs/agent-metrics-atomic-integration.md`** (team sources, productive/system time, `call_data` vs callDetails for per-agent KPIs).
