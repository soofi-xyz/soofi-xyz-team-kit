# Candidate archive assembly

Build one publishable archive per county/data group from data that other people already
mined: candidate assignment submissions, contributor batches, or earlier Oracle runs.
This is the procedure behind the Travis County, TX publication (Atlas #87 and #86). The
orchestration (inventory, repair ledger, coverage targets, acceptance) lives in
[`repair-candidate-submissions`](../../repair-candidate-submissions/SKILL.md); this file is
the archive-level mechanics it calls.

Publication itself is unchanged: finish with the sequence in
[`car-publication.md`](./car-publication.md). Nothing here adds a second public path.

## Inputs

Each input is one of:

| Kind | Example | Usable as |
|---|---|---|
| Validated lexicon CAR | `travis-county-batch-03.car` | Unpack and re-hash. |
| Hashed or unhashed lexicon ZIPs / output directories | one `.zip` per property with Seed + group roots | Re-hash directly. |
| Custom tables with per-record source request | DuckDB, Parquet, CSV, JSON with `source_url`/request per row | Transform to lexicon first (`build-county-transform`), then re-hash. |
| Custom tables without per-record source request | aggregates, scraped rows with no URL | Not publishable. Use only as a coverage map for a targeted re-mine. |

Fetch every input by CID through the dedicated gateway or `ipfs.filebase.io` and check bytes
against the submission's manifest digest before using it. A vendor URL or a candidate's
private node is a locator, not the input. Read the code that produced each table: rows from
a mock generator or tagged synthetic are `unusable`.

## Rule 1: one Seed per county

The Seed data-group root is the property's identity; `hash` derives the property CID from
it. Two contributors who wrote Seed differently produce disjoint property CIDs for the same
parcel (Travis: 0 shared CIDs between the county and permit contributors). Fix that once:

1. Pick the **Seed basis**: the `county` input with the most validated parcels against the
   official assessed roll. That input's Seed is the county's Seed.
2. Key every other input to the official parcel identifier written in its own records (for
   Travis, the TCAD property id). Never key on address or owner name.
3. Rewrite each non-basis property directory with the basis Seed for its parcel. Leave every
   non-Seed data file byte-identical, so its data CIDs do not change.
4. Report matched / unmatched / ambiguous counts per input. Unmatched rows are not
   published; they go to the ledger as a parcel-backbone gap.

Travis evidence: 237,540 of 237,540 permit properties matched a `county` parcel on TCAD
property id; 475,080 of 475,080 `property_improvement` data CIDs were unchanged.

## Rule 2: combine batches into one archive per group

Contributors often ship several batch archives for one group. Combine them before
registering; Atlas takes exactly one archive per county/data group.

`elephant-cli` has no command that unpacks a CAR back into property directories. Build the
combined input directory from what the contributors shipped, in this order of preference:

1. Their hashed ZIPs or property output directories (one child per property, Seed + group
   root). Copy them into one `./$county-$group-outputs` directory; duplicate child names
   abort `hash`, so rename by official parcel id first.
2. For a CAR-only input, walk its `CountyIndex` shards and run
   `elephant-cli fetch-data <data-group root CID> --output-zip <parcel-id>.zip` per property
   entry through the dedicated gateway. Slow; use it only for the properties no ZIP covers.

Do not hand-decode or hand-edit blocks.

Then prove nothing was lost or invented: the union of every batch's
`propertyCid,dataGroupCid,dataCid` rows must equal the combined archive's rows (Travis:
883,922 rows, 0 missing, 0 extra).

## Rule 3: union across submissions, one winner per record

When several inputs cover the same group, take the union. Resolve overlaps per record,
never by merging fields from two records into one:

| Overlap | Key | Winner |
|---|---|---|
| Same parcel, `county` group | official parcel id | The Seed-basis record. Another input wins only if the basis record fails validation and the other passes. |
| Same permit | jurisdiction + permit number | The record with a source request URL; then the later source fetch; then more populated lexicon fields. |
| Same contractor/company | official license or registry id | The record stamped from the official registry detail URL. |
| Different jurisdictions or classes | n/a | Keep both; they are complementary coverage. |

Record each overlap decision (key, winner input, loser input, reason) in the repair ledger.
A field from the losing record is never copied into the winner; publish a corrected record
from source instead.

## Rule 4: never repair provenance by hand

A record publishes only with the source request it came from. Do not backfill
`source_http_request`, invent a URL from a parcel id pattern, or stamp a portal home page.
Records without provenance are excluded and listed as a re-mine slice (see
[`use-oracle`](../SKILL.md), "Re-mine pre-lexicon records from source").

## Rule 5: keep each archive inside the validate window

The Atlas `validate` job has a 6-hour limit. Publish large groups in separate PRs, county
group first, and use the single-file `car` field for multi-GB archives so validate and
publish download one file instead of walking the DAG through the gateway (Atlas #90).

## Then publish

For each assembled group run, unchanged, steps 1–5 and the PR flow in
[`car-publication.md`](./car-publication.md): `validate` directory, `hash` to CAR,
`validate` CAR, `export-tables --atlas-page`, upload with readback, Atlas PR. In the PR body
list every contributing submission (repo, PR, author) and the Rule 1–3 counts.
