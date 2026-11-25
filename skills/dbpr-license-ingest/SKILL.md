---
name: dbpr-license-ingest
description: "Look up the official Florida DBPR license detail for a license number printed on a permit, persist company, person, and license from that record, and map property_improvement_has_contractor, contractor_has_license, and contractor_has_person. Acquire the missing public-records relationship extract only for historical qualification when the permit has no license number."
metadata: {"author":"elephant-xyz"}
---
# DBPR License Ingest

Use Florida Department of Business and Professional Regulation (DBPR) records as the
official contractor-licensing layer. It is statewide and county-neutral.

When a permit prints a license number, use that license number, the person name, and
the company name only as search keys for the official DBPR license-detail lookup. Do
not persist a contractor company, person, or license copied from the permit portal.
Persist company, person, and license from the DBPR record. If DBPR returns no match,
write no contractor, person, or license. `source_http_request.url` on those records
is the official DBPR license-detail URL, not the permit page and not the Sunbiz
download page. The Sunbiz company detail URL rule stays: `search.sunbiz.org` by
document number, not the bulk file. Do not wait for a statewide relationship extract
before reading permits that already carry a license. Do not build the whole
license–company graph from the bulk file and then harvest. Require the missing
public-records extract only for historical qualification when the permit has no
license number.

Write `property_improvement_has_contractor` from `property_improvement` to `company`.
The contractor is the company, not a separate class. Write `contractor_has_license`
from `company` to `license`. Relationship objects are only `from` and `to`. The
license id is `license_identifier` on class `license`. Write `contractor_has_person`
from `company` to `person` (schema title `company_to_person`). The person is an
object with `first_name` and `last_name`, not a string field. There is no license
field on the person. Lexicon PR 178 requires `license_identifier` to be non-empty and
adds `source_http_request` and `request_identifier` on `license`.
`license_identifier` is already on main. If the live manifest does not yet include
those license fields or these edges, record the gap and do not substitute another
edge.

Do not invent a generic SID, a license field on the person, or a separate contractor
class. Do not mix DBPR records into BBB reputation output. Write only the classes and
fields the live lexicon manifest has; retain unsupported official records in the private
snapshot and resolution ledger and report schema gaps. The lexicon output still carries
the three edges above from the DBPR record, as relationship files, never SQL rows.

## Inputs and outputs

Require:

- `<county>` and ingest-window/as-of rule;
- official DBPR source URL and posted/refreshed time;
- a private artifact root outside Git;
- the live lexicon manifest URL;
- prior DBPR manifest, when re-ingesting.

Produce:

- immutable private raw and normalized snapshots;
- SHA-256 digests, source URL, retrieval time, posted time, row counts, and field profile;
- reconciliation for licenses, qualifier/person relationships, qualified-business
  relationships, statuses, and effective periods;
- lexicon output files (`classes/` + `relationships/`) for supported structures and an
  immutable resolver handoff (the resolution ledger JSONL);
- one terminal adequacy result and explicit gap codes.

## 1. Run the adequacy gate

On every ingest or re-ingest, fail the gate unless the snapshot is all of:

1. official DBPR data, not BBB, Sunbiz, a permit portal, or a name list;
2. dated and fresh enough for the declared as-of rule;
3. immutable, digested, parsed, written to the private normalized snapshot, and
   reconciled;
4. inclusive of license number/type, status, licensee/qualifier records,
   qualified-business relationships, and applicable effective start/end dates;
5. able to support the permit attribution dates in scope.

Emit exactly one result: `adequate_reuse`, `adequate_acquired`, or `inadequate`.
An inadequate relationship-history result enqueues the public-records extract and
blocks historical qualification for permits that omit a license number. It does not
block reading permits that already print a license number; look those up on the
official license-detail record first. If a current bulk file lacks relationship
history, it is not adequate for historical attribution; obtain the official
relationship/history extract through DBPR public records. Require that extract only
when the permit has no license number.

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
no dedicated DBPR importer; do not mislabel a BBB/name/phone candidate matcher as one,
because it is not authoritative DBPR temporal resolution. If a helper is later added, require:

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

## 4. Write supported lexicon structures only

Read the live lexicon manifest before writing output. Persist company, person, and
license from the DBPR record as lexicon class files, and link a company to its Sunbiz
company only when an exact official relationship resolves to one Sunbiz
`document_number`. Write `property_improvement_has_contractor`,
`contractor_has_license`, and `contractor_has_person` as relationship files. Keep
statuses and effective periods in the private normalized snapshot and the immutable
resolution ledger when the lexicon has no field for them.

Never copy a BBB reputation license onto a DBPR license, synthesize a license number
on a raw permit contact, or link a person from a name. Do not emit permit company edges
in this stage; the permit identity stage emits them with the versioned resolver after
permit capture, recording resolver version and snapshot digests in the resolution
ledger beside the job's permit artifacts (reconcile section of `county-ingest-run`).

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

Emit `dbpr_canonical_license_entity_unsupported` only when the live lexicon manifest
has no `license` class. Emit `dbpr_permit_license_edge_unsupported` only when that
manifest lacks `contractor_has_license`, `property_improvement_has_contractor`, or
`contractor_has_person`. Once those are present, write them and do not emit those
codes. `dbpr_resolver_provenance_unsupported` remains a schema-capability gap. None of
these codes excuse acquisition, and none authorize a permit-portal copy or a
substitute edge. Return snapshot revision/digests, source boundary, posted/retrieved
dates, counts, quarantines, relationship-window coverage, supported records written,
adequacy result, gap codes, and the next automated action. Read permits that already
print a license number through the official license-detail lookup without waiting for
this extract. Historical qualification of permits with no license number proceeds
only after `adequate_reuse` or `adequate_acquired`.
