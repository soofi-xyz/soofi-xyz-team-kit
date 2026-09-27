# DSA Filter decision round-trip calibration

Use only with `dsa-filter-decision.json`. This is a sanitized scenario specification, not proof of a deployed run.

Classification: `deterministic`. It exercises predefined version-controlled mapping expressions with expected-output and negative cases. Any proposal to change decision identity or representation is a `PRODUCT_CHANGE`, not a profile option.

## Configuration sources

Resolve pinned current Lexicon before inspecting a candidate or the Transform
workspace. Current Lexicon removed `rule_execution`; any candidate that revives
it fails with `RemovedLexiconConcept`. All three mappings are registered by
Lexicon PR #796 and published in DEV:

- `decision-to-lexicon@1.0.0` emits tabular JSONL `product_execution`,
  `product_execution_has_child_execution`, `product_execution_includes_debt`
  and `company_represents_debt`; it emits no `product`, `product_has_execution`,
  `company` or `debt` rows. Debt and company endpoints are existing graph
  identities carried by `graph_identity_references`;
- `lexicon-to-decision@1.0.0` rebuilds all six Decision datasets, including
  `graph_identity_references`, from those four datasets;
- `lexicon-to-interprose@3.0.0` is generator-only
  (`infra/lib/transform-mapping-artifacts.ts`) and reads only
  `company_represents_debt`;
- additive optional Decision properties only; no `rule_execution` vertex,
  evidence-package vertex, or `rule_execution_*` edge;
  `authoritative_graph_export` is a non-graph adapter dataset that no mapping
  reads or writes;
- Decision, current Lexicon, and Interprose definitions;
- the mapping contract test at `infra/test/transform-mappings.spec.ts` and the
  Spark 3.3 suite at `infra/test/spark/test_decision_mappings.py`.

Published mapping objects are overwritten under the same `id@version` while the
pull request is open. Pin each `mapping.json` and query by S3 `VersionId` and
SHA-256 before every run, compare them with a `cdk synth` of the pinned
candidate, and re-read them after the run. Compare other operators' runs only
when their plan digests equal the pinned ones.

Bind the Transform runtime to the commit whose Glue script bytes equal the DEV
deployment, not to the default branch. Schema-bound JSON reading of vertex
inputs (Transform PR #43) is part of the runtime under test: the inverse reads
`product_execution` through the `lexicon.json` vertex schema, so every forward
`product_execution` column must be declared there.

Use the complete half-open UTC day staged at
`s3://transformpipelinestack-databuckete3889a50-rmklq0v3to8q/inputs/dsa-filter-decision-prod-derived/2026-09-18T000000Z_2026-09-19T000000Z_v1/`
in DEV `us-east-2`, manifest SHA-256
`167469f157cf18ed0225570dbbf7b5f213498fd4dd3405a87edc6e25302824cc`, version
`Rl2cIl7LIcDPoj6BOmsvVRIW4EURgmmf`. Verify every derived object's SHA-256, row
count and `VersionId` against it. The day contains all six Decision families,
accepted outcomes, client events, and one `decision_batch.status = not_required`
run; it contains no rejected outcome.

Use the separately pinned sanitized 20260915 mixed run as the rejected-path
case. Its manifested package (SHA-256
`e890fb58a0866b9cd873b3665d6cae12adbcf29d12952e84edb63a9cf1495e5d`) predates the
current Decision contract (`rules_report` instead of the two rule booleans; no
evidence-manifest fields). The executable
`20260924T133000Z-contract-freeze-v1-decision-contract-adapted-v1/` package is
manifested (SHA-256
`8c07fdd6a18f0a6a3d7fb187675ff73996d45df05fe6e200e375355ed80a3714`, version
`9vtKQG9LRwVRZuSYNMaSWVIaUs._MJV1`). Verify every listed object's `VersionId`,
SHA-256, bytes and rows, its `sourceManifest` binding to the manifested package,
and row-for-row lineage before using it. Never retain a source row or business
identifier.

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
6. Prove `product_execution` carries the 17 `decision_batch` fields,
   `dsa_company_identifier`, and all seven chunk fields; every child chunk
   resolves to exactly one parent run.
7. Prove `product_execution_includes_debt` carries `outcome`, `chunk_index`,
   both rule booleans and `source_run_id`, with one edge per evaluated debt.
8. Prove `company_represents_debt` carries `dsc_client_id`, `source_run_id`,
   `idempotency_key`, `event_type` and `client_event_schema_version`, plus
   `company_type = DEBT_SETTLEMENT_AGENCY`, source `status`, and `version = 2`.
9. Without Persist, execute Lexicon → Decision directly from the forward DEV
   output and compare every declared field of `decision_batch` (17),
   `chunk_executions` (7), `debt_outcomes` (4), `rule_evaluations` (5),
   `dsa_client_id_updates` (7), and `graph_identity_references` (5).
10. Without Persist, execute Lexicon → Interprose from that same output. Elect
    one deterministic latest DSA `company_represents_debt` edge per debt and
    compare all seven `form_1281` fields, including
    `form_config_id = 1281` and `field_identifier = DSA_CLIENT_ID_`.
11. Run a latest-edge regression containing an older and newer event for the
    same debt: the newer event must win, the stale event must not leak, and an
    equal-time conflict without a declared deterministic tie-break must fail.
    `form_1281.sql` declares `idempotency_key DESC` as the tie-break. When no
    staged debt has more than one event, this regression and
    `latest_oos_missing_state_blocks_dsa_offer = false` are proven only by the
    Spark suite; report that limitation.
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
