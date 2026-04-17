# Repo Map

Use this file at the start of every `metrics` workflow to confirm ownership boundaries and reuse points.

## Repository Roles

| Repo | Primary role | Tech stack | Owns |
| --- | --- | --- | --- |
| `skills` | Workflow guidance and reusable operating rules | Markdown skills and rules | This skill package, related skills, contribution patterns |
| `lexicon` | Canonical schema and metric registry | TypeScript, Vite, React, Vitest, CDK | `cloudwatch-metrics.json`, `lexicon.json`, schema tests, lexicon viewer |
| `livevox-metrics-pipeline` | Metric ingestion, normalization, and publication example | Python, Pydantic, pytest, CDK, Step Functions | Metric emission, ingestion lanes, metric inventories, source-owned business widget specs |
| `main-dashboard` | Shared CloudWatch dashboard rendering | TypeScript, Jest, CDK | Dashboard sections, widget constructs, shared custom widget factory, synth tests |

## Lexicon Ownership

- `lexicon/src/data/cloudwatch-metrics.json`: canonical CloudWatch metric names and documented dimensions.
- `lexicon/src/data/lexicon.json`: graph schema for persisted business data and immutable snapshot modeling.
- `lexicon/src/data/lexicons.ts`: registers `cloudwatch_metrics` in the viewer.
- `lexicon/src/data/__tests__/cloudwatch-metrics-data.spec.ts`: validates metric registry shape and expected entries.
- `lexicon/src/data/__tests__/lexicon-data.spec.ts`: validates graph modeling, including `daily_business_metric_value`.

## Pipeline Ownership

- `livevox-metrics-pipeline/app/services/livevox_dashboard_contract.py`: source of truth for expected metric names, units, labels, and publication modes in this pipeline.
- `livevox-metrics-pipeline/scripts/check_lexicon_contract.py`: confirms expected pipeline metric names exist in `cloudwatch-metrics.json`.
- `livevox-metrics-pipeline/docs/metrics-inventory.md`: explains the metric lanes, semantics, namespace, dimensions, and widget ownership split.
- `livevox-metrics-pipeline/app/config/metrics/`: declarative metric config patterns for business metrics.
- `livevox-metrics-pipeline/dashboard/socapital-dashboard-widgets.json`: source-owned business widget specs that `main-dashboard` renders on shared dashboards.
- `livevox-metrics-pipeline/tests/test_infrastructure_app.py`: synthesis guardrail that often needs updates when a new metric lane adds schedules, alarms, or other infra resources.

## Dashboard Ownership

- `main-dashboard/lib/constructs/daily-value-widget-factory.ts`: default path for shared single-value cards.
- `main-dashboard/lib/dashboard-stack.ts`: dashboard section order and construct wiring.
- `main-dashboard/lib/constructs/livevox-call-metrics-widget.ts`: grouped realtime and daily metric pattern.
- `main-dashboard/lib/constructs/livevox-agent-metrics-widget.ts`: grouped snapshot-service-total pattern.
- `main-dashboard/lib/constructs/livevox-service-efficiency-widget.ts`: grouped multi-section reporting pattern.
- `main-dashboard/test/dashboard.test.ts`: synthesis-level expectations, including section order, card titles, snapshot fallback settings, and custom-widget counts.

## Reuse Rules

- Prefer extending existing lexicon files and tests over inventing parallel registries.
- Prefer existing pipeline lanes and config patterns over bespoke ingestion flows.
- Prefer existing widget factories and grouped constructs over new widget infrastructure.
- Treat `livevox-metrics-pipeline` as the concrete example for lexicon-aligned metric publishing and dashboard handoff.
- Treat the older `metrics-skill` analysis workflow as deprecated history, not current design authority.

## Validation Commands By Repo

| Repo | Commands |
| --- | --- |
| `lexicon` | `bun run test:run`, `bun run lint`, `bun run format:check`, `bun run typecheck` |
| `livevox-metrics-pipeline` | `just format`, `just lint`, `just type-check`, `just test`, `just build` when infra changes |
| `main-dashboard` | `just format`, `just lint`, `just type-check`, `just test`, `just build` |

## Ownership Summary

- Canonical name and business-friendly description start in `lexicon`.
- Ingestion, publication, and source semantics live in the pipeline repo.
- Shared dashboard rendering lives in `main-dashboard`.
- Cross-repo process guidance lives in `skills`.
