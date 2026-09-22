# Atlas exploration patterns

Use MCP tools only. Discover scope, tables, and columns before querying. Every recipe
starts with `listAtlasCounties` → `getAtlasDatasetInfo` → `getAtlasSchema`.

## Count or group one class

```sql
SELECT status, count(*) AS records
FROM property
GROUP BY status
ORDER BY records DESC
```

Report scope and `source` CIDs.

## Find a property from a folio

1. Query `parcel` for the exact user-supplied `parcel_identifier` (or any entity
   table's `request_identifier`); return its `property_cid`.
2. Call `getAtlasProperty` with that CID.
3. If a separately disclosed normalized fallback was needed, report both the stored and
   supplied identifiers.

Never silently strip punctuation or use normalized parcel digits as folio identity.

## Join across classes

Relationship tables carry `from_cid`/`to_cid` (plus `relationship_cid`, `property_cid`,
`data_group_cid`); entity tables carry `cid` and `property_cid`. Example — properties with their mailing
address:

```sql
SELECT p.cid AS property_cid, a.street_number, a.street_name, a.city_name
FROM property p
JOIN property_has_address pha ON pha.from_cid = p.cid
JOIN address a ON a.cid = pha.to_cid
LIMIT 100
```

## Inspect permit evidence

1. Choose the data group that publishes permits (see `listAtlasCounties`).
2. Describe its permit/improvement class and its relationship tables.
3. Query exact permit, folio, status, work text, or company-edge fields, joining through
   the relationship tables.
4. Use `getAtlasProperty` to assemble one property when needed.
5. Keep unmatched permits and null company edges explicit.

Do not infer a contractor's legal identity from name, phone, address, BBB, or place data.

## Inspect official identity and enrichment

Query official corporate/licensing classes separately from BBB, places, HOA, and AVM
classes. Report the evidence class used. A shared name is not an identity edge.

For contractor quality: find permit contacts or accepted company CIDs, query reputation
rows linked to those exact CIDs, state whether the link was official or an unresolved
candidate, and count companies rather than permit or property duplicates.

## Address mismatch

1. Describe the address class and the relationship tables that reach it.
2. Query bounded rows for one property CID or folio.
3. Compare raw source addresses and typed fields.
4. Report the source, exact values, and mismatch rule.

## Area query

Use the bbox JOIN recipe in `tools-and-workflows.md` (property → property_has_address →
address_has_geometry → geometry, plus property_has_tax → tax for values). Report the
bbox, the row limit (1000), and that filtering is by the geometry point.

## Property assembly

`getAtlasProperty` returns the `property` row plus every class row reachable through
relationships, grouped by table, including shared entities, with `source`. Do not expect
a pre-2.0 consolidated document; discover tables first.

## Honest limitations

- One data group does not prove county-wide completeness.
- A missing table means the group did not publish it; an empty query means no rows
  matched that exact scope and filter.
- `queryAtlas` caps results at 1000 rows; paginate deterministically.
- Atlas reflects its synchronized index revision, not live county portals.
- Ingestion query DB rows not published through Atlas are intentionally unavailable.
