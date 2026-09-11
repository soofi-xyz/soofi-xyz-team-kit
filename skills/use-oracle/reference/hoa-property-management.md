# HOA and property-management heuristic

Oracle resolves HOA and property management for published query-table rows by reading
subdivision, looking up a unique Florida Sunbiz company for that subdivision, then
reading the HOA company's registered-agent / communication company and looking that
company up in Sunbiz.

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
They remain local hashes after enrichment. The approval-gated publication path uploads
the bundle and returns its Filebase CID; enrichment alone does not upload or replace
the row-level hashes.

## Publication destination

Use the existing shared query-table Filebase bucket with a separate dataset namespace:

- Bucket: `elephant-oracle-query-table` (shared by published counties; do
  not create a separate HOA/PM product bucket).
- Enriched table key: `<county>/query-table.parquet`.
- Enriched coverage key: `<county>/dataset-coverage.json`.
- HOA/PM object bundle key: `<county>/hoa-pm/objects.jsonl`.
- HOA/PM labels: `oracle-query-table-<county>-hoa-pm` and
  `oracle-dataset-coverage-<county>-hoa-pm`.

Always require the county in `runtime/catalog/published-counties.json`, then derive
the separate HOA/PM labels from that base county key. Permit profiles do not control
HOA/PM publication. Never update `oracle-query-table-<county>` or
`oracle-dataset-coverage-<county>` from this bounded enrichment path: those official
labels remain reserved for the full county publication.

The HOA/PM object bundle is CID-linked from the enriched query table and shares the
county's existing bucket under the county-scoped `hoa-pm/` prefix. Register the query
slice under the distinct MCP dataset key `<county>-hoa-pm`; it does not replace the
official county key.

Publication remains human-approval gated. Plan the exact destination without network
writes:

```bash
cd skills/use-oracle/runtime
node bin/elephant-county.mjs hoa-pm-publish \
  --county broward \
  --input <enriched-dir> \
  --dry-run
```

Do not remove `--dry-run` until the exact query table, coverage JSON, and HOA/PM object
bundle are bound into an approved publication manifest. This step does not upload.

## Command

```bash
cd skills/use-oracle/runtime
node bin/elephant-county.mjs hoa-pm-enrich \
  --county duval \
  --input-parquet <query-table.parquet> \
  --input-coverage <dataset-coverage.json> \
  --sunbiz-extract <sunbiz-extract-dir> \
  --output-dir <output-dir>
```

`hoa_pm_status` is Donphan's miss channel. Misses stay explicit: `no_subdivision`,
`no_sunbiz_hoa`, `not_unique`, `no_agent_company`, `agent_not_in_sunbiz`. Do not invent
an HOA from subdivision name alone.

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
