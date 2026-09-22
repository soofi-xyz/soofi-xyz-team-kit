---
name: overture-places-ingest
description: "Ingest Overture Maps places for a county with pinned release, TIGER boundary, taxonomy, licence, internal reconciliation, and lexicon output ready for Atlas publication."
metadata: {"author":"elephant-xyz"}
---

# Overture Places Ingest

Use Overture as business/POI taxonomy enrichment. Sunbiz is legal identity and BBB is
contractor reputation; do not conflate them.

## Gates

1. Resolve and pin one Overture STAC release.
2. Clip with a pinned Census TIGER/Line county polygon: bbox prune, then `ST_Within`.
3. Key category behavior on `taxonomy.hierarchy`; preserve primary and alternates.
4. Run the case-insensitive source/licence gate after extraction and after internal load.
5. Keep `expected_count = NULL`; Overture has no authoritative all-business denominator.
6. Preserve release, county FIPS, boundary vintage, source lineage, and attribution.
7. Produce lexicon records for the normal `places` CAR/table/Atlas sequence.
8. Never create a separate places pointer or specialized public query path.

## Taxonomy

Store:

- `taxonomy.primary`
- ordered `taxonomy.hierarchy`
- `taxonomy.alternates` for inspection, not primary counts
- `basic_category`
- legacy category only in a clearly named compatibility field
- `overture_release`

Match hosted-service policy against complete, human-reviewed hierarchy paths. Preserve all
rows and stamp the rule version; let consumers choose whether to exclude hosted services.

## Resolve and extract

Record release ID, STAC URL, retrieval time, TIGER vintage, county FIPS, bbox diagnostic,
and clipped count. Reproduction commands must pass the pinned release explicitly.

Use `skills/overture-places-ingest/scripts/extract-county-places.sql`:

1. prune source Parquet by bbox;
2. require geometry within the county polygon.

Geometry assigns county ownership. Preserve a conflicting source address county in
`source_payload`.

## Source/licence gate

Compare source dataset names case-insensitively while preserving original spelling. Use the
reviewed provider allowlist. Treat `osm` and every unknown provider as hard stops requiring
human licence review. Never extend the allowlist from observed data.

Repeat the gate against loaded source rows. Include required Overture/Foursquare/provider
attribution in run evidence and lexicon source metadata.

## Internal load and reconciliation

Load through the Query DB places track as an internal check:

- `business_locations`: county/GERS place;
- `business_location_categories`: taxonomy rows;
- `business_location_sources`: provider lineage;
- `overture_place_extractions`: county/release run;
- `business_location_parcel_links`: only when a separate confidence-scored linkage stage
  exists.

Use GERS ID as source identity and idempotent upserts. Keep historical release state,
`first_seen_release`, `last_seen_release`, and `is_current`. Do not load places into
companies or infer `company_id`.

Assert:

- loaded locations equal the clipped manifest;
- no duplicate GERS IDs or null geometry;
- all loaded provider names pass the licence gate;
- run metadata and digests match;
- parcel links may be zero;
- expected count stays null.

The Query DB is not the public source. Its working Parquet/coverage outputs are internal.

## Lexicon and Atlas handoff

Transform current, reconciled rows into lexicon-compliant places records with exact source
provenance. Validate every record against the live lexicon. Include attribution metadata in
the places data group.

Hand the validated places group directory to `use-oracle`, then run:

1. validate places group;
2. hash one county places CAR;
3. validate the CAR;
4. export normalized tables and update the Atlas county page;
5. upload archive and tables with readback;
6. merge the Atlas county-page PR;
7. verify global Atlas IPNS and MCP 2.0 sync.

Do not publish a standalone places Parquet, county catalog entry, or per-county IPNS name.

## Refresh

For later releases:

- process Overture additions, removals, and changed rows by GERS ID;
- retain historical rows;
- do not infer closure from absence;
- use explicit `operating_status`;
- rerun source gate, internal reconciliation, lexicon validation, and Atlas publication.

## Report

Return release, county/FIPS, TIGER vintage, bbox and clipped counts, source/licence gate,
hosted-service rule version, internal reconciliation, current/history counts, attribution,
places group validation, CAR/tables roots, Atlas PR, global index CID, and MCP sync result.
