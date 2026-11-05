# Scope of work

Audit date: 2026-11-05. Counts are what the submissions claim in their manifests, coverage
files, or PR bodies unless marked **(verified)**. Re-measure every count in step 4 of the
runbook before using it as a gate.

## What the job delivers

For every county below: one Atlas page whose data groups hold the **union of every usable
candidate submission**, re-keyed to one property identity, validated against the live
lexicon, merged, and answering the acceptance queries through the Elephant MCP.

Out of scope: grading candidates, changing candidate repos, publishing any field the
lexicon has no class for (hail events, embeddings, owner "signals", confidence scores),
and building new permit harvesters beyond the gap slices the acceptance criteria name.

## Findings that shape the work

- **Few submissions are in lexicon format.** Travis (HebaGaber, xucian, richardreid1811),
  Santa Clara (qschachl-creator, 494,841 properties, CAR not pinned) and Rock Island
  (liesislukas, 1,830 of 65,955 parcels transformed). Every other submission is custom
  Parquet, DuckDB, or JSON, so most of the work is converting provenance-carrying rows to
  lexicon records with `build-county-transform`.
- **A legacy pre-Atlas Santa Clara publication exists** (IPNS
  `k51qzi5uqu5dgnc94h8ce98ds0cb5yoidmcebpwnvccug4upasgbzpyz3ffgs5` and
  `k51qzi5uqu5dm5dkii3wz7hj8vqurb1b773uy0qj9nlvsvgaqqyccuurz8kmic`). Its permit table has
  shifted CSV columns and missing APNs. Use it only as a dedupe cross-check.
- **Atlas Florida pages are pilots.** The published and open Oracle pages cover a property
  list of 33 to ~1,100 parcels. Candidate submissions cover the full county (180k–490k
  parcels), so the repair raises those counties by two to four orders of magnitude.
- **Some submissions contain fabricated rows.** Duval #4 (trasgo-furioso) generates
  permits, BBB, and Sunbiz with `Math.random`; Chester #3 (reperis) ships 23,451 synthetic
  roofing permits tagged `provenance_tier='synthetic'`. Exclude them (Rule: no synthetic
  rows) and list them in `excluded.csv`.
- **Public gateways rate-limit.** `ipfs.io` and `dweb.link` answered 429 to every audit
  request; `ipfs.filebase.io` served most candidate CIDs. Fetch through the dedicated
  gateway and Filebase; record unretrievable CIDs as `lost` and recover from the
  submission's Git copy where one exists (Brevard).
- **Three open Atlas PRs fail `validate` for delivery reasons, not data:** #72 Pasco and #74
  Lake (CAR stream terminated), #77 Duval (malformed Filebase CAR export). #70 Seminole is
  approved but needs a rebase to regenerate `index.json`. Use the single-file `car` field
  (Atlas #90) and the dedicated gateway, as Travis did.

## County scope

Order is the execution order. "Basis" is the proposed Seed basis for the `county` group.

| # | County | Atlas today | Submissions to use (repo PR, author) | Basis and targets | Blockers |
|---|---|---|---|---|---|
| 1 | Travis, TX (48453) | `county` 441,961 published; `property_improvement` 1,986,694 permits / 237,540 properties in Atlas #86 (validate green, review needed) | #4 HebaGaber (county, 15,025 roofing permits with contractor edges), #2 xucian (permits), #5 richardreid1811 (16,217 roofing permits with contractor, 10,741 Comptroller-resolved contractors, 54,784 licenses), #6 curiousily (339 BBB grades from Wayback, 19,064 roofing permits with contractor) | Basis HebaGaber. Add contractor edges to permits; contractors/licenses; Overture places (93,331, prefer `overture-places-ingest`) | Merge #86 first. Close superseded Atlas #83. No non-Austin permits in any submission (Lakeway 42,764 indexed, 0 loaded) |
| 2 | Seminole, FL (12117) | Atlas #70 open, approved, 1,145 properties, stale `index.json` | #1 utkuozdil | 181,218 parcels (100% coordinates); ~522k permits (publish status only where known); 26,446 places; 437 BBB businesses | Rebase #70, then supersede with full county |
| 3 | Lake, FL (12069) | Atlas #74 open, 934 properties, validate failing (CAR stream) | #2 rarcifa (latest; #1 earlier draft) | 215,806 parcels **(verified)**; 76,166 permits (Clermont eTRAKiT 58,495 + county 17,671); 37,020 sales; 33,346 businesses | Gateway delivery for the CAR |
| 4 | Osceola, FL (12097) | Published pilot `county` (~836) + `property_management` | #1 alexarsh | 210,853 properties **(verified)**; 317,331 permits **(verified)**; 4,595 contractors; 19,057 places; 285 BBB | Pilot page is merged; supersede its `county` group |
| 5 | Brevard, FL (12009) | Published pilot `county` (33 properties) | #1 apantovic (closed) | 347,497 properties **(verified)**; 434,643 permits **(verified)**, 363,362 matched to parcels; 32,120 businesses; 155 contractors | Candidate CIDs do not resolve; rebuild from the Parquet committed under `data/v/2026-09-04.*` |
| 6 | Duval, FL (12031) | Atlas #77 open, 3,022 properties, validate failing (CAR export) | #5 m-ratnikov (primary bulk), #3 NetoBoralli (retrievable fallback for NAL/SDF/geometry), #1 jzubielik (only real permits and BBB; lexicon transform handler). **Exclude #4 trasgo-furioso (mock data)** | Denominator 398,315 RE# (FDOR NAL, `R` suffix). Targets ~398k properties, 403,813 with coordinates, 71,802 sales, ~324k owners, 4,050 DBPR contractors, 66,666 places | #5 query-table CID not retrievable now; permits 0–1,604 (JaxEPICS WAF; #1 rows sit in a private database) |
| 7 | Pasco, FL (12101) | Atlas #72 open, 1,040 properties, validate failing (CAR stream) | #1 amirhf | 325,213 parcels; 276,649 buildings; 322,261 owners | No permits in the submission (Accela developer account); coordinates only 24,995, fill from county GIS |
| 8 | Oakland, MI (26125) | No page | #1 th3Wh1t3Rabbit | 490,799 properties **(verified)**; 39,282 permits | New page; PIN → lexicon transform |
| 9 | Nassau, NY (36059) | No page (Atlas `FL/nassau` is a different county) | #1 edgar-arturo-arrizon | 426,460 properties; 4,561 Oyster Bay permits (3,986 linked); 78,054 places; 409,304 corporations | Provenance partial (origins empty); check per-row source URLs before converting |
| 10 | Chester, PA (42029) | No page | #3 reperis (closed; primary), #4 sebastianconcept (153 West Chester SmartGov UCC permits), #2 cc-bb-aa (952 permits, 356 contractors). **Strip all synthetic rows** | ~193,287 parcels (UPI); ~192.7k owners; ~182k sales; ~49k real EnerGov permits; 103,637 PA DOS businesses | **License:** county GIS parcels are CC BY-NC-SA with a redistribution restriction. Get a written decision before publishing |
| 11 | Santa Clara, CA (06085) | No page | `...-santa-clara-ca` #1 qschachl-creator (lexicon parcel backbone; basis), #2 mikhalenia (closed; 93,093 San Jose permits, 8,920 contractors); `...-pipeline-completion` #2 chillymagician (52,157 Palo Alto permits), #1 arthurckw (Palo Alto sales, mailing, year built). #3 joaqorm55: reuse the CSLB contractor loader only. #4 EranTenenboim and #6 evereq add no new data | 494,841 properties (GIS 504,717 features, 9,876 without APN); ~145k permits (San Jose 93k + Palo Alto 52k); ~9k contractors | qschachl CAR (2.88 GB) is unpinned: recover it or re-run his committed transforms against `ubcd-cewv`. arthurckw's node is offline. 14 of 16 permit jurisdictions have no data. Owner names unavailable countywide (CA) |
| 12 | Rock Island, IL (17161) | No page | #2 liesislukas (lexicon transform; basis; 25,354 City of Rock Island permits), #1 mariusfrt (65,956-row Parquet **(verified)**: coordinates, year built, sale dates, proximity columns) | 65,955 properties; 25,354 permits (98.4% linked); ~49.9k owner entities; ~46k sales | Finish the transform for the remaining 64,125 parcels (33 source requests). PIN is not unique (65,813 distinct): decide the join key before seeding. liesislukas has no CIDs; permits are JSON in the repo |

46 other assignment repos have no submission and are out of scope until one arrives.

## Atlas-side quick wins (do first, in parallel with county 1)

1. Get Atlas #86 reviewed and merged; close #83.
2. Rebase Atlas #70 so `index.json` regenerates.
3. Re-run validate for #72, #74, #77 with the single-file `car` field and the dedicated
   gateway. These pilots are later superseded by the full-county archives, but merging
   them first proves the delivery path for each county.
