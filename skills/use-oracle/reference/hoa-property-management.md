# HOA and property-management heuristic

Oracle resolves HOA and property management for published query-table rows by reading
subdivision. When `ownership_estate_type` is Condominium, Cooperative, or Timeshare,
or when estate is missing, the matcher tries a fail-closed unique match on the
matching official Florida DBPR CTMH mailing list — never a union of condo + coop +
timeshare. FeeSimple and Leasehold skip CTMH and use the Sunbiz HOA path only. A
unique CTMH hit rematches to a unique ACTIVE Sunbiz company for the corporate record
and registered-agent property manager. When CTMH misses or is not unique, the existing
Sunbiz HOA path still looks up a unique Florida Sunbiz company for that subdivision,
then reads the HOA company's registered-agent / communication company and looks that
company up in **all ACTIVE Sunbiz companies**, not only the HOA-marker index.
Estate type still filters Sunbiz condo vs homeowners candidates.

Use the statewide Sunbiz company dataset. Do not use the ZIP-filtered county extract
produced by `sunbiz-filter` / `sunbiz-enrich`, because an HOA or manager can be registered
outside the property's county.

This does **not** set `hoa_flag` (Chapter 720 membership stays on `hoa-enrich`).

## Objects and CID stamps

Relationships are CID fields on the referencing object, not graph edges.

| Object | Data group | CID fields |
| --- | --- | --- |
| `property` | County query table / property | `hoa_cid`, `property_manager_cid` |
| `homeowners_association` | `HOA_` | `company_cid`, `property_manager_cid` |
| `company` (HOA legal entity) | `HOA_` | `sunbiz_document_number` |
| `company` (manager) | `Property_Management` | `sunbiz_document_number` |

Local object CIDs are `sha256:<hex>` of the canonical payload before the `cid` field.
They remain local hashes after enrichment. The approval-gated publication path validates
those hashes, deduplicates the objects, uploads company objects first, replaces the HOA's
`company_cid` and `property_manager_cid` with the returned IPFS CIDs, then uploads each HOA
object. It finally re-stamps the query table's `hoa_cid` / `property_manager_cid`, uploads
the re-stamped table and a real-CID object inventory, and moves only the HOA/PM IPNS labels.
Enrichment alone does not upload or replace the row-level hashes.

## Publication destination

Use the existing shared query-table Filebase bucket with a separate dataset namespace:

- Bucket: `elephant-oracle-query-table` (shared by published counties; do
  not create a separate HOA/PM product bucket).
- Enriched table key: `<county>/hoa-pm/query-table.parquet`.
- Enriched coverage key: `<county>/hoa-pm/dataset-coverage.json`.
- HOA/PM object bundle key: `<county>/hoa-pm/objects.jsonl`.
- Individual browsable object keys:
  `<county>/hoa-pm/objects/<data-group>/<type>/<local-sha256>.json`.
- Never write HOA/PM slices to the official keys `<county>/query-table.parquet`
  or `<county>/dataset-coverage.json`.
- HOA/PM labels: `oracle-query-table-<county>-hoa-pm` and
  `oracle-dataset-coverage-<county>-hoa-pm`.

Require either a published county in `runtime/catalog/published-counties.json` or a
query-table-only county in `runtime/catalog/mcp-overlays.json`, then derive the separate
HOA/PM labels from that base county key. Permit profiles do not control HOA/PM
publication. Never update `oracle-query-table-<county>` or
`oracle-dataset-coverage-<county>` from this bounded enrichment path: those official
labels remain reserved for the full county publication.

The HOA/PM object bundle is CID-linked from the enriched query table and shares the
county's existing bucket under the county-scoped `hoa-pm/` prefix. Register the query
slice under the distinct MCP dataset key `<county>-hoa-pm`; it does not replace the
official county key.

For rows with a published `hoa_cid` or `property_manager_cid`, publish a second
property JSON object containing those CID fields and replace only the overlay row's
`property_cid` with the returned CID. Keep the original property object and official
county query table unchanged. Unmatched overlay rows retain their original
`property_cid`. Store the stamped pages under `<county>/hoa-pm/properties/` and move
only `oracle-query-table-<county>-hoa-pm`:

```bash
node bin/elephant-county.mjs hoa-pm-property-publish \
  --county duval \
  --input-parquet <current-overlay.parquet> \
  --dry-run
```

A live run requires an approval manifest that binds the exact source overlay bytes,
plus a resumable receipt. Never add or change `hoa_flag` in this step.

When a county has no official `property_cid`, use the explicit `--thin-overlay`
shortcut. It creates one minimal JSON object per linked overlay row from only the
overlay's county, native parcel-identifier column, available property-address fields,
subdivision, `hoa_cid`, `property_manager_cid`, and `hoa_pm_status`. It does not copy
owners, values, permits, sales, taxes, or `hoa_flag`, and it does not represent the
result as the county's canonical property object:

```bash
node bin/elephant-county.mjs hoa-pm-property-publish \
  --county seminole \
  --input-parquet <current-overlay.parquet> \
  --thin-overlay \
  --dry-run
```

The thin shortcut requires its own exact-byte approval action,
`publish-thin-overlay-property-pages-and-overlay-query-table`. It retains the same
`<county>/hoa-pm/properties/` object prefix, `<county>/hoa-pm/query-table.parquet`
table key, and `oracle-query-table-<county>-hoa-pm` label. Never combine
`--thin-overlay` with `--official-parquet`.

Publication remains human-approval gated. Plan the exact destination without network
writes:

```bash
cd skills/use-oracle/runtime
node bin/elephant-county.mjs hoa-pm-publish \
  --county broward \
  --input <enriched-dir> \
  --query-table-only \
  --dry-run
```

Do not remove `--dry-run` until the exact source query table, coverage JSON, and HOA/PM
object bundle are bound into a new approved publication manifest with action
`publish-query-table-coverage-and-resolvable-hoa-pm-objects`. A live run also requires
`--receipt <path>` so object-CID mappings and uploads resume safely. Never reuse an
approval for changed bytes. Use `--query-table-only` when another workflow owns
`objects.jsonl`; it publishes only the query table and coverage and leaves the object
key untouched.

## Mandatory subdivision reconciliation

Whenever the base county or identity query table gains or fills `subdivision`, sync the
existing `<county>-hoa-pm` overlay before enriching it. Never treat an overlay
`no_subdivision` result as permanent when the official table has non-empty subdivision
text. Copy only official text into blank overlay rows; preserve filled overlay values and
`hoa_flag`.

Use `--parcel-csv` to add official rows that belong to the bounded parcel slice but are
missing from the overlay. Keep all outputs outside git. Run this exact order:

Build the statewide HOA/PM index from the complete expanded quarterly Sunbiz archive and
the exact subdivision values present in the publication scope:

```bash
cd skills/use-oracle/runtime
node bin/elephant-county.mjs hoa-pm-index \
  --source-dir <expanded-cordata-dir> \
  --subdivisions <json-array-of-subdivision-names> \
  --quarter 2026Q3 \
  --output <statewide-hoa-pm-index-dir>
```

The index scans the complete statewide archive twice: once for ACTIVE HOA candidates and
once for their registered-agent companies. Do not substitute a ZIP-filtered county extract.

```bash
cd skills/use-oracle/runtime
node bin/elephant-county.mjs hoa-pm-overlay-sync \
  --county <county> \
  --overlay-parquet <current-hoa-pm-query-table.parquet> \
  --official-parquet <official-or-identity-query-table.parquet> \
  --parcel-csv <bounded-parcel.csv> \
  --output-dir <sync-dir>

node bin/elephant-county.mjs hoa-pm-enrich \
  --county <county> \
  --input-parquet <sync-dir>/query-table.parquet \
  --input-coverage <current-hoa-pm-dataset-coverage.json> \
  --sunbiz-extract <sunbiz-extract-dir> \
  [--sunbiz-pm-extract <full-active-sunbiz-dir>] \
  --ctmh-extract <ctmh-extract-dir> \
  --output-dir <output-dir>

node bin/elephant-county.mjs hoa-pm-publish \
  --county <county> \
  --input <output-dir> \
  --query-table-only \
  --dry-run
```

Stop after the dry run. Never write `<county>/query-table.parquet`, move the official
`oracle-query-table-<county>` IPNS name, or remove `--dry-run` without the separate durable
human approval.

`hoa_pm_status` is Donphan's miss channel. Misses stay explicit: `no_subdivision`,
`no_sunbiz_hoa`, `no_ctmh_condo`, `no_ctmh_coop`, `no_ctmh_timeshare`, `not_unique`,
`ctmh_not_in_sunbiz`, `sunbiz_not_unique`, `no_agent_company`, `agent_not_in_sunbiz`.
Do not invent an HOA from subdivision name alone.

## DBPR CTMH condo identity

Condo associations come from the official Florida DBPR CTMH public-records page, not
from Sunbiz companies named `CONDOMINIUM ASSOCIATION`:

https://www2.myfloridalicense.com/condos-timeshares-mobile-homes/public-records/#1506105905579-f9864587-f7ca

Official extracts (quote/comma CSV with a header row; refreshed 2026-09-05):

| File | URL | Bytes | SHA-256 | Data rows |
| --- | --- | ---: | --- | ---: |
| `Condo_NF.csv` | `https://www2.myfloridalicense.com/sto/file_download/extracts/Condo_NF.csv` | 558134 | `e4cb66d64fa427b007587135b9855e4e3ee9ccd6e19dcde23fc4844eea9796ee` | 2142 |
| `condo_CE.csv` | `https://www2.myfloridalicense.com/sto/file_download/extracts/condo_CE.csv` | 856903 | `d70f3fedba265b14d8c3fa80819ae2835240a9786623723aff5b8c1d3f29eb33` | 3311 |
| `Condo_CW.csv` | `https://www2.myfloridalicense.com/sto/file_download/extracts/Condo_CW.csv` | 2439800 | `3254e5dc51db17367f810556fc548385ba3e402d970ca4c351b77e67bcb9a233` | 9344 |
| `Condo_MD.csv` | `https://www2.myfloridalicense.com/sto/file_download/extracts/Condo_MD.csv` | 1434926 | `da5f3914a68efa1350c46c5039c29dad0708fd99caa9811fb278703bf59b2811` | 5820 |
| `condo_PB.csv` | `https://www2.myfloridalicense.com/sto/file_download/extracts/condo_PB.csv` | 1941692 | `7deb1ceb5a718a55bf62843d0b519da0065f34ef3eabb9480fd5a5af163bc1f3` | 7352 |
| `coopmailing.csv` | `https://www2.myfloridalicense.com/sto/file_download/extracts/coopmailing.csv` | 191918 | `4bdf1aaf8f127f6cc8f99b7fd5cc99da9fb05f39c51c41dbd062cc3e49a31e1f` | 760 |
| `tsmailing.csv` | `https://www2.myfloridalicense.com/sto/file_download/extracts/tsmailing.csv` | 190928 | `d79b2a76192724b7dfe152730f2eaded161160848dd3f3b337edf64a76c1c5a2` | 729 |
| `multitsmailing.csv` | `https://www2.myfloridalicense.com/sto/file_download/extracts/multitsmailing.csv` | 9985 | `340cb4b8631c879bdda37b10e8e383733bf40990e550adebf132db2226ea1434` | 41 |

The same public-records page also publishes conversion, notice-of-intended-conversion,
mobile-home park, yacht-broker, payment-history, and summary extracts. Do not index
those for HOA identity: `condo_conv.csv` is a 100% subset of the regional condo
mailing lists; `noic.csv` names developers, not managing entities; `mhmailing.csv`
names parks and owners, not associations; payment-history and summary reports do
not uniquely identify an association the same way.

Condo columns: `Project Number`, `File Number`, `Condo Name`, `County`,
`Street City State Zip`, `Units`, `Recorded Date`, `Primary Status`,
`Secondary Status`, `Managing Entity Number`, `Managing Entity Name`, plus managing-entity
address fields. Unique match is fail-closed on the intersection of subdivision /
legal-text community keys with `Condo Name` and `Managing Entity Name`, scoped to
**that parcel’s county**. Multiple buildings that share one managing-entity number
collapse to one association. A CTMH row with no county cannot match a parcel whose
county is known and cannot break a tie. A statewide-unique hit in a different county
is a miss, not a steal. Two in-county hits stay `not_unique`. Never
fuzzy / edit-distance.

CTMH is the **identity** source for condos. Sunbiz is the **corporate / PM** source
for that same entity. Join fail-closed: exactly one ACTIVE Sunbiz company whose full
normalized legal name or association base equals the CTMH managing-entity / project
name (THE/INC stripped; `CONDOMINIUM ASSOCIATION` / `CONDO ASSOC` suffix stripped).
Prefer HOA/condo-marker companies when more than one name matches. A unique join
stamps `hoa_sunbiz_document_number` and then runs the existing registered-agent
**company** → PM lookup. If CTMH is unique but Sunbiz is 0 or >1, **keep the CTMH
HOA**, leave `hoa_sunbiz_document_number` null, and set `ctmh_not_in_sunbiz` or
`sunbiz_not_unique`. Do not invent a document number from the CTMH project number.

`Managing Entity Name` can fill PM when it uniquely matches a **different** ACTIVE
Sunbiz company (typical when the registered agent is a person). If the managing
entity is the association itself, it is not stamped as PM.

For rows that already have an HOA (CTMH or Sunbiz), look up a company registered
agent by exact legal name in the full ACTIVE Sunbiz company set — not only the
HOA-marker index. Person agents stay `no_agent_company`. Do not invent PMs.

## Ownership-estate gate

`ownership_estate_type` filters both the CTMH mailing pool and Sunbiz HOA
candidates. Do not infer estate type from `property_usage_type`, DOR codes, or the
subdivision string. Do not union condo + coop + timeshare into one pool.

Do not index payment-history, NOIC, yacht, mobile-home, or summary reports.
Conversion extracts remain optional; they are a 100% subset of the five condo files
and must collapse to one association when the project number repeats.

| `ownership_estate_type` | Candidate pool |
| --- | --- |
| `Condominium` | The five regional condo CSVs only (`Condo_NF`, `condo_CE`, `Condo_CW`, `Condo_MD`, `condo_PB`). |
| `Cooperative` | `coopmailing.csv` only. |
| `Timeshare` | `tsmailing.csv` + `multitsmailing.csv` only. |
| `FeeSimple`, `Leasehold` | No CTMH. Sunbiz HOA path only. |
| missing / unknown | Unique **condo** first; if no unique hit, unique **coop**; if none, unique **timeshare**. A condo `not_unique` does not fall through. Then rematch a unique association to Sunbiz. If every CTMH pool misses, existing Sunbiz HOA path (estate still filters Sunbiz `CONDOMINIUM ASSOCIATION` vs homeowners-marker companies, including the legal-text condo collision filter). |

Stamp `homeowners_association_type` on the HOA object and overlay row: `Condominium`
when the estate, CTMH kind, or matched company is a condominium association,
otherwise `Homeowners` (or `Cooperative` / `Timeshare` when that is the estate or
CTMH kind). Missing estate does not guess condo from DOR codes. Pinellas already
maps estate type in the transform and exports it on the query table. Other counties
stay without the column until they export it; those slices still unique-match CTMH.

## Deterministic HOA-name normalization

Apply these rules in order. Keep a unique **legacy** match unchanged (original tract-prefix
and trailing 1–3 digit / UNIT|PHASE|SEC strip plus the original HOA-name markers). Use the
expanded normalization only when the legacy matcher finds no company. If the legacy matcher
finds more than one company, keep `not_unique` — do not pick a “better” normalized name.
A community name extracted from legal text is an expanded exact-base candidate only — never
a legacy substring needle.

1. Fold case, punctuation, apostrophes, whitespace, and `&` / `AND`.
2. Remove a leading 3–6 digit tract code from the subdivision.
3. Canonicalize `PH` / `PHASE`, `SEC` / `SECTION`, leading-zero numbers, and word numbers
   `ONE` through `TWENTY`.
4. Remove trailing `UNIT`, `PHASE`, `SECTION`, `PARCEL`, `NBHD`, or `VLG` plus its
   alphanumeric number; `REPLAT` / `PARTIAL REPLAT`; a bare trailing number or word
   number; and a trailing subdivision `CONDOMINIUM` designator.
5. On Sunbiz names, remove leading `THE`, trailing `INC` / `INCORPORATED`, and only these
   explicit association suffixes: homeowners/homeowner's/homeowners', condominium,
   property owners, community, or civic association; `ASSOCIATION`, `ASSOC`, `ASSN`,
   `POA`, `COA`, or `HOA`.
6. When `subdivision` is still a parcel legal description, extract a community token
   (below) and compare it as an exact association base.

Compare the resulting bases exactly. Do not use edit distance, token scores, or another
fuzzy fallback. Property-owner, community, and civic variants still require exactly one
ACTIVE candidate.

When `subdivision` is a parcel legal description rather than a community name, first
extract a community token by stripping only these deterministic legal wrappers:

- leading `LOT`/`LOTS` + numbers, `BLK`/`BLOCK` + id, book/page number pairs, and
  aliquot heads (`E 1/2 OF`, `ALL OF`)
- `S/D` / `SUBD` → `SUBDIVISION`
- trailing plat-book/page/`MB`/`OR`/`REC` cites, trailing `LOT` + number, and a bare
  trailing `PHASE`/`UNIT`/`SUBDIVISION`/`CONDO`/`CONDOMINIUM`

Do not extract from section-township-range (`SEC`/`TWP`/`RGE`), metes-and-bounds
(`COM`…`FT`), acreage “being part of” lines, or “recorded without legal” notes. A
single-token extract must be at least 5 letters and is matched by exact association
base only — never as a Sunbiz substring. An extracted legal token may not bind to a
unique `CONDOMINIUM ASSOCIATION` unless the subdivision text itself contains `CONDO`
or `CONDOMINIUM`. Clean community-name subdivisions may still match a unique condo
association. Fail closed if the extract is empty or not unique.

For statewide collisions, use principal-address county only when the evidence is explicit:
accept one same-county candidate only when every alternative has an explicit conflicting
county. Missing geography does not break a tie, so the result remains `not_unique`.

Sunbiz can contain duplicate ACTIVE filings for one identical normalized legal name. When
all otherwise-plausible rows have the same normalized legal name for the same subdivision,
collapse them to one association. Retain the earliest `filedDate` when available; otherwise
retain the lexicographically lower document number. This handles the two ACTIVE
`VILLAGES OF WESTPORT HOMEOWNERS ASSOCIATION, INC.` filings deterministically while still
failing closed for differently named plausible associations.

## DoD evidence (this pass)

Observed **Fri Sep 11 2026, 1:35 PM PDT**. Official quarterly Sunbiz `cordata.zip`
from `Public@sftp.floridados.gov:doc/quarterly/cor/cordata.zip` (SFTP, not a
fallback archive). Scratch artifacts stayed on `/Volumes/mrnda 2tb` and are
**not** in git.

| Artifact | Value |
| --- | --- |
| Zip bytes | `1819049954` (size stable after SFTP exit 0) |
| Zip SHA-256 | `ddaa7c4d8f9e217dfe73f05a35f81e0842e47a365d34dc709dcede868f798a56` |
| `unzip -l` | 10 `cordata*.txt` files, `18469418632` expanded bytes |
| `sunbiz-prepare` | PASS (digest + `unzip -t` + extract) |
| Index | Florida-wide **ACTIVE** HOA-marker + exact-subdivision + registered-agent companies. **Not** ZIP-filtered `sunbiz-filter`. |
| Source records scanned | `12,808,196` (`invalidRecordCount` 0) |
| ACTIVE companies | `4,109,232` |
| Index extract size | `21,058` companies (`20,247` HOA/exact + `832` agent companies) |

Bounded Duval join of
`florida_scope2_ever_owned_properties_2026-09-10.csv` (18,188 distinct APNs)
to the published Duval query table (403,885 rows): **1,330** APNs matched,
including `1605480000`. `hoa-pm-enrich` used county-agnostic Parquet schema
infer on that bounded slice.

`hoa_pm_status` counts (1,330 properties):

| Status | Properties | `hoa_cid` | `property_manager_cid` |
| --- | ---: | ---: | ---: |
| `no_sunbiz_hoa` | 965 | 0 | 0 |
| `not_unique` | 196 | 0 | 0 |
| `matched` | 66 | 66 | 66 |
| `agent_not_in_sunbiz` | 57 | 57 | 0 |
| `no_agent_company` | 46 | 46 | 0 |

Local objects JSONL: 404 rows (`169` HOA association + `169` HOA company +
`66` property-management company). CIDs are `sha256:<hex>` of the canonical
payload **before** the `cid` field. Nothing uploaded DAG objects to IPFS /
Filebase.

### APN `1605480000` (in-scope, not matched)

Live MCP Duval schema is still **40 columns** (`subdivision` and `hoa_flag`
present; no `hoa_cid` / `property_manager_cid` / `hoa_pm_status`) until an
approval-gated republish.

| Field | Live published | Local bounded enrich |
| --- | --- | --- |
| `parcel_identifier` | `1605480000` | `1605480000` |
| address | `11659 JONATHAN RD` | `11659 JONATHAN RD` |
| `subdivision` | `02944 BEACON HILLS & HARBOR 01` | same |
| `hoa_flag` | NULL | NULL (heuristic does not write it) |
| `hoa_pm_status` | column absent | `no_sunbiz_hoa` |
| `hoa_cid` / `property_manager_cid` | column absent | NULL |

Statewide ACTIVE index has no HOA-marker company whose normalized name
contains `BEACON HILLS AND HARBOR`. Nearby Sunbiz rows (`BEACON HILLS CIVIC
ASSOCATION , INC.`, `BEACON HILLS HARBOR INC`) are **INACTIVE** and fail the
HOA-name markers. This is an honest miss, not a CID stamp.

### Sample local CIDs from a matched in-scope APN

APN `0062233035` / subdivision `04427 MARIETTA FORREST UNIT 01` /
`hoa_pm_status=matched`:

| Object | `data_group` | Local CID |
| --- | --- | --- |
| `homeowners_association` MARIETTA FORREST HOMEOWNERS ASSOCIATION, INC. (`N28433`) | `HOA_` | `sha256:6f1b762cdca5ffa5f80a4fc1c017e0df7fc3629619c4d6b42a07442389667ed4` |
| HOA `company` | `HOA_` | `sha256:52a75a2abf50703b68291cdc5de303b811bdb82cdbed68c4a14373758ebc5fad` |
| Manager `company` LIFESTYLES PROPERTY SERVICES, LLC (`L14000161770`) | `Property_Management` | `sha256:78d62c5976c8866955c42d3cee29d35c4dd6f65b96a6e98102a7b485bb4acca8` |

### Donphan SQL that would work after republish

Do **not** run this against live MCP today: `getPropertyQuerySchema` for Duval
still lacks the columns. After `Publish/duval/approve` and `tick` upload of the
enriched query table:

```sql
SELECT
  parcel_identifier,
  subdivision,
  hoa_flag,
  hoa_pm_status,
  hoa_cid,
  hoa_name,
  hoa_sunbiz_document_number,
  property_manager_cid,
  property_manager_name,
  property_manager_sunbiz_document_number
FROM properties
WHERE parcel_identifier IN ('1605480000', '0062233035');
```

Expected after republish: `1605480000` stays `no_sunbiz_hoa` with NULL CIDs;
`0062233035` shows the local `sha256:` values above until an object-upload
path replaces them with IPFS CIDs.

Fixture path (runtime tests, synthetic Sunbiz): property `1605480000` +
subdivision `Example Subdivision` still stamps synthetic `sha256:<hex>` links.
That fixture is not the official archive result.
