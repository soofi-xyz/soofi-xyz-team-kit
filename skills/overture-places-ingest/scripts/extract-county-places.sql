-- Boundary-clipped Overture places extraction for one county.
--
-- Keep in sync with oracle-node/scripts/overture-places-lib.mjs
-- `buildExtractCopySql`.
-- Field names and the release path were verified against Overture's published
-- schema on 2026-08-12. Key on taxonomy.hierarchy, not categories.primary.
--
-- Usage: the Node extract script substitutes quoted literals for $RELEASE,
-- $COUNTY_FIPS, $BOUNDARY_PATH, $PLACES_GLOB and $OUT.
--
-- Two-stage filtering is deliberate: the bbox predicate prunes Parquet row
-- groups cheaply; ST_Within is the actual county test. Never report the bbox
-- count as the county count.

LOAD spatial;
LOAD httpfs;
SET s3_region = 'us-west-2';

CREATE OR REPLACE TEMP TABLE county_boundary AS
SELECT geom AS geometry
FROM ST_Read($BOUNDARY_PATH)
WHERE GEOID = $COUNTY_FIPS;

CREATE OR REPLACE TEMP TABLE county_bbox AS
SELECT
  ST_XMin(ST_Extent(geometry)) AS xmin,
  ST_XMax(ST_Extent(geometry)) AS xmax,
  ST_YMin(ST_Extent(geometry)) AS ymin,
  ST_YMax(ST_Extent(geometry)) AS ymax
FROM county_boundary;

COPY (
  SELECT
    p.id                                AS gers_id,
    p.version                           AS overture_version,
    p.names.primary                     AS name_primary,
    p.taxonomy.primary                  AS taxonomy_primary,
    p.taxonomy.hierarchy                AS taxonomy_hierarchy,
    p.taxonomy.alternates               AS taxonomy_alternate,
    p.basic_category                    AS basic_category,
    -- Deprecated: removed in the September 2026 release. Retained only so the
    -- scoping numbers stay reconcilable. Drop once the source no longer has it.
    p.categories.primary                AS legacy_category_primary,
    p.operating_status                  AS operating_status,
    p.confidence                        AS confidence,
    p.websites                          AS websites,
    p.socials                           AS socials,
    p.emails                            AS emails,
    p.phones                            AS phones,
    p.brand.names.primary               AS brand_name,
    p.brand.wikidata                    AS brand_wikidata,
    p.addresses[1].freeform             AS address_freeform,
    p.addresses[1].locality             AS address_locality,
    p.addresses[1].postcode             AS address_postcode,
    p.addresses[1].region               AS address_region,
    p.addresses[1].country              AS address_country,
    p.addresses[1]                      AS address0,
    p.sources                           AS sources,
    ST_X(p.geometry)                    AS longitude,
    ST_Y(p.geometry)                    AS latitude,
    ST_AsGeoJSON(p.geometry)            AS geometry_geojson,
    ST_AsWKB(p.geometry)                AS geometry_wkb,
    $RELEASE                            AS overture_release,
    $COUNTY_FIPS                        AS county_fips
  FROM read_parquet(
    $PLACES_GLOB,
    hive_partitioning = 1
  ) AS p,
  county_bbox AS b,
  county_boundary AS c
  WHERE p.bbox.xmin >= b.xmin
    AND p.bbox.xmax <= b.xmax
    AND p.bbox.ymin >= b.ymin
    AND p.bbox.ymax <= b.ymax
    AND ST_Within(p.geometry, c.geometry)
) TO $OUT (FORMAT PARQUET);

-- Run-record counters (honest numbers; none is an expected_count):
--   SELECT count(*) FROM read_parquet($OUT);                         -- clip count
--   SELECT count(DISTINCT taxonomy_primary) FROM read_parquet($OUT);
--   SELECT operating_status, count(*) FROM read_parquet($OUT) GROUP BY 1;
--   SELECT DISTINCT unnest(sources).dataset FROM read_parquet($OUT); -- source gate
