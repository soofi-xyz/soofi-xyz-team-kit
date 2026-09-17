# Verification and onboarding

## Trace one run

1. Pin repository/adapter/model versions, authorized environment, selector artifact
   and bindings, effective ruleset artifacts, evaluation instant and projection.
2. Execute the selector against controlled data. Verify the exact unique population,
   duplicates, pagination, empty selection and materialization provenance.
3. Inspect normalized predicates and generated query. Use controlled source facts
   to calculate expected entity and candidate decisions independently.
4. Compare individual predicate evidence with combined report-mode evaluation.
   Then compare accepted entities/candidates with fast filter mode and direct mode.
5. Reconcile selected IDs, result artifacts, detailed reports and aggregate counts.
   Check missing data, partition failures and unfinished work before claiming a
   complete result. Distinguish unavailable explanations from measured zeros.
6. Await outcome persistence independently, then read subjects spanning the
   implementation's defined decision values through the supported data
   interface. Verify a subject filtered out by rule logic traces to its exact
   filtering rule artifact/version and verify idempotent event replay.
7. If optional publication is enabled, await its independent outcome, read the
   expected facts through the public data interface, and verify idempotent replay.

## Worked example with abstract predicates

Use abstract boolean predicates `P` and `Q` only; this is a fixture for the
evaluation mechanism, not a business-rule definition. Use a materialized selector
result containing E1–E5; E4 is absent when evaluation reads the source. Require
the entity predicate and one related candidate passing both P and Q.

| Entity | Entity predicate | Candidate P/Q observations | Expected result |
| --- | --- | --- | --- |
| E1 | Pass | C1: pass/pass; C2: fail/pass | Accept E1 with C1 only |
| E2 | Fail | C3: pass/pass | Reject E2 |
| E3 | Pass | C4: pass/fail; C5: fail/pass | Reject: no single candidate passes both |
| E4 | Absent from source | No evaluation | Source-missing, not predicate-rejected |
| E5 | Pass | C6: fail/fail | Reject; candidate failure explanations overlap |

With complete source/report evidence, reconcile 5 selected = 1 accepted +
3 rejected + 1 source-missing. Candidate-predicate P fails on C2/C5/C6; Q fails
on C4/C6. Counts overlap at C6 and include C2 from an accepted entity if counting
all candidate observations. If instead counting rejected entities where every
candidate fails a predicate, E5 counts for each, while E3 counts for neither.
State the metric's population and counting unit rather than summing those counts
as if they represented unique rejected entities.

If a partition containing E5 fails, mark its decision unfinished/error and the
run partial; do not keep the complete-run counts above. Retry that partition
without duplicating E1 or aggregate counts. Use this example to teach report
interpretation before introducing any consumer-owned policy artifacts.

## Scenario coverage

| Area | Required evidence |
| --- | --- |
| Generality | A non-Debt entity with its own selector/identity, entity-only mode and optional related candidates |
| Selection | Query/version/binding changes, authorization scope, empty/duplicate/malformed IDs, pagination, partial query failure and supplied-population membership/provenance |
| Rules | Deterministic composition, identical/conflicting artifacts, unsupported syntax, scope/polarity interpretation, empty effective ruleset and stable report attribution |
| Candidates | Multiple candidates, cross-candidate false positives, missing required scope, multiple scopes and nullable projection |
| Graph model | Shared candidates, relationship-scoped facts, historical/corrected versions, out-of-order observations and index/traversal equivalence |
| Time/cache | Pinned evaluation instant, timezone boundaries, artifact invalidation, changed facts and documented snapshot-isolation limits |
| Population cache | Source/selector advancement, expired or incomplete materialization, concurrent generation, lease loss and runtime activation/rollback |
| Execution | Saturation, admission/cleanup, retry/redrive capacity, partial partitions, idempotent aggregation and independent publication failure |
| Outcome persistence | Durable outcomes across configured decision values, filtering-rule attribution/version, source-unavailable/execution-failure distinction, queue retry/DLQ/replay and manifest-to-store reconciliation |
| Performance | Comparable before/after Filter phase timings, data size/fan-out, query identity, source plans, cache state, load and decision-equivalence results; separate asynchronous persistence timing |
| Consumers | Output schema/nullability, freshness/completeness handling, publication identity and downstream ownership |

Use tests tied to observable decisions and failure handling. A generic contract
is not implemented until its adapters and service paths pass these scenarios;
changing documentation is not evidence that arbitrary entity support exists.

## Evidence to return

Record commands/results, revision/environment, artifact identities, fixtures,
execution/request IDs, selected and terminal counts, output/report locations,
measured timings and remaining limits. Keep rule content and sensitive entity
records in their authorized sources. Local fixtures establish behavior for their
controlled inputs, not deployed policy or production performance.

For the existing service, use its [actual verification commands and limits](implementation/verification.md)
and [known implementation gaps](implementation/known-gaps.md). Do not require a
specific business-rule inventory to explain or validate the generic mechanism.
