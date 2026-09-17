---
name: build-rules-product
description: "Designing, integrating, or operating a generic Rule Filter product — entity-selection queries, predicates, candidates, projections, batch/direct evaluation, snapshots, reports, and capacity."
disable-model-invocation: true
---

# Build Rules Product

Use `gallade` as the Rule Filter owner. Require a query selecting the entities to
evaluate, then apply governed rule artifacts and return passing entities with
requested metadata. Use Debt only as an example. Keep specific business-rule
definitions, counts and campaign policies outside these generic references.

Start with [the product index](reference/PRD.md). Preserve this skill path for
existing callers; load implementation references only when the actual service's
contracts or code are relevant.

## Reference map

| Task | Read |
| --- | --- |
| Generic purpose, ownership, reuse and routing | [Product and boundaries](reference/product-and-boundaries.md) |
| Required population query, identities, bindings and input provenance | [Entity selection](reference/entity-selection.md) |
| Predicate scopes, ruleset composition, compiler and time | [Rules and queries](reference/rules-and-queries.md) |
| Source mappings, relationships, immutable facts and versions | [Graph model](reference/graph-model.md) |
| Batch input/output, projection and counts | [Batch contract](reference/batch-contract.md) |
| Durable record-level outcomes, rule attribution, Event → Queue delivery and traceability | [Outcome persistence](reference/outcome-persistence.md) |
| Direct evaluation and cache/latency semantics | [Single entity](reference/single-entity.md) |
| Materialization, refresh, readiness and leases | [Entity universe](reference/entity-universe.md) |
| Architecture, admission, retries, writeback and deployment | [Execution and operations](reference/execution-and-operations.md) |
| Query optimization, measured timing and solver handoff | [Performance and consumers](reference/performance-and-consumers.md) |
| Worked report example, tests and completion evidence | [Verification](reference/verification.md) |
| Existing Debt adapter: exact payloads, SSM, runtime and constraints | [Implementation index](reference/implementation/PRD.md) |
| Existing service's remaining work, including generic entity selection | [Implementation gaps](reference/implementation/known-gaps.md) |

## Working rules

1. Separate generic product requirements from deployed capabilities. The current
   Filter service is Debt-rooted; it does not accept arbitrary entity selectors.
2. Define selection, evaluation and projection separately. Require selector
   identity even for reused materializations; preserve legacy inputs during migration.
3. Pin source/model/artifact versions and environment before changing behavior.
   Keep unknown source facts or partial execution distinct from failed predicates.
4. Require durable, immutable outcomes for every evaluated record. Use the
   Event → Queue persistence contract, preserve filtering-rule attribution, keep
   persistence completion separate from evaluation completion, and verify no
   Filter-phase regression beyond a predeclared measurement tolerance.
5. Follow [engineering guidelines](../apply-engineering-guidelines/SKILL.md) for
   implementation. Reuse discovered infrastructure and public data interfaces.
6. Use Xatu/Oranguru for communication handoffs, Abra for solvers, Machamp for
   workflows, Porygon for metrics, Conkeldurr for Persist/Lexicon changes and
   Regigigas for distribution. Link their existing contracts rather than copying
   consumer-specific behavior into this product.
