# Atlas exploration patterns

Use MCP tools only. Discover county, data group, tables, and columns before querying.

## Count or group one class

1. Call `listPublishedCounties`.
2. Call `getOracleDatasetInfo` with explicit scope.
3. Call `getPropertyQuerySchema` without `table`.
4. Select the normalized class table and describe it.
5. Call `queryProperties` with one aggregate `SELECT FROM properties`.
6. Report scope and source CIDs.

Example:

```sql
SELECT status, count(*) AS records
FROM properties
GROUP BY status
ORDER BY records DESC
```

## Find a property from a folio

1. Discover a table containing `request_identifier` or `parcel_identifier`.
2. Query the exact user-supplied value first.
3. Return the matching `property_cid`.
4. Call `getOracleProperty` with that CID.
5. Report exact stored and supplied identifiers if a separately disclosed normalized
   fallback was needed.

Never silently strip punctuation or use normalized parcel digits as folio identity.

## Inspect permit evidence

1. Choose the published permit/property-improvement data group.
2. Discover its normalized permit table.
3. Query exact permit, folio, status, work text, or company-edge fields.
4. Use `property_cid` to reconstruct one property when needed.
5. Keep unmatched permits and null company edges explicit.

Do not infer a contractor's legal identity from name, phone, address, BBB, or place data.

## Inspect official identity and enrichment

Query official corporate/licensing tables separately from BBB, places, HOA, and AVM
tables. Report the evidence class used. A shared name is not an identity edge.

For contractor quality:

1. find permit contacts or accepted company UUIDs;
2. query reputation rows linked to those exact company IDs;
3. state whether the link was official or only an unresolved candidate;
4. count companies, not permit or property duplicates, unless requested otherwise.

## Address mismatch

1. Discover address-bearing class and relationship tables.
2. Query bounded rows for one property CID or folio.
3. Compare raw source addresses and typed fields.
4. Report the source, exact values, and mismatch rule.

Do not treat address similarity as legal identity.

## Geo query

1. Discover a normalized table with latitude, longitude, parcel, and optional value
   columns.
2. Call `findPropertiesInArea` with explicit column names and one bbox or polygon.
3. For value sums, call `sumPropertyValueInArea` with the same scope.
4. Report that polygon filtering uses point coordinates and the result limit is 1000.

## Property reconstruction

`getOracleProperty` returns:

- property roots for the selected data group;
- normalized class rows grouped by table;
- normalized relationship rows grouped by table;
- source index/archive/tables/schema CIDs.

Do not expect a pre-2.0 consolidated document.

## Honest limitations

- One data group does not prove county-wide completeness.
- A missing table means the group did not publish it; an empty query means no rows matched
  that exact scope.
- Query SQL forbids JOIN and CTE. Use bounded separate queries and CID-based reasoning.
- Geo tools cap the selected rows at 1000.
- Atlas reflects its synchronized index revision, not live county portals.
- Query DB rows not published through Atlas are intentionally unavailable to public MCP
  consumers.
