# Records-request routing

When a jurisdiction cannot be harvested unattended, name **who** receives the request,
**which system** to export, and **how** to send it. Do not say “request a bulk export”
without a recipient.

This is county-agnostic. The Broward list at the end is a 2026 worked example, not a
runtime special case.

## Choose the recipient

Pick one primary office from first-party city/town/village/county pages. Prefer the office
that holds the **permit system of record**, not a third-party expediter.

| Signal on the official site | Primary recipient | Typical route |
|---|---|---|
| Building / Permitting / Building Records / Property Records | Building Division or Building Records | `records-first` |
| City / Town / Village Clerk or Public Records / FOIA / JustFOIA / NextRequest / GovQA | Records custodian (Clerk) | `records-first` |
| Vendor developer docs plus a City IT or OpenGov/EnerGov administrator | Authorized API / integration key | `api-first` |
| Village or tiny municipality with no searchable database | Village Clerk / Village contact | `records-first` |
| Historical / microfilm / predecessor system named on the Building page | Building Records first; Clerk if they own archives | `records-first` |

Rules:

- Use the official portal or form URL when one exists.
- Use a published departmental email or phone only when listed on the official site.
- If email/phone is unpublished, send through the portal and say “not published.”
- Do not invent staff names. Named clerks are allowed only when the official site names them.
- Login or a “public user” account is not harvest authorization. Vendor terms can prohibit
  automation even after login. Prefer a native export.
- `api-first` only when the vendor documents an official API **and** the municipality can
  issue a scoped key. Otherwise `records-first`.
- Supplemental county approval systems are not a substitute for the municipal ledger.

## Catalog fields

For every jurisdiction with `status` `blocked`, `custodian-only`, or `manual-only`, the
source YAML must include `records_request`:

```yaml
records_request:
  recipient_office: City Clerk / Building Records / City IT
  request_portal_url: https://example.gov/public-records   # or omit if only email exists
  request_email: records@example.gov                      # optional when portal exists
  request_phone: "555-0100"                               # optional
  system_scope: complete EnerGov export plus predecessor cutoff date
  route: records-first   # or api-first
  fee_caveat: itemized estimate before paid research      # optional
```

The validator requires `recipient_office`, `system_scope`, `route`, and either
`request_portal_url` or `request_email`.

## Reusable request

Subject: `Public records request — native electronic permit export — [Jurisdiction] [System]`

Body:

```text
Please provide the existing native electronic export, preferably CSV/XLSX or the
database format you maintain, for all permit and application records in
[system / predecessor / date boundary].

Include existing fields for: stable system ID; permit/application/control number;
type/work class and description; status; application, issue, expiration, final,
and completion dates; parcel/folio; job-site address; valuation; contractor
business and license; inspection date/type/result. Include data dictionaries,
code lists, predecessor systems, and migration dates.

Exclude personal phone and email fields. Include open, closed, expired, voided,
and legacy records within the stated boundary.

If no export exists, provide existing permit logs/reports and identify excluded
systems. Before incurring charges, send an itemized estimate and name any
narrower existing export that would reduce fees.
```

## Worked example: Broward County, FL (2026)

Use these recipients when filing Broward requests. Refresh live pages before sending.
Highest-priority parallel filings: Dania Beach, Davie, Coral Springs, Lauderdale Lakes,
North Lauderdale, Parkland, Deerfield Beach, Sea Ranch Lakes.

- **Dania Beach** — Building Division via the Permit Information Request Form
  (https://ci.dania-beach.fl.us/2705/Permit-Information-Request). General records also
  accept JustFOIA (https://daniabeachfl.justfoia.com/publicportal). Email/phone: not
  published on the form page. Scope: complete eSuite export, all types, including stable
  internal IDs. Records-first. Pre-2001 research may require a deposit; extensive
  IT/clerical work can be billed.

- **Davie** — Town public-records process (https://www.davie-fl.gov/287/Request-for-Public-Information).
  Building: https://www.davie-fl.gov/206/Building, 954-797-1111. Scope: complete legacy
  eSuite history **and** OAS records from the 2026-01-12 cutover
  (https://davie-fl-us.avolvecloud.com/). Records-first. Ask for an itemized estimate.

- **Coral Springs** — City Clerk public-records request
  (https://www.coralsprings.gov/Government/City-Clerks-Office/Public-Records-Request;
  GovQA). clerks@coralsprings.gov; Clerk 954-344-1065. Building also lists
  buildingpermits@coralsprings.gov and Customer Care 954-344-1025, with a Building forms
  page at https://www.coralsprings.gov/Government/Departments/Building/Building-Forms/Public-Records-Request.
  Scope: native eTRAKiT export. CAPTCHA plus a 1,000-row search cap is not completeness.
  Records-first.

- **Hillsboro Beach** — Town Clerk (official site names Sherry Henderson),
  https://townofhillsborobeach.com/181/Town-Clerk, Shenderson@townofhillsborobeach.com,
  954-427-4011 ext. 2. Form: https://townofhillsborobeach.com/DocumentCenter/View/5093.
  Submit: https://townofhillsborobeach.com/555/Submit-a-Records-Request. Do not use the
  police PDRECORDS address for building permits. Scope: complete CommunityCore export.
  Records-first. Published labor for extensive IT work: $30/hour, 1-hour minimum.

- **Pembroke Park** — Town Clerk (official site names Cynthia Garcia-Lima). NextRequest
  https://townofpembrokeparkfl.nextrequest.com/; townclerk@tppfl.gov; 954-966-4600;
  3150 SW 52nd Ave. Scope: complete Gov-Easy export, not a keyword slice such as
  Job Name=ROOF. Records-first.

- **Lauderdale Lakes** — City public-records form
  https://lauderdalelakes.org/655/Public-Records-Request-Form. API-first only if City IT
  issues a scoped OpenGov `Record Read` integration key into Runtime Secrets; otherwise
  request complete OpenGov plus predecessor exports. Building-record research has been
  published around $40/hour.

- **North Lauderdale** — JustFOIA
  https://northlauderdalefl.justfoia.com/publicportal/home/newrequest. Scope: complete
  EnerGov and predecessor systems. Records-first. A login is not harvest authorization.
  Work beyond about 15 minutes may incur labor and IT charges.

- **Parkland** — City Clerk https://www.cityofparkland.org/149/Public-Records-Request.
  Scope: complete MGO plus retired eTRAKiT. Records-first. MGO terms prohibit automated
  harvesting.

- **Deerfield Beach** — Building Records JustFOIA
  https://deerfieldbeachfl.justfoia.com/Forms/Launch/c3659a89-954e-4827-98a6-98bb76ab44be.
  Scope: GeoCivix from 2025-12-15 **and** Gov-Easy/predecessor history. Records-first.
  GeoCivix terms prohibit automated access even to public areas.

- **Sea Ranch Lakes** — Village contact https://searanchlakesfl.org/; 954-943-8862.
  Scope: complete Village-issued permit ledger and inspections. Do not treat Broward BCS
  as the Village completeness source. Records-first.

- **Fort Lauderdale** — Development Services Property Records,
  PropertyRecords@fortlauderdale.gov;
  https://www.fortlauderdale.gov/Government/Departments/Development-Services/Permitting-Services/Property-Records.
  Scope: LauderBuild history, portal-only records, details, inspections, earliest retained
  date, and change feed; continue public ArcGIS snapshot deltas separately. Records-first.
  Plans for large structures may need owner authorization.

- **Hollywood** — City Clerk (official site names Patricia A. Cerny), 2600 Hollywood Blvd
  Room 221, 954-921-3211, pcerny@hollywoodfl.org;
  https://www.hollywoodfl.org/834/Public-Records. Scope: Accela electronic boundary plus
  Records and Archives for older/closed permits, with the official electronic start date.
  Records-first. Labor may apply if research exceeds about 15 minutes.

- **Hallandale Beach** — https://www.hallandalebeachfl.gov/1023/Public-Records-Requests.
  Building (954) 457-1383 / 457-2220. Scope: EnerGov migration documentation and every
  predecessor-system export. Records-first.

- **Miramar** — City Clerk (official site names Denise A. Gibbs), dagibbs@miramarfl.gov,
  954-602-3014; https://www.miramarfl.gov/Departments/City-Clerk/Public-Records. Building
  954-602-3200. Scope: EnerGov plus pre-2019 predecessor records. Records-first.

- **Plantation** — Building Safety records
  https://www.plantation.org/government/departments/building-safety/building-records,
  954-797-2783. Clerk search: https://www.plantation.org/government/departments/city-clerk/public-records-online-search.
  Scope: Accela electronic records plus the existing pre-2004 microfilm index, then
  targeted digitization if needed. Records-first. Copy fees have been published in the
  $3–5/page range; a deposit may be required.

- **Oakland Park** — JustFOIA https://oaklandparkfl.justfoia.com/publicportal/home/newrequest.
  Building 954-630-4350, building@oaklandparkfl.gov. Scope: complete pre-2019-11-01 legacy
  export plus Tyler/EnerGov. Records-first.

- **Pembroke Pines** — Building Division, 601 City Center Way, 954-435-6502, via the City
  Public Records Center. Scope: official migration cutoff and all predecessor permit
  records (current portal capture is not proof of pre-migration completeness).
  Records-first.

- **Weston** — City Clerk 954-385-2000,
  https://www.westonfl.org/government/city-clerk/public-records-requests. Building
  954-385-0500, building@westonfl.org. Scope: Accela electronic records plus pre-1997
  records or a written earliest-retained-date statement. Broward County Records
  954-765-4400 may hold pre-1997 instruments. Records-first.

- **Wilton Manors** — NextRequest https://cityofwiltonmanorsfl.nextrequest.com/; Community
  Development Services 954-390-2180. Scope: unavailable Citizenserve files as a
  machine-readable exception export. Records-first.
