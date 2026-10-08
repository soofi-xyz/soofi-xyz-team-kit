---
title: Decide the searchable field and its PII status
impact: CRITICAL
tags: vector-search, embeddings, lexicon, chunking, hit-target, pii
---

## Decide the searchable field

Produce one declaration table per requested field and get the user's approval
before drafting any PR. Read the Lexicon rule; do not guess types from names.

| Decision | Values | How to choose |
| --- | --- | --- |
| Owner rule | the vertex or edge rule that declares the property | Find it in `src/data/lexicon.json` or the merged overlay. The property must be on the same rule. |
| `content` | `text` or `blob_text` | `text` for an inline `type: "string"` property without `format: "uri"`. `blob_text` for a `type: "blob"` property or a `type: "string"`, `format: "uri"` property whose value is an `s3://bucket/key` pointing at the text. |
| `chunking.strategy` | `whole` or `window` (default `window`) | `whole` for short self-contained values (messages, notes): one chunk up to 8,000 characters, split only past that. `window` for long documents and transcripts: values up to 2,000 characters stay one chunk; longer values are split into 1,200–2,000-character chunks with 200 characters of overlap (`boundary-v1`). |
| `hit_target` | `edge` (default) or `out_vertex`; edges only | `out_vertex` only on a self-edge (`from` and `to` are the same single label) whose text describes that vertex; the hit is returned as the vertex. Otherwise leave it out: the hit is the edge, and GraphQL returns `entity: null` with `entityKind: "edge"` and `entityId`. |
| `version` | string, e.g. `"1"` | Start at `"1"`. Bump only when the meaning of the text changes and it must be re-embedded (see the deletion warning below). |
| Embedding name | e.g. `note_text_embedding` | Use `<owner>_<property>_embedding`. It names the chunks, backfill artifacts and search filters. |

Character counts are UTF-16 code units, which match JavaScript string length.

### Validation rules the Lexicon and Persist both enforce

- The name is unique across the whole Lexicon, including overlay additions.
- The name is not a property or derived-index name on the same rule, and not
  `id` or `created_at`.
- One rule embeds a given `source_property` at most once.
- `source_property` exists on the same rule and is graph-persisted (not
  `persistence: "external"`).
- `text` requires a `string` property and is rejected on `format: "uri"`, which
  would embed the link instead of its content.
- `blob_text` requires a `blob` or a `format: "uri"` string.
- `hit_target` is rejected on vertex embeddings, and `out_vertex` is rejected on
  an edge whose `from` differs from `to`.
- Only `source_property`, `content`, `version`, `chunking.strategy` and
  `hit_target` are allowed. Model, dimensions and chunk sizes belong to the
  Persist embedding profile and are rejected as unknown keys.
- After the embedding exists, GraphSON and CSV ingest reject a property or
  column with the embedding's name, so never pick a name callers might send.

### Route engine requests to Conkeldurr

Send these to `conkeldurr` with the field, sample shape (no real content) and
expected behavior: a new chunking strategy or chunk size, a new content type
(PDF, HTML, DOCX, anything other than plain text or an AWS Transcribe result), a
different embedding model or profile, grouping several elements into one result,
or a new search filter.

### Correct

```text
note.text           string, short notes      → content text,      whole,  edge n/a
document_has_file.uri  string format uri, S3 transcripts → content blob_text, window, hit is the edge
case_note_has_body_uri.uri  self-edge case_note→case_note → blob_text, whole, hit_target out_vertex
```

### Incorrect

```text
document_has_file.uri → content text          (embeds the URI string, rejected)
note.text             → hit_target out_vertex (hit_target is edge-only, rejected)
note.text             → name "text"           (collides with the property, rejected)
```

## PII decision

Search returns text: every hit carries an evidence snippet of up to 200
characters of highlighted context (lexical) or 240 characters of chunk text
(vector-only) to any SigV4 caller of `/persist/graphql`.

1. Vertex fields: check `config/graphql-resolution-map.json` in the Persist
   revision being configured. A source property routed there with `pii_access`
   other than `none` is excluded from `search`, but the backfill and stream
   poller still embed it and store its text in the chunk index. Do not declare
   an embedding on such a field; ask the user to choose another field.
2. Edge fields: the resolution map covers vertex types only, so an edge text
   field is always searchable once declared. If the text may contain personal
   data (names, phone numbers, addresses, account numbers, conversation
   content), stop and require an explicit, recorded PII decision from the data
   owner before PROD. Write the decision and who made it in the Lexicon PR
   description.
3. Never paste sample values of the field into chat, PRs or logs to make the
   decision. Describe the field's kind of content instead.
