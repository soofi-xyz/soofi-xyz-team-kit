---
name: dbpr-license-ingest
description: "Acquire, validate, and load the official Florida DBPR contractor-license identity baseline before permit harvest, including licenses, qualifiers, qualified-business relationships, status, and effective dates. Use on every Florida county ingest or re-ingest when DBPR adequacy is checked or stale."
metadata: {"author":"elephant-xyz"}
---
# DBPR License Ingest

Use Florida Department of Business and Professional Regulation (DBPR) records as the
official contractor-licensing layer. Run this skill after `sunbiz-corporate-ingest` and
before any permit harvest. It is statewide and county-neutral.

Do not invent a generic SID, canonical license entity, qualified-business table, or
permit-license foreign key. Do not load DBPR records into BBB reputation-license tables.
Load only fields and relationships supported by the deployed Query DB; retain unsupported
official records in the private snapshot and resolution ledger and report schema gaps.

## Inputs and outputs

Require:

- `<county>` and ingest-window/as-of rule;
- official DBPR source URL and posted/refreshed time;
- a private artifact root outside Git;
- Query DB destination proof and current schema inventory;
- prior DBPR manifest, when re-ingesting.

Produce:

- immutable private raw and normalized snapshots;
- SHA-256 digests, source URL, retrieval time, posted time, row counts, and field profile;
- reconciliation for licenses, qualifier/person relationships, qualified-business
  relationships, statuses, and effective periods;
- supported Query-DB load receipts and an immutable resolver handoff;
- one terminal adequacy result and explicit gap codes.

## 1. Run the adequacy gate

On every ingest or re-ingest, fail the gate unless the snapshot is all of:

1. official DBPR data, not BBB, Sunbiz, a permit portal, or a name list;
2. dated and fresh enough for the declared as-of rule;
3. immutable, digested, parsed, loaded into the operating snapshot, and reconciled;
4. inclusive of license number/type, status, licensee/qualifier records,
   qualified-business relationships, and applicable effective start/end dates;
5. able to support the permit attribution dates in scope.

Emit exactly one result: `adequate_reuse`, `adequate_acquired`, or `inadequate`.
An inadequate result enqueues acquisition immediately and blocks permit harvest. If a
current bulk file lacks relationship history, it is not adequate for historical
attribution; obtain the official relationship/history extract through DBPR public
records.

## 2. Acquire official DBPR records

Start at the official Construction Industry Public Records page:

`https://www2.myfloridalicense.com/construction-industry/public-records/`

Use its current **Construction** licensee download and layout/readme. DBPR describes the
download as weekly, comma/quote-delimited ASCII and warns that its public file excludes
some status classes. Record that boundary. For missing qualifiers, qualified-business
relationships, status classes, or relationship history, submit a request through the
official DBPR Open Government public-records portal:

`https://www2.myfloridalicense.com/open-government/`

Name the recipient and scope as: Florida DBPR, Construction Industry Licensing Board;
contractor licenses, licensees/qualifiers, qualified businesses, statuses, and effective
relationship dates for the requested ingest window. Do not broaden beyond public,
necessary identity fields.

Download at a conservative rate with no parallel requests. Stage the operator-selected
official file privately:

```bash
export COUNTY=<county>
export DBPR_AS_OF=<YYYY-MM-DD>
export DBPR_SOURCE_FILE=<downloaded-official-file>
export DBPR_PRIVATE_ROOT=<private-artifact-root>
test -s "$DBPR_SOURCE_FILE"
mkdir -p "$DBPR_PRIVATE_ROOT/dbpr/$DBPR_AS_OF/raw"
cp "$DBPR_SOURCE_FILE" "$DBPR_PRIVATE_ROOT/dbpr/$DBPR_AS_OF/raw/"
shasum -a 256 "$DBPR_PRIVATE_ROOT/dbpr/$DBPR_AS_OF/raw/"* \
  > "$DBPR_PRIVATE_ROOT/dbpr/$DBPR_AS_OF/SHA256SUMS"
```

Never put this snapshot, personal contact fields, or credentials in Git. Bind the source
page URL, selected download URL, posted date, retrieval time, request receipt (if used),
file size, and digest into the durable run manifest.

## 3. Normalize and verify

Parse the official layout without discarding columns. Preserve raw rows byte-for-byte.
Normalize license numbers only by the DBPR profile; preserve original values separately.
Represent open-ended effective periods as null end dates, never invented dates.
Quarantine malformed, future, or impossible dates and conflicting overlapping
relationships.

Use a checked-in runtime helper when one exists. On the current bundled baseline there is
no dedicated DBPR importer; do not mislabel
`src/permits/private-company-match.mjs` as one because it uses BBB/name/phone candidates
and is not authoritative DBPR temporal resolution. If a helper is later added, require:

```bash
cd skills/use-oracle/runtime
npm test
```

and record its command, version, input/output digests, checkpoints, and reconciliation in
the manifest before relying on it.

Verify:

- raw rows = parsed + quarantined rows;
- unique source keys and normalized license keys reconcile;
- every qualified-business edge references captured license/qualifier/business evidence;
- effective periods are valid and collisions remain separate;
- status and relationship coverage satisfy the declared attribution window;
- identical inputs and normalizer version reproduce identical output digests.

## 4. Load supported structures only

Inspect the deployed schema before writing. Load legal companies only through the
existing company/Sunbiz identity path when an exact official relationship resolves to an
existing `business_registrations.document_number` and `companies.company_id`. Keep DBPR
licenses, qualifiers, qualified-business relationships, statuses, and effective periods
in the private normalized snapshot and immutable resolver ledger unless reviewed schema
tables exist for them.

Never populate `business_reputation_license_id`, synthesize
`permit_contacts.license_number`, or write `permit_contacts.person_id` from a name.
Do not stamp permit company edges in this stage; `query-db-loading-matching` performs the
versioned resolver/backfill after permit capture.

## Gap codes and acceptance

Use these exact gap codes:

- `dbpr_official_source_unavailable`
- `dbpr_snapshot_stale`
- `dbpr_snapshot_unreconciled`
- `dbpr_qualifier_relationships_missing`
- `dbpr_qualified_business_history_missing`
- `dbpr_effective_dates_missing`
- `dbpr_status_boundary_incomplete`
- `dbpr_canonical_license_entity_unsupported`
- `dbpr_permit_license_edge_unsupported`
- `dbpr_resolver_provenance_unsupported`

Only the last three are schema-capability gaps; they do not excuse acquisition. Return
snapshot revision/digests, source boundary, posted/retrieved dates, counts, quarantines,
relationship-window coverage, supported rows loaded, adequacy result, gap codes, and the
next automated action. Permit harvest may proceed only after `adequate_reuse` or
`adequate_acquired`.
