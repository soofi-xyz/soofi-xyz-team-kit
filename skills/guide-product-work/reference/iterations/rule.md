# Rule capability map

Use Gallade for the engine and Meditite for supported selector/ruleset configuration.
Apply the [shared workflow](../../SKILL.md) to the actual request and deployed
adapter. These seven capability areas are a starting inventory. Select and split
features by dependencies; do not merge candidates, projections and persistence
into a generic verification stage. Keep expected decisions independent of results.

| Feature ID / usable capability | Dependency | Builder increment / configurer exercise | AWS inspection and acceptance |
| --- | --- | --- | --- |
| `selection-evaluation` — select and evaluate an entity | Approved source/model | Deliver a minimal selector, direct predicate and explanation path; configure known passing, failing and missing entities. | Inspect selector/evaluation logs and decisions; match entity identity and failing predicate. |
| `rule-composition` — combine policies | Single-predicate evaluation | Deliver supported predicate/scope composition; configure changed thresholds and combinations against the same population. | Inspect effective ruleset version and predicate explanations; identify why a decision changed. |
| `candidate-scopes` — require related qualifying candidates | Evaluation and source relationships | Deliver related-candidate selection/scope semantics; configure multiple candidates and a missing/split-match case. | Inspect candidate decisions and scope results; prove required predicates apply to the same qualifying candidate where specified. |
| `projections-reports` — return decision context | Selection/evaluation | Deliver supported projection/report modes; configure metadata variants and aggregate/per-record views. | Compare report artifacts and logs, counting units and overlapping failures; verify requested fields and missing data behavior. |
| `batch-execution` — evaluate a bounded population | Direct evaluation | Deliver batch partitioning, capacity admission and partial-failure handling; configure small batch/limit variants. | Inspect workflow/worker logs, disjoint counts and rejected/failed work; compare equivalent direct results. |
| `snapshot-freshness` — reuse a governed population | Selection and materialization | Deliver snapshot identity, refresh/readiness and leases; configure reused and refreshed populations after a source change. | Inspect provenance, effective versions and readiness logs; show reuse does not falsely freeze source facts. |
| `durable-outcomes` — trace a decision after evaluation | Evaluation and supported persistence interface | Deliver Event → Queue outcome storage and idempotent recovery; configure supported delivery and replay fixtures. | Inspect evaluation versus consumer completion separately, then read back immutable rule attribution and DLQ/retry behavior without adding critical-path writes. |

Use [the reference map](../../../build-rules-product/SKILL.md) and the target
implementation contract. Do not infer arbitrary-entity/candidate support from the
generic design. Unsupported configuration goes to Gallade. A rule-threshold
change may be one feature piece; pass/fail, missing facts and replay are tests
inside it. Keep scheduling, ranking and communication with their owning products.
