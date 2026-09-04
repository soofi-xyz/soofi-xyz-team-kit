---
name: county-seed-data
description: "Produce and stage the parcel seed CSV that drives county ingestion, at skills/use-oracle/runtime/data/seeds/<county>.csv. Use when onboarding a county, when the ingest feeder reports missing or malformed seed data, or when asked where parcel lists come from."
metadata: {"author":"elephant-xyz"}
---
# County Seed Data

The entire pipeline is driven by one CSV per county at
`skills/use-oracle/runtime/data/seeds/<county>.csv`, one row per parcel — the input of record
for the `CountyIngest` feeder. Seed availability and preferred source come from the
`onboard-county` intake; check for an existing file (`ls data/seeds/`) before producing
one. Only ask the operator if neither the intake nor the filesystem settles it.

## Required columns

Canonical header (matches `durable-workflow-builder`'s SeedRow contract):

- `parcel_id` — REQUIRED. The county parcel identifier, in the format the APPRAISER
  portal expects.
- `source_identifier` — optional; identifier used for the source request. Falls back to
  `parcel_id` when absent.
- `situs_address` — optional; single situs-address column, used for address-hash
  matching.

Extra columns flow through untouched to `Parcel.process`. `buildSeedIndex` validates the
header at run start — a missing `parcel_id` column fails the run immediately.

## Sourcing parcel lists

Start from the county's sources catalog
(`skills/use-oracle/runtime/docs/<county>-sources.yaml`, from `county-discovery`) to pick the
bulk-roll source.

Preference order for Florida counties:

1. **County appraiser bulk download** — most appraiser sites publish full parcel rolls
   (CSV/Excel/Access). Found during `county-discovery`.
2. **Florida DOR Name-Address-Legal (NAL) rolls** — statewide, one file per county,
   published yearly; reliable fallback with consistent columns.
3. **County GIS / open-data portal** — parcel layers exportable to CSV.

For non-FL states, use the county/state equivalent of 1 or 3. To locate the official
offices and their download pages, start from the NETR Online directory:
`https://publicrecords.netronline.com/state/<STATE>/county/<county>`.

## Workflow

1. Download the roll; inspect columns and row count. Record provenance (URL, date) in
   `skills/use-oracle/runtime/docs/<county>-county-findings.md`.
2. Map columns to the seed schema. Keep the parcel id EXACTLY as the appraiser portal
   expects it (punctuation matters; e.g. Lee STRAP vs numeric variants). Keep any
   alternate id formats as extra columns — the permit portal may use a different format.
3. Sanity checks before staging:
   - row count vs county's published parcel count (within a few %)
   - no duplicate `parcel_id`
   - spot-check 5 ids resolve on the appraiser portal
4. Place the file at `skills/use-oracle/runtime/data/seeds/<county>.csv` — once there, it IS the
   input of record. If a file already exists, confirm before overwriting — a run may be
   reading it.
5. Record row count — it is the denominator for all ETA math during the run.

## Parcel-id format — validate BEFORE any run

The seed `parcel_id` must match the appraiser portal's EXPECTED width/format exactly.
A wrong-width or wrong-format id typically makes the appraiser API return an empty `[]`
with NO error — so a format bug makes the WHOLE county come back silently empty while
looking like a clean, successful run.

- **Leading-zero trap (Orange County):** the roll stored ids as NUMBERS, so a 15-digit
  `012...` id lost its leading zero and became a 14-digit number → every lookup returned
  `[]`. Fix: load ids as TEXT and pad to / resolve the canonical width before staging.
- **Fail loud on an empty/zero-result lookup — never silently skip.** A silent empty is the
  dangerous failure: it masquerades as success. Before any full run, assert a NON-empty
  appraiser response for every sampled parcel; treat a zero-result lookup as a hard error,
  not a skip.

## Prioritization

The Lee run prioritized commercial properties. If the same is wanted, sort the seed CSV
(commercial usage codes first) before staging — the only way to make APPRAISAL scraping
commercial-first; permit harvest is already gated by `Parcel.process` eligibility.
