---
name: overture-places-ingest
description: "Ingest Overture Maps places for a county with taxonomy, boundary, source-licence, Neon coverage, and IPFS publication gates. Use when a county needs business/POI category data, when refreshing an Overture release, or when publishing a county places table."
metadata: {"author":"elephant-xyz"}
---
# Overture Places Ingest

Ingest Overture Maps places as county-scoped business/POI locations. Overture is the
pipeline's category source: Sunbiz describes legal entities, BBB is selected for
contractor reputation, and neither is a general location taxonomy.

> **Implementation status:** Lee County, Florida is verified end to end through
> extraction, Neon load, validation, and dedicated Filebase/IPNS publication. The
> implemented extract/export/validation code is in `oracle-node`; the places schema,
> bulk-loader track, coverage upsert, and Filebase uploader are in
> `elephant-query-db`. Parcel-link population, counties other than Lee, and an
> automated monthly refresh remain unimplemented.

## Non-negotiable gates

1. Resolve the Overture release from its STAC catalog and pin the resolved release in
   the run record. Never let a rerun silently move to a newer release.
2. Clip with a Census TIGER/Line county polygon: cheap bounding-box pruning first,
   then `ST_Within`. A bounding-box count is diagnostic only and is never publishable.
3. Key category logic on `taxonomy.hierarchy`. Never key new behavior on deprecated
   `categories.primary`; retain it only as `legacy_category_primary` while the source
   still supplies it.
4. Run the mandatory, case-insensitive source-dataset gate after extraction and again
   against the loaded source rows immediately before publication. `osm` and every
   unknown provider are hard stops.
5. Set `oracle_dataset_coverage.expected_count` to `NULL`. Overture supplies a
   numerator, not an authoritative denominator for all county businesses.
6. Publish places from a separate per-county Filebase bucket and IPNS name. Include
   the required root `NOTICE.txt` and machine-readable attribution in `index.json`.
7. Never commit extracted JSONL, Parquet, credentials, or generated publish artifacts.

## Taxonomy contract

Overture deprecated `categories`; it is removed beginning with the September 2026
release. Store and query:

- `taxonomy.primary`: the most specific current label.
- `taxonomy.hierarchy`: the source-provided ordered L0-to-primary path. This is the
  canonical roll-up field and must not be reconstructed from labels.
- `taxonomy.alternates`: preserve for inspection, but do not count alternates as
  primary-category membership.
- `basic_category`: coarse Overture label for filtering and map display.
- `categories.primary`: temporary compatibility field named
  `legacy_category_primary` only.

Stamp every row with `overture_release`. Overture taxonomy changes quarterly, so a
category is meaningful only with its release.

### Hosted-service classification

`config/hosted-service-categories.txt` contains exactly five human-reviewed, full
`taxonomy.hierarchy` paths observed in the Lee `2026-07-22.0` extract. Match the
complete path, set `is_hosted_service = true`, and stamp
`hosted_service_rule = 'hosted-service-categories@<release>'`.

The flag is advisory: preserve every place and let consumers decide whether to exclude
hosted services. Do not claim or generate a 250-entry rebuild. The earlier "~250"
number came from deprecated flat `categories.primary` values and was never validated
as a hierarchy-path list.

## 1. Resolve and pin the release

The public places theme is:

```text
s3://overturemaps-us-west-2/release/<release>/theme=places/type=place/*
```

Discover from STAC, review the selected release, then pass it explicitly:

```bash
curl -s https://stac.overturemaps.org/catalog.json |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["latest"])'

node scripts/extract-overture-places.mjs \
  --county lee \
  --county-fips 12071 \
  --release 2026-07-22.0 \
  --boundary-source tiger/tl_2024_us_county \
  --output-dir downloads/overture-places/lee/2026-07-22.0
```

The extractor can discover STAC when `--release` is omitted, but the resolved ID,
catalog URL, retrieval time, and TIGER vintage must still be written to
`manifest/summary.json`. Reproduction commands always use the pinned release.

## 2. Clip to the county boundary

Use the five-digit county FIPS from the county catalog. Lee is `12071`. Select that
`GEOID` from a pinned TIGER/Line county shapefile.

The required two-stage predicate is implemented in
`scripts/extract-county-places.sql`:

1. compare the source `bbox` to the county extent to prune Parquet reads;
2. require `ST_Within(place.geometry, county.geometry)` for county membership.

Assign border records by geometry. If `addresses[0]` names a different county, the
geometry county owns the record and the discrepancy remains in `source_payload`.

Run a counts-only probe before writing JSONL:

```bash
node scripts/extract-overture-places.mjs \
  --county lee \
  --county-fips 12071 \
  --release 2026-07-22.0 \
  --boundary-source tiger/tl_2024_us_county \
  --counts-only \
  --output-dir downloads/overture-places/lee/probe
```

Keep every clipped place. Overture already applies its own minimum confidence; another
extraction threshold would vary coverage by provider.

## 3. Enforce the source/licence gate

Canonical comparison is case-insensitive so live values such as `Microsoft`,
`AllThePlaces`, and `RenderSEO` match their approved canonical names. The approved set
is the original nine attribution-page providers plus two human-approved Overture
lineage values:

```text
meta
microsoft
foursquare
pinmeto
krick
renderseo
dac
brightquery
alltheplaces
overture
overture-signals
```

`Overture` and `Overture-signals` were approved by human decision on 2026-08-12 as
Overture's own lineage. This decision does not authorize other new providers.

Collect distinct `sources[].dataset` values from the complete clipped extract,
lowercase only for comparison, and preserve the source spelling in stored rows. Fail
closed:

- if `osm` appears in any casing, stop and do not load or publish;
- if any value is outside the approved set, stop for human licence review;
- never auto-extend the allowlist from observed data.

Repeat this gate against `business_location_sources` immediately before export/upload.
The published NOTICE is valid only for the providers it names.

## 4. Load and reconcile in Neon

Load the chunked `places/places-part-NNNN.jsonl` and
`manifest/summary.json` through the query DB's `--tracks places` bulk-loader track.
The implementation uses these grains:

- `business_locations`: one row per county/GERS place.
- `business_location_categories`: taxonomy primary/alternate rows.
- `business_location_sources`: provider lineage and licence evidence.
- `overture_place_extractions`: one row per county/release run.
- `business_location_parcel_links`: later confidence-scored bridge; do not populate
  during ingest.

Use GERS ID as the source identity and idempotent upserts. Retain the complete source
payload. Do not load places into `companies`, do not infer `company_id`, and do not
conflate a business location with a legal entity.

After load, assert:

- loaded `business_locations` count equals the clipped manifest count;
- no duplicate GERS IDs and no null geometry;
- loaded distinct source datasets pass the licence gate;
- the extraction run records release, county FIPS, TIGER vintage, bbox count, clipped
  count, category/source/status summaries, and duration;
- parcel links may remain zero because that later step is not part of ingest.

Upsert `oracle_dataset_coverage` with:

```text
source = overture_places
ingested_count = current business_locations count for the county/release
expected_count = NULL
```

Do not manufacture 100% completion by setting `expected_count = ingested_count`.

## 5. Export, validate, and publish

Export current Neon rows, not the raw extract:

```bash
node scripts/export-overture-places-table.mjs \
  --from-neon \
  --env-file ../elephant-query-db/.env.local \
  --county lee \
  --release 2026-07-22.0 \
  --out downloads/overture-places/lee/2026-07-22.0/publish

node scripts/validate-overture-places-table.mjs \
  --from-neon \
  --env-file ../elephant-query-db/.env.local \
  --county lee \
  --release 2026-07-22.0 \
  --parquet downloads/overture-places/lee/2026-07-22.0/publish/lee/places-table.parquet
```

The publish gate requires:

- Parquet rows equal current Neon rows for that county/release;
- zero duplicate GERS IDs;
- zero null geometries;
- `taxonomy.hierarchy` serialized as a `/`-delimited scalar;
- the live source/licence gate passes.

Publish each county's places artifact to its own resources:

```text
Filebase bucket: elephant-oracle-open-data-<county>-places
IPNS label:      oracle-open-data-<county>-places
```

Never share either resource with property, permit, or query-table artifacts. Fixed
object keys and IPNS repointing can otherwise clobber or unpin another artifact family.

The published directory must contain:

```text
NOTICE.txt
<county>/index.json
<county>/places-table.parquet
```

`NOTICE.txt` is part of the IPFS DAG and must include the Overture citation and access
date, per-provider licences, the Foursquare copyright notice, and Elephant's own change
statement/date. `index.json` must repeat attribution in a machine-readable block and
record release, row count, validation/PII decisions, and the artifact path.

### DuckDB Querying of Places over IPNS

When querying `places-table.parquet` hosted on Filebase IPNS via DuckDB or the MCP:
```sql
INSTALL httpfs;
LOAD httpfs;
SET unsafe_disable_etag_checks = true;
SELECT * FROM 'https://ipfs.filebase.io/ipns/<places-ipns-key>/<county>/places-table.parquet' LIMIT 10;
```

Register the stable places-table URL in the county catalog only after public-gateway
verification confirms `NOTICE.txt`, `index.json`, and Parquet all resolve from the
places-family IPNS name.

## Verified Lee result

Reference run: Lee County, Florida, FIPS `12071`, TIGER
`tl_2024_us_county`, Overture release `2026-07-22.0`.

- bbox diagnostic: **40,517** — not publishable as the county count;
- boundary-clipped: **40,191**;
- old scoping baseline: **40,190**; the verified clip is +1, and neither number is an
  `expected_count`;
- Neon `business_locations`: **40,191**, with `expected_count = NULL`;
- source gate: PASS, `osm` absent, unknown providers empty;
- hosted-service flag: 956 records from the five approved full paths;
- Lee PII decision: approved 2026-08-12 to publish public business `emails` and
  `phones` as-is;
- dedicated Lee places Filebase/IPNS publication: verified.

The loaded source spellings were `AllThePlaces`, `BrightQuery`, `DAC`, `Foursquare`,
`meta`, `Microsoft`, `Overture`, `Overture-signals`, `PinMeTo`, and `RenderSEO`.
`krick` is approved but was absent in Lee.

## Refresh semantics

The first county run is a full extract. Later releases are upserts/diffs:

- use GERS ID as the merge key and provider `dataset + record_id` as re-identification
  evidence;
- maintain `first_seen_release`, `last_seen_release`, and `is_current`;
- process Overture changelog `added`, `removed`, and `data_changed` records for the
  county;
- never delete historical rows;
- absence from a release is not business closure;
- use `operating_status` for Overture's explicit closure state.

Re-run extraction, source gate, Neon reconciliation, export validation, attribution,
and IPNS repointing for every release. Automated monthly discovery/execution is not
implemented; refreshes are operator-run until that workflow lands.

## Open questions and intentionally unimplemented work

- Populate `business_location_parcel_links` with a confidence-scored spatial match.
- Onboard and boundary-validate a county other than Lee.
- Automate monthly STAC discovery, approval/pinning, diff ingest, and publication.
- Decide whether later counties inherit Lee's 2026-08-12 PII publication decision.
- Add a lexicon class for business locations; do not force places into `company` or
  property-relative `nearby_location`.
- Decide whether downstream products need an Elephant mapping for `basic_category`;
  the verified Lee implementation passes Overture labels through.

Persist run notes and source decisions, but never extracted place data or secrets.
