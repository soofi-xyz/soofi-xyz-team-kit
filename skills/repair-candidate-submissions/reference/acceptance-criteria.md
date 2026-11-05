# Acceptance criteria

A county is **delivered** when every gate below passes **as answered by the Elephant MCP**
after the Atlas merge and an MCP sync. A green Atlas PR, an upload, or a local archive is
not delivery.

## How targets are read

- **Target** = the count in [`scope-of-work.md`](./scope-of-work.md), re-measured in runbook
  step 4. If the re-measured validated count is lower than the claim, the re-measured count
  becomes the target and the difference is listed in `excluded.csv` by reason.
- **Pass** = the MCP count is at least **98% of target** for the `county` group and at least
  **95% of target** for every other group, **and** every record not published is accounted
  for in `excluded.csv` or `overlaps.csv` (zero unaccounted rows).
- **Coverage %** for the `county` group is reported against the official assessed-roll
  denominator, not against a submission's count.

## Gates for every county

| Gate | Pass condition |
|---|---|
| Inventory complete | Every PR (any state) and fork for the county is in the ledger with a disposition: used, partly used, or excluded with reason |
| Maximum coverage | Every submission that adds a parcel, permit, jurisdiction, contractor, or class missing from the others contributes it. The PR body shows records contributed per submission |
| One identity | One Seed basis; 100% of published properties in every group share the `county` group's property CIDs; unmatched rows listed |
| Validation | `elephant-cli validate` on each group directory: 0 errors. CAR validate: integrity, root, index, graph, lexicon, orphans all pass |
| Provenance | 100% of published records carry their original source request. 0 hand-filled URLs |
| No fabricated data | 0 rows from mock generators or rows tagged synthetic |
| Union proof | Inputs = published + overlaps + excluded, per group, exactly |
| Licensing | Source licence recorded for every group; any non-redistributable source has a written decision before the PR |
| Atlas | PR touches one county page; `validate` green; merged by a code owner; `publish` run green; global index lists the new CIDs |
| MCP | `listAtlasCounties` shows the county and groups; `getAtlasDatasetInfo` `source` CIDs equal the Atlas page and row counts equal `export-tables`; acceptance queries below meet target |
| Persistence | After an MCP restart the same queries return the same counts |

## Numeric targets per county

Queries run through `queryAtlas` with explicit `state`, `county`, `dataGroup`. Replace the
target with the step-4 re-measured count where it is lower and documented.

| County | `county` group properties | Permits (`property_improvement`) | Other required counts |
|---|---|---|---|
| Travis, TX | 441,961 (unchanged) | 1,986,694 permits on 237,540 properties | Roofing permits with a contractor edge ≥ 19,064; Comptroller-resolved contractors ≥ 10,741; licenses ≥ 54,784; BBB grades 339 (dated Wayback snapshots) |
| Seminole, FL | 181,218; coordinates on 100% | Permits ≥ 522,000; status set only where the source states it | Places 26,446 |
| Lake, FL | 215,806 | 76,166 (Clermont 58,495 + county 17,671) | Sales 37,020; businesses 33,346 |
| Osceola, FL | 210,853 | 317,331 | Contractors 4,595; places 19,057 |
| Brevard, FL | 347,497 | 434,643, of which ≥ 363,362 linked to a parcel | Businesses 32,120; contractors 155 |
| Duval, FL | ≥ 390,000 of the 398,315 RE# denominator | Every JaxEPICS permit recoverable from #1 (up to 1,604); a re-mine slice opened for the rest | Coordinates 403,813; sales 71,802; owners ≥ 320,000; DBPR contractors 4,050 |
| Pasco, FL | 325,213; coordinates ≥ 95% (from county GIS) | Not in scope until a permit source is available | Buildings 276,649; owners 322,261 |
| Oakland, MI | 490,799 | 39,282 | n/a |
| Nassau, NY | 426,460 | 4,561 (Oyster Bay; ≥ 3,986 linked) | Places 78,054; corporations 409,304 |
| Chester, PA | ~193,287 (after licence decision) | ~49,000 real EnerGov permits + 153 SmartGov UCC; 0 synthetic | Owners ~192,700; sales ~182,000; businesses 103,637 |
| Santa Clara, CA | 494,841 | ≥ 145,000 (San Jose ~93,093 + Palo Alto 52,157), deduplicated against the legacy table | Contractors ~8,920; Palo Alto sales and mailing location 20,912 if recoverable |
| Rock Island, IL | 65,955 | 25,354 (City of Rock Island), ≥ 98% linked to a parcel | Owner entities ~49,900; sales ~46,000 |

Places and business counts publish only through a lexicon data group that exists in the
live manifest (for Overture places, `overture-places-ingest`). Where no group exists, record
the count as a gap; it does not block delivery of the other groups.

## Whole-job criteria

- Every county in the scope table is delivered or has a written blocker with the next human
  action (licence decision, credential, source access).
- Total properties served by the MCP from candidate work rises from 441,961 (Travis only) to
  the sum of delivered `county` targets (about 3.8 million across the twelve counties).
- No candidate repo or PR was written to.

## MCP test questions (ask through `donphan`; each answer must cite Atlas `source`)

Per county, substituting the county name:

1. How many properties are in <county>? → the `county` target.
2. How many building permits are there in <county>? → the permit target.
3. How many <county> properties have at least one permit?
4. What are the most common permit types in <county>?
5. Show one <county> property with owner, sales history, and permits (`getAtlasProperty`);
   the permits belong to the same parcel id.
6. Which <county> properties have a roofing permit, and which contractor did the work?
7. How many <county> properties are owned by companies rather than people?
8. Which <county> properties have not changed owner in more than 10 years?
9. (Where coordinates exist) How many properties lie within 1 mile of <a point in the
   county seat>?

Record each answer, the query the agent ran, and the `source` CIDs in the county report.
