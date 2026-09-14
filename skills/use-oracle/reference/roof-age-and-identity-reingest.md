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
`skills/use-oracle/runtime/src/roof-age/{estimator,integration}.ts`. For each parcel,
pass the frozen source profile, explicit parcel values, property built/home-year
evidence, permit lifecycle evidence, the requested as-of date, and
historical-coverage state.
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

The shared production integration is
`runtime/src/roof-age/integration.ts`. Appraisal transforms call it through
`runtime/src/core/transform-runner.mjs`; permit database loads run the same reconciler
inside the permit load transaction. Preserve explicit parcel `roof_date` and
`roof_age_years`. Never create a date from age alone. A built-year default writes the
four-digit year to the legacy text `roof_date` column and records
`roofDatePrecision: "year"`; it does not claim January 1 or any exact date.

Lineage is queryable at `structures.source_payload->'roof_age_lineage'` and is flattened
into county query tables as `roof_age_*` columns. It records source category, date
precision, confidence, policy/profile versions and digest, selected permit source/id,
coverage state/caveats, as-of date, and eligibility reason.

## Audit and backfill

Require Node 22.18+, installed bundled dependencies, the reflected Query DB schema, and
an explicit environment-variable **name** containing a PostgreSQL URL. Do not print the
URL. AWS and Filebase credentials are not required for a database-only audit.

Run a bounded read-only audit first; dry-run is the default:

```bash
npm run roof-age:audit --prefix skills/use-oracle/runtime -- \
  --state FL --county Broward --as-of-date YYYY-MM-DD \
  --database-url-env DATABASE_URL --limit 25 --offset 0 \
  --coverage-state unknown --coverage-caveats history_unknown \
  --report /private/checkpoints/broward-roof-age-audit.json
```

Review scope totals, missing before/after, explicit values, untouched construction-year
defaults, accepted permit updates, stale defaults superseded, blocked rows, incomplete
history, and projected updates. Apply only after separate database-write approval:

```bash
npm run roof-age:backfill --prefix skills/use-oracle/runtime -- \
  --state FL --county Broward --as-of-date YYYY-MM-DD \
  --database-url-env DATABASE_URL --limit 25 --offset 0 \
  --coverage-state partial \
  --coverage-caveats partial_history,predecessor_gap \
  --report /private/checkpoints/broward-roof-age-apply.json --apply
```

Repeat the same bounded batch and as-of date to prove `rowsWritten: 0` before widening
scope. Keep reports and database URLs outside Git. Unknown or partial permit history
remains a caveat; a dry-run never writes property rows.

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
