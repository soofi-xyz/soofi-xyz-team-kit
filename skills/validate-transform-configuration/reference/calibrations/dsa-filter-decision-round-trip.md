# DSA Filter decision round-trip calibration

Use only with `dsa-filter-decision.json`. This is a sanitized scenario specification, not proof of a deployed run.

Classification: `deterministic`. It exercises predefined version-controlled mapping expressions with expected-output and negative cases. Any proposal to change decision identity or representation is a `PRODUCT_CHANGE`, not a profile option.

## Synthetic dataset

Create 37 client events spanning three decision categories, five reason categories, nullable effective dates, duplicate source delivery, mixed field order and one deliberately unmatched graph endpoint. Replace source identities with non-reversible fixture tokens. Record only aggregate counts and artifact digests.

## Expected flow

1. Validate the client-event language and exact mapping digests.
2. Transform events into edge-only durable decisions.
3. Reject the duplicate through deterministic identity or reconcile it explicitly.
4. Detect the unmatched endpoint before Persist.
5. After correcting the fixture in a new immutable input, read back a bounded Persist canary.
6. Project form-1281 rows and reconcile category/reason aggregates.

Expected passing evidence: 37 admitted events, 37 unique decision edges, zero dangling endpoints, 37 form rows, equal category/reason histograms and zero protected values in the artifact.

## Regression expectations

- Unsupported mapping options: phase 6 `FAIL`.
- Spark 3.3-incompatible SQL/type behavior: phase 7 `FAIL`.
- Latest-PR-wins deployment digest mismatch: phase 8 `FAIL`.
- Dangling client/rule endpoint: phase 10 `FAIL`.
- Mutable form manifest or nondeterministic hashing: phase 11 `FAIL`.
- Any DEV write in dry-run mode: stop immediately before it with `APPROVAL_REQUIRED`.
