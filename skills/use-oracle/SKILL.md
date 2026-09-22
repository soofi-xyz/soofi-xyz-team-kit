---
name: use-oracle
description: "Operate Oracle county mining and the single Atlas publication path: capture, reconcile internally, validate lexicon groups, build CARs and tables, register the county in Atlas, and verify the global Atlas index."
---

# Use Oracle

Drive the bundled ingestion runtime and the Elephant CLI. Keep ingestion,
reconciliation, and publication boundaries explicit.

## Public boundary

Use exactly one public path:

```text
validate group
  → hash one CAR per county/data group
  → validate CAR
  → export normalized tables and Atlas page
  → upload CAR and tables with readback
  → Atlas county-page PR
  → merge
  → verify global Atlas IPNS
  → synchronize MCP 2.0 SQL
```

Do not publish Query DB exports, per-county pointers, coverage objects, overlays, or
environment maps. The Query DB is an internal working store for reconciliation and
product checks. Atlas archives and CLI-exported tables are the MCP/public source.

## Read first

1. [`reference/car-publication.md`](./reference/car-publication.md)
2. [`reference/readiness-and-completeness.md`](./reference/readiness-and-completeness.md)
3. [`reference/permit-evidence-preflight.md`](./reference/permit-evidence-preflight.md)
4. [`reference/roof-age-and-identity-reingest.md`](./reference/roof-age-and-identity-reingest.md)
5. [`reference/hoa-property-management.md`](./reference/hoa-property-management.md)
6. [`reference/self-contained-ingestion.md`](./reference/self-contained-ingestion.md)
7. [`reference/failure-modes.md`](./reference/failure-modes.md)
8. [`reference/durable-orchestration.md`](./reference/durable-orchestration.md)

## Choose the ingestion stack

Select one bundled runtime mode before capture:

- **Local:** Restate + Postgres under `skills/use-oracle/runtime/`.
- **AWS:** the bundled AWS batch/queue modules and the selected, verified AWS profile.

Do not require a sibling source checkout. Do not mix local Restate handlers with AWS
workers. Stack choice affects capture and internal loading only; publication always uses
the Atlas sequence above.

## Ingest and reconcile

Run these stages in order:

1. **Intake and readiness:** `onboard-county`, `county-discovery`,
   `county-readiness-preflight`.
2. **Parcel backbone:** `county-seed-data`, `county-appraisal-onboarding`,
   `build-county-transform`.
3. **Official identity baseline:** corporate registry, then licensing authority. In
   Florida run `sunbiz-corporate-ingest`, then `dbpr-license-ingest`. Stamp each
   Sunbiz company with a GET of `search.sunbiz.org` by document number
   (`sunbiz:<documentNumber>:company`). Do not write
   `https://dos.fl.gov/sunbiz/other-services/data-downloads/` onto the company.
4. **Permits:** `county-permit-adapter`, `county-ingest-run`, then permit evidence
   preflight. When a permit prints a license number, use that license number, the
   person name, and the company name only as search keys for the official DBPR
   license-detail lookup. Persist company, person, and license from the DBPR
   record. If DBPR returns no match, write no contractor, person, or license. Do
   not persist a contractor copied from the permit. Do not wait for a statewide
   relationship extract before reading permits that already carry a license.
   Require that extract only for historical qualification when the permit has no
   license number. Map a DBPR match with `property_improvement_has_contractor`
   (`property_improvement` → `company`), `contractor_has_license`
   (`company` → `license`; `license_identifier` on class `license`), and
   `contractor_has_person` (`company` → `person`; `first_name` and `last_name`;
   no license field on the person). Relationship objects are only `from` and `to`.
   `source_http_request.url` on those records is the official DBPR license-detail
   URL, not the permit page and not the Sunbiz download page. If the live manifest
   lacks those edges or the license source fields, record the gap and do not
   substitute another edge.
5. **Internal reconciliation:** `query-db-loading-matching`.
6. **Enrichment:** BBB, places, HOA/property management, AVM, and roof age as applicable.

Preserve these internal contracts:

- Key parcels by folio/request identifier, never a digits-only parcel normalization.
- Merge idempotently through one writer per county.
- Scope artifacts by county/job and load only fail-closed ready markers.
- Track `(path, artifact hash)` watermarks so corrected in-place outputs reload.
- Consume dead/invalid tombstones so stale rows do not survive.
- Preserve raw source payloads and valid unmatched permits.
- Link permits to the targeted parcel evidence; never trust a portal's displayed related
  parcel without reconciliation.
- Stamp company edges only from official, versioned, temporally valid identity evidence.
- Preserve unresolved, ambiguous, and conflicting contacts as unlinked.
- Compute roof age from accepted lifecycle evidence and retain confidence/coverage
  caveats.
- Keep reputation and places separate from legal identity.

The Query DB never becomes the publication source. Its successful reconciliation gates
completion and provides diagnostics; CAR inputs remain validated lexicon output.

## Publish each data group

Repeat for `county`, `property_improvement`, `hoa`, `corporate_registry`, `places`, or
each other group actually produced.

```bash
elephant-cli validate <group-dir> --output-csv <group-errors.csv>

elephant-cli hash <group-dir> \
  --output-zip <hashed-dir> \
  --output-csv <hash.csv> \
  --output-car <county>-<group>.car

elephant-cli validate <county>-<group>.car \
  --output-csv <car-errors.csv>

elephant-cli export-tables <county>-<group>.car \
  --output <tables-dir> \
  --output-json <tables-export.json> \
  --atlas-page <atlas>/counties/<STATE>/<county>.json \
  --county <county> --state <STATE> --fips <fips>

elephant-cli upload <county>-<group>.car \
  --output-json <archive-upload.json>

elephant-cli upload <tables-dir> \
  --output-json <tables-upload.json>
```

Use a public, durable IPFS node for a registrable run. Filebase Kubo RPC is the worked
example. A local node is acceptable only for development unless it remains publicly
reachable through Atlas merge. Require archive-root and tables-root readback before the
PR.

## Register and verify

1. Confirm only `counties/<STATE>/<county>.json` changed in the Atlas clone.
2. Open branch `publish/<state>-<county>`.
3. Create one PR and wait for `validate`.
4. Ask a code owner to merge. Do not self-merge.
5. If automation reverts the merge, treat publication as failed, restore public
   availability, and open a new PR.
6. Resolve global Atlas IPNS
   `k51qzi5uqu5dhzmj1jtn06idud425ozwdjjjn4eu7q01g2t814h7rw4du0nd04`
   through the configured gateway order.
7. Verify the accepted index CID and county/group entries reflect the merge.
8. Run MCP 2.0 `sync` (`npx -y @elephant-xyz/mcp@2 sync`), then call
   `listAtlasCounties` and `getAtlasDatasetInfo` with explicit `state`, `county`, and
   `dataGroup`.

Do not report publication from a green PR alone. Require the merged global IPNS and the
synchronized MCP snapshot.

## CLI and credentials

- Use a CLI build that supports CAR validation, `export-tables --atlas-page`, and CAR
  upload. Record its version or commit.
- Require the live lexicon manifest and schema gateways during validation.
- Keep upload credentials outside Git and command output.
- Require authenticated `gh` access to Atlas only when opening the registration PR.
- Never invent credentials or run a live upload just to test documentation.

## Property-list and legacy runs

Split a supplied property list by county. Build one seed file per county and one CAR per
county/data group. Never combine counties in one archive.

Re-mine pre-lexicon records from source. Do not backfill missing provenance into legacy
rows.

## Completion report

Use the required report in `agents/oracle.md`. Include internal reconciliation evidence
without exposing private rows or database credentials, and include global Atlas IPNS plus
MCP sync evidence for every public claim.
