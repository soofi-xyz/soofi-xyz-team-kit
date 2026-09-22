---
title: Scripts-mode transforms
impact: high
tags: [transform, elephant-cli, seed]
---

# Scripts-mode transforms (five-script bundle)

The bundled runtime ships Duval and Pinellas as scripts-mode transforms:
`ownerMapping.js`, `structureMapping.js`, `layoutMapping.js`, `utilityMapping.js`, and
`data_extractor.js`, run in that order against `input.html`, `property_seed.json`, and
`unnormalized_address.json` in the working directory. They write `data/*.json` including
relationship files with relative links.

## Run it through the CLI

```bash
zip -j county-scripts.zip ownerMapping.js structureMapping.js layoutMapping.js utilityMapping.js data_extractor.js
zip -j county-input.zip input.html property_seed.json unnormalized_address.json
elephant-cli transform --input-zip county-input.zip --scripts-zip county-scripts.zip --output-zip county-transformed.zip
```

The CLI runs the scripts, creates the county data-group root from the relationship
files, then writes the seed data-group root and `address_has_parcel.json` linking the
`address.json` and `parcel.json` the scripts produced (elephant-cli #251). Files the
scripts already wrote are kept; a script that emits its own seed root is left alone. The
output validates and hashes as it is. No seed-mode run and no merge step.

If the CLI warns that `address.json` or `parcel.json` is missing, the scripts did not emit
them and `hash` cannot derive the property CID: fix the scripts, do not hand-merge a seed
bundle.

## Traps seen on real counties

- `seed.csv` `headers` beyond `content-type` (User-Agent, Accept) flow into
  `source_http_request` and fail validation. Strip them at seed generation.
- An empty `address` column produces a seed address that fails the lexicon's address
  schema on every field. The seed row needs the real unnormalized address.
- Scripts must not emit `fact_sheet.json` or `*_has_fact_sheet.json`: the CLI no longer
  generates fact sheets, the archive carries only lexicon data, and an unlinked file fails
  validation.
- The runtime's transform runner executes these scripts one parcel at a time with
  `process.chdir`; never run two parcels concurrently in one process.
