# Schema And Query Code

This database serves normalized Elephant oracle data from Lee appraisal, Accela permits, BBB contractor reputation/quality data, and Sunbiz corporate registrations.

## Schema Surface

Import schema from `@elephant-xyz/query-db`. These are the current logical table and view exports:

```ts
import {
  addressProfileView,
  addresses,
  businessRegistrationAddresses,
  businessRegistrationAnnualReports,
  businessRegistrationEvents,
  businessRegistrationParties,
  businessRegistrations,
  businessReputationAlternateNames,
  businessReputationCategories,
  businessReputationComplaintEvents,
  businessReputationComplaints,
  businessReputationContacts,
  businessReputationExternalLinks,
  businessReputationLicenses,
  businessReputationLocations,
  businessReputationMedia,
  businessReputationProfiles,
  businessReputationRatingReasons,
  businessReputationReviews,
  businessReputationServiceAreas,
  companies,
  companyProfileView,
  contractorQualityScores,
  deeds,
  factSheets,
  files,
  floodStormInformation,
  geometries,
  inspections,
  layouts,
  lots,
  ownerships,
  parcels,
  people,
  permitContacts,
  permitCustomFields,
  permitEvents,
  permitFees,
  permitLinks,
  permitListWindows,
  permitSearchView,
  propertyImprovements,
  propertyProfileView,
  propertyValuations,
  properties,
  salesHistories,
  structures,
  sunbizExtractionChunks,
  taxes,
  unnormalizedAddresses,
  utilities,
  type Address,
  type BusinessRegistration,
  type BusinessRegistrationAddress,
  type BusinessRegistrationAnnualReport,
  type BusinessRegistrationEvent,
  type BusinessRegistrationParty,
  type BusinessReputationComplaint,
  type BusinessReputationComplaintEvent,
  type BusinessReputationProfile,
  type BusinessReputationReview,
  type ContractorQualityScore,
  type Company,
  type Inspection,
  type Parcel,
  type PermitContact,
  type PermitCustomField,
  type PermitEvent,
  type PermitFee,
  type PermitLink,
  type PermitListWindow,
  type Property,
  type PropertyImprovement,
} from "@elephant-xyz/query-db";
```

Primary read paths:

- Parcel/property: `parcels`, `properties`, `ownerships`, `taxes`, `sales_histories`, `structures`, `layouts`, `lots`, `utilities`, `flood_storm_information`, `property_profile_view`
- Permits: `property_improvements`, `inspections`, `permit_contacts`, `permit_events`, `permit_fees`, `permit_links`, `permit_custom_fields`, `permit_search_view`
- BBB contractor quality: `business_reputation_profiles`, `business_reputation_reviews`, `business_reputation_complaints`, `business_reputation_complaint_events`, `business_reputation_contacts`, `business_reputation_categories`, `business_reputation_external_links`, `contractor_quality_scores`
- Sunbiz: `companies`, `business_registrations`, `business_registration_addresses`, `business_registration_parties`, `business_registration_annual_reports`, `business_registration_events`, `company_profile_view`
- Address search: `addresses`, `unnormalized_addresses`, `address_profile_view`

## Exact Schema Files

The skill also bundles exact reusable TypeScript schema files from `elephant-query-db`. Use these only when the target project cannot consume `@elephant-xyz/query-db` directly.

```text
reference/query-db-schema/
├── types.ts
└── schema/
    ├── appraisal.ts
    ├── bbb.ts
    ├── core.ts
    ├── index.ts
    ├── permits.ts
    ├── shared.ts
    ├── sunbiz.ts
    └── views.ts
```

The files preserve the source package import style, including `.js` ESM import specifiers. To reuse them in another TypeScript project, copy the directory shape as-is:

```bash
mkdir -p src/elephant-query-db
cp -R skills/use-elephant-query-db/reference/query-db-schema/schema src/elephant-query-db/
cp skills/use-elephant-query-db/reference/query-db-schema/types.ts src/elephant-query-db/types.ts
```

Then import from the copied schema module:

```ts
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "@/elephant-query-db/schema";
import { propertyImprovements, permitSearchView } from "@/elephant-query-db/schema";
import type { PropertyImprovement } from "@/elephant-query-db/types";
```

If the copied files are used, install their runtime dependencies:

```bash
npm install drizzle-orm @neondatabase/serverless
```

## Database Client

Create a server-only database client. In a Next.js app, put this in a server-only module such as `src/server/elephant-db.ts`.

```ts
import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@elephant-xyz/query-db/schema";

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
  throw new Error("DATABASE_URL is required to query the elephant-query-db Vercel Neon database");
}

const neonSql = neon(databaseUrl);

export const elephantDb = drizzle(neonSql, { schema });
export type ElephantDb = typeof elephantDb;
export { schema as elephantSchema };
```

## Shared Query Functions

Put reusable query functions in a server-only module such as `src/server/elephant-queries.ts`.

```ts
import "server-only";

import { desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  addressProfileView,
  businessReputationAlternateNames,
  businessReputationCategories,
  businessReputationComplaintEvents,
  businessReputationComplaints,
  businessReputationContacts,
  businessReputationExternalLinks,
  businessReputationLicenses,
  businessReputationLocations,
  businessReputationMedia,
  businessReputationProfiles,
  businessReputationRatingReasons,
  businessReputationReviews,
  businessReputationServiceAreas,
  businessRegistrations,
  companyProfileView,
  contractorQualityScores,
  inspections,
  permitContacts,
  permitCustomFields,
  permitLinks,
  permitSearchView,
  propertyImprovements,
  propertyProfileView,
  type BusinessReputationAlternateName,
  type BusinessReputationCategory,
  type BusinessReputationComplaint,
  type BusinessReputationComplaintEvent,
  type BusinessReputationContact,
  type BusinessReputationExternalLink,
  type BusinessReputationLicense,
  type BusinessReputationLocation,
  type BusinessReputationMedia,
  type BusinessReputationProfile,
  type BusinessReputationRatingReason,
  type BusinessReputationReview,
  type BusinessReputationServiceArea,
  type ContractorQualityScore,
  type Inspection,
  type PermitContact,
  type PermitCustomField,
  type PermitLink,
  type PropertyImprovement,
} from "@elephant-xyz/query-db";

import { elephantDb } from "./elephant-db";

export type PropertyProfileRow = typeof propertyProfileView.$inferSelect;
export type PermitSearchRow = typeof permitSearchView.$inferSelect;
export type CompanyProfileRow = typeof companyProfileView.$inferSelect;
export type AddressProfileRow = typeof addressProfileView.$inferSelect;

export type BusinessReputationSearchRow = Pick<
  BusinessReputationProfile,
  | "businessReputationProfileId"
  | "companyId"
  | "addressId"
  | "name"
  | "legalName"
  | "profileUrl"
  | "bbbRating"
  | "ratingScore"
  | "reviewAverageRating"
  | "reviewCount"
  | "complaintCount"
  | "closedComplaintsPastThreeYears"
  | "isAccredited"
  | "websiteUrl"
>;

export type PermitDetail = {
  readonly permit: PropertyImprovement;
  readonly inspections: readonly Inspection[];
  readonly contacts: readonly PermitContact[];
  readonly links: readonly PermitLink[];
  readonly customFields: readonly PermitCustomField[];
};

export type BusinessReputationDetail = {
  readonly profile: BusinessReputationProfile;
  readonly scores: readonly ContractorQualityScore[];
  readonly alternateNames: readonly BusinessReputationAlternateName[];
  readonly categories: readonly BusinessReputationCategory[];
  readonly contacts: readonly BusinessReputationContact[];
  readonly externalLinks: readonly BusinessReputationExternalLink[];
  readonly licenses: readonly BusinessReputationLicense[];
  readonly locations: readonly BusinessReputationLocation[];
  readonly media: readonly BusinessReputationMedia[];
  readonly ratingReasons: readonly BusinessReputationRatingReason[];
  readonly reviews: readonly BusinessReputationReview[];
  readonly serviceAreas: readonly BusinessReputationServiceArea[];
  readonly complaints: readonly BusinessReputationComplaint[];
  readonly complaintEvents: readonly BusinessReputationComplaintEvent[];
};

/**
 * Normalize a parcel identifier for the Elephant query database.
 *
 * @param value - User-entered parcel identifier with or without punctuation.
 * @returns Digits-only parcel identifier used by `parcels.parcel_identifier` and permit parcel fields.
 */
export function normalizeParcelIdentifier(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Read one property profile by parcel identifier.
 *
 * @param parcelIdentifier - Parcel identifier, with or without punctuation.
 * @returns The first matching property profile row, or null when no row exists.
 */
export async function getPropertyByParcelIdentifier(
  parcelIdentifier: string,
): Promise<PropertyProfileRow | null> {
  const normalizedParcelIdentifier = normalizeParcelIdentifier(parcelIdentifier);
  const rows = await elephantDb
    .select()
    .from(propertyProfileView)
    .where(eq(propertyProfileView.parcelIdentifier, normalizedParcelIdentifier))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * List permits for a parcel.
 *
 * @param parcelIdentifier - Parcel identifier, with or without punctuation.
 * @param limit - Maximum number of permits to return.
 * @returns Permit search rows ordered by issue date when available.
 */
export async function listPermitsByParcelIdentifier(
  parcelIdentifier: string,
  limit = 50,
): Promise<readonly PermitSearchRow[]> {
  const normalizedParcelIdentifier = normalizeParcelIdentifier(parcelIdentifier);
  return elephantDb
    .select()
    .from(permitSearchView)
    .where(eq(permitSearchView.parcelIdentifier, normalizedParcelIdentifier))
    .orderBy(desc(permitSearchView.permitIssueDate))
    .limit(limit);
}

/**
 * Search permits by permit number, status, description, address, or parcel identifier.
 *
 * @param searchText - Free-text user search term.
 * @param limit - Maximum number of permits to return.
 * @returns Matching permit search rows.
 */
export async function searchPermits(
  searchText: string,
  limit = 50,
): Promise<readonly PermitSearchRow[]> {
  const trimmed = searchText.trim();
  const pattern = `%${trimmed}%`;
  const normalizedParcelIdentifier = normalizeParcelIdentifier(trimmed);

  return elephantDb
    .select()
    .from(permitSearchView)
    .where(
      or(
        ilike(permitSearchView.permitNumber, pattern),
        ilike(permitSearchView.improvementType, pattern),
        ilike(permitSearchView.improvementStatus, pattern),
        ilike(permitSearchView.unnormalizedAddress, pattern),
        eq(permitSearchView.parcelIdentifier, normalizedParcelIdentifier),
      ),
    )
    .orderBy(desc(permitSearchView.permitIssueDate))
    .limit(limit);
}

/**
 * Read a permit plus child inspection/contact/link/custom-field rows.
 *
 * @param permitNumber - Accela permit number, for example `ELE2025-02590`.
 * @returns Permit detail bundle, or null when the permit does not exist.
 */
export async function getPermitDetailByNumber(
  permitNumber: string,
): Promise<PermitDetail | null> {
  const permitRows = await elephantDb
    .select()
    .from(propertyImprovements)
    .where(eq(propertyImprovements.permitNumber, permitNumber))
    .limit(1);
  const permit = permitRows[0];

  if (permit === undefined) return null;

  const [inspectionRows, contactRows, linkRows, customFieldRows] = await Promise.all([
    elephantDb
      .select()
      .from(inspections)
      .where(eq(inspections.propertyImprovementId, permit.propertyImprovementId))
      .orderBy(desc(inspections.completedDate)),
    elephantDb
      .select()
      .from(permitContacts)
      .where(eq(permitContacts.propertyImprovementId, permit.propertyImprovementId)),
    elephantDb
      .select()
      .from(permitLinks)
      .where(eq(permitLinks.propertyImprovementId, permit.propertyImprovementId)),
    elephantDb
      .select()
      .from(permitCustomFields)
      .where(eq(permitCustomFields.propertyImprovementId, permit.propertyImprovementId)),
  ]);

  return {
    permit,
    inspections: inspectionRows,
    contacts: contactRows,
    links: linkRows,
    customFields: customFieldRows,
  };
}

/**
 * Search BBB reputation profiles by business name, legal name, normalized name, or BBB URL.
 *
 * @param searchText - Free-text business search term, for example a contractor name from a permit.
 * @param limit - Maximum number of reputation profiles to return.
 * @returns Matching BBB reputation profile summary rows ordered by BBB-derived score.
 */
export async function searchBusinessReputationProfiles(
  searchText: string,
  limit = 25,
): Promise<readonly BusinessReputationSearchRow[]> {
  const trimmed = searchText.trim();
  if (trimmed.length === 0) return [];

  const pattern = `%${trimmed}%`;

  return elephantDb
    .select({
      businessReputationProfileId: businessReputationProfiles.businessReputationProfileId,
      companyId: businessReputationProfiles.companyId,
      addressId: businessReputationProfiles.addressId,
      name: businessReputationProfiles.name,
      legalName: businessReputationProfiles.legalName,
      profileUrl: businessReputationProfiles.profileUrl,
      bbbRating: businessReputationProfiles.bbbRating,
      ratingScore: businessReputationProfiles.ratingScore,
      reviewAverageRating: businessReputationProfiles.reviewAverageRating,
      reviewCount: businessReputationProfiles.reviewCount,
      complaintCount: businessReputationProfiles.complaintCount,
      closedComplaintsPastThreeYears: businessReputationProfiles.closedComplaintsPastThreeYears,
      isAccredited: businessReputationProfiles.isAccredited,
      websiteUrl: businessReputationProfiles.websiteUrl,
    })
    .from(businessReputationProfiles)
    .where(
      or(
        ilike(businessReputationProfiles.name, pattern),
        ilike(businessReputationProfiles.legalName, pattern),
        ilike(businessReputationProfiles.normalizedName, pattern),
        ilike(businessReputationProfiles.profileUrl, pattern),
      ),
    )
    .orderBy(desc(businessReputationProfiles.ratingScore), desc(businessReputationProfiles.loadedAt))
    .limit(limit);
}

/**
 * Read one BBB reputation profile and every normalized child table loaded from BBB.
 *
 * @param businessReputationProfileId - UUID primary key from `business_reputation_profiles`.
 * @returns Full BBB reputation detail, including reviews, complaints, complaint events, and contractor scores.
 */
export async function getBusinessReputationDetail(
  businessReputationProfileId: string,
): Promise<BusinessReputationDetail | null> {
  const profileRows = await elephantDb
    .select()
    .from(businessReputationProfiles)
    .where(eq(businessReputationProfiles.businessReputationProfileId, businessReputationProfileId))
    .limit(1);
  const profile = profileRows[0];

  if (profile === undefined) return null;

  const [
    scores,
    alternateNames,
    categories,
    contacts,
    externalLinks,
    licenses,
    locations,
    media,
    ratingReasons,
    reviews,
    serviceAreas,
    complaints,
  ] = await Promise.all([
    elephantDb
      .select()
      .from(contractorQualityScores)
      .where(eq(contractorQualityScores.businessReputationProfileId, businessReputationProfileId))
      .orderBy(desc(contractorQualityScores.score)),
    elephantDb
      .select()
      .from(businessReputationAlternateNames)
      .where(eq(businessReputationAlternateNames.businessReputationProfileId, businessReputationProfileId)),
    elephantDb
      .select()
      .from(businessReputationCategories)
      .where(eq(businessReputationCategories.businessReputationProfileId, businessReputationProfileId)),
    elephantDb
      .select()
      .from(businessReputationContacts)
      .where(eq(businessReputationContacts.businessReputationProfileId, businessReputationProfileId)),
    elephantDb
      .select()
      .from(businessReputationExternalLinks)
      .where(eq(businessReputationExternalLinks.businessReputationProfileId, businessReputationProfileId)),
    elephantDb
      .select()
      .from(businessReputationLicenses)
      .where(eq(businessReputationLicenses.businessReputationProfileId, businessReputationProfileId)),
    elephantDb
      .select()
      .from(businessReputationLocations)
      .where(eq(businessReputationLocations.businessReputationProfileId, businessReputationProfileId)),
    elephantDb
      .select()
      .from(businessReputationMedia)
      .where(eq(businessReputationMedia.businessReputationProfileId, businessReputationProfileId)),
    elephantDb
      .select()
      .from(businessReputationRatingReasons)
      .where(eq(businessReputationRatingReasons.businessReputationProfileId, businessReputationProfileId))
      .orderBy(businessReputationRatingReasons.reasonOrdinal),
    elephantDb
      .select()
      .from(businessReputationReviews)
      .where(eq(businessReputationReviews.businessReputationProfileId, businessReputationProfileId))
      .orderBy(desc(businessReputationReviews.reviewDate)),
    elephantDb
      .select()
      .from(businessReputationServiceAreas)
      .where(eq(businessReputationServiceAreas.businessReputationProfileId, businessReputationProfileId)),
    elephantDb
      .select()
      .from(businessReputationComplaints)
      .where(eq(businessReputationComplaints.businessReputationProfileId, businessReputationProfileId))
      .orderBy(desc(businessReputationComplaints.complaintDate)),
  ]);

  const complaintIds = complaints.map((complaint) => complaint.businessReputationComplaintId);
  const complaintEvents = complaintIds.length === 0
    ? []
    : await elephantDb
      .select()
      .from(businessReputationComplaintEvents)
      .where(inArray(businessReputationComplaintEvents.businessReputationComplaintId, complaintIds))
      .orderBy(desc(businessReputationComplaintEvents.eventDate));

  return {
    profile,
    scores,
    alternateNames,
    categories,
    contacts,
    externalLinks,
    licenses,
    locations,
    media,
    ratingReasons,
    reviews,
    serviceAreas,
    complaints,
    complaintEvents,
  };
}

/**
 * Return BBB-derived contractor quality scores for companies attached to one permit.
 *
 * @param permitNumber - Accela permit number.
 * @returns Contractor quality score rows for the permit's contractor company and company contacts.
 */
export async function listContractorQualityScoresForPermitNumber(
  permitNumber: string,
): Promise<readonly ContractorQualityScore[]> {
  const permitRows = await elephantDb
    .select({
      propertyImprovementId: propertyImprovements.propertyImprovementId,
      contractorCompanyId: propertyImprovements.contractorCompanyId,
    })
    .from(propertyImprovements)
    .where(eq(propertyImprovements.permitNumber, permitNumber))
    .limit(1);
  const permit = permitRows[0];

  if (permit === undefined) return [];

  const contactCompanyRows = await elephantDb
    .select({ companyId: permitContacts.companyId })
    .from(permitContacts)
    .where(eq(permitContacts.propertyImprovementId, permit.propertyImprovementId));
  const companyIds = Array.from(new Set([
    permit.contractorCompanyId,
    ...contactCompanyRows.map((row) => row.companyId),
  ].filter((companyId): companyId is string => companyId !== null)));

  if (companyIds.length === 0) return [];

  return elephantDb
    .select()
    .from(contractorQualityScores)
    .where(inArray(contractorQualityScores.companyId, companyIds))
    .orderBy(desc(contractorQualityScores.score));
}

/**
 * Read a Sunbiz company profile by document number.
 *
 * @param documentNumber - Sunbiz document number.
 * @returns The first matching company profile row, or null when no row exists.
 */
export async function getCompanyByDocumentNumber(
  documentNumber: string,
): Promise<CompanyProfileRow | null> {
  const rows = await elephantDb
    .select()
    .from(companyProfileView)
    .where(eq(companyProfileView.documentNumber, documentNumber.trim().toUpperCase()))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Search Sunbiz registrations by legal name, document number, or FEI number.
 *
 * @param searchText - Free-text user search term.
 * @param limit - Maximum number of registrations to return.
 * @returns Matching company profile rows.
 */
export async function searchCompanies(
  searchText: string,
  limit = 50,
): Promise<readonly CompanyProfileRow[]> {
  const trimmed = searchText.trim();
  const pattern = `%${trimmed}%`;

  return elephantDb
    .select()
    .from(companyProfileView)
    .where(
      or(
        ilike(companyProfileView.name, pattern),
        ilike(companyProfileView.documentNumber, pattern),
        ilike(companyProfileView.feiNumber, pattern),
      ),
    )
    .limit(limit);
}

/**
 * Search normalized address profile rows.
 *
 * @param searchText - Partial address text.
 * @param limit - Maximum number of addresses to return.
 * @returns Matching address profile rows.
 */
export async function searchAddresses(
  searchText: string,
  limit = 50,
): Promise<readonly AddressProfileRow[]> {
  const pattern = `%${searchText.trim()}%`;

  return elephantDb
    .select()
    .from(addressProfileView)
    .where(ilike(addressProfileView.unnormalizedAddress, pattern))
    .limit(limit);
}

/**
 * Return high-level row counts for health checks and admin dashboards.
 *
 * @returns Counts from core logical source tables.
 */
export async function getElephantQueryDbCounts(): Promise<{
  readonly permits: number;
  readonly businessRegistrations: number;
  readonly businessReputationProfiles: number;
  readonly contractorQualityScores: number;
}> {
  const [permitRows, registrationRows, reputationRows, scoreRows] = await Promise.all([
    elephantDb
      .select({ count: sql<number>`count(*)::int` })
      .from(propertyImprovements),
    elephantDb
      .select({ count: sql<number>`count(*)::int` })
      .from(businessRegistrations),
    elephantDb
      .select({ count: sql<number>`count(*)::int` })
      .from(businessReputationProfiles),
    elephantDb
      .select({ count: sql<number>`count(*)::int` })
      .from(contractorQualityScores),
  ]);

  return {
    permits: permitRows[0]?.count ?? 0,
    businessRegistrations: registrationRows[0]?.count ?? 0,
    businessReputationProfiles: reputationRows[0]?.count ?? 0,
    contractorQualityScores: scoreRows[0]?.count ?? 0,
  };
}
```

## Next.js Route Handler Examples

Use route handlers as the Vercel API boundary. Do not call the database from client components.

```ts
import { NextResponse, type NextRequest } from "next/server";

import { getPermitDetailByNumber } from "@/server/elephant-queries";

export const runtime = "nodejs";

/**
 * GET /api/elephant/permits/[permitNumber]
 *
 * @param _request - Incoming Next.js request.
 * @param context - Route params containing the permit number.
 * @returns JSON response with permit detail data or 404.
 */
export async function GET(
  _request: NextRequest,
  context: { readonly params: Promise<{ readonly permitNumber: string }> },
): Promise<NextResponse> {
  const { permitNumber } = await context.params;
  const detail = await getPermitDetailByNumber(decodeURIComponent(permitNumber));

  if (detail === null) {
    return NextResponse.json({ error: "permit_not_found" }, { status: 404 });
  }

  return NextResponse.json({ data: detail });
}
```

```ts
import { NextResponse, type NextRequest } from "next/server";

import { getPropertyByParcelIdentifier, listPermitsByParcelIdentifier } from "@/server/elephant-queries";

export const runtime = "nodejs";

/**
 * GET /api/elephant/parcels/[parcelIdentifier]
 *
 * @param _request - Incoming Next.js request.
 * @param context - Route params containing the parcel identifier.
 * @returns JSON response with property and permit data.
 */
export async function GET(
  _request: NextRequest,
  context: { readonly params: Promise<{ readonly parcelIdentifier: string }> },
): Promise<NextResponse> {
  const { parcelIdentifier } = await context.params;
  const decodedParcelIdentifier = decodeURIComponent(parcelIdentifier);
  const [property, permits] = await Promise.all([
    getPropertyByParcelIdentifier(decodedParcelIdentifier),
    listPermitsByParcelIdentifier(decodedParcelIdentifier, 100),
  ]);

  if (property === null) {
    return NextResponse.json({ error: "parcel_not_found" }, { status: 404 });
  }

  return NextResponse.json({ data: { property, permits } });
}
```

```ts
import { NextResponse, type NextRequest } from "next/server";

import { getBusinessReputationDetail } from "@/server/elephant-queries";

export const runtime = "nodejs";

/**
 * GET /api/elephant/reputation/[businessReputationProfileId]
 *
 * @param _request - Incoming Next.js request.
 * @param context - Route params containing the BBB reputation profile UUID.
 * @returns JSON response with BBB profile detail, child rows, and contractor score rows.
 */
export async function GET(
  _request: NextRequest,
  context: { readonly params: Promise<{ readonly businessReputationProfileId: string }> },
): Promise<NextResponse> {
  const { businessReputationProfileId } = await context.params;
  const detail = await getBusinessReputationDetail(businessReputationProfileId);

  if (detail === null) {
    return NextResponse.json({ error: "business_reputation_profile_not_found" }, { status: 404 });
  }

  return NextResponse.json({ data: detail });
}
```

```ts
import { NextResponse, type NextRequest } from "next/server";

import { searchBusinessReputationProfiles } from "@/server/elephant-queries";

export const runtime = "nodejs";

/**
 * GET /api/elephant/reputation/search?q=<business-name>
 *
 * @param request - Incoming Next.js request with a `q` search parameter.
 * @returns JSON response with matching BBB reputation profile summaries.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const rows = await searchBusinessReputationProfiles(query, 25);

  return NextResponse.json({ data: rows });
}
```

## Query Notes

- `property_profile_view`, `permit_search_view`, `company_profile_view`, and `address_profile_view` are the preferred read models for application search pages.
- `property_improvements` is the permit table. Accela permit child rows join through `property_improvement_id`.
- BBB reputation profiles are in `business_reputation_profiles`; child BBB data joins through `business_reputation_profile_id`.
- BBB contractor score rows are in `contractor_quality_scores`; tie them to permits through `company_id` on `property_improvements.contractor_company_id` and `permit_contacts.company_id`, or through `business_reputation_profile_id` for profile detail pages.
- BBB loader artifacts preserve all browser-harvested visible text, JSON-LD, links, profile/subpage HTML, and Lee permit seed metadata in `business_reputation_profiles.source_payload`.
- `business_registrations.document_number` is the Sunbiz natural key.
- `parcels.parcel_identifier` and `properties.parcel_identifier` use normalized digits-only parcel identifiers.
- Use `source_system`, `source_record_key`, `source_record_hash`, and `source_artifact_uri` for audit and reconciliation screens.
- Use `source_payload` only when typed columns do not yet expose a source field needed by the UI.
