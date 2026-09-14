# Roof-age and contractor-identity re-ingest

Use this checklist when an operator asks Oracle to re-ingest a county and rerun the
old-roof contractor-expansion query. The policy is county-neutral.

## Operator checklist

1. Freeze the durable run manifest and pass county readiness. Rebuild or repair the seed
   and appraisal/property backbone; preserve the seed CSV as input of record.
2. Load the official corporate registry, then run the official contractor-licensing
   authority adequacy-or-acquire stage. In Florida, run `sunbiz-corporate-ingest`, then
   `dbpr-license-ingest`. Permit harvest is blocked until both identity snapshots are
   loaded/reconciled and the licensing stage returns `adequate_reuse` or
   `adequate_acquired`.
3. Run `county-permit-adapter` and `county-ingest-run` with permit list, detail, contact,
   lifecycle-date, inspection, description/scope, raw artifact, and digest capture.
4. Run `permit-evidence-preflight.md`, classify roofing work from explicit source text,
   resolve company identity, and use `query-db-loading-matching` to backfill supported
   company edges. Preserve raw names and omitted `license_number`.
5. Verify/create the two company-edge indexes per `query-db-loading-matching`, then rerun
   the product query in this order: parcel → explicitly classified roofing permits →
   resolved contractor `company_id` → other permits for that same company → old-roof
   candidates from the roof-age estimator.
6. Run BBB and Overture places only after identity resolution. They add reputation and
   context; they do not replace DBPR or establish contractor identity.

## Roof-age estimator

Use the reusable county-neutral implementation at
`skills/use-oracle/runtime/src/roof-age/estimator.ts`. For each parcel, pass the frozen
source profile, explicit field evidence states, property built/home-year evidence,
permit lifecycle evidence, the requested as-of date, and historical-coverage state.
The runtime maps exact source vocabulary through the profile, then uses the latest valid
accepted anchor:

- **High:** completed primary-roof replacement/reroof completion or close date.
- **Medium:** completed new-construction completion or close date, with no later accepted
  primary-roof replacement.
- **Low:** valid built/home year only, with no later recorded accepted replacement.

Open replacement permits do not reset age. Repairs, coatings, gazebos, awnings, and other
accessory roofs do not reset primary roof age. Never synthesize dates; never use
quarantined or impossible dates. Partial historical coverage is a confidence caveat
because an unobserved later replacement may exist; it is not automatic ineligibility.

County/source profiles own exact status and work mappings. Emit source field/value pairs,
completion and close date evidence states, a source-profile-selected chronology start,
and built/home-year provenance from transform/load boundaries. Do not classify with
product-query regex. Unmapped or contradictory terms become `needs_review`.

The versioned output contract (`elephant.roof-age-estimate.v1`) returns:

- `anchor`: either a permit terminal date with source system, source record, and chosen
  date field; a property built year with source field provenance; or `null`;
- `asOfDate` and integer `estimatedAgeYears` (whole elapsed years for dated permit
  anchors; calendar-year precision for built-year fallback);
- anchor confidence, accepted work classification, and eligibility/reason;
- historical-coverage state and sorted caveat codes; partial, unknown, capped, blocked,
  predecessor, archive, or unreconciled history never becomes proof of permit absence;
- per-permit terminal outcome counts and deterministic policy/profile version metadata
  with the canonical profile SHA-256.

`high`, `medium`, and `low` describe the accepted evidence anchor. They do not certify
physical roof condition, prove that no later replacement occurred, or override incomplete
historical coverage.

## Product-query contract

Feed the query only permit IDs accepted by the frozen, profile-versioned work classifier;
do not classify production results with SQL regex. Join companies through
`permit_contacts.company_id` or
`property_improvements.contractor_company_id`. Use raw names, license text, regex, fuzzy
matching, addresses, and phones only to discover unresolved repair candidates.

Return the parcel and roof-age confidence/caveat, roofing permit and accepted work class,
resolved company ID and resolver version, the company's other permits, identity-edge
index verification, and unresolved/ambiguous/conflicting counts. A product row without a
verified company edge must not appear as resolved.
