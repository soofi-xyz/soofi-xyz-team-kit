# Known gaps and closure evidence

Use the [2026-09-15 source baseline](PRD.md#evidence-baseline). All rows below are
open until implementation and verification evidence establishes closure. Updating
this agent kit does not change the Filter deployment.

## Generic product extension

The [generic selection contract](../entity-selection.md) is a product requirement,
not an existing workflow input. Preserve current callers while implementing:

- versioned, configurable read-only entity-selection queries and bound parameters;
- generic entity identity/model adapters across discovery, compiler, batch and
  direct evaluation, with explicit candidate and projection contracts;
- selector/bindings/model/authorized-scope/source identity in snapshot cache keys,
  plus materialized-input provenance and complete/deduplicated selection results;
- selector membership for restricted/direct inputs and generic outcome metadata;
- a non-Debt acceptance fixture proving selection, evaluation, projection, cache
  isolation and batch/direct equivalence.

Current discovery, `debt_id` input, compiler roots, snapshot singleton and evaluator
classification are domain-specific. Treat their generalization as Gallade-owned
implementation work with compatibility, scoped-access and migration evidence.
Keep specific business-rule definitions and inventories outside this product's
references; they are not required to explain the generic mechanism.

## Documentation gaps addressed by this reference split

The focused references now describe context-selected rules, phone/email AND
semantics, SMS invocation requirements, reduced default statistics, CSV outputs,
capacity control, shared snapshots and opt-in Persist writeback. Gallade owns the
product; Xatu owns downstream handoff criteria. Do not reintroduce the old
read-only-graph or no-DynamoDB/EventBridge assertions.

## Implementation and verification backlog

Effort: S = hours, M = roughly a day or several focused changes, L = multi-day.
Risk describes changing the service, not the certainty of the observed mismatch.
Priorities reflect contract/operating impact; latency optimization needs measurement.

| Priority / ID | Gap and evidence in Filter | Owner, effort / risk | Closure evidence |
| --- | --- | --- | --- |
| P1 / discovery | `lib/filter-stack.ts` publishes only legacy batch SSM; canonical sync SSM already exists | Gallade; S / low | Add canonical batch alias without replacing the workflow; old/new callers resolve the same ARN |
| P1 / sync-contract | `src/evaluate-debt.ts` treats explicit `ruleset_id` as a label; non-phone catalog-ID selection is absent | Gallade + Xatu; M / medium | Publish a compatible selector/label contract; test existing subset callers, unknown IDs, response identity and intended scope |
| P1 / sync-observability | `src/evaluate-debt.ts` logs/returns latency but lacks promised latency/count/error/cache metrics | Gallade + Porygon; M / low | Terminal/error/cache measurements tested and registered; dashboard evidence; telemetry cannot corrupt decisions |
| P1 / sync-latency | CDK uses 32000 ms Persist / 45 s Lambda; prior requirement was 220 ms Persist / <=300 ms warm p95 | Gallade + Persist owner; measurement S, optimization TBD / medium | Measure representative warm p95 and Persist contribution; either meet the target or explicitly revise it with consumer acceptance |
| P1 / writeback-e2e | `test/e2e/eligibility.e2e.test.ts` omits writeback opt-in, counts historical edges globally and permits zero facts | Gallade + Machamp; M / low | Explicit phone-only opt-in fixture, correlated ingest completion, expected debt/phone/UTC-date facts and idempotent replay; missing expected facts fail |
| P1 / input-api-iam | Batch/Glue S3 and execute-api grants remain broad; evaluator S3 is already prefix-scoped | Gallade; M / medium | Authorized inputs/rules/async results/writeback still work; unrelated prefixes/APIs denied; install parameters validated |
| P1 / redrive-capacity | Native redrive skips completed AcquireCapacity after the original lease may have been released (`docs/capacity-controller.md`) | Gallade + Machamp; M / high | Preserve failed-state/Map-child redrive while proving reacquisition or equivalent enforced capacity accounting |
| P2 / marketplace | `marketplace.product.json`, `marketplace/app.ts`, tenant installer parameters are absent | Gallade + Regigigas; L / medium | Build-produced cloud assembly passes tenant install, prerequisites, asset and existing-install migration tests |
| P2 / region-runtime | `bin/app.ts`, graph clients and ingest constants pin us-east-2; Lambdas use Node 22 | Gallade; M / medium | Deployment/signing follow verified tenant region; Node 24 ESM/parser/WASM tests and synth pass |
| P2 / naming | Package, tags, metrics, prefixes and stack identity remain Filter | Gallade + Regigigas/Porygon; M / medium | Consumer inventory, compatible migration, retained-resource diff, both-generation discovery/output/metric checks |
| P2 / snapshot-activation | Snapshot flags are CI/CDK-time values (`bin/app.ts`, stack); source docs also lag PROD CI enablement | Gallade + Machamp; M / medium | Validated runtime activation/rollback without redeploy; freshly verified environment flags and updated repo instructions |
| P2 / rules-cache | Sync cache uses URI/context + TTL, not version/ETag invalidation (`src/ruleset-loader.ts`) | Gallade; M / medium | Agree staleness/replay requirements; versioned rules or validated invalidation prevents unacceptable stale decisions without breaking latency |
| P2 / channel-evidence | Xatu suppression requirements have not been verified against live Lexicon/SMS/email fixtures | Gallade + Xatu + Lexicon owner; M / low | Pinned deployed rules/context and positive/negative suppression matrix; no claim of missing live rules from this code audit alone |
| P2 / metrics-integration | Capacity runbook records Lexicon/Main Dashboard integration as cross-repo follow-up | Porygon + Gallade; M / low | Registered metric definitions and visible shared dashboard series for the actual environment |
| P3 / commands | `just check` / `just cdk:synth` from old PRD are absent; real recipes are documented in verification | Gallade; S / low | Agreed aliases or updated shared command contract; actual commands run successfully |

## Dependency order

Reconcile caller contracts before behavior changes. Add compatible batch discovery
and measurement early. Inventory resources/consumers before tightening IAM or
renaming. Resolve deploy-time Persist/Lexicon lookups before marketplace installation.
Measure latency before optimizing or reducing budgets. Use characterization tests
before changing redrive, snapshot lease behavior or ruleset identity.

## Requirements already implemented

Do not recreate the evaluator, provisioned alias, canonical sync pointer,
phone/email batch candidates, context selection, report mode, CSV output, capacity
controller, snapshots or writeback workflow. Maintain these existing capabilities
while resolving the gaps above.
