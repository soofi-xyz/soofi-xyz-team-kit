import { sql } from "drizzle-orm";
import { date, integer, numeric, pgView, text, uuid } from "drizzle-orm/pg-core";

import { addresses, companies } from "./core.js";
import { parcels, properties } from "./appraisal.js";
import { propertyImprovements } from "./permits.js";
import { businessRegistrations } from "./sunbiz.js";

export const propertyProfileView = pgView("property_profile_view", {
  propertyId: uuid("property_id"),
  parcelIdentifier: text("parcel_identifier"),
  propertyType: text("property_type"),
  propertyUsageType: text("property_usage_type"),
  propertyLegalDescriptionText: text("property_legal_description_text"),
  propertyStructureBuiltYear: integer("property_structure_built_year"),
  subdivision: text("subdivision"),
  zoning: text("zoning"),
  parcelId: uuid("parcel_id"),
  jurisdictionKey: text("jurisdiction_key"),
}).as(sql`
  select
    ${properties.propertyId} as property_id,
    ${properties.parcelIdentifier} as parcel_identifier,
    ${properties.propertyType} as property_type,
    ${properties.propertyUsageType} as property_usage_type,
    ${properties.propertyLegalDescriptionText} as property_legal_description_text,
    ${properties.propertyStructureBuiltYear} as property_structure_built_year,
    ${properties.subdivision} as subdivision,
    ${properties.zoning} as zoning,
    ${parcels.parcelId} as parcel_id,
    ${parcels.jurisdictionKey} as jurisdiction_key
  from ${properties}
  left join ${parcels} on ${parcels.parcelId} = ${properties.parcelId}
`);

export const permitSearchView = pgView("permit_search_view", {
  propertyImprovementId: uuid("property_improvement_id"),
  permitNumber: text("permit_number"),
  improvementType: text("improvement_type"),
  improvementStatus: text("improvement_status"),
  sourceStatus: text("source_status"),
  recordStatus: text("record_status"),
  applicationReceivedDate: date("application_received_date"),
  permitIssueDate: date("permit_issue_date"),
  permitCloseDate: date("permit_close_date"),
  parcelId: uuid("parcel_id"),
  parcelIdentifier: text("parcel_identifier"),
  addressId: uuid("address_id"),
  unnormalizedAddress: text("unnormalized_address"),
  cityName: text("city_name"),
  postalCode: text("postal_code"),
  contractorCompanyId: uuid("contractor_company_id"),
  contractorName: text("contractor_name"),
}).as(sql`
  select
    ${propertyImprovements.propertyImprovementId} as property_improvement_id,
    ${propertyImprovements.permitNumber} as permit_number,
    ${propertyImprovements.improvementType} as improvement_type,
    ${propertyImprovements.improvementStatus} as improvement_status,
    ${propertyImprovements.sourceStatus} as source_status,
    ${propertyImprovements.recordStatus} as record_status,
    ${propertyImprovements.applicationReceivedDate} as application_received_date,
    ${propertyImprovements.permitIssueDate} as permit_issue_date,
    ${propertyImprovements.permitCloseDate} as permit_close_date,
    ${propertyImprovements.parcelId} as parcel_id,
    coalesce(${parcels.parcelIdentifier}, ${propertyImprovements.parcelIdentifier}) as parcel_identifier,
    ${propertyImprovements.addressId} as address_id,
    coalesce(${addresses.unnormalizedAddress}, ${propertyImprovements.workLocation}) as unnormalized_address,
    ${addresses.cityName} as city_name,
    ${addresses.postalCode} as postal_code,
    ${propertyImprovements.contractorCompanyId} as contractor_company_id,
    ${companies.name} as contractor_name
  from ${propertyImprovements}
  left join ${parcels} on ${parcels.parcelId} = ${propertyImprovements.parcelId}
  left join ${addresses} on ${addresses.addressId} = ${propertyImprovements.addressId}
  left join ${companies} on ${companies.companyId} = ${propertyImprovements.contractorCompanyId}
`);

export const companyProfileView = pgView("company_profile_view", {
  companyId: uuid("company_id"),
  name: text("name"),
  normalizedName: text("normalized_name"),
  businessRegistrationId: uuid("business_registration_id"),
  documentNumber: text("document_number"),
  status: text("status"),
  filingType: text("filing_type"),
  filedDate: date("filed_date"),
  feiNumber: text("fei_number"),
}).as(sql`
  select
    ${companies.companyId} as company_id,
    ${companies.name} as name,
    ${companies.normalizedName} as normalized_name,
    ${businessRegistrations.businessRegistrationId} as business_registration_id,
    ${businessRegistrations.documentNumber} as document_number,
    ${businessRegistrations.status} as status,
    ${businessRegistrations.filingType} as filing_type,
    ${businessRegistrations.filedDate} as filed_date,
    ${businessRegistrations.feiNumber} as fei_number
  from ${companies}
  left join ${businessRegistrations} on ${businessRegistrations.companyId} = ${companies.companyId}
`);

export const addressProfileView = pgView("address_profile_view", {
  addressId: uuid("address_id"),
  normalizedAddressKey: text("normalized_address_key"),
  unnormalizedAddress: text("unnormalized_address"),
  streetNumber: text("street_number"),
  streetName: text("street_name"),
  streetSuffixType: text("street_suffix_type"),
  unitIdentifier: text("unit_identifier"),
  cityName: text("city_name"),
  stateCode: text("state_code"),
  postalCode: text("postal_code"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
}).as(sql`
  select
    ${addresses.addressId} as address_id,
    ${addresses.normalizedAddressKey} as normalized_address_key,
    ${addresses.unnormalizedAddress} as unnormalized_address,
    ${addresses.streetNumber} as street_number,
    ${addresses.streetName} as street_name,
    ${addresses.streetSuffixType} as street_suffix_type,
    ${addresses.unitIdentifier} as unit_identifier,
    ${addresses.cityName} as city_name,
    ${addresses.stateCode} as state_code,
    ${addresses.postalCode} as postal_code,
    ${addresses.latitude} as latitude,
    ${addresses.longitude} as longitude
  from ${addresses}
`);
