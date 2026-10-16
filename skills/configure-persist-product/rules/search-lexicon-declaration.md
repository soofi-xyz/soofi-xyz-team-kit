---
title: Declare the embedding in a Lexicon PR
impact: CRITICAL
tags: vector-search, embeddings, lexicon, overlay, pull-request
---

## Declare the embedding in a Lexicon PR

Eligibility lives only in the Lexicon
([Spring-Oaks-Capital-LLC/lexicon](https://github.com/Spring-Oaks-Capital-LLC/lexicon)).
Add an `embeddings` entry to the rule that owns the property. With no
`embeddings` anywhere, the backfill refuses to start and `search` answers
`Search has no ACTIVE index generation yet`.

Uxie authors `embeddings` entries under the existing contract. Changes to the
contract itself (new keys, new validation rules) are Lexicon engine work for
Dialga; ask the Model owners (Jirachi) to review the configuration PR.

### Where the entry goes

- Base vocabulary: the rule in `src/data/lexicon.json` (`vertices[]` or
  `edges[]`), beside `properties`.
- Overlay: an entry in `vertex_property_extensions` or
  `edge_property_extensions` of an overlay such as `src/data/lexicon.veritus.json`
  (`{ "type", "properties", "embeddings" }`; `properties` is required, use `{}`
  when adding only embeddings). The merge adds the overlay embeddings to the base
  rule and throws if the name is already declared there. An overlay belongs to
  another team (`_meta.owner`); get that team's agreement before editing it and
  link it in the PR.

### Examples

A short inline vertex property, embedded whole:

```json
{
  "type": "note",
  "properties": { "text": { "type": "string" } },
  "embeddings": {
    "note_text_embedding": {
      "source_property": "text",
      "content": "text",
      "version": "1",
      "chunking": { "strategy": "whole" }
    }
  }
}
```

An edge whose `format: "uri"` property points at a long text object in S3; the
hit is the edge:

```json
{
  "type": "document_has_file",
  "from": "document",
  "to": "file",
  "properties": { "uri": { "type": "string", "format": "uri" } },
  "embeddings": {
    "document_has_file_uri_embedding": {
      "source_property": "uri",
      "content": "blob_text",
      "version": "1",
      "chunking": { "strategy": "window" }
    }
  }
}
```

A self-edge whose text describes its vertex, returned as that vertex:

```json
{
  "type": "case_note_has_body_uri",
  "from": "case_note",
  "to": "case_note",
  "properties": { "uri": { "type": "string", "format": "uri" } },
  "embeddings": {
    "case_note_body_embedding": {
      "source_property": "uri",
      "content": "blob_text",
      "version": "1",
      "chunking": { "strategy": "whole" },
      "hit_target": "out_vertex"
    }
  }
}
```

An overlay adding an embedding to a base edge:

```json
{
  "edge_property_extensions": [
    {
      "type": "document_has_file",
      "properties": {},
      "embeddings": {
        "document_has_file_uri_embedding": { "source_property": "uri", "content": "blob_text", "version": "1" }
      }
    }
  ]
}
```

In the real file, add only the `embeddings` block to the existing rule; do not
retype its properties.

### Incorrect

```json
{ "note_text_embedding": { "source_property": "text", "content": "text", "version": "1", "model": "cohere", "dimensions": 1024 } }
```

`model` and `dimensions` are unknown keys: both the Lexicon tests and Persist
reject them.

### Validate locally

Install with the lockfile CI uses, then run the vocabulary and overlay tests:

```bash
bun install --frozen-lockfile
npx vitest run src/data/__tests__/governed-vocabulary-structure.spec.ts infra/test/lexicon-overlay.spec.ts
npm run typecheck && npm run lint && npm run format
```

The vocabulary test validates the merged `lexicon` registry entry, so overlay
embeddings are checked against the merged rule.

### Order and deployment

- Persist before Lexicon. Persist decodes the published Lexicon fail-closed:
  an `embeddings` entry with a key or value the deployed Persist revision does
  not know makes the Lexicon undecodable for every Persist consumer (ingest,
  validate, GraphQL). Deploy the Persist revision that understands the
  declaration first, then the Lexicon.
- Opening or updating a Lexicon or Persist PR to `main` deploys it to the
  shared DEV account. Ask before opening one.
- PR description: the declaration table, the PII decision, who agreed for an
  overlay, and the plan (DEV generation, then PROD after approval). No sample
  field values.
- Merging the Lexicon PR changes nothing in search until a new generation is
  built and activated.

### Changing an existing embedding

Changing `source_property`, `content`, `version` or `chunking.strategy`, or
removing or renaming the entry, reads to Persist as remove-plus-add. Outside
DEV the stream poller deletes that embedding's chunks from every generation,
including ACTIVE, on its next poll; DEV waits 24 hours first. The new
declaration is searchable only after a new generation is built and activated.
Plan such a change as a window with the user and build the replacement
generation immediately after the Lexicon deploys.
