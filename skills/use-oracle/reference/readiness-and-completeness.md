# Readiness and completeness

County readiness is **enforced** by
`skills/use-oracle/scripts/validate-county-readiness.py`. A checklist is not sufficient.
`onboard-county`, `county-seed-data`, and `county-ingest-run` (pilot or full) MUST run the
validator and STOP on a non-zero exit.

The machine-readable county source catalog is
`skills/use-oracle/runtime/docs/<county>-sources.yaml` — the same file `county-discovery`
already writes. Do not create `Counties-trasform-scripts/<county>/sources/sources.json`.

Human findings stay in `skills/use-oracle/runtime/docs/<county>-county-findings.md` and are
PR'd to `Counties-trasform-scripts/<county>/docs/`.

Read the YAML catalog before any refresh. When a probe reveals a quirk, incident, or URL
change, update the YAML in the same piece of work.

## County source catalog fields

Record the following in `docs/<county>-sources.yaml`:

- County name, state, canonical slug, and FIPS
- Source snapshot and verification times
- Required history boundary
- Current jurisdictions and required predecessor systems
- Canonical assessed-property source and count
- Tax-roll year and preliminary/final/certified status
- Geometry source and feature count
- Parcel identifier formats and exact join keys
- Count discrepancy, explanation, and seed decision
- `parcel.separately_assessed_without_geometry` (`acknowledged` or `none`) when GIS is below assessed
- Appraisal access method and safe throughput
- One permit entry per jurisdiction or delegated authority
- `permits.assumes_unified_countywide_history` (must not be true)
- Official custodian, portal, vendor, tenant/agency identifier, and `portal_kind`
- Record-search / `historical_records` versus application-submission capability
- Anonymous, authenticated, CAPTCHA, manual, or custodian-only access state
- Earliest accessible record date and known exclusions
- Adapter family, reuse decision, implementation status, fixture, and test evidence
- Reported count, enumeration strategy, and enumeration status
- Pagination, result-cap, partition, and drift behavior
- Safe concurrency and full-run estimate
- Publication rights and privacy constraints
- Required infrastructure and destination identity
- Approved exceptions and unresolved blockers

## County Readiness Preflight

Run the validator after bounded `county-discovery` and catalog updates, and again before
seed, pilot, or full ingestion:

```bash
python3 skills/use-oracle/scripts/validate-county-readiness.py \
  skills/use-oracle/runtime/docs/<county>-sources.yaml
```

**STOP** before `county-seed-data`, adapter pilots/scale-out, or `county-ingest-run` while
any gate is `BLOCKED`. This applies when `onboard-county` is invoked directly.

At intake, automatically begin bounded source/jurisdiction enumeration, adapter
fingerprinting and implementation scaffolds, AWS remote BBB execution setup, destination
proof, Filebase credential-readiness checks, and named records-request preparation. These
independent preparation tracks continue while a readiness gate is blocked; bulk traversal
and pilots do not.

Report each gate as:

- `PASS`
- `BLOCKED`
- `APPROVED_EXCEPTION`
- `NOT_APPLICABLE`

A readiness report must name the evidence, blocker owner, required action, and next permissible
automated action.

The validator returns `preparation_allowed`, `execution_allowed`,
`required_blocker_actions`, and `next_automated_actions`. Execute every safe continuation
action while blocked. On PASS, enqueue the next dependency-ready stage from the durable run
manifest without waiting for operator confirmation.

### Jump-of-ingest rules (every county)

Apply these before seed on the county in front of you. They are reusable failure modes,
not a roster of special counties:

- GIS polygons are not the assessed-property population. Compare GIS to the tax roll.
- If counts differ, `parcel.discrepancy_explanation` is required. Above the 2% threshold,
  GIS-only seeding is BLOCKED until an approved exception names the cause, canonical
  denominator, seed decision, excluded population, and coverage effect.
- If GIS is below assessed, set `separately_assessed_without_geometry` so condominium and
  other units without unique geometry are not dropped.
- Enumerate every incorporated, unincorporated, delegated, and predecessor jurisdiction.
  No `needs-review`. A close parcel match does not skip municipal permit discovery.
- Never treat a county one-stop, application-intake, or supplemental-approval portal as
  unified historical municipal permits (`assumes_unified_countywide_history` must not be
  true; `portal_kind` in that family cannot have `historical_records: true`).

### Parcel readiness gate

- Distinguish assessed tax parcels from GIS geometry features.
- GIS polygons are not automatically the complete property population.
- Compare county appraiser, tax-roll/NAL, and GIS counts when available.
- Use the tax roll or equivalent assessed-property roll as the canonical population unless an
  explicit decision establishes another source.
- Preserve condominium and separately assessed units without unique geometry.
- Join geometry where available; never fabricate it.
- Treat identifiers as strings and preserve leading zeros and punctuation.
- Prove representative identifiers against the owning source.
- Use a configurable discrepancy threshold, defaulting to 2%.
- If sources differ beyond the threshold, stop until the cause, canonical denominator, seed
  decision, excluded population, and coverage effect are documented and approved.
- Never publish a GIS-feature count as complete assessed-property coverage without
  qualification.

### Permit readiness gate

- Enumerate every incorporated, unincorporated, delegated, and required predecessor
  jurisdiction.
- Cataloged jurisdiction count must equal the expected jurisdiction count.
- Classify every jurisdiction as supported, delegated, manual-only, blocked, unavailable,
  excluded, or custodian-only.
- No jurisdiction may remain `needs-review` before full ingestion.
- Prove whether each portal exposes historical permit records, not merely application
  submission or supplemental county approval.
- Identify one authoritative source boundary per jurisdiction and historical period.
- Every required vendor must have a reusable adapter, test fixture, throughput measurement, or
  explicit implementation plan (`county-permit-adapter` / Accela template / generic path).
- Determine this during initial discovery and start missing adapter scaffolds, fixtures, and
  bounded tests as soon as the source contract is known. Do not wait for parcel ingestion.
- Determine result caps, pagination behavior, date boundaries, record-type partitions, session
  requirements, and anonymous-access limits before scaling.
- Blocked or unavailable jurisdictions must remain visible in coverage.
- For `blocked`, `custodian-only`, and `manual-only` rows, catalog `records_request` with
  `recipient_office`, `system_scope`, `route` (`api-first` or `records-first`), and a
  portal URL or email (`reference/request-routing.md`).

### Destination readiness gate

Before writes, independently prove through `bootstrap-oracle-infra` and
`query-db-loading-matching`:

- Database project and branch
- Endpoint and role
- Environment classification
- Migration state
- Writer connection type
- Required schemas and tables
- Advisory-lock namespace
- Idempotency and source-key contracts
- Publication bucket and IPNS ownership when publication is in scope

Refuse to write if the target cannot be independently proven. Do not open writer connections
from this plugin.

Start destination and publication readiness at intake. Verify the Filebase credential by
secret identifier/availability and a safe runtime check—never by storing its value in the
catalog—plus the target bucket and IPNS owner. If access is missing, request secret injection
immediately and continue independent discovery and adapter work.

When `destination.writes_in_scope` is true and `proven` is true, list at least two
`independent_identity_sources` (for example Neon console project/branch **and** configured
branch/endpoint IDs). Do not copy expected IDs from the connection under test.

### Enrichment readiness gate

Sunbiz, BBB, and places do not control permit completeness. If `enrichment.bbb.expected_count`
equals `advertised_listing_count`, the catalog must also set `listing_page_cap` and
`cap_acknowledged: true`. Advertised directory totals are not harvestable census counts.

## Readiness validation

The validator fails (`exit 1`) when:

- Required source metadata is missing
- The canonical parcel denominator is unresolved
- A material count discrepancy lacks an approved resolution
- Identifier resolution has not been proven
- Jurisdictions are missing or unclassified
- A central submission portal is incorrectly treated as a historical record source
- A required adapter has no implementation plan
- Enumeration boundaries or result caps are unknown
- Throughput and full-run duration are unknown
- The destination cannot be independently proven
- `destination.proven` is true without two independent identity sources
- A blocked / custodian-only / manual-only jurisdiction lacks `records_request`
- BBB `expected_count` copies an advertised listing total without a page-cap acknowledgment
- Publication targets or approvals are missing when publication is in scope
- Existing checkpoints do not match the current source, registry, configuration, or schema
  signatures

## Reconciliation identities

Source totals are claims, not evidence.

For every source or partition, prove:

```text
reported = received + explicit_source_missing

received =
  normalized
  + excluded_nonpermit
  + invalid

normalized =
  unique_logical
  + duplicate_extra

unique_logical =
  linked
  + valid_unlinked
```

A capped, truncated, regressing, duplicated, or unreconciled source must fail closed.

Drive `monitoring-county-ingestion` for artifact vs Neon counts. Map:

- reported → source-claimed totals in the catalog
- received / captured → local/S3 artifact counts
- normalized / unique_logical → transform outputs (`validate-county-transform`)
- committed / loaded → Neon counts from `query-db-loading-matching`
- linked / valid_unlinked → match results (null property links are valid unmatched records)
- published → query-table / coverage IPNS after remote readback

## Completeness evidence gates

A county may be marked complete only when all of the following pass:

**BOUNDARY GATE.** Every current jurisdiction and required predecessor system has an
authoritative, explicit source boundary.

**TERMINAL GATE.** No pending, running, cooling, capped, truncated, or retryable work remains.

**RECONCILIATION GATE.** Every source and partition satisfies the reconciliation equations.

**EXCEPTION GATE.** Every missing or failed record is finite, identified, and explicitly
accepted.

**DURABILITY GATE.** Raw snapshot digest, manifest, terminal checkpoint, and chunk receipts
exist.

**IDEMPOTENCE GATE.** An identical reload produces the same logical counts and no duplicate
source keys.

**QUERY GATE.** Published property and permit rows match the frozen loaded IDs, and remote
Donphan queries succeed.

**PROVENANCE GATE.** The completeness flag is derived from frozen manifests — not adapter
counts, dashboard labels, or pilot success.

Never set `oracle_dataset_coverage.expected_count` as if a source were complete unless these
gates pass for that source. Enrichment gaps (Sunbiz, BBB, places) must not silently change
core permit completeness.

## Publish fail-closed

Before publication:

- create privacy-approved derivatives;
- reconcile artifact rows with loaded logical IDs;
- verify schema and joins;
- hash immutable bytes;
- upload immutable content first;
- perform remote readback;
- verify counts and representative queries;
- add a catalog entry only after readback passes.

Existing query-table GATE still applies: parquet rows == distinct folio in the query DB, 0
dup/null folios — never skip the reconcile. Regenerate `PROPERTY_QUERY_TABLE_MAP` from this
kit's bundled `skills/use-oracle/runtime/catalog/published-counties.json` (via
`npm run catalog:sync-mcp-json --prefix skills/use-oracle/runtime`) or MCP
`listPublishedCounties`. Do not embed a four-county default list in this skill.

**PII publish is human-approved, then automated:** dry-run until a human POSTs
`Publish/<county>/approve`; then `tick` uploads. Do not skip approval, and do not require the
human to run the upload command except as break-glass.

Apply the atomic completion and snapshot-drift rules in
[`continuous-ingestion.md`](./continuous-ingestion.md). A capture or load milestone is not
done; completion requires remote publication readback and MCP visibility. A newer loaded
watermark marks publication stale and automatically queues a replacement immutable snapshot;
execute that queue under [`continuous-safe-optimization.md`](./continuous-safe-optimization.md).

Availability must be typed `unsupported`, `supported_partial`, or `supported_full`. Never
represent unsupported access as zero records.

## Failure-mode fixtures

These fixtures prove the jump-of-ingest rules. They are not a list of counties to treat
as special cases. Numbers inside a fixture are illustrative. Always refresh live source
evidence for the county being ingested.

| Fixture | Mode |
|---|---|
| `fixtures/readiness/material-gis-assessed-discrepancy.yaml` | Material GIS vs tax-roll gap; GIS-only seed BLOCKED |
| `fixtures/readiness/unclassified-permit-jurisdiction.yaml` | Parcel PASS; unclassified municipality BLOCKED |
| `fixtures/readiness/unified-portal-not-municipal-history.yaml` | County one-stop is not municipal permit history |
| `fixtures/readiness/ready-minimal.yaml` | PASS |
| `fixtures/readiness/blocked-without-request-route.yaml` | Blocked/custodian/manual-only rows need `records_request` |
| `fixtures/readiness/advertised-listing-count-is-not-harvestable.yaml` | Advertised BBB listings are not `expected_count` without a page-cap acknowledgment |

Provenance: these modes were learned during 2026 Florida ingests (large GIS-under-tax-roll
gaps with condo/geometry-null units; close GIS/tax-roll match that still required separate
municipal permit sources; central e-permits portals that were not historical coverage).
Keep the rules; do not hard-code those county names into runtime behavior.
