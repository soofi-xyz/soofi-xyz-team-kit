# HOA and property-management enrichment

Run HOA/property-management matching as internal enrichment. Produce lexicon records and
relationship CIDs for the normal Atlas data-group pipeline. Do not publish a separate
overlay, working table, or public pointer.

This enrichment does not set Chapter 720 membership (`hoa_flag`). Keep membership on its
authoritative source track.

## Source order

Use:

1. exact parcel-linked appraisal subdivision or legal-community text;
2. official Florida DBPR CTMH mailing lists for condominium, cooperative, and timeshare
   identity;
3. statewide ACTIVE Sunbiz companies for corporate identity;
4. statewide corporate events and fictitious names only as bridges from an already
   established name;
5. parcel-linked clerk plat/declaration names only when a custodian supplies structured
   evidence.

Never use a county ZIP-filtered Sunbiz extract. An association, successor, DBA owner, or
manager may be registered outside the property county.

## Fail-closed name rules

- Strip deterministic legal-description noise before lookup.
- Do not append HOA, POA, community, or association suffixes.
- Match normalized association bases exactly.
- Never use edit distance, token score, address proximity, or a human favorite.
- Reject people, lawyers, law firms, and registered-agent designations as associations
  or managers.
- Preserve all candidates and terminal status.

When multiple ACTIVE candidates remain, apply in order:

1. one exact successor from official event evidence;
2. explicit nonprofit filing type;
3. explicit HOA/condo/cooperative/community legal-name role;
4. one candidate with explicit matching city/county while every alternative explicitly
   conflicts;
5. one existing CTMH or parcel-linked declaration document number.

Keep `not_unique` when ambiguity remains.

## Estate-type gate

- `Condominium`: regional condo CTMH lists only.
- `Cooperative`: cooperative list only.
- `Timeshare`: timeshare and multi-timeshare lists only.
- `FeeSimple` or `Leasehold`: skip CTMH; use Sunbiz HOA path.
- Missing estate: try condo, then cooperative, then timeshare; do not fall through a
  non-unique pool.

Do not infer estate type from use code, DOR code, or subdivision text.

Scope CTMH to the parcel county. Multiple buildings with one managing-entity number may
collapse to one association. A unique CTMH result may remain a valid HOA when Sunbiz
corporate resolution is absent or ambiguous; keep the corporate document null and record
the miss.

## Corporate and manager identity

After one association is established:

- resolve exactly one ACTIVE Sunbiz company by normalized legal name;
- use events or fictitious-name ownership only when they end at one ACTIVE corporate
  document number;
- resolve a corporate registered-agent or CTMH managing entity to a different ACTIVE
  company for property management;
- keep person agents as `no_agent_company`;
- never invent a document number from a CTMH project number.

Keep company, association, and property-manager records in their correct lexicon groups.
Use local deterministic hashes during enrichment; the normal CLI hash/CAR sequence assigns
content identifiers for Atlas publication.

## Clerk fallback

Accept only a structured `plat_name` or `declaration_name` linked to the exact parcel and
one instrument number. Reject grantor, grantee, attorney, owner, trustee, return-to, and
free-text legal party names.

Require one normalized recorded name and one ACTIVE Sunbiz company. Keep conflicts with
appraisal community evidence unresolved.

## Reconciliation

Before enrichment, synchronize subdivision into blank bounded working rows by exact
`elephant_uuid`, `property_id`, or canonical token. Preserve filled values and existing
membership fields. Add missing rows only from an explicitly bounded parcel list and
official working artifact.

Run the local sequence:

```bash
node bin/elephant-county.mjs hoa-pm-index \
  --source-dir <expanded-statewide-cordata> \
  --subdivisions <json-array> \
  --quarter <YYYYQn> \
  --output <index-dir>

node bin/elephant-county.mjs hoa-pm-overlay-sync \
  --county <county> \
  --overlay-parquet <working.parquet> \
  --official-parquet <official-working.parquet> \
  --parcel-csv <bounded.csv> \
  --output-dir <sync-dir>

node bin/elephant-county.mjs hoa-pm-enrich \
  --county <county> \
  --input-parquet <sync-dir>/query-table.parquet \
  --input-coverage <working-coverage.json> \
  --sunbiz-extract <statewide-active-sunbiz> \
  --sunbiz-pm-extract <statewide-active-sunbiz> \
  --ctmh-extract <ctmh-dir> \
  --output-dir <output-dir>
```

These Parquet/coverage files are internal reconciliation intermediates. Do not upload or
serve them. Convert the resulting lexicon records into the appropriate validated group
directory, then publish only through the CAR/table/Atlas sequence.

## Statuses

Keep misses explicit, including:

- `no_subdivision`
- `no_sunbiz_hoa`
- `no_ctmh_condo`
- `no_ctmh_coop`
- `no_ctmh_timeshare`
- `not_unique`
- `ctmh_not_in_sunbiz`
- `sunbiz_not_unique`
- `no_agent_company`
- `agent_not_in_sunbiz`
- clerk missing/not-unique/conflicting states

Do not clear a prior accepted HOA or manager on a later miss. Preserve it with an explicit
`_prior_hoa_preserved`, `_prior_pm_preserved`, or combined status. Replace only with a new
unique eligible result.

## Verification

Report input rows, synchronized rows, exact source digests, status counts, unique HOA and
manager matches, unresolved counts, preserved prior links, object/relationship counts,
and the validated Atlas data-group directory that contains the enrichment.
