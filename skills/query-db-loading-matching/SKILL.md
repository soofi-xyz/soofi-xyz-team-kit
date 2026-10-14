---
name: query-db-loading-matching
description: "Load county artifacts into the internal reconciliation store and cross-match records: folio identity, watermarks, tombstones, permit and official identity links, roof age, and enrichment. Use when loading or reconciling a county run; never as the public data source."
metadata: {"author":"elephant-xyz"}
---

# Query DB Loading and Matching

Use the Query DB only as an internal working store for ingest reconciliation, identity
resolution, roof-age/product checks, and enrichment. Atlas CARs and CLI-exported tables are
the sole public publication source.

The Query DB is not the public source.

Do not expose Query DB credentials, direct users to query it, export public artifacts from
it, or signal publication from a load.

## Connection and ownership

- Read `DATABASE_URL` from runtime configuration; never print it.
- Use a direct connection for bulk writes, COPY, locks, and long transactions.
- Keep schema and migrations owned by the Query DB package. This skill carries operating
  facts, not a public schema-consumer API.
- Core internal tables include parcels/properties, appraisal children, permit
  improvements and children, companies and official registrations, reputation records,
  places, addresses, and roof-age lineage.

## Folio identity

Key parcel rows by `(jurisdiction_key, request_identifier)`, where
`request_identifier` is the source folio. Never use digits-only parcel normalization as a
conflict key.

Normalization can collapse distinct lettered parcels. Validate distinct folios against the
seed and source manifests. Use normalized parcel IDs only as bounded matching candidates.

A historical key correction requires a source-scoped clean reload; an upsert alone cannot
separate already-collapsed rows.

## Safe reload

Never `TRUNCATE ... CASCADE` shared addresses, companies, people, property parents, or
permit children.

For an existing county:

1. derive the underscore source key from the lowercase-hyphen county slug;
2. delete that source in reverse FK order;
3. skip shared identity tables or leave harmless unreferenced rows;
4. batch large deletes;
5. index child FK columns before large parent deletes;
6. reload through idempotent staging and upserts;
7. validate before committing completion.

For a new county, skip the clear only because no county rows exist.

## Single writer and idempotency

Route multi-row loads through one `Loader` object keyed by county. Serialize appraisal,
permit, official-identity, and enrichment merges for that county. Allow different counties
to load concurrently.

Use:

- deterministic source keys and hashes;
- durable staging plus `ON CONFLICT` merges;
- journaled phases;
- per-table or per-batch checkpoints;
- bounded disk staging with immediate cleanup;
- connection keepalive and resumable permanent stage tables where required.

Do not run a manual bulk load alongside incremental loading. Queue it through the same
county writer.

## Artifact scope and ready gate

- Scope every load to `data/artifacts/<track>/<county>/<jobId>/`.
- Never sweep a shared multi-county root.
- Enumerate ready markers in one filesystem pass.
- Load only when `ready.json` references the same artifact hash as transform metadata.
- Treat missing ready markers as not loadable, not as empty source rows.
- Preserve full `source_payload` and source artifact URI.

## Content-aware watermarks

Persist one watermark per county, job, and track:

```text
prefix
mergedCount
lastMergedAt
hashIndexPath
```

The hash index tracks `(path, artifact hash)`, not path alone. A corrected in-place
transform must reload when its hash changes.

Verify watermarks through durable Loader state. A process log or file count is not enough.
Completion requires every final ready artifact to be covered.

## Tombstones

Consume dead and invalid tombstones during incremental merges. If a record loaded earlier
later becomes invalid, retired, or source-empty:

- delete or downgrade the stale source rows within the same county/source boundary;
- retain the tombstone, source evidence, and terminal reason;
- update the watermark atomically with the merge;
- reconcile stale-edge and orphan counts.

Without tombstone consumption, corrected source state leaves false live data.

## Permit/property matching

1. Link permits from the harvest request's target-parcel evidence.
2. Use exact folio/source identity first.
3. Use normalized parcel or address evidence only as explicit fallbacks.
4. Preserve valid unmatched permits with null property links.
5. Never trust a portal's displayed related parcel without reconciling it to the target.
6. Record match method, version, confidence, and source hashes.

## Official company edges

Load the official corporate registry and licensing authority before permit harvest. Resolve
contractor contacts by:

1. exact official licence number; or
2. one unique company plus a licensed qualifier whose relationship is effective on the
   permit attribution date.

Write `permit_contacts.company_id` only for accepted official evidence. Write
`property_improvements.contractor_company_id` only when every contractor-role contact on
that permit resolves to the same company.

Preserve raw names and omitted licence values. Keep unresolved, ambiguous, conflicting,
stale, and orphaned records unlinked. Record resolver version and source snapshot digests
in an immutable reconciliation ledger. Name, phone, address, BBB, and places matches are
candidates only.

Verify indexes on both company-edge columns and run `ANALYZE` before product queries.

## Roof age

Run the shared estimator after permits and official company edges reconcile.

Accept only profile-mapped replacement work and lifecycle states. Prefer the latest valid
completed replacement date; use built year only as a documented fallback. Exclude open
permits, repairs, coatings, accessory roofs, quarantined dates, and impossible chronology.

Persist:

- selected source and permit ID;
- work/status classifier and version;
- evidence date and precision;
- source profile and digest;
- as-of date;
- age and confidence;
- historical-coverage state and caveats;
- terminal eligibility reason.

Partial history lowers certainty; it does not prove no later replacement.

## Enrichment

Keep BBB, places, HOA/property management, and AVM in separate tracks with their own source
and licence gates. Preserve accepted links and review candidates. Do not let enrichment
establish legal identity or core permit completeness.

Working Parquet and coverage artifacts may remain because enrichment and reconciliation
modules consume them. They are internal intermediates. Never upload them, create public
pointers for them, or configure MCP to read them.

## Verification

Before wrap-up, reconcile:

- seed folios = ready + proven dead + current invalid;
- distinct loaded folios = ready appraisal folios;
- artifact and child-table counts by source;
- null/orphan property links;
- permit capture, matched, and valid-unmatched counts;
- evaluated/accepted/unresolved/conflicting company edges;
- company-edge indexes;
- per-track watermark coverage;
- consumed tombstones and stale rows removed;
- roof-age classified/eligible/ineligible counts and caveats;
- enrichment counts by source.

Check current schema names in the owning Query DB package; do not copy stale DDL into this
skill.

## Handoff to publication

Hand Oracle validated lexicon group directories and reconciliation evidence. Do not hand it
a Query DB export as public input. Oracle validates, hashes, packs, exports normalized Atlas
tables, uploads, opens the Atlas county PR, and verifies global Atlas IPNS.

Return counts and digests only; redact private rows, local paths containing sensitive data,
and `DATABASE_URL`.
