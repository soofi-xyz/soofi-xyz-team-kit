---
name: validate-county-transform
description: "Prove a county's transform scripts extract 100% of the data available on the appraiser site across property-type variability, by diffing extracted fields against raw captures. Use before scaling any county ingestion run, after editing transform scripts, or when asked whether transform coverage is complete for a county."
metadata: {"author":"elephant-xyz"}
---
# Validate County Transform

Existing scripts in `Counties-trasform-scripts/<county>/` must never be assumed complete.
Validate against fresh captures before any large run.

## Sample selection

Coverage failures come from variability, not volume. Pick 10-20 parcels spanning:

- usage types: commercial, industrial, residential single-family, condo, multi-family,
  agricultural, vacant, government/institutional
- edge cases: multiple buildings, multiple owners, recent sale, zero improvements,
  exemptions, very old construction
- at least one parcel with media/images and one with secondary tabs (cost cards, land
  lines, permits tab) if the site has them

Get usage-type spread from the seed CSV or county GIS export, not random sampling.

## Workflow

1. Capture each sample with the county browser flow (`elephant-cli prepare` locally) so
   you validate against exactly what the pipeline sees.
2. Run the transform locally on each capture (`elephant-cli transform
   --transform-version 2` with the county scripts; the `transform-v2-builder` skill covers
   mechanics and debugging).
3. Per sample, produce a field inventory diff:
   - Parse the raw HTML/JSON capture and enumerate every label/value pair, table, and
     media URL present on the page(s).
   - Enumerate every field present in the transformed lexicon output (all `data/*.json`).
   - Diff: anything in the raw inventory absent from the output is a gap. Classify each
     gap: (a) extractor bug, (b) page section not captured by the browser flow,
     (c) lexicon has no home for it.
4. Fix (a) in the transform scripts and (b) in the browser flow; re-run until the only
   remaining gaps are class (c).
5. For class (c) — lexicon gaps — do NOT drop data: keep it in `source_payload` and record
   the gap (pattern: `../elephant-query-db/docs/open-lexicon-gaps.md`). Lexicon expansion
   in `../lexicon` is a separate, deliberate follow-up.
6. Schema check: transformed output must validate (`elephant-cli validate` locally on
   every sample).
7. Verify `county_jurisdiction` in output matches the county for every sample (transform
   script mismatches have produced wrong-county labels before).

> ⚠️ **Validation is fail-closed, per parcel, no exceptions per path.** A branch of the
> old pipeline skipped schema validation for the non-minting paths — parcels were
> uploaded, loaded to the query DB, and enqueued for permits with no schema validation
> (a "successful" but wrong transform passed silently). In the current stack the
> `Parcel.process` handler validates every parcel and excludes failures before the DB
> row is written or permits are enqueued (`durable-workflow-builder`, fail-closed
> validation gate). When reviewing the service, verify this gate exists; if you add a
> new post-transform path, route it through validation too.

## Validate the EXACT artifact set that will load — reconcile folios BEFORE the load

Coverage on a sample proves the extractor; it does NOT prove the batch you are about to
load is complete. Before kicking off the load:

- **Point the validation at the EXACT artifact set the loader will read** —
  `data/artifacts/appraisal/<county>/<jobId>/`. The loader reads `ready.json`-marked
  parcels only, so count the load set with
  `find data/artifacts/appraisal/<county>/<jobId> -name ready.json | wc -l`; use
  `find … -name transformed.zip | wc -l` only to measure total transform output (the
  difference is the invalid/dead tail). Don't validate a
  different/earlier jobId or a hand-picked sample. A run that validates one jobId dir but
  loads another proves nothing about what lands in the DB.
- **Reconcile the distinct-folio (`request_identifier`) count of that dir vs the source
  seed count NOW**, before the load — count folio dirs or `ready.json` markers; a
  shortfall discovered mid-load means the load must be redone; catch it in a cheap
  `find` sweep first (see
  `monitoring-county-ingestion`). Fold in the documented un-scrapeable/dead tail: expect
  `distinct folios == achievable`, per `county-ingest-run`.

## Acceptance

Record in the county's findings doc in `Counties-trasform-scripts`
(`<county>-county-findings.md`):

- sample list (parcel ids + usage types)
- field-coverage result per sample: extracted / total discoverable, with the class-(c)
  exception list
- assertion that no class-(a)/(b) gaps remain

Only then proceed to `county-ingest-run`. If transform scripts changed, commit them on a
branch and open a PR against `Counties-trasform-scripts` (`gh pr create`), and keep
`skills/use-oracle/runtime/transforms/<county>/` synced with the merged result — the `Parcel`
service reads that local dir. Include the validation report and any comparison scripts
in the same PR so the coverage evidence isn't lost.
