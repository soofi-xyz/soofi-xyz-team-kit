---
title: Per-property output contract
impact: critical
tags: [lexicon, transform, provenance]
---

# Per-property output contract

Every transform, whatever tool produced it, writes one directory (or one ZIP of it) per
property with this layout. `elephant-cli validate`, `hash`, and the county archive read
nothing else.

```text
<property>/
└── data/
    ├── property.json                      entity (class record)
    ├── address.json                       entity
    ├── tax_2025.json                      entity, one file per instance
    ├── relationship_property_address.json relationship
    ├── relationship_property_tax_2025.json
    ├── <county data-group schema cid>.json   data-group root
    ├── property_seed.json                 seed entity
    ├── unnormalized_address.json          seed entity
    ├── address_has_parcel.json            seed relationship
    └── <seed data-group schema cid>.json     seed data-group root
```

## Entities

- One JSON object per class instance, named `<class>[_<n>].json` in snake_case.
- Required on every entity: `source_http_request` (the request that fetched the page)
  and `request_identifier` (the parcel identifier substituted into that request).
- Only lexicon properties for the class; anything else goes under `source_payload`.
- `source_http_request.headers` may carry `content-type` only.

## Relationships

- `{"from": {"/": "./a.json"}, "to": {"/": "./b.json"}}` and nothing else.
- No `source_http_request`, no `request_identifier`.
- Filename stem is free but must be unique; the relationship key that places it in the
  root is the data-group property name (`property_has_address`).

## Data-group roots

- Exactly two keys: `label` and `relationships`.
- `relationships` maps each relationship key to one link or an array of links,
  following the cardinality the data-group schema declares.
- The file is named by the data-group schema CID from the live manifest
  (`https://lexicon.elephant.xyz/api/manifest`), resolved when the transform runs.
- A property has one root per data group it populates. The **seed** data group is
  mandatory: `hash` derives the property CID from the seed root and refuses to run
  without it.

## Links and identifiers

- Transforms write relative-path links. `hash` canonicalizes every file, replaces paths
  with CIDs bottom-up, and assigns dag-json CIDs (`baguqeera…`) to data records. Schema
  CIDs from the lexicon stay raw (`bafkrei…`).
- Never compute or hardcode a CID in a transform. Identity between records that must
  share a CID (the same company across permits) comes from producing byte-identical
  canonical content, or from linking to the existing record.

## What validate checks

- Every root is found by shape, its label is resolved to a schema CID, and the root,
  its relationships, and the linked entities are validated against the lexicon with
  every `cid`-typed schema position dereferenced.
- An entity present in the directory but referenced by no relationship in any root is an
  error (`Unused data JSON file`). Either link it or do not write it.
- Errors are written to the CSV named by `--output-csv`; the run exits non-zero on any
  data row. Directory input validates every child property with one shared schema cache.
