---
name: florida-nal-publish
description: "Build full-county Atlas `county` archives for Florida from the Florida DOR NAL tax roll: one deterministic transform for all 67 counties, sharded parallel validation, one CAR per county, tables and the Atlas page entry. Use when publishing or deepening a Florida county in Atlas, when a Florida page holds only a short property list, or when asked to get Florida property coverage into Atlas quickly."
metadata: {"author":"elephant-xyz"}
---
# Florida NAL Publish

Florida publishes every county's property roll in one statewide format: the Department of
Revenue Name-Address-Legal (NAL) file. Build Atlas `county` archives from it directly. Do not
scrape appraiser portals for appraisal data a Florida NAL file already holds.

The transform reproduces the records the earlier Oracle NAL runs published, byte for byte:
`scripts/parity-check.sh` regenerates the Hardee property registered in Atlas PR #85 and
requires the same property CID, County data CID and archive root.

## Files

| File | Purpose |
|---|---|
| `scripts/fl-counties.json` | All 67 counties: DOR file URL (verified), roll (Final or Preliminary), lexicon `county_name`, FIPS, Atlas slug |
| `scripts/nal-to-lexicon.mjs` | NAL CSV → one lexicon property folder per parcel (Seed + County groups) |
| `scripts/parity-check.sh` | Golden-record check against the published Hardee archive |
| `scripts/run-county.sh` | Download → generate (sharded) → parity → parallel validate → one CAR → tables (+ Atlas page) |

## Records produced

Every record carries `request_identifier` = `PARCEL_ID` and `source_http_request` =
`{"method":"GET","url":"<the county's DOR NAL zip>"}`.

| Group | Class | NAL columns |
|---|---|---|
| Seed | `parcel` | `PARCEL_ID` |
| Seed, County | `address` | `PHY_ADDR1` `PHY_ADDR2` `PHY_CITY` + `FL` + `PHY_ZIPCD` as `unnormalized_address`; lexicon `county_name` |
| County | `property` | `PARCEL_ID`, `S_LEGAL`, `ACT_YR_BLT`, `EFF_YR_BLT`, `TOT_LVG_AREA`, `LND_SQFOOT`, `property_type` from `DOR_UC` / buildings |
| County | `lot` | `LND_SQFOOT` |
| County | `tax` | `JV` market, `AV_SD` assessed, `LND_VAL` land, `TV_NSD` taxable, `ASMNT_YR` year |

`property_type`: `DOR_UC` 004/005 → `Unit`, 002 → `ManufacturedHome`, any building or living
area → `Building`, otherwise `LandParcel`. Areas under 10 square feet become null (the
lexicon requires two or more digits).

## Run one county

Requirements: Node 22+, `elephant-cli` 1.58.1+, `python3`, `curl`, `unzip`. Disk: about 15 GB
per 400k parcels while the run is in progress.

```bash
S=skills/florida-nal-publish/scripts
$S/parity-check.sh "$WORK"                       # once per machine or CLI upgrade
$S/run-county.sh duval --work "$WORK" --shards 16 --atlas ./atlas
```

`--limit N` builds a sample. `--car-validate` adds a full CAR validation after hashing; it is
slow (about 10 properties per second) and Atlas runs its own check, so use it only when a shard
validation result is in doubt. The run writes `$WORK/<slug>/summary.json` with the property
count, source URL and sha256, archive root, tables root and duration.

Stop when parity fails or any shard reports a validation error. Fix the transform; never edit
generated folders or the CAR by hand.

## Throughput (measured on an 18-core Mac, Duval)

| Step | Rate | 400k parcels |
|---|---|---|
| Generate | ~1,800 parcels/s | ~4 min |
| Validate (one process) | ~10 parcels/s | ~11 h |
| Validate (16 shards) | ~160 parcels/s | ~45 min |
| Hash to one CAR | ~150 parcels/s | ~45 min |

Validation is the bottleneck; always shard it. Counties are independent: run several at once
when cores allow, or one per AWS Batch job.

## Publish

Pinning and registration follow `use-oracle/reference/car-publication.md`:

1. `elephant-cli upload <slug>-county.car --api https://rpc.filebase.io` and the same for the
   tables directory, with Filebase credentials, keeping both upload summaries.
2. One Atlas PR per county touching only `counties/FL/<slug>.json`. The `county` group
   replaces the earlier short-list group; other groups on the page stay.
3. A code owner merges. Record the row in the publication ledger; it is complete only when
   Atlas `validate` passed, the PR merged and the live index lists the new archive root.

Large archives depend on Atlas `validate` reaching a gateway that serves whole CARs. When
`validate` reports `terminated` or "not available from any gateway", the archive is fine;
the check needs the dedicated gateway (`ATLAS_GATEWAYS`) or a longer fetch limit.

## Source notes

- Five counties have only a 2026 Preliminary roll on the DOR portal (DeSoto, Escambia,
  Flagler, Holmes, Liberty); Jackson has no 2026 NAL file. `fl-counties.json` records this.
- DOR spells three file names its own way: `Dade`, `Saint Johns`, `Saint Lucie`.
- Keep `PARCEL_ID` exactly as the roll gives it. Permit portals may use another format;
  join permits through alternate identifiers, not by rewriting the parcel identifier.
- Use candidate or third-party county datasets only as a completeness cross-check.
