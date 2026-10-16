# Quiq SMS full-day round-trip calibration

Use only with `quiq-sms-lifecycle.json`. This dossier contains sanitized expectations, not runtime validation evidence.

Classification: `deterministic`. It tests pinned forward/reverse mappings and fixed normalization. Provider lifecycle semantics, identity schemes, and dependency changes are `PRODUCT_CHANGE` handoffs.

## Real-window coverage

The window should span a UTC day boundary and contain repeated provider updates, every lifecycle category, mixed phone-location outcomes and records omitting optional JSON fields. The canary picks 10 real events per slice with mixed outcomes; behaviors absent from the window are reported as not covered, never simulated. Retain only aggregate histograms, schemas and SHA-256 digests.

## Expected flow

1. Hydrate objects listed by one immutable export manifest.
2. Read JSON with the language-derived explicit schema; omitted optional fields become typed nulls.
3. Apply lifecycle and phone-location enrichment.
4. Transform to canonical facts, then reverse-map the nine declared parity fields.
5. Compare canonicalized rows and status/time histograms using a UTC half-open full-day window.

Expected passing evidence: one canonical lifecycle fact and one reverse row per hydrated input, nine of nine fields compared, zero unexpected mismatches, zero dangling message endpoints and identical manifest/object hashes.

## Final PROD-derived validation

Everything runs on real data. Compare at least 7 recent complete UTC days of `quiq-events` from
read-only PROD metadata against the profile's `sourceWindowPolicy` (derived at intake with recorded defaults) and ask the user
to confirm the recommended window (or use the owner's "most recent full UTC day with real data
per slice"). If a slice has no data that day, say so and suggest the nearest UTC day with data.
Stage a canary of 10 real events per slice (mixed outcomes) into DEV under its own approval
digest, run it in `observed-dev`, and compare it with what PROD actually did (the slice's PROD
actual in `reference/prod-actuals.json`). Show the execution ids, S3 inputs and outputs, row
counts and the comparison, and ask before the full window unless the owner pre-approved a
passing canary. A failed canary stops the validation. After approval, stage and run the full
window and pass the regression expectations below against the PROD actuals. If PROD access,
the confirmation, the canary gate or an approval is missing, the verdict stays `BLOCKED`.

## Regression expectations

- Unsupported JSON/CSV mapping option: phase 6 `FAIL`.
- Omitted optional field dropped by inference: phase 7 `FAIL`.
- Transform timestamp or decimal mismatch against the PROD actual: phase 11 `FAIL`.
- Deployed package/configuration differs from evaluated revision: phase 8 `FAIL`.
- Local-time full-day export includes/excludes the wrong event: phase 11 `FAIL`.
- Stale ordering changes canonical hashes: phase 11 `FAIL`.
- Manifest points at missing hydration artifacts: phase 11 `FAIL`.
