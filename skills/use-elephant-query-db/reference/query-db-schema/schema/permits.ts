import { sql } from "drizzle-orm";
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
import { parcels, properties } from "./appraisal.js";
import {
  createdAtColumn,
  jsonObjectColumn,
  nullableJsonObjectColumn,
  sourceMetadataColumns,
  updatedAtColumn,
} from "./shared.js";

export const propertyImprovements = pgTable(
  "property_improvements",
  {
    propertyImprovementId: uuid("property_improvement_id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").references(() => properties.propertyId, {
      onDelete: "set null",
    }),
    parcelId: uuid("parcel_id").references(() => parcels.parcelId, {
      onDelete: "set null",
    }),
    addressId: uuid("address_id").references(() => addresses.addressId, {
      onDelete: "set null",
    }),
    contractorCompanyId: uuid("contractor_company_id").references(
      () => companies.companyId,
      { onDelete: "set null" },
    ),
    requestIdentifier: text("request_identifier"),
    permitNumber: text("permit_number"),
    improvementType: text("improvement_type"),
    improvementStatus: text("improvement_status"),
    improvementAction: text("improvement_action"),
    contractorType: text("contractor_type"),
    permitRequired: boolean("permit_required"),
    applicationReceivedDate: date("application_received_date"),
    permitIssueDate: date("permit_issue_date"),
    finalInspectionDate: date("final_inspection_date"),
    permitCloseDate: date("permit_close_date"),
    completionDate: date("completion_date"),
    isOwnerBuilder: boolean("is_owner_builder"),
    isDisasterRecovery: boolean("is_disaster_recovery"),
    privateProviderPlanReview: boolean("private_provider_plan_review"),
    privateProviderInspections: boolean("private_provider_inspections"),
    fee: numeric("fee", { precision: 18, scale: 2 }),
    estimatedJobValue: numeric("estimated_job_value", { precision: 18, scale: 2 }),
    estimatedSqFt: numeric("estimated_sq_ft", { precision: 18, scale: 2 }),
    schemaVersion: text("schema_version"),
    source: text("source"),
    sourceUrl: text("source_url"),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }),
    accelaRecordId: text("accela_record_id"),
    accelaAltId: text("accela_alt_id"),
    sourceModule: text("source_module"),
    sourceRecordType: text("source_record_type"),
    recordType: text("record_type"),
    sourceStatus: text("source_status"),
    recordStatus: text("record_status"),
    openedDate: date("opened_date"),
    expirationDate: date("expiration_date"),
    workLocation: text("work_location"),
    parcelIdentifier: text("parcel_identifier"),
    propertyMatchMethod: text("property_match_method"),
    propertyMatchConfidence: text("property_match_confidence"),
    applicant: text("applicant"),
    licensedProfessional: text("licensed_professional"),
    projectDescription: text("project_description"),
    description: text("description"),
    commRes: text("comm_res"),
    volts: text("volts"),
    block: text("block"),
    lot: text("lot"),
    subdivision: text("subdivision"),
    planningCommunity: text("planning_community"),
    municipalCode: text("municipal_code"),
    historic: text("historic"),
    fireDistrict: text("fire_district"),
    moreDetails: jsonObjectColumn("more_details"),
    moreDetailsRawText: text("more_details_raw_text"),
    inspectionsRawText: text("inspections_raw_text"),
    processingStatusRawText: text("processing_status_raw_text"),
    rawText: text("raw_text"),
    sourceSearchResult: nullableJsonObjectColumn("source_search_result"),
    idempotencyKey: text("idempotency_key"),
    sourceHttpRequest: nullableJsonObjectColumn("source_http_request"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("property_improvements_source_record_idx").on(table.sourceSystem, table.sourceRecordKey),
    index("property_improvements_permit_number_idx")
      .on(table.sourceSystem, table.permitNumber)
      .where(sql`${table.permitNumber} IS NOT NULL`),
    index("property_improvements_dates_idx").on(
      table.applicationReceivedDate,
      table.permitIssueDate,
      table.permitCloseDate,
    ),
    index("property_improvements_status_idx").on(
      table.improvementStatus,
      table.sourceStatus,
      table.recordStatus,
    ),
    index("property_improvements_parcel_idx").on(table.parcelId),
    index("property_improvements_parcel_identifier_idx").on(table.parcelIdentifier),
    index("property_improvements_project_description_idx").on(table.projectDescription),
  ],
);

export const inspections = pgTable(
  "inspections",
  {
    inspectionId: uuid("inspection_id").primaryKey().defaultRandom(),
    propertyImprovementId: uuid("property_improvement_id").references(
      () => propertyImprovements.propertyImprovementId,
      { onDelete: "cascade" },
    ),
    inspectionNumber: text("inspection_number"),
    inspectionStatus: text("inspection_status"),
    permitNumber: text("permit_number"),
    requestedDate: date("requested_date"),
    scheduledDate: date("scheduled_date"),
    completedDate: date("completed_date"),
    completedTime: text("completed_time"),
    result: text("result"),
    inspectionCode: text("inspection_code"),
    inspectionType: text("inspection_type"),
    inspectionIdentifier: text("inspection_identifier"),
    inspectorName: text("inspector_name"),
    resultedDate: text("resulted_date"),
    resultComment: text("result_comment"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("inspections_source_record_idx").on(table.sourceSystem, table.sourceRecordKey),
    index("inspections_permit_date_idx").on(table.permitNumber, table.completedDate),
    index("inspections_identifier_idx").on(table.inspectionIdentifier),
  ],
);

export const permitContacts = pgTable(
  "permit_contacts",
  {
    permitContactId: uuid("permit_contact_id").primaryKey().defaultRandom(),
    propertyImprovementId: uuid("property_improvement_id")
      .notNull()
      .references(() => propertyImprovements.propertyImprovementId, { onDelete: "cascade" }),
    contactRole: text("contact_role").notNull(),
    personId: uuid("person_id").references(() => people.personId, {
      onDelete: "set null",
    }),
    companyId: uuid("company_id").references(() => companies.companyId, {
      onDelete: "set null",
    }),
    addressId: uuid("address_id").references(() => addresses.addressId, {
      onDelete: "set null",
    }),
    rawName: text("raw_name"),
    rawBlockText: text("raw_block_text"),
    phone: text("phone"),
    email: text("email"),
    licenseNumber: text("license_number"),
    licenseType: text("license_type"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex("permit_contacts_source_record_idx").on(table.sourceSystem, table.sourceRecordKey),
    index("permit_contacts_permit_role_idx").on(
      table.propertyImprovementId,
      table.contactRole,
    ),
    index("permit_contacts_raw_name_idx").on(table.rawName),
  ],
);

export const permitEvents = pgTable(
  "permit_events",
  {
    permitEventId: uuid("permit_event_id").primaryKey().defaultRandom(),
    propertyImprovementId: uuid("property_improvement_id")
      .notNull()
      .references(() => propertyImprovements.propertyImprovementId, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    eventStatus: text("event_status"),
    eventDate: timestamp("event_date", { withTimezone: true }),
    actorName: text("actor_name"),
    commentText: text("comment_text"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex("permit_events_source_record_idx").on(table.sourceSystem, table.sourceRecordKey),
    index("permit_events_permit_date_idx").on(
      table.propertyImprovementId,
      table.eventDate,
    ),
  ],
);

export const permitFees = pgTable(
  "permit_fees",
  {
    permitFeeId: uuid("permit_fee_id").primaryKey().defaultRandom(),
    propertyImprovementId: uuid("property_improvement_id")
      .notNull()
      .references(() => propertyImprovements.propertyImprovementId, { onDelete: "cascade" }),
    feeCode: text("fee_code"),
    feeDescription: text("fee_description"),
    feeStatus: text("fee_status"),
    assessedAmount: numeric("assessed_amount", { precision: 18, scale: 2 }),
    paidAmount: numeric("paid_amount", { precision: 18, scale: 2 }),
    balanceAmount: numeric("balance_amount", { precision: 18, scale: 2 }),
    assessedDate: date("assessed_date"),
    paidDate: date("paid_date"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex("permit_fees_source_record_idx").on(table.sourceSystem, table.sourceRecordKey),
    index("permit_fees_permit_idx").on(table.propertyImprovementId),
  ],
);

export const permitLinks = pgTable(
  "permit_links",
  {
    permitLinkId: uuid("permit_link_id").primaryKey().defaultRandom(),
    propertyImprovementId: uuid("property_improvement_id")
      .notNull()
      .references(() => propertyImprovements.propertyImprovementId, { onDelete: "cascade" }),
    linkKind: text("link_kind").notNull(),
    text: text("text"),
    url: text("url").notNull(),
    title: text("title"),
    storageUri: text("storage_uri"),
    contentSha256: text("content_sha256"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex("permit_links_source_record_idx").on(table.sourceSystem, table.sourceRecordKey),
    index("permit_links_permit_idx").on(table.propertyImprovementId),
    uniqueIndex("permit_links_permit_url_idx").on(
      table.propertyImprovementId,
      table.linkKind,
      table.url,
    ),
  ],
);

export const permitCustomFields = pgTable(
  "permit_custom_fields",
  {
    permitCustomFieldId: uuid("permit_custom_field_id").primaryKey().defaultRandom(),
    propertyImprovementId: uuid("property_improvement_id")
      .notNull()
      .references(() => propertyImprovements.propertyImprovementId, { onDelete: "cascade" }),
    fieldGroup: text("field_group"),
    fieldName: text("field_name").notNull(),
    fieldValue: text("field_value"),
    fieldPayload: jsonObjectColumn("field_payload"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex("permit_custom_fields_source_record_idx").on(table.sourceSystem, table.sourceRecordKey),
    uniqueIndex("permit_custom_fields_unique_idx").on(
      table.propertyImprovementId,
      table.fieldGroup,
      table.fieldName,
    ),
    index("permit_custom_fields_name_value_idx").on(table.fieldName, table.fieldValue),
  ],
);

export const permitListWindows = pgTable(
  "permit_list_windows",
  {
    permitListWindowId: uuid("permit_list_window_id").primaryKey().defaultRandom(),
    jobId: text("job_id").notNull(),
    windowKey: text("window_key").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    portalUrl: text("portal_url"),
    reportedTotal: integer("reported_total"),
    discoveredPermitCount: integer("discovered_permit_count"),
    noResults: boolean("no_results"),
    truncatedForSplit: boolean("truncated_for_split"),
    pageCount: integer("page_count"),
    summaryStorageUri: text("summary_storage_uri"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex("permit_list_windows_source_record_idx").on(table.sourceSystem, table.sourceRecordKey),
    uniqueIndex("permit_list_windows_job_window_idx").on(table.jobId, table.windowKey),
  ],
);
