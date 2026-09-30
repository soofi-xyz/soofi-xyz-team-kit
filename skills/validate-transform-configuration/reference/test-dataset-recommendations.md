# Test dataset recommendations

Recommend datasets before asking `test-dataset`. Combine them: runtime proof
needs production-shaped coverage, and negative proof needs deliberate edge
cases.

## Dataset tiers

| Id | Content | Proves | Does not prove |
| --- | --- | --- | --- |
| profile evidence | `validationSources` entries of the matched profile (`existing-dev-artifact`, `sanitized-evidence-package`) | whatever the manifest covers; reusable across runs | anything when `artifactStatus` is `planned` (location reserved, `tbd` lists what is missing) or `staging`, or when the manifest digest does not verify |
| `prod-derived-full-utc-day` | one complete half-open UTC day `[D, D+1)` (or the confirmed longer range) of every source family the forward mapping reads, derived from PROD and sanitized | real cardinality, join closure, enum coverage, and scale at the bounded tier; **required for the final validation and for `READY`** | rare rejected or negative paths that did not occur that day |
| `sanitized-edge-cases` | small hand-selected package: rejected outcomes, nulls in optional fields, all-rows-omit-optional-key, conflicting or stale events, UTC boundary timestamps, duplicate idempotency keys, missing endpoints | negative and inverse behavior with an expected-outcome oracle | volume and realistic distribution |
| `synthetic-fixture` | rows generated locally from the language definition's properties and enums | shape, typing, and local Spark execution | anything about production data; never sufficient for `READY` |

Default recommendation: profile evidence when `ready`; otherwise the full UTC
day plus the edge-case package. Whatever is chosen for earlier phases, the
final validation always runs on the confirmed PROD-derived window; profile
evidence qualifies only when it is that window's manifested staging. A `planned` entry is shown with its `tbd`
fields and is never the default. Use the synthetic fixture for `synthetic-local`
mode and as a first local smoke test.

## Choosing the UTC day

Do this proactively for every run aiming for `READY`, without waiting to be
asked. With read-only PROD metadata, compare the most recent complete UTC days (at
least 7 candidates) and pass the sanitized aggregates to
`scripts/source_window.py recommend`. For each day, record row counts per required source family,
coverage of every enum value the definition declares (the resolver's `coverageTargets`), presence of the profile's `requiredCoverageSignals`, bytes,
and whether immutable object versions exist. Recommend the most recent day that
covers everything. If none does, recommend a contiguous range or return
`BLOCKED`; never pad the data or pick random rows. Ask the `source-window`
question and record the user's answer with `source_window.py confirm`.

## Storage layout

Stage in the DEV Transform data bucket in the target region (the layout's default region unless
the operator says otherwise). The bucket must have S3
versioning enabled; verify with `get-bucket-versioning` before recommending it.

```text
s3://<dev-transform-data-bucket>/inputs/<language>-<purpose>/<window>_<version>/
  manifest.json                   # written last, with IfNoneMatch: *
  derived/<dataset>/<dataset>.jsonl|parquet|csv
  evidence/source-manifest.json   # sanitized PROD source identities: counts, digests, version ids
  expected/<dataset>.jsonl        # edge-case oracle rows (edge-case packages only)
```

- `<language>` is the registered source language. For a projection out of the hub it is
  `<hub>-<target>`, unless a qualifier names a registered language. `<purpose>` is
  `prod-derived`, `edge-cases`, or `synthetic`. A profile may reserve its own prefix
  (`inputs/<profile-stem>/<window>_v1/`).
- Each input dataset lives in its own `<table>/` directory under one prefix, so that
  `transform_runs.py spec-from-intent --bind <name>=<prefix>` can list which outputs the package
  can run.
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

## Tools

- PROD rows for oracles: `scripts/iceberg_snapshot_read.py` (read-only; pins the snapshot; rows
  only in a mode-0700 `--private-dir` outside any checkout; prints aggregates). Delete the
  directory once the oracle aggregates are recorded. Other stores (DynamoDB, Persist Gremlin)
  are read with the operator's PROD profile and the same rule: aggregates in evidence, rows
  never committed or uploaded.
- Package build and upload: `scripts/stage_evidence_package.py manifest`, then `upload` with the
  printed operation digest after approval. Record the returned manifest SHA-256 and VersionId
  in the profile's `validationSources`.
- Graph exports from a forward run: `scripts/graph_export_bridge.py`.

A package itself is not portable evidence of how it was made. Record the generating commands
and pinned revisions in the package's `evidence/source-manifest.json` so a teammate can rebuild
it from committed tools plus fresh read-only reads.

## Expected sizes and cost

- A profile's `scaleTiers` bound rows and cost per tier; a calibration dossier records the
  expected row counts of its packages.
- Transform cost: `resolve-plan` returns `predictedCostUsd` before Glue runs.
  KiB-to-MiB inputs typically predict well under $1 per execution. Set
  `costCeilingUsd` to the lower of the profile scale tier and the user's
  ceiling. Rejected missing-input cases stop before Glue and cost nothing beyond the plan step.
- S3 storage for these packages is negligible. The dominant cost is Glue.
