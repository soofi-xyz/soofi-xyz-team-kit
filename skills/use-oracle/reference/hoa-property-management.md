# HOA and property-management heuristic

Oracle resolves HOA and property management for published query-table rows by reading
subdivision, looking up a unique Florida Sunbiz company for that subdivision, then
reading the HOA company's registered-agent / communication company and looking that
company up in Sunbiz.

This does **not** set `hoa_flag` (Chapter 720 membership stays on `hoa-enrich`).

## Objects and CID stamps

Relationships are CID fields on the referencing object, not graph edges.

| Object | Data group | CID fields |
| --- | --- | --- |
| `property` | County query table / property | `hoa_cid`, `property_manager_cid` |
| `homeowners_association` | `HOA ` | `company_cid`, `property_manager_cid` |
| `company` (HOA legal entity) | `HOA ` | `sunbiz_document_number` |
| `company` (manager) | `Property Management` | `sunbiz_document_number` |

Local object CIDs are `sha256:<hex>` of the canonical payload before the `cid` field.
IPFS publish replaces those with Filebase CIDs when the objects are uploaded.

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

Misses stay explicit: `no_subdivision`, `no_sunbiz_hoa`, `not_unique`, `no_agent_company`,
`agent_not_in_sunbiz`. Do not invent an HOA from subdivision name alone.

## DoD evidence (this pass)

Published Florida query tables already expose `subdivision` (and sometimes `hoa_flag`).
They do **not** yet expose `hoa_cid` / `property_manager_cid` until `hoa-pm-enrich` runs
and the county parquet is republished.

Example in-scope CSV APN on the **live** Duval table (2026-09-11):

| Field | Value |
| --- | --- |
| `parcel_identifier` | `1605480000` |
| address | `11659 JONATHAN RD` |
| `subdivision` | `02944 BEACON HILLS & HARBOR 01` |
| `hoa_flag` | NULL (unchanged; not this heuristic) |
| `hoa_cid` / `property_manager_cid` | not on published schema yet |

Fixture path (runtime tests, synthetic Sunbiz): property `1605480000` + subdivision
`Example Subdivision` stamps `hoa_cid` and `property_manager_cid` as `sha256:<hex>`
Merkle links on the property object and writes HOA / Property Management JSONL objects.
Unmatched APNs wait for the other contributor’s parcels; that is not a fail for this pass.
