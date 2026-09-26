# Rule Filter — product reference index

Define a reusable product that **selects an entity population with a query,
evaluates configured rules, and returns passing entities with requested metadata**.
Use Debt as one example entity type. Do not make Debt, a communication channel,
a particular rule, or a particular campaign part of the generic product definition.

## Read by question

| Question | Reference |
| --- | --- |
| What does the product own and how do other products use it? | [Product and boundaries](product-and-boundaries.md) |
| Which entities are evaluated, and which query selects them? | [Entity selection](entity-selection.md) |
| How do rules, scopes, composition and query compilation work? | [Rules and queries](rules-and-queries.md) |
| How do graph relationships, source mappings and versions work? | [Graph model and versions](graph-model.md) |
| What does a batch accept and return? | [Batch contract](batch-contract.md) |
| How does direct evaluation of one entity work? | [Single entity](single-entity.md) |
| Why materialize IDs, when do they refresh, and what stays live? | [Entity universe](entity-universe.md) |
| How do admission, failures, writeback and deployment work? | [Execution and operations](execution-and-operations.md) |
| How do query optimization, timings and downstream solvers relate? | [Performance and consumers](performance-and-consumers.md) |
| How can a teammate verify decisions and reconcile report counts? | [Verification](verification.md) |
| Which capabilities exist in the current service? | [Implementation baseline](implementation/PRD.md) |
| Which current-service gaps still need implementation? | [Implementation gaps](implementation/known-gaps.md) |

## Contract versus implementation

Treat the generic references as product requirements. Conceptual field names are
not an already-deployed API. Keep exact existing inputs, discovery pointers,
outputs and constraints in the implementation references.

The inspected Filter service is Debt-rooted. Its full-population selector is
hardcoded, and its compiler and direct evaluator have domain-specific constraints.
A caller-configurable entity-selection query, arbitrary entity adapters and the
generic result envelope require implementation and compatibility tests. Do not
suggest that renaming a payload field enables them.

## Evidence baseline

The [existing implementation](implementation/PRD.md#evidence-baseline) was inspected
on 2026-09-15 at `Spring-Oaks-Capital-LLC/filter` commit `451a667`. Local checks
passed; no deployed configuration, current rule inventory or production timing was
certified. Resolve a fresh revision and environment when doing implementation work.
Keep business-rule definitions and inventories in their governed source, outside
this generic product documentation.
