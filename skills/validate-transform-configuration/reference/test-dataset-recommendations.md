# Test dataset recommendations

Recommend datasets before asking `test-dataset`. Combine them: runtime proof
needs production-shaped coverage, and negative proof needs deliberate edge
cases.

## Dataset tiers

| Id | Content | Proves | Does not prove |
| --- | --- | --- | --- |
| profile evidence | `validationSources` entries of the matched profile (`existing-dev-artifact`, `sanitized-evidence-package`) | whatever the manifest covers; reusable across runs | anything when `artifactStatus` is `staging` or the manifest digest does not verify |
| `prod-derived-full-utc-day` | one complete half-open UTC day `[D, D+1)` of every source family the forward mapping reads, derived from PROD and sanitized | real cardinality, join closure, enum coverage, and scale at the bounded tier | rare rejected or negative paths that did not occur that day |
| `sanitized-edge-cases` | small hand-selected package: rejected outcomes, nulls in optional fields, all-rows-omit-optional-key, conflicting or stale events, UTC boundary timestamps, duplicate idempotency keys, missing endpoints | negative and inverse behavior with an expected-outcome oracle | volume and realistic distribution |
| `synthetic-fixture` | rows generated locally from the language definition's properties and enums | shape, typing, and local Spark execution | anything about production data; never sufficient for `READY` alone |

Default recommendation: profile evidence when `ready`; otherwise the full UTC
day plus the edge-case package. Use the synthetic fixture for `synthetic-local`
mode and as a first local smoke test.

## Choosing the UTC day

With read-only PROD metadata, compare the most recent complete UTC days (at
least 7 candidates). For each day, record row counts per required source family,
coverage of every enum value the definition declares (for example `outcome` in
`accepted|rejected`), presence of the profile's `requiredCoverageSignals`, bytes,
and whether immutable object versions exist. Recommend the most recent day that
covers everything. If none does, recommend a contiguous range or return
`BLOCKED`; never pad the data or pick random rows.

## Storage layout

Stage in the DEV Transform data bucket in `us-east-2`. The bucket must have S3
versioning enabled; verify with `get-bucket-versioning` before recommending it.

```text
s3://<dev-transform-data-bucket>/inputs/<language>-<purpose>/<window>_<version>/
  manifest.json                   # written last, with IfNoneMatch: *
  derived/<dataset>/<dataset>.jsonl|parquet|csv
  evidence/source-manifest.json   # sanitized PROD source identities: counts, digests, version ids
  expected/<dataset>.jsonl        # edge-case oracle rows (edge-case packages only)
```

- `<language>` is the registered source language (`decision`, `quiq`, …).
  `<purpose>` is `prod-derived`, `edge-cases`, or `synthetic`.
- `<window>` is `YYYY-MM-DDT000000Z_YYYY-MM-DDT000000Z` (half-open) for day
  windows, or `YYYYMMDDTHHMMSSZ-<label>` for curated packages.
- `<version>` is `v1`, `v2`, …. Never overwrite a prefix. A correction is a new
  version.
- Each table directory holds exactly one format, the one the mapping declares
  for that input.

`manifest.json` lists every object with key, bytes, `sha256`, S3 `VersionId`,
format, row count, and the dataset it binds to. It also records the source
window, the sanitization rules applied, the source-manifest digest, and the
creation time. After writing it, record the manifest's own SHA-256 and
`VersionId`. Those two values, not the prefix, identify the dataset. Multipart
ETags are observations, not digests.

## Staging procedure

Each numbered write is a separate confirmation gate.

1. Read PROD source metadata and bounded rows under the operator's PROD
   read-only profile. Write nothing in PROD.
2. Sanitize locally. Replace business identifiers and PII with keyed,
   deterministic pseudonyms that preserve joins, and drop free text. Keep
   enum, boolean, count, and timestamp semantics.
3. Build `derived/`, `evidence/source-manifest.json`, and `manifest.json`
   locally. Verify every row against the language definition's required fields
   and types.
4. Gate: upload `derived/` and `evidence/` to the new DEV prefix.
5. Gate: upload `manifest.json` last with `IfNoneMatch: *`, then read it back
   and verify its SHA-256 and `VersionId`.

## Expected sizes and cost

- Decision: one full UTC day from the existing DEV package
  (`dsa-filter-decision-prod-derived/2026-09-18T000000Z_2026-09-19T000000Z_v1/derived/`)
  is six JSONL tables totaling about 268 KiB.
- Quiq SMS lifecycle: a full-day export is bounded by the profile's
  `full-day-dev` tier (≤100,000 rows, ≤$50).
- Transform cost: `resolve-plan` returns `predictedCostUsd` before Glue runs.
  KiB-to-MiB inputs typically predict well under $1 per execution. Set
  `costCeilingUsd` to the lower of the profile scale tier and the user's
  ceiling. A three-step round trip plus cross-source run is three executions.
- S3 storage for these packages is negligible. The dominant cost is Glue.
