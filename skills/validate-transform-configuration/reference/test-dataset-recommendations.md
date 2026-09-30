# Test dataset recommendations

Silvally uses real data only. Every package is derived read-only from PROD for
a confirmed UTC window, staged to DEV under approval, and executed by DEV
Transform. There are no synthetic, fixture or hand-written edge-case packages,
and Silvally never falls back to them — not even when a window is empty.

## Packages

| Id | Content | Proves | Does not prove |
| --- | --- | --- | --- |
| profile evidence | `validationSources` entries of the matched profile (`existing-dev-artifact`, `sanitized-evidence-package`) | whatever the manifest covers, when it is the confirmed window's manifested staging | anything when `artifactStatus` is `planned` (location reserved, `tbd` lists what is missing) or `staging`, or when the manifest digest does not verify |
| `prod-derived-canary` | 10 real events per slice from the confirmed window, chosen by `prod_actuals.py canary-sample` (grouped by outcome, ordered by event time and key SHA-256, taken round-robin so accepted and rejected outcomes both appear when the window has both) | the mapping's behavior on real accepted and rejected events against what PROD did, cheaply, before the full run | volume, cardinality and rare paths outside the sample |
| `prod-derived-full-utc-day` | one complete half-open UTC day `[D, D+1)` (or the confirmed longer range) of every source family the forward mapping reads | real cardinality, join closure, enum coverage, and scale at the bounded tier; **required for the final validation and for `READY`**, and run only after the canary passed and the user approved | rejected or negative paths that did not occur in the window |

Always recommend the canary first and the full window second. Profile evidence
qualifies only when it is that window's manifested staging. A `planned` entry
is shown with its `tbd` fields and is never the default. When the chosen day
has no real data for a slice, say so and suggest the nearest UTC day with data
(`source_window.py data-days`); never substitute another kind of package.

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
```

- `<language>` is the registered source language. For a projection out of the hub it is
  `<hub>-<target>`, unless a qualifier names a registered language. `<purpose>` is
  `prod-derived`; the canary package uses `<window>_canary_<version>`. A profile may reserve its own prefix
  (`inputs/<profile-stem>/<window>_v1/`).
- Each input dataset lives in its own `<table>/` directory under one prefix, so that
  `transform_runs.py spec-from-intent --bind <name>=<prefix>` can list which outputs the package
  can run.
- `<window>` is `YYYY-MM-DDT000000Z_YYYY-MM-DDT000000Z` (half-open).
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
2. Keep the rows in a mode-0700 private directory outside any repository.
   For the canary, `prod_actuals.py canary-sample` selects the events and
   `prod_actuals.py inputs` writes their real inputs (with `--bind` for a field
   the PROD run resolved). For graph-input slices, `graph_inputs.py gremlin` builds
   the Transform graph datasets for those events' keys from a bounded read-only
   PROD Persist read, with zero dangling endpoints (`--as-of` for a stale actual).
   Slices with sensitive fields (SMS phone numbers and message bodies) are staged
   only under the owner's `sensitiveFieldStaging` decision, with real values
   unmodified.
3. Build `derived/`, `evidence/source-manifest.json`, and `manifest.json` in
   that directory (`stage_evidence_package.py manifest`). Verify every row
   against the language definition's required fields and types. Nothing is
   executed on these rows outside DEV Transform.
4. Gate: upload `derived/` and `evidence/` to the new DEV prefix.
5. Gate: upload `manifest.json` last with `IfNoneMatch: *`, then read it back
   and verify its SHA-256 and `VersionId`.

## Tools

- What PROD actually did: `scripts/prod_actuals.py` (Lambda outcomes from a PROD state machine's
  execution logs) and `scripts/iceberg_snapshot_read.py` (a PROD Iceberg table for the selected
  day(s) only: the window, and the catalog `rowFilter` as `--where`, are pushed down to the scan, a
  canary key read of an event actual takes the same window, a current-state-by-key actual selects its
  keys from the window and reads their state with `--current-state-as-of <data cutoff>`, and any other
  whole-table read needs an explicit `--allow-full-scan`;
  pins the snapshot). Both are read-only, keep rows only in a mode-0700 `--private-dir`
  outside any checkout and print aggregates. Use the run's `private/` from `run_workspace.py new`
  and remove it with `run_workspace.py cleanup --run-dir <run>` once the comparison is recorded;
  cleanup touches only that run. Other stores (DynamoDB, Persist Gremlin)
  are read with the operator's PROD profile and the same rule: aggregates in evidence, rows
  never committed or uploaded.
- Package build and upload: `scripts/stage_evidence_package.py manifest`, then `upload` with the
  printed operation digest after approval. Record the returned manifest SHA-256 and VersionId
  in the profile's `validationSources`.

A package itself is not portable evidence of how it was made. Record the generating commands
and pinned revisions in the package's `evidence/source-manifest.json` so a teammate can rebuild
it from committed tools plus fresh read-only reads.

## Expected sizes and cost

- A profile's `scaleTiers` bound rows and cost per tier; a calibration dossier records the
  expected row counts of its packages.
- Transform cost: `resolve-plan` returns `predictedCostUsd` before Glue runs.
  KiB-to-MiB inputs typically predict well under $1 per execution. Set
  `costCeilingUsd` to the lower of the profile scale tier and the user's (or
  the owner's per-job) ceiling. The canary costs one small execution per slice. Rejected missing-input cases stop before Glue and cost nothing beyond the plan step.
- S3 storage for these packages is negligible. The dominant cost is Glue.
