# Product and boundaries

Read [the evidence baseline](PRD.md#evidence-baseline) before relying on this snapshot.

## Ownership

Use **Gallade** for the Filter service and its Rules productization. Keep the
current implementation name `filter` and the intended marketplace name `Rules`
explicit until a compatible migration lands.

| Owner | Boundary |
| --- | --- |
| Gallade | Rule evaluation, contact candidate selection, outputs, capacity, snapshots, eligibility writeback and service verification |
| Xatu | Downstream audience boundaries, suppression acceptance criteria and runtime intake packaging |
| Machamp | Supporting workflow, throttling, cost, idempotency and recovery expertise |
| Porygon | Metric definitions, reconciliation, Lexicon metric registration and shared dashboard integration |
| Conkeldurr | Separate changes to Persist, Lexicon and other platform dependencies |
| Regigigas | Marketplace distribution, dependency ordering and tenant installation |

## Current surfaces

| Surface | Discovery | Contract |
| --- | --- | --- |
| Batch | SSM `filter-workflow-state-machine-arn`; stack output `StateMachineArn` | IAM `states:StartExecution`; STANDARD workflow; S3 outputs |
| Single debt | SSM `/rules/sync/evaluator-function-arn`; stack output `EvaluatorFunctionArn` | IAM `lambda:InvokeFunction`; qualified `live` alias with provisioned concurrency 1 |
| Output bucket | SSM `/filter/output-bucket-name`; stack output `OutputBucketName` | Read returned S3 locations with authorized IAM |
| Capacity | `/filter/capacity/runtime-config` and `/filter/capacity/*-function-arn` | Supported capacity CLI and IAM-protected operator functions |

The canonical batch pointer `/rules/workflow/state-machine-arn` is a target,
not present at the baseline. Discover the legacy pointer for existing integrations.

## Implemented capabilities

- Evaluate debts from caller CSV/Parquet or full Persist debt discovery.
- Reuse full-population debt-ID snapshots when enabled and fresh.
- Compile Lexicon JSON/Gremlin rules selected by context or explicit S3 prefixes.
- Select phone and/or email candidates; require every selected scope to pass.
- Use optimized filter queries by default or report queries for rule explanations.
- Emit JSON results, debt-ID CSV results, statistics and optional report artifacts.
- Evaluate one debt synchronously with one bounded Persist read.
- Admit batch runs through shared capacity control and recover leases out of band.
- Opt in to daily phone eligibility writeback through Persist's ingest API in a
  separate event-triggered workflow.

## Boundaries to preserve

Use Persist for all graph reads and writes. Never connect directly to Neptune or
mutate Persist's internal storage. Eligibility writeback is an intentional producer
of graph facts; Persist still owns validation, graph identity and persistence.

Consume Lexicon-owned rules, vocabularies and metadata. Rule CRUD, approval,
publishing and governance remain with Lexicon. Do not infer deployed suppression
coverage from compiler support or a field named `phone`.

Keep outbound calls, SMS, email, templates, scoring and downstream activity state
in their owning communication products. Return a point-in-time eligibility result;
callers must handle freshness and durable evidence for their own use case.

Do not add a public REST API, custom domain, tenant identity or usage plan merely
to expose Rules. The existing batch and direct-invoke surfaces use IAM.

## Operating entry

Resolve the repository revision and existing deployment before provisioning.
Reuse the selected AWS profile from the existing access flow and verify account
and region. Follow reviewed repository/CDK/CI deployment procedures for production;
do not use ad hoc production Lambda, Step Functions or IAM updates.

Source anchors in Filter: `lib/filter-stack.ts` discovery outputs and state
machines; `src/types.ts`; `src/handler.ts`; `src/evaluate-debt.ts`.
