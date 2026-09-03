---
name: county-readiness-preflight
description: "Fail-closed county readiness validator. Use before county-seed-data, county-ingest-run, onboard-county, or any pilot or full ingest. At the start of every new county, validates elephant-pipeline/docs/<county>-sources.yaml for GIS vs tax-roll, permit-jurisdiction classification, destination proof, records-request recipients, and BBB advertised-count traps."
---

# County Readiness Preflight

This skill is the **hard gate** in front of seed, pilot, and full ingest for **every**
county. It applies when the user invokes **`onboard-county` directly**, not only `/oracle`.

Do not treat a written checklist as sufficient. Run the validator. A non-zero exit is a
stop.

Start the independent preparation tracks at intake: full source/jurisdiction enumeration,
adapter fingerprinting and implementation scaffolds, AWS remote BBB execution setup,
destination proof, Filebase/IPNS readiness, and named request routing. This validator stops
seed, pilots, adapter scale-out, and full ingest; it does not stop that safe preparation.

## At the jump of every ingest

Before seeding, apply these rules to the county in front of you. They are county-agnostic
failure modes, not a list of special counties:

1. **GIS is not the property population.** Compare GIS feature count to the tax roll / NAL
   / assessed roll. Use the assessed roll as the canonical denominator unless an approved
   exception says otherwise. A material gap (default 2%) blocks GIS-only seeding. If GIS
   is below assessed, record `separately_assessed_without_geometry` (`acknowledged` or
   `none`) so condos and other units without unique polygons are not dropped.
2. **Permits are per jurisdiction.** Enumerate unincorporated, every municipality,
   delegated authorities, and required predecessor systems. Catalog count must match
   expected count. No row may remain `needs-review`. A matching parcel roll does not
   excuse an unclassified city.
3. **A county one-stop is not municipal history.** Do not set
   `assumes_unified_countywide_history: true`. Do not mark
   `portal_kind` `central-submission` / `onestop` / `supplemental-approval` /
   `application-intake` as `historical_records: true`. Supplemental county approvals are
   not complete municipal permits.
4. **Destination must be proven** before writes. Proven destinations need two
   independent identity sources (for example console project/branch plus configured
   branch and endpoint IDs). Copying IDs from the connection under test is not proof.
5. **Blocked, custodian-only, and manual-only permit rows need a complete
   `records_request`.** Name the recipient office, portal or email, system/date scope,
   and `api-first` or `records-first`. “Request a bulk export” without a recipient is
   BLOCKED.
6. **BBB advertised listing totals are not harvestable counts.** Do not set
   `expected_count` equal to `advertised_listing_count` unless `listing_page_cap` and
   `cap_acknowledged` are both true.

## Command

```bash
python3 skills/use-oracle/scripts/validate-county-readiness.py \
  <elephant-pipeline>/docs/<county>-sources.yaml
```

Exit **0** only when `overall` is `PASS` and `seed_allowed` / `ingest_allowed` are true.
Exit **1** when any gate is `BLOCKED` (or the catalog file is missing). Print the JSON
report to the operator. Keep `preparation_allowed: true`, set `execution_allowed` from
readiness, name `required_blocker_actions` with owners, and return
`next_automated_actions`. On PASS, auto-advance the durable run without operator
confirmation.

## When it must run

Run after `county-discovery` has written or updated
`elephant-pipeline/docs/<county>-sources.yaml`, and **again** immediately before:

- `county-seed-data`
- `onboard-county` continuing past discovery into seed
- `county-ingest-run` pilot (~25 parcels)
- `county-ingest-run` full county

If the catalog is missing, that is BLOCKED — do not seed from GIS or an assumed roll.

## Catalog contract

The catalog is YAML, not `sources.json`. Shape and fields:
[`../use-oracle/reference/readiness-and-completeness.md`](../use-oracle/reference/readiness-and-completeness.md).

## Regression fixtures

Fixtures are named by **failure mode**. They must keep passing
`python3 skills/use-oracle/scripts/validate-county-readiness.py --self-test`:

| Fixture | Mode under test |
|---|---|
| `fixtures/readiness/material-gis-assessed-discrepancy.yaml` | Material GIS vs tax-roll gap blocks GIS-only seed |
| `fixtures/readiness/unclassified-permit-jurisdiction.yaml` | Parcel can pass while an unclassified municipality blocks |
| `fixtures/readiness/unified-portal-not-municipal-history.yaml` | County one-stop is not complete municipal permit history |
| `fixtures/readiness/ready-minimal.yaml` | PASS — seed and ingest allowed |
| `fixtures/readiness/blocked-without-request-route.yaml` | Blocked/custodian/manual-only rows need a complete `records_request` |
| `fixtures/readiness/advertised-listing-count-is-not-harvestable.yaml` | BBB advertised listing total is not `expected_count` without a page cap |

## After a BLOCKED report

Do not call seed or ingest. Name the blocked gate, the evidence, the owner, and the next
permissible automated action. Automatically continue source enumeration, bounded adapter
work, access remediation, request preparation, and publication-readiness checks from
`next_automated_actions`; do not wait for another user message.
