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

The CLI runs the scripts, then creates the county data-group root from the relationship
files. It does **not** create the seed data-group root in this mode.

## Produce the seed root and merge it

```bash
# seed.csv: parcel_id,address,method,url,multiValueQueryString,source_identifier,county
zip -j seed-input.zip seed.csv
elephant-cli transform --input-zip seed-input.zip --output-zip seed-bundle.zip
mkdir merged && unzip -qo county-transformed.zip -d merged && unzip -qn seed-bundle.zip -d merged
```

County files win on name collisions (`-n` does not overwrite), the seed bundle adds the
seed root, `address_has_parcel.json`, and the seed entities. Validate the merged
directory, not the two halves.

## Traps seen on real counties

- `seed.csv` `headers` beyond `content-type` (User-Agent, Accept) flow into
  `source_http_request` and fail validation. Strip them at seed generation.
- An empty `address` column produces a seed address that fails the lexicon's address
  schema on every field. The seed row needs the real unnormalized address.
- Scripts that emit `fact_sheet.json` without a relationship trigger the unused-file
  error; emit it only with its relationships.
- The runtime's transform runner executes these scripts one parcel at a time with
  `process.chdir`; never run two parcels concurrently in one process.
