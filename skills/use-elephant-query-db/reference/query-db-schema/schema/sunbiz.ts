import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { addresses, companies, people } from "./core.js";
import {
  createdAtColumn,
  emptyTextArray,
  jsonObjectColumn,
  sourceMetadataColumns,
  updatedAtColumn,
} from "./shared.js";

export const businessRegistrations = pgTable(
  "business_registrations",
  {
    businessRegistrationId: uuid("business_registration_id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.companyId, {
      onDelete: "set null",
    }),
    requestIdentifier: text("request_identifier").notNull(),
    sourceDataUri: text("source_data_uri"),
    sourceFileName: text("source_file_name"),
    sourceLineNumber: integer("source_line_number"),
    schemaVersion: text("schema_version"),
    parserSource: text("parser_source"),
    documentNumber: text("document_number").notNull(),
    entityName: text("entity_name"),
    statusCode: text("status_code"),
    status: text("status"),
    filingTypeCode: text("filing_type_code"),
    filingType: text("filing_type"),
    filedDate: date("filed_date"),
    feiNumber: text("fei_number"),
    lastTransactionDate: date("last_transaction_date"),
    stateCountry: text("state_country"),
    annualReport1Year: text("annual_report_1_year"),
    annualReport1Date: date("annual_report_1_date"),
    annualReport2Year: text("annual_report_2_year"),
    annualReport2Date: date("annual_report_2_date"),
    annualReport3Year: text("annual_report_3_year"),
    annualReport3Date: date("annual_report_3_date"),
    moreThanSixOfficers: boolean("more_than_six_officers"),
    rawRecordLength: integer("raw_record_length"),
    matchedAddressRoles: text("matched_address_roles").array().notNull().default(emptyTextArray),
    matchedZipPrefixes: text("matched_zip_prefixes").array().notNull().default(emptyTextArray),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("business_registrations_source_record_unique").on(table.sourceSystem, table.sourceRecordKey),
    unique("business_registrations_source_system_document_number_unique").on(
      table.sourceSystem,
      table.documentNumber,
    ),
    index("business_registrations_company_idx").on(table.companyId),
    index("business_registrations_entity_name_idx").on(table.entityName),
    index("business_registrations_fei_idx").on(table.feiNumber),
    index("business_registrations_zip_prefixes_idx").using(
      "gin",
      table.matchedZipPrefixes,
    ),
  ],
);

export const businessRegistrationAnnualReports = pgTable(
  "business_registration_annual_reports",
  {
    businessRegistrationAnnualReportId: uuid("business_registration_annual_report_id")
      .primaryKey()
      .defaultRandom(),
    businessRegistrationId: uuid("business_registration_id")
      .notNull()
      .references(() => businessRegistrations.businessRegistrationId, { onDelete: "cascade" }),
    documentNumber: text("document_number").notNull(),
    reportOrdinal: integer("report_ordinal").notNull(),
    reportYear: text("report_year"),
    reportDate: date("report_date"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique("business_registration_reports_source_record_unique").on(table.sourceSystem, table.sourceRecordKey),
    unique("business_registration_reports_unique").on(
      table.businessRegistrationId,
      table.reportOrdinal,
    ),
  ],
);

export const businessRegistrationAddresses = pgTable(
  "business_registration_addresses",
  {
    businessRegistrationAddressId: uuid("business_registration_address_id").primaryKey().defaultRandom(),
    businessRegistrationId: uuid("business_registration_id")
      .notNull()
      .references(() => businessRegistrations.businessRegistrationId, { onDelete: "cascade" }),
    addressId: uuid("address_id").references(() => addresses.addressId, {
      onDelete: "set null",
    }),
    requestIdentifier: text("request_identifier").notNull(),
    documentNumber: text("document_number").notNull(),
    addressRole: text("address_role").notNull(),
    line1: text("line_1"),
    line2: text("line_2"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    country: text("country"),
    singleLine: text("single_line"),
    normalized: text("normalized"),
    addressMatchMethod: text("address_match_method"),
    addressMatchConfidence: text("address_match_confidence"),
    matchedZipPrefixes: text("matched_zip_prefixes").array().notNull().default(emptyTextArray),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("business_registration_addresses_source_record_unique").on(table.sourceSystem, table.sourceRecordKey),
    unique("business_registration_addresses_role_unique").on(
      table.businessRegistrationId,
      table.addressRole,
    ),
    index("business_registration_addresses_address_idx").on(table.addressId),
    index("business_registration_addresses_zip_idx").on(table.zip),
  ],
);

export const businessRegistrationParties = pgTable(
  "business_registration_parties",
  {
    businessRegistrationPartyId: uuid("business_registration_party_id").primaryKey().defaultRandom(),
    businessRegistrationId: uuid("business_registration_id")
      .notNull()
      .references(() => businessRegistrations.businessRegistrationId, { onDelete: "cascade" }),
    partyPersonId: uuid("party_person_id").references(() => people.personId, {
      onDelete: "set null",
    }),
    partyCompanyId: uuid("party_company_id").references(() => companies.companyId, {
      onDelete: "set null",
    }),
    addressId: uuid("address_id").references(() => addresses.addressId, {
      onDelete: "set null",
    }),
    requestIdentifier: text("request_identifier").notNull(),
    documentNumber: text("document_number").notNull(),
    partyRole: text("party_role").notNull(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name"),
    partyTypeCode: text("party_type_code"),
    title: text("title"),
    officerOrdinal: integer("officer_ordinal"),
    addressLine1: text("address_line_1"),
    addressLine2: text("address_line_2"),
    addressCity: text("address_city"),
    addressState: text("address_state"),
    addressZip: text("address_zip"),
    addressCountry: text("address_country"),
    addressSingleLine: text("address_single_line"),
    addressNormalized: text("address_normalized"),
    addressMatchMethod: text("address_match_method"),
    addressMatchConfidence: text("address_match_confidence"),
    matchedZipPrefixes: text("matched_zip_prefixes").array().notNull().default(emptyTextArray),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("business_registration_parties_source_record_unique").on(table.sourceSystem, table.sourceRecordKey),
    index("business_registration_parties_registration_idx").on(
      table.businessRegistrationId,
    ),
    index("business_registration_parties_name_idx").on(table.name),
    index("business_registration_parties_address_zip_idx").on(table.addressZip),
  ],
);

export const businessRegistrationEvents = pgTable(
  "business_registration_events",
  {
    businessRegistrationEventId: uuid("business_registration_event_id")
      .primaryKey()
      .defaultRandom(),
    businessRegistrationId: uuid("business_registration_id")
      .notNull()
      .references(() => businessRegistrations.businessRegistrationId, { onDelete: "cascade" }),
    documentNumber: text("document_number").notNull(),
    eventCode: text("event_code"),
    eventType: text("event_type"),
    eventDate: date("event_date"),
    eventDescription: text("event_description"),
    sourceFileName: text("source_file_name"),
    sourceLineNumber: integer("source_line_number"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique("business_registration_events_source_record_unique").on(table.sourceSystem, table.sourceRecordKey),
    index("business_registration_events_registration_date_idx").on(
      table.businessRegistrationId,
      table.eventDate,
    ),
  ],
);

export const sunbizExtractionChunks = pgTable(
  "sunbiz_extraction_chunks",
  {
    sunbizExtractionChunkId: uuid("sunbiz_extraction_chunk_id").primaryKey().defaultRandom(),
    extractKey: text("extract_key").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    recordCount: integer("record_count").notNull(),
    uri: text("uri").notNull(),
    sourceDataUri: text("source_data_uri"),
    sourcePayload: jsonObjectColumn("source_payload"),
    ...sourceMetadataColumns(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("sunbiz_extraction_chunks_source_record_unique").on(
      table.sourceSystem,
      table.sourceRecordKey,
    ),
    unique("sunbiz_extraction_chunks_key_chunk_unique").on(
      table.extractKey,
      table.chunkIndex,
    ),
  ],
);
