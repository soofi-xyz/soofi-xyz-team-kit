---
name: county-readiness-preflight
description: "Fail-closed county readiness validator. Use before county-seed-data, county-ingest-run, onboard-county, or any pilot or full ingest. Validates elephant-pipeline/docs/<county>-sources.yaml — parcel vs GIS discrepancy, permit-jurisdiction classification, and destination proof."
---

# County Readiness Preflight

This skill is the **hard gate** in front of seed, pilot, and full ingest. It applies when
the user invokes **`onboard-county` directly**, not only when they invoke `/oracle`.

Do not treat a written checklist as sufficient. Run the validator. A non-zero exit is a
stop.

## Command

From the plugin kit (or a path that can see this skill):

```bash
python3 skills/use-oracle/scripts/validate-county-readiness.py \
  <elephant-pipeline>/docs/<county>-sources.yaml
```

Exit **0** only when `overall` is `PASS` and `seed_allowed` / `ingest_allowed` are true.
Exit **1** when any gate is `BLOCKED` (or the catalog file is missing). Print the JSON
report to the operator.

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

These fixtures live in this kit and must keep passing
`python3 skills/use-oracle/scripts/validate-county-readiness.py --self-test`:

| Fixture | Expected |
|---|---|
| `fixtures/readiness/broward-2026.yaml` | BLOCKED before seed — ~26.6% GIS vs assessed discrepancy unresolved |
| `fixtures/readiness/hillsborough-unclassified-permits.yaml` | parcel PASS; permit BLOCKED — Temple Terrace `needs-review` |
| `fixtures/readiness/ready-minimal.yaml` | PASS — seed and ingest allowed |

## After a BLOCKED report

Do not call seed or ingest. Name the blocked gate, the evidence, the owner, and the next
permissible automated action. Independent workstreams (discovery of other sources,
enrichment planning, loading already-captured artifacts) may continue.
