---
name: county-ingest-run
description: "Operate a county pilot and backpressure-aware full ingest, then reconcile the internal Query DB with content-aware watermarks, tombstones, permit links, official identity edges, roof age, and enrichment before Atlas publication."
metadata: {"author":"elephant-xyz"}
---

# County Ingest Run

Require readiness PASS, appraisal onboarding, transform validation, a permit adapter, and
an adequate official identity baseline. In Florida load Sunbiz then DBPR before any permit
harvest. Reputation or name-only lists do not satisfy identity adequacy.

Use the seed CSV as input of record. Never derive pending parcels from the Query DB.

## Run shape

Process each parcel through:

```text
prepare → transform → validate → eligibility → permit harvest → internal load
```

Use `CountyIngest/<county>-<jobId>` as the durable idempotency boundary. Fan out through
bounded chunk workflows and bounded parcel windows. Start `PermitFeed` only after appraisal
dispatch and identity-baseline adequacy. Do not enqueue a whole county.

The Query DB is a private reconciliation store. Loading it does not publish data. Public
publication happens later through the Atlas CAR/table sequence in `use-oracle`.

## Pilot

1. Select about 25 parcels covering commercial, residential, permit-less, and known permit
   cases.
2. Use a distinct pilot job ID and bounded window.
3. Verify capture, transformed archive, fail-closed validation marker, internal row,
   eligibility artifact, and permit artifacts.
4. Confirm residential skips and permit-less completion are terminal, not errors.
5. Record per-source latency, retries, safe concurrency, and projected full duration.

Do not scale a source projected above 48 hours without the operator choosing full
acquisition, official bulk records, or a separately owned runtime lookup.

## Full run

Run the full seed with the same durable workflow and a new full-run job ID. Treat a
"previously accepted" response for the same key as healthy idempotency.

Ramp concurrency in measured steps. Start permit portals at two workers; keep source
tolerance, not machine capacity, as the limit. Restart services after changing process
configuration so durable invocations resume from journals.

For large transform sets:

- use a bounded warm worker pool;
- stream the seed instead of loading it into memory;
- read transformed ZIPs in memory;
- batch directory work with bounded `Promise.all`.

## Failure handling

Classify each terminal outcome:

- **dead:** source proves retired, empty, or permanently missing;
- **invalid:** capture exists but transform or lexicon validation fails;
- **retryable:** timeout, 5xx, transient navigation, egress, or service outage;
- **blocked:** CAPTCHA, login, terms, custodian, or source-access decision.

Pause at bounded retry exhaustion. Resume world fixes against the same journal. Use a new
redrive workflow key for code fixes or corrected transforms while retaining the same
artifact job namespace. Recompute eligibility when its policy fingerprint changes.

Prove a dead tail with raw source-empty evidence and a representative redrive. Never hide a
transform failure inside dead counts.

## Internal load and reconciliation

Route multi-row loads through one `Loader` object per county. Keep appraisal and permit
merges serialized for that county; different counties may run in parallel.

Require:

- deterministic folio/request-identifier parcel keys;
- source-scoped, FK-safe reloads and idempotent upserts;
- one artifact sweep over ready markers, not per-parcel filesystem stats;
- a content-aware watermark of `(path, artifact hash)` per track;
- a ready-hash gate so partially regenerated output cannot load;
- tombstone consumption for dead/invalid records that were previously loaded;
- final watermarks covering appraisal, permits, and each requested enrichment track.

Do not use digits-only parcel normalization as a conflict key. Do not truncate shared
addresses, companies, people, or parent tables with cascade.

## Permit and official identity reconciliation

- Link a permit from the harvest request's target-parcel evidence.
- Preserve permits that cannot be linked.
- Preserve raw contractor names and omitted license values.
- Resolve contractor companies from official licence number or one unique company plus a
  temporally valid licensed qualifier.
- Record resolver version and identity-snapshot digests.
- Set `permit_contacts.company_id` only for accepted official evidence.
- Set `property_improvements.contractor_company_id` only when all contractor contacts on
  the permit resolve to one company.
- Keep unresolved, ambiguous, conflicting, stale, and orphaned edges explicit.
- Verify indexes on both company-link columns before product queries.

## Roof age and enrichment

Run the shared roof-age estimator after permit and company-edge reconciliation. Preserve:

- accepted work and lifecycle-status mapping;
- selected permit or built-year fallback;
- source profile and digest;
- evidence date precision;
- confidence and historical-coverage caveats;
- as-of date and terminal reason.

Do not infer replacement from generic repair text, open permits, coatings, accessory roofs,
or impossible dates.

Run BBB, places, HOA/property management, and AVM as separate enrichment tracks. They may
add useful evidence but never establish corporate or licensing identity.

## Wrap-up

Do not equate appraisal dispatch completion with run completion. Require:

- `seed = ready + proven dead + current invalid`;
- final permit status for every eligible parcel;
- distinct Query DB folios covering ready appraisal records;
- final watermarks covering all loaded artifacts;
- tombstones reconciled;
- official identity edges and indexes reconciled;
- roof-age and requested enrichment checks complete;
- no unclassified retryable residual.

When public publication is in scope, hand validated lexicon group directories to
`use-oracle`. Do not run a runtime publisher or create a per-county public pointer.

Return pilot/full counts, source rates, failure classes, watermarks, tombstones, folio
reconciliation, permit links, official identity edges, roof-age/enrichment coverage, and the
validated group directories ready for the Atlas sequence.
