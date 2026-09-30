# Quiq SMS full-day round-trip calibration

Use only with `quiq-sms-lifecycle.json`. This dossier contains sanitized expectations, not runtime validation evidence.

Classification: `deterministic`. It tests pinned forward/reverse mappings and fixed normalization. Provider lifecycle semantics, identity schemes, and dependency changes are `PRODUCT_CHANGE` handoffs.

## Synthetic dataset

Create 86 lifecycle events across a UTC day boundary, including offset-change timestamps, repeated provider updates, all lifecycle categories, mixed phone-location outcomes, and records omitting each optional JSON field. Use fixture-only tokens and retain only aggregate histograms, schemas and SHA-256 digests.

## Expected flow

1. Hydrate objects listed by one immutable export manifest.
2. Read JSON with the language-derived explicit schema; omitted optional fields become typed nulls.
3. Apply lifecycle and phone-location enrichment.
4. Transform to canonical facts, then reverse-map the nine declared parity fields.
5. Compare canonicalized rows and status/time histograms using a UTC half-open full-day window.

Expected passing evidence: 86 hydrated inputs, 86 canonical lifecycle facts, 86 reverse rows, nine of nine fields compared, zero unexpected mismatches, zero dangling message endpoints and identical manifest/object hashes.

## Final PROD-derived validation

The synthetic dataset above is an earlier phase. It proves shape, negatives and wiring, and its
evaluation ends `BLOCKED` with `FinalProdDerivedValidationRequired`. `READY` needs the final run:
compare at least 7 recent complete UTC days of `quiq-events` from read-only PROD metadata against the
profile's `sourceWindowPolicy` (derived at intake with recorded defaults), ask the user to confirm the recommended window, stage the
sanitized window into DEV under its own approval digest, execute every workflow step in
`observed-dev` under per-execution approvals, and pass the regression expectations below on that
window. If PROD metadata access or the confirmation is missing, the verdict stays `BLOCKED`.

## Regression expectations

- Unsupported JSON/CSV mapping option: phase 6 `FAIL`.
- Omitted optional field dropped by inference: phase 7 `FAIL`.
- Spark 3.3 timestamp or decimal mismatch: phase 7 `FAIL`.
- Deployed package/configuration differs from evaluated revision: phase 8 `FAIL`.
- Local-time full-day export includes/excludes the wrong event: phase 11 `FAIL`.
- Stale ordering changes canonical hashes: phase 11 `FAIL`.
- Manifest points at missing hydration artifacts: phase 11 `FAIL`.
