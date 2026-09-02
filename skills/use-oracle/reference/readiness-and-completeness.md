# Readiness and completeness

County readiness is **enforced** by
`skills/use-oracle/scripts/validate-county-readiness.py`. A checklist is not sufficient.
`onboard-county`, `county-seed-data`, and `county-ingest-run` (pilot or full) MUST run the
validator and STOP on a non-zero exit.

The machine-readable county source catalog is
`elephant-pipeline/docs/<county>-sources.yaml` — the same file `county-discovery` already
writes. Do not create `Counties-trasform-scripts/<county>/sources/sources.json`.

Human findings stay in `elephant-pipeline/docs/<county>-county-findings.md` and are PR'd to
`Counties-trasform-scripts/<county>/docs/`.

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
- Appraisal access method and safe throughput
- One permit entry per jurisdiction or delegated authority
- Official custodian, portal, vendor, and tenant/agency identifier
- Record-search capability versus application-submission capability
- Anonymous, authenticated, CAPTCHA, manual, or custodian-only access state
- Earliest accessible record date and known exclusions
- Adapter status and test evidence
- Reported count and enumeration strategy
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
  elephant-pipeline/docs/<county>-sources.yaml
```

**STOP** before `county-seed-data`, adapter scale-out, or `county-ingest-run` while any gate
is `BLOCKED`. This applies when `onboard-county` is invoked directly.

Bounded discovery probes are permitted before readiness validation.

Report each gate as:

- `PASS`
- `BLOCKED`
- `APPROVED_EXCEPTION`
- `NOT_APPLICABLE`

A readiness report must name the evidence, blocker owner, required action, and next permissible
automated action.

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
- Determine result caps, pagination behavior, date boundaries, record-type partitions, session
  requirements, and anonymous-access limits before scaling.
- Blocked or unavailable jurisdictions must remain visible in coverage.

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
dup/null folios — never skip the reconcile. Regenerate `PROPERTY_QUERY_TABLE_MAP` from
`oracle-node/catalog/published-counties.json` or MCP `listPublishedCounties`. Do not embed a
four-county default list in this skill.

**PII publish is human-approved, then automated:** dry-run until a human POSTs
`Publish/<county>/approve`; then `tick` uploads. Do not skip approval, and do not require the
human to run the upload command except as break-glass.

Availability must be typed `unsupported`, `supported_partial`, or `supported_full`. Never
represent unsupported access as zero records.

## Non-normative regression examples

These examples are regression cases, not permanent runtime constants. Always refresh live
source evidence. Encoded fixtures (must keep passing `--self-test`):

- `fixtures/readiness/broward-2026.yaml` — GIS-only seeding BLOCKED (~26.6% discrepancy)
- `fixtures/readiness/hillsborough-unclassified-permits.yaml` — parcel PASS; permit BLOCKED
  while Temple Terrace remains `needs-review`
- `fixtures/readiness/ready-minimal.yaml` — PASS; seed and ingest allowed

### Broward (dated 2026 discovery snapshot)

- GIS exposed approximately 556,230 features.
- The preliminary DOR roll reported approximately 758,147 assessed real-property parcels.
- GIS-only seeding must fail readiness because the approximately 26.6% difference is material.
- The resolution must address tax-roll ingestion, condominium units, geometry-null properties,
  and final reconciliation.
- Broward contains 31 municipalities plus unincorporated or delegated jurisdictions.
- ePermits OneStop must not be assumed to contain unified historical municipal permit records.

### Hillsborough (dated 2026 discovery snapshot)

- GIS exposed approximately 531,612 features.
- DOR reported approximately 530,915 real-property parcels.
- The approximately 0.13% difference may pass after source-vintage reconciliation.
- Permit discovery must still cover unincorporated Hillsborough, Tampa, Plant City, and Temple
  Terrace separately.
