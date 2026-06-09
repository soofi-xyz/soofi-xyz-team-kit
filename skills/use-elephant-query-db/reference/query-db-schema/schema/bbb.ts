import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { addresses, companies, people } from "./core.js";
import {
  createdAtColumn,
  jsonObjectColumn,
  nullableJsonObjectColumn,
  sourceMetadataColumns,
  updatedAtColumn,
} from "./shared.js";

export const businessReputationProfiles = pgTable(
  "business_reputation_profiles",
  {
    businessReputationProfileId: uuid("business_reputation_profile_id")
      .primaryKey()
      .defaultRandom(),
    companyId: uuid("company_id").references(() => companies.companyId, {
      onDelete: "set null",
    }),
    addressId: uuid("address_id").references(() => addresses.addressId, {
      onDelete: "set null",
    }),
    requestIdentifier: text("request_identifier"),
    provider: text("provider"),
    providerProfileId: text("provider_profile_id"),
    providerBusinessId: text("provider_business_id"),
    providerBbbId: text("provider_bbb_id"),
    profileUrl: text("profile_url"),
    profileType: text("profile_type"),
    profileSlug: text("profile_slug"),
    localBbbName: text("local_bbb_name"),
    localBbbUrl: text("local_bbb_url"),
    name: text("name"),
    legalName: text("legal_name"),
    normalizedName: text("normalized_name"),
    description: text("description"),
    phone: text("phone"),
    email: text("email"),
    emailUrl: text("email_url"),
    websiteUrl: text("website_url"),
    isAccredited: boolean("is_accredited"),
    accreditationStatus: text("accreditation_status"),
    accreditedSince: date("accredited_since"),
    accreditationRevokedDate: date("accreditation_revoked_date"),
    bbbRating: text("bbb_rating"),
    ratingScore: numeric("rating_score", { precision: 6, scale: 2 }),
    ratingReasonNotRated: text("rating_reason_not_rated"),
    reviewAverageRating: numeric("review_average_rating", { precision: 5, scale: 2 }),
    reviewCount: integer("review_count"),
    complaintCount: integer("complaint_count"),
    closedComplaintsPastThreeYears: integer("closed_complaints_past_three_years"),
    closedComplaintsPastTwelveMonths: integer("closed_complaints_past_twelve_months"),
    unansweredComplaints: integer("unanswered_complaints"),
    bbbFileOpenedDate: date("bbb_file_opened_date"),
    businessStartedDate: date("business_started_date"),
    businessLocalStartedDate: date("business_local_started_date"),
    businessIncorporatedDate: date("business_incorporated_date"),
    newOwnerDate: date("new_owner_date"),
    yearsInBusiness: integer("years_in_business"),
    numberOfEmployees: integer("number_of_employees"),
    entityType: text("entity_type"),
    hqStatus: text("hq_status"),
    sourceRetrievedAt: timestamp("source_retrieved_at", { withTimezone: true }),
    parserSource: text("parser_source"),
    schemaVersion: text("schema_version"),
    sourceHttpRequest: nullableJsonObjectColumn("source_http_request"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("business_reputation_profiles_source_record_idx").on(
      table.sourceSystem,
      table.sourceRecordKey,
    ),
    index("business_reputation_profiles_provider_url_idx").on(table.profileUrl),
    index("business_reputation_profiles_company_idx").on(table.companyId),
    index("business_reputation_profiles_address_idx").on(table.addressId),
    index("business_reputation_profiles_provider_business_idx").on(
      table.provider,
      table.providerBusinessId,
    ),
    index("business_reputation_profiles_rating_idx").on(table.bbbRating),
    index("business_reputation_profiles_normalized_name_idx").on(table.normalizedName),
  ],
);

export const businessReputationAlternateNames = pgTable(
  "business_reputation_alternate_names",
  {
    businessReputationAlternateNameId: uuid("business_reputation_alternate_name_id")
      .primaryKey()
      .defaultRandom(),
    businessReputationProfileId: uuid("business_reputation_profile_id")
      .notNull()
      .references(() => businessReputationProfiles.businessReputationProfileId, {
        onDelete: "cascade",
      }),
    alternateName: text("alternate_name").notNull(),
    normalizedName: text("normalized_name"),
    nameType: text("name_type"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("business_reputation_alt_names_source_record_idx").on(
      table.sourceSystem,
      table.sourceRecordKey,
    ),
    index("business_reputation_alt_names_profile_idx").on(
      table.businessReputationProfileId,
    ),
    index("business_reputation_alt_names_normalized_idx").on(table.normalizedName),
  ],
);

export const businessReputationCategories = pgTable(
  "business_reputation_categories",
  {
    businessReputationCategoryId: uuid("business_reputation_category_id")
      .primaryKey()
      .defaultRandom(),
    businessReputationProfileId: uuid("business_reputation_profile_id")
      .notNull()
      .references(() => businessReputationProfiles.businessReputationProfileId, {
        onDelete: "cascade",
      }),
    categoryName: text("category_name").notNull(),
    categoryCode: text("category_code"),
    categoryUrl: text("category_url"),
    isPrimary: boolean("is_primary"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("business_reputation_categories_source_record_idx").on(
      table.sourceSystem,
      table.sourceRecordKey,
    ),
    index("business_reputation_categories_profile_idx").on(
      table.businessReputationProfileId,
    ),
    index("business_reputation_categories_name_idx").on(table.categoryName),
  ],
);

export const businessReputationRatingReasons = pgTable(
  "business_reputation_rating_reasons",
  {
    businessReputationRatingReasonId: uuid("business_reputation_rating_reason_id")
      .primaryKey()
      .defaultRandom(),
    businessReputationProfileId: uuid("business_reputation_profile_id")
      .notNull()
      .references(() => businessReputationProfiles.businessReputationProfileId, {
        onDelete: "cascade",
      }),
    reasonOrdinal: integer("reason_ordinal"),
    reasonCode: text("reason_code"),
    reasonText: text("reason_text").notNull(),
    reasonImpact: text("reason_impact"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("business_reputation_rating_reasons_source_record_idx").on(
      table.sourceSystem,
      table.sourceRecordKey,
    ),
    index("business_reputation_rating_reasons_profile_idx").on(
      table.businessReputationProfileId,
    ),
  ],
);

export const businessReputationContacts = pgTable(
  "business_reputation_contacts",
  {
    businessReputationContactId: uuid("business_reputation_contact_id")
      .primaryKey()
      .defaultRandom(),
    businessReputationProfileId: uuid("business_reputation_profile_id")
      .notNull()
      .references(() => businessReputationProfiles.businessReputationProfileId, {
        onDelete: "cascade",
      }),
    personId: uuid("person_id").references(() => people.personId, {
      onDelete: "set null",
    }),
    contactName: text("contact_name").notNull(),
    normalizedName: text("normalized_name"),
    title: text("title"),
    role: text("role"),
    phone: text("phone"),
    email: text("email"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("business_reputation_contacts_source_record_idx").on(
      table.sourceSystem,
      table.sourceRecordKey,
    ),
    index("business_reputation_contacts_profile_idx").on(
      table.businessReputationProfileId,
    ),
    index("business_reputation_contacts_person_idx").on(table.personId),
    index("business_reputation_contacts_name_idx").on(table.normalizedName),
  ],
);

export const businessReputationLicenses = pgTable(
  "business_reputation_licenses",
  {
    businessReputationLicenseId: uuid("business_reputation_license_id")
      .primaryKey()
      .defaultRandom(),
    businessReputationProfileId: uuid("business_reputation_profile_id")
      .notNull()
      .references(() => businessReputationProfiles.businessReputationProfileId, {
        onDelete: "cascade",
      }),
    licenseNumber: text("license_number"),
    licenseType: text("license_type"),
    licenseStatus: text("license_status"),
    agency: text("agency"),
    jurisdiction: text("jurisdiction"),
    issueDate: date("issue_date"),
    expirationDate: date("expiration_date"),
    rawText: text("raw_text"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("business_reputation_licenses_source_record_idx").on(
      table.sourceSystem,
      table.sourceRecordKey,
    ),
    index("business_reputation_licenses_profile_idx").on(
      table.businessReputationProfileId,
    ),
    index("business_reputation_licenses_number_idx").on(table.licenseNumber),
  ],
);

export const businessReputationServiceAreas = pgTable(
  "business_reputation_service_areas",
  {
    businessReputationServiceAreaId: uuid("business_reputation_service_area_id")
      .primaryKey()
      .defaultRandom(),
    businessReputationProfileId: uuid("business_reputation_profile_id")
      .notNull()
      .references(() => businessReputationProfiles.businessReputationProfileId, {
        onDelete: "cascade",
      }),
    addressId: uuid("address_id").references(() => addresses.addressId, {
      onDelete: "set null",
    }),
    areaName: text("area_name").notNull(),
    areaType: text("area_type"),
    cityName: text("city_name"),
    countyName: text("county_name"),
    stateCode: text("state_code"),
    postalCode: text("postal_code"),
    countryCode: text("country_code"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("business_reputation_service_areas_source_record_idx").on(
      table.sourceSystem,
      table.sourceRecordKey,
    ),
    index("business_reputation_service_areas_profile_idx").on(
      table.businessReputationProfileId,
    ),
    index("business_reputation_service_areas_address_idx").on(table.addressId),
    index("business_reputation_service_areas_state_zip_idx").on(
      table.stateCode,
      table.postalCode,
    ),
  ],
);

export const businessReputationLocations = pgTable(
  "business_reputation_locations",
  {
    businessReputationLocationId: uuid("business_reputation_location_id")
      .primaryKey()
      .defaultRandom(),
    businessReputationProfileId: uuid("business_reputation_profile_id")
      .notNull()
      .references(() => businessReputationProfiles.businessReputationProfileId, {
        onDelete: "cascade",
      }),
    addressId: uuid("address_id").references(() => addresses.addressId, {
      onDelete: "set null",
    }),
    relationshipType: text("relationship_type").notNull(),
    locationName: text("location_name"),
    providerProfileId: text("provider_profile_id"),
    providerBusinessId: text("provider_business_id"),
    providerBbbId: text("provider_bbb_id"),
    profileUrl: text("profile_url"),
    phone: text("phone"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("business_reputation_locations_source_record_idx").on(
      table.sourceSystem,
      table.sourceRecordKey,
    ),
    index("business_reputation_locations_profile_idx").on(
      table.businessReputationProfileId,
    ),
    index("business_reputation_locations_address_idx").on(table.addressId),
    index("business_reputation_locations_url_idx").on(table.profileUrl),
  ],
);

export const businessReputationReviews = pgTable(
  "business_reputation_reviews",
  {
    businessReputationReviewId: uuid("business_reputation_review_id")
      .primaryKey()
      .defaultRandom(),
    businessReputationProfileId: uuid("business_reputation_profile_id")
      .notNull()
      .references(() => businessReputationProfiles.businessReputationProfileId, {
        onDelete: "cascade",
      }),
    providerReviewId: text("provider_review_id"),
    reviewDate: date("review_date"),
    reviewRating: numeric("review_rating", { precision: 5, scale: 2 }),
    reviewTitle: text("review_title"),
    reviewText: text("review_text"),
    reviewerDisplayName: text("reviewer_display_name"),
    reviewStatus: text("review_status"),
    businessResponseDate: date("business_response_date"),
    businessResponseText: text("business_response_text"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("business_reputation_reviews_source_record_idx").on(
      table.sourceSystem,
      table.sourceRecordKey,
    ),
    index("business_reputation_reviews_profile_date_idx").on(
      table.businessReputationProfileId,
      table.reviewDate,
    ),
    index("business_reputation_reviews_provider_idx").on(table.providerReviewId),
  ],
);

export const businessReputationComplaints = pgTable(
  "business_reputation_complaints",
  {
    businessReputationComplaintId: uuid("business_reputation_complaint_id")
      .primaryKey()
      .defaultRandom(),
    businessReputationProfileId: uuid("business_reputation_profile_id")
      .notNull()
      .references(() => businessReputationProfiles.businessReputationProfileId, {
        onDelete: "cascade",
      }),
    providerComplaintId: text("provider_complaint_id"),
    complaintDate: date("complaint_date"),
    complaintClosedDate: date("complaint_closed_date"),
    complaintType: text("complaint_type"),
    complaintCategory: text("complaint_category"),
    complaintStatus: text("complaint_status"),
    complaintSummary: text("complaint_summary"),
    complaintText: text("complaint_text"),
    desiredOutcome: text("desired_outcome"),
    resolutionText: text("resolution_text"),
    customerDisplayName: text("customer_display_name"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("business_reputation_complaints_source_record_idx").on(
      table.sourceSystem,
      table.sourceRecordKey,
    ),
    index("business_reputation_complaints_profile_date_idx").on(
      table.businessReputationProfileId,
      table.complaintDate,
    ),
    index("business_reputation_complaints_provider_idx").on(table.providerComplaintId),
    index("business_reputation_complaints_status_idx").on(table.complaintStatus),
  ],
);

export const businessReputationComplaintEvents = pgTable(
  "business_reputation_complaint_events",
  {
    businessReputationComplaintEventId: uuid("business_reputation_complaint_event_id")
      .primaryKey()
      .defaultRandom(),
    businessReputationComplaintId: uuid("business_reputation_complaint_id")
      .notNull()
      .references(() => businessReputationComplaints.businessReputationComplaintId, {
        onDelete: "cascade",
      }),
    eventDate: date("event_date"),
    eventType: text("event_type").notNull(),
    actorName: text("actor_name"),
    actorRole: text("actor_role"),
    eventText: text("event_text"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("business_reputation_complaint_events_source_record_idx").on(
      table.sourceSystem,
      table.sourceRecordKey,
    ),
    index("business_reputation_complaint_events_complaint_date_idx").on(
      table.businessReputationComplaintId,
      table.eventDate,
    ),
  ],
);

export const businessReputationMedia = pgTable(
  "business_reputation_media",
  {
    businessReputationMediaId: uuid("business_reputation_media_id")
      .primaryKey()
      .defaultRandom(),
    businessReputationProfileId: uuid("business_reputation_profile_id")
      .notNull()
      .references(() => businessReputationProfiles.businessReputationProfileId, {
        onDelete: "cascade",
      }),
    mediaKind: text("media_kind").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    description: text("description"),
    contentType: text("content_type"),
    storageUri: text("storage_uri"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("business_reputation_media_source_record_idx").on(
      table.sourceSystem,
      table.sourceRecordKey,
    ),
    index("business_reputation_media_profile_idx").on(table.businessReputationProfileId),
  ],
);

export const businessReputationExternalLinks = pgTable(
  "business_reputation_external_links",
  {
    businessReputationExternalLinkId: uuid("business_reputation_external_link_id")
      .primaryKey()
      .defaultRandom(),
    businessReputationProfileId: uuid("business_reputation_profile_id")
      .notNull()
      .references(() => businessReputationProfiles.businessReputationProfileId, {
        onDelete: "cascade",
      }),
    linkKind: text("link_kind").notNull(),
    url: text("url").notNull(),
    label: text("label"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("business_reputation_external_links_source_record_idx").on(
      table.sourceSystem,
      table.sourceRecordKey,
    ),
    index("business_reputation_external_links_profile_idx").on(
      table.businessReputationProfileId,
    ),
  ],
);

export const contractorQualityScores = pgTable(
  "contractor_quality_scores",
  {
    contractorQualityScoreId: uuid("contractor_quality_score_id")
      .primaryKey()
      .defaultRandom(),
    companyId: uuid("company_id").references(() => companies.companyId, {
      onDelete: "set null",
    }),
    businessReputationProfileId: uuid("business_reputation_profile_id").references(
      () => businessReputationProfiles.businessReputationProfileId,
      { onDelete: "set null" },
    ),
    requestIdentifier: text("request_identifier"),
    scoringModel: text("scoring_model").notNull(),
    score: numeric("score", { precision: 6, scale: 2 }),
    scoreBand: text("score_band"),
    matchConfidence: text("match_confidence"),
    matchMethod: text("match_method"),
    factorPayload: jsonObjectColumn("factor_payload"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("contractor_quality_scores_source_record_idx").on(
      table.sourceSystem,
      table.sourceRecordKey,
    ),
    index("contractor_quality_scores_company_idx").on(table.companyId),
    index("contractor_quality_scores_profile_idx").on(table.businessReputationProfileId),
    index("contractor_quality_scores_score_idx").on(table.score),
  ],
);
