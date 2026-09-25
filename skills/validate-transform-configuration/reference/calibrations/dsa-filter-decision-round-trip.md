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
  `product_execution_evaluates_ruleset`, `product_execution_includes_debt`,
  and client-ID-bearing `company_represents_debt` facts;
- immutable hydrated Decision evidence for rule booleans, chunks, manifests,
  counts and exact reverse reconstruction;
- Decision, current Lexicon, and Interprose definitions
- the mapping contract test at `infra/test/transform-mappings.spec.ts`

Use the pinned sanitized package declared by the profile. Its manifest SHA-256 is `e890fb58a0866b9cd873b3665d6cae12adbcf29d12952e84edb63a9cf1495e5d`; the package contains 247 objects and 46,723,527 bytes. Resolve and record the current candidate commit SHA rather than treating a pull-request branch as immutable evidence.

## Automatic local flow

1. Resolve all repositories and select the one unambiguous Lexicon candidate that contains every required mapping path.
2. Stop `BLOCKED` while any direction is `not-registered`. Once registered,
   materialize all three artifacts and verify their IDs, versions, languages,
   active current-Lexicon concepts, hydrated-evidence inputs, SQL digests,
   formats and enabled status.
3. Run the Lexicon mapping contract test from the pinned candidate.
4. Verify the sanitized package manifest digest before reading bounded fixture data.
5. Execute Decision → Lexicon with Spark 3.3 compatibility and prove canonical
   product-execution, included-debt, ruleset and company-representation endpoint
   closure before Persist.
6. Execute Lexicon → Decision by joining canonical graph facts with the pinned
   hydrated evidence package; compare all six Decision datasets.
7. Execute Lexicon → Interprose from the deterministic latest
   `company_represents_debt` client-ID event and compare all seven `form_1281`
   fields, including `form_config_id = 1281` and
   `field_identifier = DSA_CLIENT_ID_`.
8. Run the declared conflict, evidence-package, endpoint, optional-field, and unsupported-option negative cases.

Expected full-package evidence includes exact two-rule parity, 280 `form_1281` rows, 21 fail-closed negative cases, zero dangling endpoints, and zero protected values in retained evidence. Typecheck, lint, generic unit tests, and CDK synthesis do not satisfy these mapping gates.

## Regression expectations

- Unsupported mapping options: phase 6 `FAIL`.
- Spark 3.3-incompatible SQL/type behavior: phase 7 `FAIL`.
- Mapping searched only in the Transform checkout: phase 2 `BLOCKED`, then continue repository discovery.
- Missing or ambiguous Lexicon candidate after all declared discovery steps: phase 2 `BLOCKED`.
- Latest-PR-wins deployment digest mismatch: phase 8 `FAIL`.
- Dangling client/rule endpoint: phase 10 `FAIL`.
- Mutable form manifest or nondeterministic hashing: phase 11 `FAIL`.
- Any DEV write in dry-run mode: stop immediately before it with `APPROVAL_REQUIRED`.
