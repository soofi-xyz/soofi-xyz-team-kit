# DSA Filter decision round-trip calibration

Use only with `dsa-filter-decision.json`. This is a sanitized scenario specification, not proof of a deployed run.

Classification: `deterministic`. It exercises predefined version-controlled mapping expressions with expected-output and negative cases. Any proposal to change decision identity or representation is a `PRODUCT_CHANGE`, not a profile option.

## Configuration sources

Resolve pinned current Lexicon before inspecting a candidate or the Transform
workspace. Current Lexicon removed `rule_execution`; any candidate that revives
it fails with `RemovedLexiconConcept`. The corrected configuration remains
`not-registered` until reviewed mappings contain:

- `decision-to-lexicon@1.0.0`
- `lexicon-to-decision@1.0.0`
- `lexicon-to-interprose@3.0.0`
- canonical `product`, `product_execution`, `product_has_execution`,
  a declared parent-child product-execution edge,
  `product_execution_includes_debt`, and `company_represents_debt` facts;
- additive optional Decision properties only; no `rule_execution` vertex,
  evidence-package vertex, or `rule_execution_*` edge;
- direct graph carriage of every Decision field without a hydrated side package;
- Decision, current Lexicon, and Interprose definitions
- the mapping contract test at `infra/test/transform-mappings.spec.ts`

Use the complete half-open UTC day staged at
`s3://transformpipelinestack-databuckete3889a50-rmklq0v3to8q/inputs/dsa-filter-decision-prod-derived/2026-09-18T000000Z_2026-09-19T000000Z_v1/`
in DEV `us-east-2`. Its manifest, versions, counts, bytes and content digests
must be pinned before execution. The source must contain all six Decision
families, accepted and rejected outcomes, client events, and at least one
`decision_batch.status = not_required` run.

Use the separately pinned sanitized 20260915 mixed run as the rejected-path
case. The currently declared immutable package manifest SHA-256 is
`e890fb58a0866b9cd873b3665d6cae12adbcf29d12952e84edb63a9cf1495e5d`.
Confirm its internal source-run date from sanitized manifest metadata before
calling it the 20260915 case. Never retain a source row or business identifier.

## Automatic local flow

1. Resolve all repositories and select the one unambiguous Lexicon candidate that contains every required mapping path.
2. Stop `BLOCKED` while any direction is `not-registered`. Once registered,
   materialize all three artifacts and verify their IDs, versions, languages,
   active current-Lexicon concepts, generated-artifact source, SQL digests,
   formats and enabled status.
3. Run the Lexicon mapping contract test from the pinned candidate.
4. Verify both DEV evidence manifests and the full-day family/coverage signals.
5. Execute Decision → Lexicon first with Spark 3.3 compatibility. Record the
   exact executed SQL digests, execution ID, plan digest, result manifest and
   physical output locations. A registration test or synthesized mapping alone
   fails `DecisionSqlNotExecuted`.
6. Prove `product_execution` carries the 16 `decision_batch` fields and all
   seven chunk fields; every child chunk resolves to exactly one parent run.
7. Prove `product_execution_includes_debt` carries `outcome`, `chunk_index`,
   both rule booleans and `source_run_id`, with one edge per evaluated debt.
8. Prove `company_represents_debt` carries `dsc_client_id`, `source_run_id`,
   `idempotency_key`, `event_type` and `client_event_schema_version`, plus
   `company_type = DEBT_SETTLEMENT_AGENCY`, source `status`, and `version = 2`.
9. Without Persist, execute Lexicon → Decision directly from the forward DEV
   output and compare every declared field of `decision_batch` (16),
   `chunk_executions` (7), `debt_outcomes` (4), `rule_evaluations` (5),
   `dsa_client_id_updates` (7), and `graph_identity_references` (5).
10. Without Persist, execute Lexicon → Interprose from that same output. Elect
    one deterministic latest DSA `company_represents_debt` edge per debt and
    compare all seven `form_1281` fields, including
    `form_config_id = 1281` and `field_identifier = DSA_CLIENT_ID_`.
11. Run a latest-edge regression containing an older and newer event for the
    same debt: the newer event must win, the stale event must not leak, and an
    equal-time conflict without a declared deterministic tie-break must fail.
12. Run the sanitized mixed rejected-path case and all declared endpoint,
    optional-field, unsupported-option and physical-artifact negative cases.

Expected retained evidence has zero field mismatches, zero dangling endpoints,
one selected latest DSA event per eligible debt, one complete UTC day including
`not_required`, and zero protected values. Typecheck, lint, registration tests,
CDK synthesis and workflow `SUCCEEDED` do not satisfy mapping-execution gates.
Persist is forbidden for this scenario and PROD remains read-only.

## Regression expectations

- Unsupported mapping options: phase 6 `FAIL`.
- Spark 3.3-incompatible SQL/type behavior: phase 7 `FAIL`.
- Decision SQL without executed query digests and physical outputs: phase 9 `FAIL`.
- Missing `not_required` run or incomplete 2026-09-18 UTC coverage: phase 9 `FAIL`.
- Any Decision field count or value mismatch: phase 9/11 `FAIL`.
- Mapping searched only in the Transform checkout: phase 2 `BLOCKED`, then continue repository discovery.
- Missing or ambiguous Lexicon candidate after all declared discovery steps: phase 2 `BLOCKED`.
- Latest-PR-wins deployment digest mismatch: phase 8 `FAIL`.
- Any `rule_execution` concept or dangling canonical endpoint: phase 5/6/10 `FAIL`.
- Incorrect latest DSA edge or stale event leakage: phase 11 `FAIL`.
- Mutable form manifest or nondeterministic hashing: phase 11 `FAIL`.
- Any Persist invocation or PROD write: stop; it is outside the declared workflow.
- Any DEV write in dry-run mode: stop immediately before it with `APPROVAL_REQUIRED`.
