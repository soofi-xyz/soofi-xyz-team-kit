import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { parcels } from "./appraisal.js";
import { addresses, companies } from "./core.js";
import {
  createdAtColumn,
  jsonObjectColumn,
  sourceMetadataColumns,
  updatedAtColumn,
} from "./shared.js";

const wgs84Point = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return "geometry(Point,4326)";
  },
});

/**
 * One Overture place (GERS id) per county. This is a physical business location,
 * not a `company` party and not a property-relative `nearby_location`.
 *
 * `company_id` exists for a later name+address match and is never written at ingest.
 * `geometry` is filled post-merge from `longitude`/`latitude` (EPSG:4326). Parcel
 * boundaries are EPSG:2237 — any point-in-polygon against them needs ST_Transform.
 */
export const businessLocations = pgTable(
  "business_locations",
  {
    businessLocationId: uuid("business_location_id").primaryKey().defaultRandom(),
    countyKey: text("county_key").notNull(),
    countyFips: text("county_fips").notNull(),
    gersId: text("gers_id").notNull(),
    overtureVersion: integer("overture_version"),
    namePrimary: text("name_primary"),
    normalizedName: text("normalized_name"),
    taxonomyPrimary: text("taxonomy_primary"),
    taxonomyHierarchy: text("taxonomy_hierarchy").array().notNull().default(sql`ARRAY[]::text[]`),
    basicCategory: text("basic_category"),
    legacyCategoryPrimary: text("legacy_category_primary"),
    operatingStatus: text("operating_status"),
    confidence: numeric("confidence", { precision: 8, scale: 6 }),
    websites: text("websites").array(),
    socials: text("socials").array(),
    emails: text("emails").array(),
    phones: text("phones").array(),
    brandName: text("brand_name"),
    brandWikidata: text("brand_wikidata"),
    addressFreeform: text("address_freeform"),
    addressLocality: text("address_locality"),
    addressPostcode: text("address_postcode"),
    addressRegion: text("address_region"),
    addressCountry: text("address_country"),
    longitude: numeric("longitude", { precision: 12, scale: 8 }),
    latitude: numeric("latitude", { precision: 12, scale: 8 }),
    geometry: wgs84Point("geometry"),
    isHostedService: boolean("is_hosted_service"),
    hostedServiceRule: text("hosted_service_rule"),
    firstSeenRelease: text("first_seen_release").notNull(),
    lastSeenRelease: text("last_seen_release").notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    companyId: uuid("company_id").references(() => companies.companyId, {
      onDelete: "set null",
    }),
    addressId: uuid("address_id").references(() => addresses.addressId, {
      onDelete: "set null",
    }),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("business_locations_source_record_idx").on(
      table.sourceSystem,
      table.sourceRecordKey,
    ),
    uniqueIndex("business_locations_county_gers_idx").on(table.countyKey, table.gersId),
    index("business_locations_geometry_gix").using("gist", table.geometry),
    index("business_locations_taxonomy_hierarchy_gin").using("gin", table.taxonomyHierarchy),
    index("business_locations_county_taxonomy_idx").on(
      table.countyKey,
      table.taxonomyPrimary,
    ),
    index("business_locations_basic_category_idx").on(table.basicCategory),
    index("business_locations_normalized_name_idx").on(table.normalizedName),
    index("business_locations_address_idx").on(table.addressId),
    index("business_locations_county_current_idx").on(table.countyKey, table.isCurrent),
  ],
);

/**
 * One row per Overture category label on a place. `is_primary` marks
 * `taxonomy.primary`; other rows hold `taxonomy.alternate` (not reliable for counts).
 */
export const businessLocationCategories = pgTable(
  "business_location_categories",
  {
    businessLocationCategoryId: uuid("business_location_category_id")
      .primaryKey()
      .defaultRandom(),
    businessLocationId: uuid("business_location_id")
      .notNull()
      .references(() => businessLocations.businessLocationId, { onDelete: "cascade" }),
    categoryLabel: text("category_label").notNull(),
    taxonomyPath: text("taxonomy_path"),
    isPrimary: boolean("is_primary").notNull().default(false),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("business_location_categories_source_record_idx").on(
      table.sourceSystem,
      table.sourceRecordKey,
    ),
    index("business_location_categories_location_idx").on(table.businessLocationId),
    index("business_location_categories_label_idx").on(table.categoryLabel),
  ],
);

/**
 * One row per Overture `sources[]` entry. This is the licence-gate evidence and
 * the GERS bridge-file fallback (`dataset` + `record_id`).
 */
export const businessLocationSources = pgTable(
  "business_location_sources",
  {
    businessLocationSourceId: uuid("business_location_source_id")
      .primaryKey()
      .defaultRandom(),
    businessLocationId: uuid("business_location_id")
      .notNull()
      .references(() => businessLocations.businessLocationId, { onDelete: "cascade" }),
    dataset: text("dataset").notNull(),
    recordId: text("record_id"),
    updateTime: text("update_time"),
    confidence: numeric("confidence", { precision: 8, scale: 6 }),
    license: text("license"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("business_location_sources_source_record_idx").on(
      table.sourceSystem,
      table.sourceRecordKey,
    ),
    index("business_location_sources_location_idx").on(table.businessLocationId),
    index("business_location_sources_dataset_idx").on(table.dataset),
  ],
);

/**
 * One row per (county, Overture release) extract. Honest denominators live here;
 * `oracle_dataset_coverage.expected_count` stays NULL.
 */
export const overturePlaceExtractions = pgTable(
  "overture_place_extractions",
  {
    overturePlaceExtractionId: uuid("overture_place_extraction_id")
      .primaryKey()
      .defaultRandom(),
    countyKey: text("county_key").notNull(),
    countyFips: text("county_fips").notNull(),
    overtureRelease: text("overture_release").notNull(),
    previousRelease: text("previous_release"),
    runStatus: text("run_status").notNull().default("loaded"),
    tigerBoundarySource: text("tiger_boundary_source").notNull(),
    tigerVintage: text("tiger_vintage").notNull(),
    bboxCount: integer("bbox_count").notNull(),
    clipCount: integer("clip_count").notNull(),
    activeChangeCount: integer("active_change_count").notNull().default(0),
    deactivationCount: integer("deactivation_count").notNull().default(0),
    addedCount: integer("added_count").notNull().default(0),
    dataChangedCount: integer("data_changed_count").notNull().default(0),
    removedCount: integer("removed_count").notNull().default(0),
    movedInCount: integer("moved_in_count").notNull().default(0),
    movedOutCount: integer("moved_out_count").notNull().default(0),
    distinctTaxonomyPrimary: integer("distinct_taxonomy_primary"),
    distinctSourceDatasets: text("distinct_source_datasets").array(),
    operatingStatusCounts: jsonObjectColumn("operating_status_counts"),
    confidenceDistribution: jsonObjectColumn("confidence_distribution"),
    taxonomyDrift: jsonObjectColumn("taxonomy_drift"),
    durationMs: integer("duration_ms"),
    licenceGatePassed: boolean("licence_gate_passed").notNull(),
    extractionLocation: text("extraction_location"),
    publishedCid: text("published_cid"),
    publishedIpnsName: text("published_ipns_name"),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("overture_place_extractions_source_record_idx").on(
      table.sourceSystem,
      table.sourceRecordKey,
    ),
    uniqueIndex("overture_place_extractions_county_release_idx").on(
      table.countyKey,
      table.overtureRelease,
    ),
  ],
);

/**
 * Schema stub only. Point-in-polygon parcel linking is a later step, not ingest.
 * A no-op for every county except Lee until parcel boundaries exist.
 */
export const businessLocationParcelLinks = pgTable(
  "business_location_parcel_links",
  {
    businessLocationParcelLinkId: uuid("business_location_parcel_link_id")
      .primaryKey()
      .defaultRandom(),
    businessLocationId: uuid("business_location_id")
      .notNull()
      .references(() => businessLocations.businessLocationId, { onDelete: "cascade" }),
    parcelId: uuid("parcel_id").references(() => parcels.parcelId, {
      onDelete: "set null",
    }),
    folioId: text("folio_id"),
    matchConfidence: text("match_confidence"),
    matchMethod: text("match_method"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("business_location_parcel_links_source_record_idx").on(
      table.sourceSystem,
      table.sourceRecordKey,
    ),
    index("business_location_parcel_links_location_idx").on(table.businessLocationId),
    index("business_location_parcel_links_parcel_idx").on(table.parcelId),
  ],
);
