# Roof-age and contractor-identity re-ingest

Use this checklist when an operator asks Oracle to re-ingest a county and rerun the
old-roof contractor-expansion query. The policy is county-neutral.

## Operator checklist

1. Freeze the durable run manifest and pass county readiness. Rebuild or repair the seed
   and appraisal/property backbone; preserve the seed CSV as input of record.
2. Read permits that print a license number and resolve each one: official
   license-detail lookup, then the Sunbiz company. Use the permit license number,
   person name, and company name only as DBPR search keys. Persist company, person,
   and license from the DBPR record. If DBPR returns no match, write no contractor,
   person, or license. Write `property_improvement_has_contractor` from
   `property_improvement` to `company`. The contractor is the company, not a separate
   class. Write `contractor_has_license` from `company` to `license`. Relationship
   objects are only `from` and `to`. The license id is `license_identifier` on class
   `license`. Write `contractor_has_person` from `company` to `person` (schema title
   `company_to_person`). The person is an object with `first_name` and `last_name`,
   not a string field. There is no license field on the person. Do not wait for a
   statewide relationship extract before that read. In Florida, run
   `sunbiz-corporate-ingest` for the company detail URL (`search.sunbiz.org` by
   document number, not the bulk file) and `dbpr-license-ingest` for the
   license-detail lookup. Require the public-records extract only for historical
   qualification when the permit has no license number.
3. Run `county-permit-adapter` and `county-ingest-run` with permit list, detail, contact,
   lifecycle-date, inspection, description/scope, raw artifact, and digest capture.
4. Run `permit-evidence-preflight.md`, classify roofing work from explicit source text,
   resolve company identity, and emit the supported identity relationship files with a
   resolution-ledger record each. Preserve raw names and omitted license numbers.
5. Run `reconcile-county.mjs --strict` (`county-ingest-run`, Reconcile), assemble the
   groups, then rerun the product query in this order: parcel → explicitly classified
   roofing permits → resolved contractor company through
   `property_improvement_has_contractor` → other permits for that same company →
   old-roof candidates from the roof-age estimator (see the gaps below: the estimate
   exists only after a roof-age records file was built and audited).
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

The shared integration is `runtime/src/roof-age/integration.ts`. Preserve explicit
parcel `roof_date` and `roof_age_years`. Never create a date from age alone. A built-year
default writes the four-digit year to `roof_date` and records
`roofDatePrecision: "year"`; it does not claim January 1 or any exact date. Lineage
(`roof_age_lineage` in the structure's source payload) records source category, date
precision, confidence, policy/profile versions and digest, selected permit source/id,
coverage state/caveats, as-of date, and eligibility reason. There is no database step.

## What the runtime does today (gaps)

State these gaps honestly in every report that mentions roof age:

- The Restate `Parcel` transform does not call the estimator. A pipeline run produces no
  roof-age estimate by itself.
- `src/core/transform-runner.mjs` (the `elephant-county` scripts runner) applies the
  estimator with an optional `roofAge: {sourceSystem, asOfDate}`, but it reads only the
  transformed parcel files (structure, property, layout) — not permit artifacts — so on
  its own it yields built-year anchors, not permit anchors.
- `bin/roof-age-backfill.mjs` (`npm run roof-age:audit` / `roof-age:backfill`) runs the
  estimator over a JSONL file of roof-age property records (one
  `RoofAgePropertyRecord` per line with `state`, `county`, `propertyId`, `structureId`,
  `sourceSystem`, `sourceRecordId`, `builtYear`, `roofDate`, `roofAgeYears`,
  `sourcePayload`, `permits`; see `src/roof-age/jsonl-store.mjs`). Nothing yet builds that
  JSONL from transformed parcels plus the job's permit artifacts. Until a builder exists,
  write it with a reviewed, versioned script and record its digest in the run manifest.

## Audit and backfill (files)

Dry-run is the default and never writes records. `--apply` requires `--output`, writes
reconciled records to that NEW JSONL file atomically (holding `<output>.lock`), and never
modifies `--input`:

```bash
npm run roof-age:audit --prefix skills/use-oracle/runtime -- \
  --state FL --county <County> --as-of-date YYYY-MM-DD \
  --input <roof-age-records.jsonl> --limit 25 --offset 0 \
  --coverage-state unknown --coverage-caveats history_unknown \
  --report <private-checkpoint-dir>/roof-age-audit.json
```

Other flags: `--source-system <system>`. Review scope totals, missing before/after,
explicit values kept, built-year defaults, accepted permit anchors, stale defaults
superseded, blocked rows, and incomplete history. Apply the same bounded batch and as-of
date with `--apply --output <new.jsonl>` only after review, then apply again to that
output and prove nothing changes before widening scope. Keep reports and record files
outside Git. Unknown or partial permit history remains a caveat.

## Product-query contract

Feed the query only permit IDs accepted by the frozen, profile-versioned work classifier;
do not classify production results with SQL regex. Join lexicon contractors through
`property_improvement_has_contractor`, `contractor_has_license`
(`license_identifier`), and `contractor_has_person` in validated group output or the
exported Atlas tables. Use raw names, license text, regex, fuzzy
matching, addresses, and phones only to discover unresolved repair candidates.

Return the parcel and roof-age confidence/caveat, roofing permit and accepted work class,
resolved company and resolver version, the company's other permits, the resolution-ledger
record for each edge, and unresolved/ambiguous/conflicting counts. A product row without a
verified company edge must not appear as resolved.
