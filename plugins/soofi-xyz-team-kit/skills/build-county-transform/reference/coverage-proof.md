---
title: Coverage proof
impact: critical
tags: [transform, coverage, validation]
---

# Coverage proof

Existing scripts in `Counties-trasform-scripts/<county>/` are never assumed complete.
Prove coverage against fresh captures before any large run and after every edit.

## Sample selection

Coverage failures come from variability, not volume. Pick 10 to 20 parcels spanning:

- usage types: commercial, industrial, residential single-family, condo, multi-family,
  agricultural, vacant, government or institutional
- edge cases: multiple buildings, multiple owners, recent sale, zero improvements,
  exemptions, very old construction
- at least one parcel with media and one with secondary tabs (cost cards, land lines,
  permits) if the site has them

Take the usage-type spread from the seed CSV or the county GIS export, not from random
sampling.

## Field-inventory diff, per sample

1. Parse the raw capture and enumerate every label and value pair, table, and media URL
   present on the page or pages.
2. Enumerate every field present in the transformed output (all `data/*.json`,
   including `source_payload`).
3. Diff. Anything in the raw inventory absent from the output is a gap. Classify it:
   (a) extractor bug, (b) page section not captured by the flow, (c) the lexicon has no
   home for it.
4. Fix (a) in the transform and (b) in the capture; re-run until only (c) remains.
5. For (c), keep the data in `source_payload` and record the gap in the findings doc.
6. `elephant-cli validate` must pass on every sample.
7. `county_jurisdiction` and `county_name` match the county on every sample.

## Validation is fail-closed, every path

An earlier pipeline branch skipped schema validation on non-minting paths and loaded
unvalidated parcels. Every path that produces a parcel routes through validation and
excludes failures before anything is loaded, enqueued, hashed, or published. When
reviewing a service, verify that gate exists.

## Validate the exact set that will load

A sample proves the extractor; it does not prove the batch. Before a load or a hash run:

- point validation at the exact artifact set the next stage reads
  (`data/artifacts/appraisal/<county>/<jobId>/`, `ready.json`-marked parcels only)
- reconcile distinct `request_identifier` count against the seed count, folding in the
  documented un-scrapeable tail; a shortfall found mid-load means redoing the load

## Acceptance record

In `Counties-trasform-scripts/<county>/docs/<county>-county-findings.md`:

- sample list with parcel ids and usage types
- field-coverage result per sample: extracted over total discoverable, with the
  class-(c) exception list
- the unmapped-code inventory and the mappings added
- the statement that no class-(a) or class-(b) gaps remain
- the `elephant-cli` commit and manifest URL used
