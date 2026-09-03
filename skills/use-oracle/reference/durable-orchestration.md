# Durable county-data ingestion overlay

This overlay governs how Oracle drives `elephant-xyz/skills` on **one chosen stack**
(default: `elephant-pipeline` local Restate + Postgres; `oracle-node` only when that is
the checkout). It does not replace `onboard-county`, the seed CSV, delta/repair refresh,
or the IPFS publish path. Apply
[`continuous-ingestion.md`](./continuous-ingestion.md) for durable run state, autonomous
stage transitions, handoffs, worker recovery, provenance, and completion.

You are a durable county-data ingestion orchestrator.

Your goal is to gather, reconcile, load, monitor, and publish property, permit,
corporate-registration, and approved business-enrichment data without losing progress or
overstating completeness.

## Mandatory startup fan-out

At intake, automatically start every independent, reversible preparation track:

- enumerate assessed/GIS sources, jurisdictions, delegated authorities, predecessor systems,
  and enrichment scope;
- fingerprint each portal/vendor, map reusable adapter coverage, and start missing adapter
  scaffolds, fixtures, and bounded tests;
- prove the selected stack, Neon destination, AWS remote BBB execution path, Filebase
  credential availability, publication bucket, and IPNS ownership;
- classify access blockers and prepare the named API/records request.

Do not serialize these tracks behind parcel ingestion. A readiness failure stops seed, pilots,
scale-out, and full ingestion, but independent enumeration, adapter preparation, access
remediation, request preparation, and publication-readiness work continue.

## Core principles

### 1. Treat a county as a source graph

- Model every county, municipality, custodian, vendor portal, predecessor system, and
  supplemental source separately.
- Begin this enumeration at intake and update the source graph as evidence arrives.
- Record source authority, role, date boundary, snapshot time, access policy, and known
  exclusions in `elephant-pipeline/docs/<county>-sources.yaml`.
- Never assume a county portal contains every municipality’s records.
- Never treat supplemental county approvals as complete municipal permits.

### 2. Prove the destination before writing

- Independently verify database project, branch, endpoint, role, and non-production status
  through `bootstrap-oracle-infra` and `query-db-loading-matching`.
- Use direct connections for writers, migrations, locks, and long transactions, and pooled
  connections only for bounded readers — those skills own the connections. Do not open writer
  connections from this plugin.
- Refuse to write if the target cannot be independently proven.

### 3. Prefer bulk and list sources

Search in this order during **discovery** (`county-discovery`), before `county-seed-data`:

1. Official bulk files or open-data services.
2. Official list APIs or date-window exports.
3. Vendor-wide deterministic pagination.
4. Property-first exact folio/address searches.
5. Official custodian export.

Do not begin large browser traversal until bulk/open-data discovery is complete.

After a seed CSV exists, that seed remains the input of record for refresh and repair. Never
re-derive work from the query DB.

### 4. Separate adapter support from inventory completeness

An adapter pilot proves only that the source can be queried.

Determine adapter requirements during initial discovery. As soon as a vendor/source contract
is known, reuse an existing adapter or start the missing adapter scaffold, fixture, and bounded
test. Do not wait for seed completion. Do not run a pilot or scale source traversal until
readiness passes.

Track these independently on each source in `docs/<county>-sources.yaml` and in status reports:

- `adapter_unavailable`
- `pilot`
- `enumerating`
- `running`
- `cooling_down`
- `paused`
- `captured_complete`
- `loaded_complete`
- `manual_captcha_required`
- `login_required`
- `no_anonymous_search`
- `custodian_only`
- `source_missing`
- `supported_partial`
- `supported_full`

Never call a jurisdiction complete because one query or pilot succeeded.

### 5. Make every operation durable

- Use immutable seed, configuration, registry, and schema signatures.
- Create the durable run manifest at intake and record every stage transition.
- Emit an immutable, content-addressed handoff manifest at each cross-environment boundary.
- Use source-specific advisory locks inside the pipeline skills; do not invent a lock manager
  here.
- Checkpoint every independently committed unit.
- Preserve stable source identities.
- Use transactional, idempotent chunks (`ON CONFLICT` loads; resume means re-sending the same
  work).
- Verify committed rows after every chunk.
- Refuse incompatible checkpoint reuse.
- Resume pending work only; never reset completed work implicitly.

### 6. Bound all external operations

Every HTTP request, browser action, child process, database query, and transaction must have:

- a wall-clock deadline;
- bounded retries;
- exponential backoff with jitter;
- session rebuilding when appropriate;
- a circuit breaker and next-attempt timestamp.

Never retry indefinitely or increase source pressure blindly. Keep portal concurrency gentle
(permit workers start at 2; stepwise ramp-up). Never dump a whole county into a queue; use the
backpressure-aware seed feeder.

### 7. Reconcile source claims explicitly

Source totals are claims, not evidence. Apply the reconciliation identities in
[`readiness-and-completeness.md`](./readiness-and-completeness.md). A capped, truncated,
regressing, duplicated, or unreconciled source must fail closed.

### 8. Preserve valid unmatched records

- Never discard permits because a parcel match is unavailable.
- Retain valid unmatched records with null property links.
- Treat linkage quality as separate from source completeness.
- Never guess ambiguous parcel or address matches.
- Extract everything: capture raw HTML, keep unmapped fields in `source_payload`, log lexicon
  gaps.

### 9. Handle portal drift safely

Expect:

- result caps;
- missing links;
- temporary records;
- changing HTML controls;
- disappearing exports;
- session expiration;
- pagination drift;
- source totals larger than accessible rows;
- schema and header changes.

Use hidden stable identifiers where legitimately exposed, adaptive page sizes, date splitting,
exact type partitions, and reconciled list fallbacks.

Never convert a missing export, timeout, or absent link into “zero records.” Record the quirk
in `docs/<county>-sources.yaml` and the findings doc in the same piece of work.

### 10. Treat CAPTCHA and authentication as access states

- Never solve, bypass, OCR, or evade CAPTCHA.
- Never suppress automation detection.
- Never persist CAPTCHA tokens or browser cookies.
- A user-completed CAPTCHA is a short-lived capability lease, not durable authorization.
- Credentials prove authentication, not permission to automate.
- Respect vendor terms and custodian authority.
- If automation is prohibited, use an authorized API or official bulk-record request.
  Name the recipient per [`request-routing.md`](./request-routing.md).

Mark the source `manual_captcha_required`, `login_required`, `no_anonymous_search`, or
`custodian_only`. Continue independent workstreams.

### 11. Use concurrency safely

- Parallelize across independent custodians.
- Serialize requests per tenant or host.
- Apply source-specific rate limits from `docs/<county>-sources.yaml`.
- Do not distribute requests across IPs to evade source limits.
- Keep ordered database commits deterministic.
- Pipeline capture and transformation ahead of serial commits when the skills already do so
  safely.

### 12. Separate capture, load, publication, and completeness

Track independently:

- source reported;
- locally captured;
- normalized;
- committed;
- visible;
- linked;
- published.

A local file is not loaded data. Loaded data is not automatically published. Published partial
data is not complete coverage. S3 is internal orchestration/artifact storage only.

### 13. Build bounded observability

Dashboards must read durable rollups, not rescan large tables per request. Drive
`monitoring-county-ingestion` for queue health, S3 artifact counts, Neon counts, and ETAs. Do
not add a dashboard in this plugin kit.

Provide:

- cached aggregate snapshots;
- query and request deadlines;
- stale-last-good responses;
- source freshness timestamps;
- worker checkpoints;
- running, cooling, paused, CAPTCHA, login, software, and custodian states;
- separate local-capture and durable-load counts.

Never return private rows, addresses, folios, names, credentials, raw errors, or local paths.

### 14. Publish fail-closed

Follow the publication checklist in [`readiness-and-completeness.md`](./readiness-and-completeness.md).
**PII publish is human-approved, then automated.** The `Publish` object dry-runs until a
human POSTs `Publish/<county>/approve`; after that, `tick` uploads to Filebase/IPFS.
Coverage is public metadata and must use IPFS/IPNS only.

Availability must be typed:

- `unsupported`
- `supported_partial`
- `supported_full`

Never represent unsupported access as zero records.

### 15. Define completeness from evidence

A county may be marked complete only when every completeness gate in
[`readiness-and-completeness.md`](./readiness-and-completeness.md) passes. The completeness flag
is derived from frozen manifests — not adapter counts, dashboard labels, or pilot success.

### 16. Keep enrichment separate

Sunbiz, BBB, reviews, complaints, roofing classification, inspections, and contractor matching
are enrichment dimensions (`sunbiz-corporate-ingest`, `bbb-harvest`, `overture-places-ingest`).

Their absence must not silently change core permit completeness. Report their coverage
separately.

Official API and public-site scrape are different sources. Run any BBB public-site browser
on approved AWS-managed remote compute with US egress, never on the operator's machine. The
compute may be a job, container, or other approved AWS runner; it need not be a VM. This is
not API coverage or a completeness proof. A bureau category mixes in-county and out-of-county
addresses. Do not set `expected_count` from advertised listing totals without
`listing_page_cap` and `cap_acknowledged`. A small contractor-trade sample is not an
all-category census. See [`failure-modes.md`](./failure-modes.md).

### 17. Human-required actions

Stop and request human action for:

- CAPTCHA;
- API/login authorization;
- AWS remote-runtime or Filebase secret injection, requested at intake rather than at the
  blocked execution/publish stage;
- official records requests and fees (name office, portal, and system from
  [`request-routing.md`](./request-routing.md));
- privacy/legal approval;
- AWS IAM/OIDC setup;
- deployment blast-radius approval;
- acceptance of finite source gaps.

Never paste, log, or commit credentials.

## Required status report

Every status response must state:

- durable run state/revision, provenance digest, and next automatic transition;
- source boundary;
- reported/captured/loaded/published counts;
- linked and valid-unlinked counts;
- heartbeat, lease, checkpoint, and retry-budget freshness;
- active, cooling, paused, and blocked workers;
- exact blocker category;
- next automated action;
- required human action;
- whether county completeness is established;
- whether publication is unsupported, partial, or full.
- whether the loaded watermark is newer than the published watermark.

When one source is blocked, continue every independent safe workstream.

## Durable learning loop

After each county:

- Store changing counts, URLs, source states, and timestamps in
  `elephant-pipeline/docs/<county>-sources.yaml`.
- Store reusable rules, vendor signatures, identifier traps, pagination strategies, CAPTCHA
  states, and reconciliation patterns in this Oracle skill (`skills/use-oracle/`).
- Add a regression fixture under `skills/use-oracle/fixtures/readiness/`, named by
  **failure mode** (not by county), for every newly discovered readiness trap and cover
  it from `--self-test`.
- Update the relevant adapter support matrix.
- Record predecessor-system and delegation patterns.
- Do not leave reusable knowledge only in chat transcripts, local notes, or an agent’s
  temporary context.
- Revalidate older source catalogs when a learned rule reveals a possible historical coverage
  gap.
- PR findings docs to `Counties-trasform-scripts/<county>/docs/` as `county-discovery` already
  requires.
