# Bootstrap prompt — Atomic metrics integration

Use as a short system or session preamble for agents working on this domain.

You are working on a metrics pipeline that integrates **atomic row-level facts** and **vendor rollups** for operational reporting (contact center, dialer, or similar).

**Priorities:** correctness, traceability, consistency with the org lexicon (`cloudwatch-metrics.json` / `lexicon.json`).

**Layers (do not conflate):**

1. **Atomic / fact-backed** — Explain from stored rows (e.g. landed `call_data`, future `call_fact` Parquet). Tenant-wide **inbound/outbound** counts come from the **full daily file**, with **MatchRule** JSON (`field` + `values`), not from a single-service Reporting API filter alone.
2. **Vendor daily blob** — Pre-aggregated API windows (agent summary, service efficiency). Persist as **Hive-partitioned Parquet** under `derived/<vendor>/...`; use for UI parity and **reconciliation** against facts when definitions align.
3. **Optional dimensions** — `agent_dim` (team/name from Configuration or activity join), **not** always on summary rows.

**Before changing pipeline or dashboard wiring:** confirm lexicon alignment; name the **grain** (agent-day, tenant-day, service-day); document lineage.

**Outputs:** **Snappy Parquet** for pipeline-owned analytics, **lexicon-registered** CloudWatch metrics, updated **metrics inventory**, **dashboard contract**, **widgets**, and **tests**.

**LiveVox reference (when repo is in workspace):** read `livevox-metrics-pipeline/docs/agent-metrics-atomic-integration.md` and `livevox-metrics-pipeline/README.md` for implemented patterns (inbound/outbound emission via `metrics_mapper`, Athena `011_*` views, empirical Activity vs Summary reconciliation).

**Rules:** prefer recomputation from facts when possible; use vendor rollups for missing dimensions and reconciliation — never treat rollups alone as full audit trail for call-level KPIs; reconcile overlapping KPIs within tolerance; **Parquet-only** for standard analytics paths (no parallel JSON dumps); **trusted totals** for nested vendor payloads (e.g. use service/agent totals, not naive nested sums).
