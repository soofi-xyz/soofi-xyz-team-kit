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

For each parcel, use the latest valid accepted anchor:

- **High:** completed primary-roof replacement/reroof completion or close date.
- **Medium:** completed new-construction completion or close date, with no later accepted
  primary-roof replacement.
- **Low:** valid built/home year only, with no later recorded accepted replacement.

Open replacement permits do not reset age. Repairs, coatings, gazebos, awnings, and other
accessory roofs do not reset primary roof age. Never synthesize dates; never use
quarantined or impossible dates. Partial historical coverage is a confidence caveat
because an unobserved later replacement may exist; it is not automatic ineligibility.

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
