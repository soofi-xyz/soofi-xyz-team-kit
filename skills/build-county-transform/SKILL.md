---
name: build-county-transform
description: "Build or repair a county transform end to end: capture sample pages, turn them into lexicon records with exact source-request provenance, prove every record validates against the live lexicon and every field on the page was extracted, then open the transform pull request. Use when onboarding a county's appraiser, permit, or registry source, when validation or coverage fails on an existing transform, or when asked whether a county's transform is complete."
metadata: {"author":"elephant-xyz"}
---
# Build County Transform

A county transform turns captured source pages into the per-property lexicon output that
`elephant-cli validate`, `hash`, and the county archive consume. This skill owns the whole
loop: sample, transform, validate, prove coverage, replay, and open the pull request.

The transform may be an Elephant CLI v2 handler, an Elephant CLI scripts-mode bundle, or
custom code in any language. What is fixed is the **output contract** in
[`reference/output-contract.md`](./reference/output-contract.md), not the tool.

## Always read

1. [`reference/output-contract.md`](./reference/output-contract.md) — the per-property
   layout every transform must produce: entities, relationships, data-group roots, the
   seed root, provenance fields, link form
2. [`reference/coverage-proof.md`](./reference/coverage-proof.md) — sample selection,
   field-inventory diff, gap classes, acceptance record
3. One of, by transform mode:
   [`reference/transform-v2-handler.md`](./reference/transform-v2-handler.md),
   [`reference/scripts-mode.md`](./reference/scripts-mode.md), or the custom-code
   section below
4. [`reference/transform-evaluator.md`](./reference/transform-evaluator.md) — optional
   AI generate-and-repair helper; never a substitute for validation
5. `../use-oracle/reference/car-publication.md` — what consumes the output downstream

## The loop

Run it for every new source and every repair. Do not skip a step because the previous
county passed.

1. **Capture samples.** Pick 10 to 20 parcels by variability, not volume (see the
   coverage reference). Capture each with the county's browser flow or fetcher through
   `elephant-cli prepare`, or with the custom capture code, so the transform sees exactly
   what the pipeline sees. Keep the raw capture and the exact request that produced it.
2. **Choose the mode.** v2 handler for a new site with named captures; scripts mode when
   maintaining an existing five-script bundle; custom code when the site needs a
   language or runtime the CLI does not offer. Custom code must still write the output
   contract, byte for byte in shape.
3. **Write or repair the transform.** Every entity carries its own `source_http_request`
   and `request_identifier`. Every relationship links two entities by relative path.
   Every data group has a root. The seed data group is present.
4. **Validate against the live lexicon.**
   `elephant-cli validate <property-dir-or-zip> --output-csv errors.csv` per sample, then
   `elephant-cli validate <samples-dir>` over all of them. The CLI must load the manifest
   from `https://lexicon.elephant.xyz/api/manifest`; a run that fails to load it has
   proved nothing. Fix the transform until no data rows remain. Never suppress a row.
5. **Prove coverage.** Field-inventory diff of every sample against its raw capture;
   only lexicon-gap fields may remain, and those stay in `source_payload` with the gap
   recorded.
6. **Replay offline.** Add or refresh the county fixture in
   `skills/use-oracle/runtime/fixtures/<county>-replay/` (one capture, `seed.csv`,
   `expected-row.json`) and the transform tests under
   `skills/use-oracle/runtime/counties/<county>/transforms/*.test.js`; run
   `npm test --prefix skills/use-oracle/runtime`.
7. **Hash a sample.** `elephant-cli hash <samples-dir> --output-zip ./hashed
   --output-csv hash.csv --output-car sample.car` then `elephant-cli validate sample.car`.
   This is the first time the seed root, links, and codecs are exercised together.
8. **Open the pull request** with the checklist below.

## Provenance: `source_http_request`

- One per entity, describing the request that fetched the page the entity came from.
  A property whose data spans a detail page and a tax page has entities pointing at
  different requests.
- Fields: `method`, `url`, `multiValueQueryString`, and for POST either `json` or
  `body` with a `headers.content-type`. Nothing else in `headers`: `User-Agent`,
  `Accept`, cookies, and tokens are rejected by the lexicon and must not leak from the
  capture layer into the record.
- The seed row's request is the default for every entity of that parcel; override only
  with a more specific request that was actually made.
- Never reconstruct a request after the fact. If the capture layer cannot report the
  request, fix the capture layer.

## Custom code

Custom transforms are allowed and common for sources the CLI cannot reach. They must:

- read captures and the seed record, and write the output contract into a per-property
  directory or ZIP; nothing about the layout is negotiable
- name data-group roots by the data-group schema CID from the live manifest, resolved at
  run time, never hardcoded from a previous run
- write relative-path links (`{"/": "./file.json"}`) and let `elephant-cli hash` resolve
  them to CIDs; do not compute CIDs in the transform
- pass steps 4 through 7 unchanged; the CLI's validate, hash, and archive validation are
  the acceptance tests for any transform, whatever produced it
- live in `Counties-trasform-scripts/<county>/` with a README that states the runtime,
  the command, and the inputs, so Oracle can run it without the author

## Lexicon gaps and unmapped codes

- A field the lexicon has no home for stays in `source_payload` and is recorded in the
  findings doc as a lexicon gap. Lexicon expansion is a separate, deliberate change.
- A source code with no lexicon mapping (a DOR use code, a construction type) is kept
  raw in `source_payload` with a warning; the parcel continues. Throwing on one code
  has silently dropped whole property classes before. Inventory unmapped codes across
  the sample and add mappings before scaling.
- `county_jurisdiction` and `county_name` must match the county on every sample.
- Do not prepend a street number to an address that already carries it.

## The pull request

Branch and PR against `github.com/elephant-xyz/Counties-trasform-scripts` under
`<county>/`, opened as soon as the samples pass, one PR per source or logical change.
Include:

- the transform: `handler.js` package, the five scripts, or the custom code with its
  README and lock file
- `docs/<county>-county-findings.md` with the sample list and usage types, the
  field-coverage result per sample, the lexicon-gap list, the unmapped-code inventory,
  and the exact `elephant-cli` commit and manifest URL used to validate
- the comparison or inventory scripts that produced the coverage result
- the replay fixture and tests that were added to the bundled runtime, or a link to the
  team-kit PR that adds them
- no scraped data beyond one small sample capture (under 1 MB); larger samples are
  referenced by their artifact path

After merge, sync `skills/use-oracle/runtime/counties/<county>/transforms/` from the
merged result; the runtime reads that copy and there is no automatic sync.

## Scaling note

Per-parcel child processes cost more in startup than in work. For a full county, run the
transform in a warm worker pool: one persistent worker per core, inputs read in memory,
results returned over IPC. This is a throughput concern, not a correctness one; the
output contract is identical.

## Rules

- Validate before hash, hash before publish. Every path through the transform is
  validated; no parcel is loaded, enqueued, or published from an unvalidated output.
- The output contract is the interface; the tool that produced it is not.
- Provenance is captured, never invented.
- Coverage is proved against the raw capture, never assumed from a previous county.
- The findings doc and the transform ship in the same PR so the evidence is not lost.
- Never modify the Elephant CLI to make a transform pass; a suspected CLI bug is
  reported with a reproduction, then worked around in the transform only if the
  workaround is itself lexicon-valid.
