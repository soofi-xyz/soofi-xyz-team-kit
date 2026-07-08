# Exploration patterns

These patterns use **MCP tools only**. There is no bulk search API — always state how many
records you inspected versus total dataset size from `getOracleDatasetInfo`.

## Reference bounding boxes

Use `findPropertiesInArea` with a `bbox` unless the user supplies a polygon.

### Lee County, FL

| Area | minLat | minLng | maxLat | maxLng | Notes |
|------|--------|--------|--------|--------|-------|
| Fort Myers (city core) | 26.50 | -81.92 | 26.68 | -81.78 | Good default for "Fort Myers" |
| Lee County (wide) | 26.30 | -82.35 | 26.95 | -81.55 | Large; many properties |

### Miami-Dade County, FL

| Area | minLat | minLng | maxLat | maxLng | Notes |
|------|--------|--------|--------|--------|-------|
| Downtown Miami | 25.75 | -80.22 | 25.79 | -80.18 | Dense urban core |
| Miami (city-wide) | 25.70 | -80.35 | 25.87 | -80.12 | Good default for "Miami" |
| Miami-Dade (wide) | 25.14 | -80.88 | 25.98 | -80.12 | Very large; prefer city bbox |

Tune bbox if results look wrong; report the bbox you used.

## Practical caps

To keep sessions responsive:

- After `findPropertiesInArea`, cap `getOracleProperty` fetches at **200** unless the user
  explicitly needs exhaustive enumeration (warn about time).
- For county-wide `listOracleProperties` scans, cap at **500–1000** property fetches per
  answer unless the user accepts a longer run.
- Always report: `inspected N of M properties in scope`.

## Pattern 1: Sub-par electric contractors

**Example:** "How many sub-par electric contractors?"

1. `getOracleDatasetInfo` — confirm county and scale.
2. Define **sub-par** explicitly (default if user omits):
   - BBB `bbbRating` in `C`, `D`, `F`, or `NR`
   - OR `ratingScore` &lt; 3.0 when numeric
   - OR `contractorQualityScores` below team threshold when present
3. Define **electric contractor**:
   - BBB `businessReputationCategories` / `categoryName` contains `electric` (case-insensitive)
   - OR Sunbiz NAICS / business description mentions electrical contracting
4. Fetch strategy:
   - County-wide: paginate `listOracleProperties` OR sample geo tiles across Lee County
   - Prefer multiple smaller bboxes if county-wide is too large
5. `getOracleProperty` on each candidate → scan BBB and linked contractor blocks.
6. Return: count, list of business names + parcel links, filter definition, sample size.

**Note:** BBB profiles may attach to permits/properties via enrichment — one property may surface
multiple contractors; count businesses, not parcels, unless the user asks per-property.

## Pattern 2: Commercial properties with nail salons in Fort Myers

**Example:** "List all commercial properties with nail salons in Fort Myers."

1. `getOracleDatasetInfo`
2. `findPropertiesInArea` with Fort Myers bbox (table above)
3. For each hit (up to cap), `getOracleProperty`
4. **Commercial property** signals (appraisal / property):
   - `propertyType` / `propertyUsageType` commercial indicators
   - `zoning` commercial codes when present
5. **Nail salon** signals (Sunbiz / business on site):
   - `companies` / `businessRegistrations` legal name or description contains `nail`
   - NAICS `812113` (nail salons) when present in registration metadata
   - Permit descriptions mentioning nail salon (secondary signal)
6. Return: parcel ID, site address, business name, evidence fields, count found vs area total.

## Pattern 3: Address mismatches

**Example:** "Find properties with address mismatches."

1. `getOracleDatasetInfo`
2. Narrow scope: user-named city (bbox) or paginated sample if county-wide
3. `getOracleProperty` on candidates
4. Compare normalized keys when available:
   - Appraisal site address vs permit `unnormalizedAddress` / permit search fields
   - Appraisal vs Sunbiz `businessRegistrationAddresses`
   - `normalizedAddressKey` / `normalizedAddressHash` inequality across sources
5. Flag **mismatch** when:
   - Normalized keys differ across sources, OR
   - Same parcel but materially different `cityName`, `streetName`, or `postalCode`
6. Return: parcel ID, each source address string, which fields diverged, count in sample.

See [`consolidated-property-shape.md`](./consolidated-property-shape.md) for field paths.

## Pattern 4: Permit gap on a known parcel

1. `getOracleProperty` — if `permits` empty or stale
2. `getPropertyPermits` with `parcelId`
3. If response indicates harvest in progress, wait ~90s and retry once
4. Re-fetch consolidated data or use permit payload from tool response

## Honest limitations

- No server-side filter for business type or BBB rating — client-side filtering after fetch.
- Geo index uses property **centroid** only (not building footprint).
- Dataset may lag live county portals — cite `exportedAt` / `completedAt` from dataset info.
- For heavy analytics (joins, SQL, dashboards), hand off to `use-elephant-query-db`.
