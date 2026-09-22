---
name: onboard-county
description: "Orchestrate county onboarding or re-ingest through readiness, appraisal, official identity, permits, internal Query DB reconciliation, enrichment, and Atlas publication."
metadata: {"author":"elephant-xyz"}
---

# Onboard County

Use the bundled runtime at `skills/use-oracle/runtime/`. Read each stage skill before
running it. Do not require sibling ingestion repositories.

## Intake

Ask once, then execute approved stages without repeated confirmation:

1. County, state, five-digit FIPS, and lowercase-hyphen county slug.
2. Pilot or full scope; supplied seed or official parcel-roll source.
3. Appraiser, permit, corporate-registry, and licensing sources; sources to exclude.
   For Florida, a license number printed on a permit is a DBPR search key, not a
   record to copy. Look it up on the official license detail, then stamp the Sunbiz
   company from `search.sunbiz.org` by document number. Do not wait for a statewide
   relationship extract before reading those permits.
4. Local Restate or bundled AWS execution. Verify selected AWS identity and region when
   AWS is chosen; fall back to local only with operator agreement.
5. US egress and any login, CAPTCHA, records-request, or custodian constraints.
6. Internal `DATABASE_URL` target. Do not print it.
7. Existing flows, transforms, findings, and reusable adapters.
8. Whether public publication is in scope. If yes, confirm an upload node that will
   remain publicly reachable through Atlas merge and authenticated Atlas PR access.

Restate the source boundary, stages, job ID, execution mode, internal destination, and
publication scope. Stop only for a material missing choice, access blocker, or source
whose projected acquisition exceeds 48 hours.

## Target outcome

Produce validated lexicon records with exact source-request provenance; reconcile them
internally by folio; stamp each Sunbiz company from its document-number detail URL;
resolve a printed permit license through official DBPR license detail before writing
any contractor, person, or license; require the public-records relationship extract
before historical qualification of permits that omit a license number; preserve
unmatched evidence; calculate roof-age lineage; add enrichment separately; and,
when publication is authorized, register each data group through the single Atlas
publication sequence.

The Query DB is an internal working store. It is not the MCP source, public registry, or
publication input.

## Stage order

1. **Infrastructure:** `bootstrap-oracle-infra`. Verify the chosen stack, data
   directories, database, services, and destination identity.
2. **Discovery and readiness:** `county-discovery`, then
   `county-readiness-preflight`. A failed gate blocks seed, pilot, and full run.
3. **Seed:** `county-seed-data`. Keep the official seed CSV as input of record.
4. **Appraisal:** `county-appraisal-onboarding`; smoke one parcel.
5. **Transform validation:** `build-county-transform`; prove source-field coverage and
   live-lexicon validity before scale.
6. **Official identity baseline:** load corporate registry, then licensing authority.
   In Florida run `sunbiz-corporate-ingest`, then `dbpr-license-ingest`. Stamp each
   Sunbiz company with `search.sunbiz.org` by document number, not the bulk download
   page. When a permit prints a license number, use that license number, the person
   name, and the company name only as search keys for the official DBPR
   license-detail lookup. Persist company, person, and license from the DBPR record.
   If DBPR returns no match, write no contractor, person, or license. Do not persist
   a contractor copied from the permit. Map the match with
   `property_improvement_has_contractor` (`property_improvement` → `company`),
   `contractor_has_license` (`company` → `license`, `license_identifier` on class
   `license`), and `contractor_has_person` (`company` → `person`, `first_name` and
   `last_name`; no license field on the person). Relationship objects are only
   `from` and `to`. Do not wait for a statewide relationship extract before reading
   permits that already carry a license. Require that extract only for historical
   qualification when the permit has no license number. Still require an official,
   dated, reconciled snapshot covering licenses, qualifiers, qualified-business
   relationships, status, and effective dates before that historical path.
7. **Permit adapter:** `county-permit-adapter`. Build may overlap discovery. Harvest
   of permits that print a license number uses the DBPR license-detail lookup and
   does not wait for the statewide relationship extract. Historical qualification of
   permits with no license number may not precede that extract's adequacy.
8. **Pilot:** `county-ingest-run` with about 25 representative parcels. Verify
   residential skip, permit-less, permit detail/contact, and failure paths.
9. **Feasibility:** project full duration. Above 48 hours, ask whether to continue,
   request bulk records, or design an owning application runtime lookup.
10. **Full run:** use the backpressure-aware feeder and measured concurrency. Monitor
    with the stack-specific monitoring skill.
11. **Internal reconciliation:** `query-db-loading-matching`.
12. **Roof age and enrichment:** apply the roof-age reference; run BBB, places,
    HOA/property-management, or AVM stages within their source and licence gates.
13. **Publication:** when in scope, follow `use-oracle` and
    `reference/car-publication.md` once per data group. Do not run another publisher.
14. **Public verification:** after Atlas merge, verify global Atlas IPNS, synchronize MCP
    2.0 SQL, and smoke the retained tools.

## Internal reconciliation gates

Require all of these before wrap-up:

- distinct folios in artifacts and Query DB reconcile to `seed − proven dead/invalid`;
- the county loader is single-writer and merges idempotently;
- watermarks track path plus artifact hash and cover the final ready artifacts;
- dead/invalid tombstones remove or downgrade previously loaded rows;
- permits link from the harvest target evidence, not an unverified displayed parcel;
- `permit_contacts.company_id` uses versioned official identity evidence;
- `property_improvements.contractor_company_id` is set only when contractor contacts
  agree;
- unresolved, ambiguous, conflicting, and valid-unmatched records remain explicit;
- indexes support company-edge product queries;
- roof-age lineage records accepted status/work mappings, source profile, selected
  evidence, confidence, historical-coverage caveats, and as-of date;
- BBB and places remain enrichment, never official identity.

Do not key parcels on digits-only identifiers. Folio/request identifier is the stable
parcel identity. Use FK-safe source-scoped clears; never truncate shared tables with
cascade.

## Atlas publication gate

For each produced data group:

1. Validate the group.
2. Build its CAR and hash CSV.
3. Validate the CAR.
4. Export normalized tables and update the Atlas page with
   `export-tables --atlas-page`.
5. Upload CAR and tables; read both roots back.
6. Open one county-page Atlas PR and wait for validation and code-owner merge.
7. Verify the merged global Atlas IPNS and synchronized MCP snapshot.

The seed root rides inside every group archive. Never publish Seed as a standalone group.
Never derive the CAR or Atlas table set from the Query DB.

## Persistence and safety

- Commit code, small fixtures, transforms, flows, and findings. Never commit raw county
  data, archives, Parquet, database URLs, or secrets.
- Do not persist a contractor company, person, or license copied from a permit.
  Permit fields are DBPR search keys only. No DBPR match means write no contractor,
  person, or license.
- Keep each source bounded, rate-limited, retryable, and resumable.
- Never bypass CAPTCHA or automation restrictions.
- Preserve source payloads and lexicon gaps.
- Track dead tails from source-empty evidence, not from failed transforms.
- Record every PR and immutable artifact digest in the findings.

## Handoff

Return the source boundary, readiness result, pilot/full counts, internal reconciliation,
official identity adequacy, permit linkage, roof-age/enrichment coverage, per-group CAR and
tables evidence, Atlas PR/merge result, global IPNS index CID, MCP sync result, blockers,
and next action.
