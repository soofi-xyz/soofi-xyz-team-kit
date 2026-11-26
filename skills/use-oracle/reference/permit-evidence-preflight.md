# Permit evidence preflight and decision contract

Apply this contract to every county, permit authority, source system, and historical
period before using permit data for a lead, status, lifecycle, scope, property-link,
longitudinal, company, or license conclusion. Run it after county readiness discovery
and before a permit pilot, targeted repair, investigation, reconciliation-derived conclusion, or
publication.

This preflight supplements the county readiness validator; it does not replace it.
Keep county-specific URLs, status mappings, identifier rules, date semantics, coverage
windows, thresholds, and safe throughput in the county/source catalog and permit
profile. Do not encode them in this generic contract.

## Keep status layers separate

Keep durable run states and source-access states from the existing Oracle vocabulary.
For each source record and decision-critical field, assign exactly one field evidence
state:

| Evidence state | Meaning |
|---|---|
| `confirmed_present` | An official, decision-capable source returned a usable value and its immutable capture is retained. |
| `confirmed_empty` | A successful official detail/contact lookup proved that the capable field or section was present but empty. A blank listing column is not enough. |
| `unavailable` | The source or endpoint does not expose the field, is inaccessible, or requires a custodian route. Never convert this state to empty. |
| `stale` | Evidence exists, but its observation time, source fingerprint, or detail fingerprint is outside the profile's accepted freshness contract. |
| `conflicting` | Eligible source observations disagree and the source profile does not establish a defensible precedence rule. |
| `invalid_quarantined` | A value fails source-profile format, chronology, range, or identity checks. Retain the raw value and provenance, but exclude it from decision anchors. This is the machine-safe spelling of “invalid/quarantined.” |
| `unknown` | The field was not observed well enough to classify into another state, including a nonterminal listing row with no filing date or detail. |

Use an existing decision outcome such as `needs_review` when a downstream schema already
provides it. Do not overload `supported`, `blocked`, `source_cap`, or other source/run
states as field evidence states.

## Build the capability and coverage matrix

Create or refresh one matrix row per `(county, jurisdiction, source, historical period)`.
Freeze it with the durable run manifest. Record:

- county, jurisdiction, source key/system, official source role, and observation time;
- catalog/profile digests, adapter key, source fingerprint, and
  `detailFingerprintVersion`;
- source coverage start/end, requested inference window, expected count when known,
  enumeration status, and current/predecessor/archive gaps;
- pagination, caps, stable record keys, list/detail/contact routes, and the official
  adapter used for each route;
- safe rate/concurrency and the profile evidence that established them;
- capabilities for indexed/list status, live detail status, filing/issue/final/
  completion dates, inspections/events, full description/scope, parcel identifier,
  contractor role/name/company/license, and source legal identifiers;
- per-field counts for every evidence state, plus detail candidates, attempted details,
  successful details, and terminal repair failures;
- immutable artifact/manifest locations, content digests, and reconciliation status.

Keep an unknown expected count as `null`, not zero. A supported adapter proves an
executable route; it does not prove field capability, historical completeness, or
successful capture.

## Repeat the preflight

1. Freeze the repository/tree, catalog, profile, adapter, schema, configuration, source,
   and checkpoint signatures in the durable run manifest.
2. Select a bounded, representative sample from stable source record keys. Include old
   and recent records, mapped and unmapped statuses, blank indexed fields, malformed
   identifiers, and records expected to have contractor/detail data. Do not begin a
   broad scrape.
3. Compare list/index evidence with live detail, contact, inspection, and event evidence
   through official adapters. Preserve every observation independently with its capture
   time and digest.
4. Prove the accessible historical start/end, expected inventory or explicit unknown,
   pagination/caps, and every predecessor/archive boundary needed by the requested
   inference.
5. Assign one field evidence state per sampled record and decision-critical field. Open
   or update the structured gap ledger for every non-`confirmed_present` result and for
   any decision that requires a confirmed absence.
6. Plan only decision-critical repairs. Bind the bounded candidate IDs and all input
   digests into an immutable plan before execution.
7. Run the acceptance checks below. Permit ingest may retain unknown/null fields, but no
   derived conclusion or publication may represent unresolved evidence as confirmed.

Re-run this preflight when a source, profile, detail fingerprint, status vocabulary,
historical boundary, or decision window changes.

## Apply decision gates

### Contractor assignment

- Confirm an assignment only from an official permit detail/contact record that names
  the contractor role and retains source evidence.
- Declare an “unassigned” lead only when a successful lookup against a source proven
  capable of contractor detail yields `confirmed_empty`.
- Treat a blank list/index column, listing-only route, failed detail, or source with
  `not-exposed`/`unknown` contractor capability as `unavailable` or `unknown`, then
  create bounded detail/contact repair work.
- Preserve source-name attribution when a historical permit names a contractor or
  qualifier but omits a license or immutable legal ID. Do not promote a likely license
  or entity to permit-proven.

### Current/open status

- Refresh decision-critical status from the live detail source. Preserve indexed status,
  indexed observation time, live status, live observation time, and both artifacts.
- If a newer authoritative detail supersedes an older index under the profile's
  precedence rule, mark the indexed evidence `stale` and use the live value.
- If observations disagree without proven order or precedence, mark the status
  `conflicting` and the open/terminal decision `needs_review`.
- Classify nonterminal rows with missing filing dates or missing details as `unknown`.
  Queue bounded source-specific detail work; do not include or exclude them by guess.

### Lifecycle and decision dates

- Fetch detail, event, and inspection evidence when issue, final inspection, close, or
  completion is decision-critical.
- Never synthesize a missing date from status, list order, permit number, application
  date, neighboring records, or another lifecycle date.
- Validate parsing, calendar validity, source-profile ranges, future dates, and chronology
  before using a date. Apply only chronology rules justified by that source's semantics.
- Mark impossible dates and migration artifacts `invalid_quarantined`. Preserve the raw
  value, field label, source record key, capture time, and digest. Do not use the value
  as an age, status, or work-window anchor.

### Scope and work classification

- Fetch detailed descriptions when flat type, trade, or scope fields cannot distinguish
  accessory work, replacement, repair/coating, or an ambiguous application.
- Require explicit source text for a positive work classification. An application/open
  date alone is not proof that work occurred.
- Keep unresolved or contradictory scope as `needs_review`; do not force it into an
  include/exclude class.
- Put source terms and classification mappings in the county/source profile and test
  them with fixtures.

### Property linkage

- Retain the raw parcel identifier. Apply only the county/source profile's proven,
  lossless normalization and record the normalization version.
- Prove that normalization is one-to-one for the source population and preserves
  meaningful leading zeros, segments, and check characters.
- Mark unsupported or malformed identifiers `invalid_quarantined` with raw evidence.
  Keep ambiguous records valid-unlinked; never choose a property link by guess.

### Roof-age estimation and longitudinal absence

Estimate primary roof age from the property's built/home year plus accepted roofing
permits. Keep this rule county-neutral; put source vocabulary and status mappings in the
county/source profile. Execute the policy through
`skills/use-oracle/runtime/src/roof-age/estimator.ts`; transforms and permit extraction provide
profile-owned source terms and evidence-state inputs, while the estimator owns precedence,
date rejection, deterministic tie-breaking, and the versioned output contract.

1. Classify work only from explicit source text retained in detail/scope evidence.
   Require a profile-tested class of `primary_roof_replacement`,
   `primary_roof_new_construction`, `repair_or_coating`, or `accessory_roof`.
   Unresolved or contradictory scope is `needs_review`.
2. Accept a replacement/reroof anchor only when the permit is completed and has a valid
   completion or close date. Use the latest accepted anchor. This resets the primary
   roof age with **high** confidence.
3. If no later accepted replacement exists, accept a completed new-construction permit
   with a valid completion or close date. This sets **medium** confidence.
4. Otherwise use a valid built/home year as the anchor with **low** confidence.
5. An open replacement does not reset age. Repair, coating, gazebo, awning, and other
   accessory-roof work never reset primary roof age.

Never synthesize a missing date. Exclude `invalid_quarantined` or chronologically
impossible dates from anchors. If no valid anchor remains, the estimate is ineligible.

Record coverage start/end, expected count or explicit unknown, captured count,
reconciliation, and predecessor/archive gaps. Partial, capped, unknown, or blocked
historical coverage does **not** make an otherwise valid roof-age estimate ineligible;
it lowers certainty through an explicit coverage caveat because an unobserved later
replacement may exist. Do not use partial history to assert that no replacement
occurred, and do not upgrade low/medium confidence because a portal returned no later
permit. Treat estimator confidence as confidence in the accepted anchor, not certification
of physical condition or proof of longitudinal absence.

### Corporate and license attribution

- Apply the permit-to-company/license sequence below. Keep permit attribution,
  licensing-authority identity, and corporate-registry identity as separate evidence
  layers.
- Treat existing BBB name/license/phone matcher results as discovery candidates only.
  BBB reputation records are not authoritative DBPR license or qualified-business
  evidence.
- Never fuzzy-merge companies or infer a permit license/entity from a name alone.

## Resolve permit company and license identity

Run this sequence for every county/source when permit contractor attribution is in
scope. For Florida, use Sunbiz as the official corporate registry and DBPR as the
official contractor licensing authority. For another state, name equivalent official
authorities in the source profile and apply the same gates.

When a permit prints a license number, follow this route. Do not use the bulk-file-first
order for that permit.

1. **Read the permit as search keys only.** Capture the person name, the company name,
   and the license number when the portal prints one. Do not persist a contractor
   company, person, or license copied from the permit portal. Keep the raw values,
   including an omitted license number, as search keys and source evidence.
2. **Look up the official license detail** for that number (`dbpr-license-ingest` in
   Florida). Do not wait for a statewide relationship extract before reading permits that
   already carry a license. If DBPR returns no match, write no contractor, person, or
   license.
3. **Persist company, person, and license from the DBPR record.**
   `source_http_request.url` on those records is the official DBPR license-detail URL,
   not the permit page and not the Sunbiz download page. Then resolve the Sunbiz
   company. The Sunbiz company detail URL rule stays: stamp that company with a GET of
   `search.sunbiz.org` by its document number (`sunbiz:<documentNumber>:company`), not
   the bulk file.
4. **Write these lexicon edges.** Relationship objects are only `from` and `to`.
   - Write `property_improvement_has_contractor` from `property_improvement` to
     `company`. The contractor is the company, not a separate class.
   - Write `contractor_has_license` from `company` to `license`. The license id is
     `license_identifier` on class `license`. Lexicon PR 178 requires
     `license_identifier` to be non-empty and adds `source_http_request` and
     `request_identifier` on `license`. `license_identifier` is already on main.
   - Write `contractor_has_person` from `company` to `person` (schema title
     `company_to_person`). The person is an object with `first_name` and `last_name`,
     not a string field. There is no license field on the person.
   If the live manifest does not yet include those license fields or these edges,
   record the gap and do not substitute another edge.
5. **Do not build the whole license–company graph from the bulk file and then harvest.**
   Require the missing public-records extract only for historical qualification when the
   permit has no license number. Until that extract supports one historical qualification,
   keep a permit that omits the license number as source-name attribution. Do not infer a
   license from a name.

Use official public records/downloads at a conservative rate, write a private snapshot
with provenance/digests, write supported lexicon records, and record remaining schema gaps without
inventing a SID, a license field on the person, or a separate contractor class. A missing
relationship extract is not a terminal recorded gap. It does not authorize a name match,
and it does not block reading permits that already print a license number.

### Use the supported identity vocabulary

Verify the live lexicon manifest before each run. There is no SQL working store; identity
lives in lexicon records and relationship files, and resolution evidence lives in a
private resolution ledger file.

- Class `company` — the legal business. Stamp each Sunbiz company with
  `request_identifier` `sunbiz:<documentNumber>:company` and a `source_http_request`
  GET of its `search.sunbiz.org` detail URL. The Sunbiz document number is the legal
  registration identifier; `request_identifier` is a source request key, not an
  official SID.
- `source_identifier` — a parcel-seed request field in the runtime. It is not a company,
  license, permit, or person identity.
- Class `property_improvement` — the permit. `(source_system, source_record_key)` is the
  permit's source uniqueness contract.
- Raw permit identity evidence — raw name, printed license number and type, contact role,
  `qualifierName`, and the source payload — stays in the permit's `raw/` and `extracted/`
  artifacts under `data/artifacts/permits/<county>/<jobId>/`. It is evidence, not a
  resolved identity.
- BBB reputation-profile license values are reputation evidence. They are not a DBPR
  license identity and must not be used as one.

No field named `SID` exists. The lexicon license identity is class `license`, property
`license_identifier`. Link it with `contractor_has_license` (`company` → `license`). Link
the permit with `property_improvement_has_contractor` (`property_improvement` →
`company`). Link the person with `contractor_has_person` (`company` → `person`, schema
title `company_to_person`). Relationship objects are only `from` and `to`. Do not
fabricate a `license_id`, an official SID, a license field on the person, or a separate
contractor class. If the live lexicon manifest does not yet include these edges or
`license.source_http_request` and `license.request_identifier` (lexicon PR 178 is not
necessarily merged), record the gap and do not substitute another mapping.

Emit those relationship files only when the resolution is backed by an immutable
resolution-ledger record described below. If the runtime cannot retain and reconcile
that provenance, record `identity_edge_provenance_unsupported` and leave the edge
unresolved.

### Pass the registry prerequisite gate

A permit that prints a license number does not wait on this gate. Look up that number's
official license detail, then the Sunbiz company. Clear the public-records relationship
extract, and item 3, only before historical qualification of a permit that has no
license number:

1. A transformed, reconciled Sunbiz snapshot containing companies, business
   registrations, document numbers, public filing roles, source record keys, snapshot
   time, artifact digest, and freshness state.
2. An **adequate** official DBPR snapshot: official source, parsed, reconciled, dated,
   and covering the ingest window with licenses, qualifier/person relationships,
   qualified-business relationships, status, and effective dates, plus source record keys,
   snapshot time, and artifact digest. Missing, stale, unreconciled, empty, BBB-only, or
   name-only contractor lists are not adequate.
3. A documented as-of rule proving the snapshots and effective periods support the
   permit attribution date. A current snapshot without relationship history does not
   prove a historical company relationship.

Sunbiz is first among identity sources and is authoritative for Florida legal entities,
document numbers, and public filing roles. It is not the licensing authority and does not
provide DBPR license IDs. A named Sunbiz officer, registered agent, or other party is not
a canonical individual identity solely because the name appears in a filing.

DBPR is not optional. It is authoritative for contractor license number, status,
qualifier, qualified business, and effective relationship dates. Do not substitute BBB, a
permit portal, Sunbiz, a search engine, or name similarity for DBPR.

On ingest or re-ingest: stamp each Sunbiz company through `sunbiz-corporate-ingest`.
When a permit prints a license number, look up the official license detail for that
number through `dbpr-license-ingest`, then the Sunbiz company. Do not wait for a
statewide relationship extract before reading those permits. If the permit has no
license number, acquire the official relationship/history extract next and block only
that historical qualification until it is adequate or the operator aborts. Write
whatever supported lexicon records exist; record remaining schema gaps without inventing a
SID, a license field on the person, or a substitute for `contractor_has_license`.
Do not skip acquisition of a missing extract that a no-license
permit needs. If that extract is already adequate, do not re-harvest it unless
freshness is stale versus the as-of rule.

Schema gaps (no generic `SID`; live manifest missing class `license` or the edges
`contractor_has_license`, `property_improvement_has_contractor`, and
`contractor_has_person`) are not the same as a missing snapshot. Record schema gaps
after writing supported records. They do not disable the acquire stage, and they do
not authorize a substitute edge.

### Preserve the permit extraction contract

For every contractor/qualifier contact, retain:

- raw company/display name, qualifier name, license number/type, and contact role;
- permit number, stable permit and contact source record IDs, source system, source URL,
  municipality/jurisdiction, and capture time;
- application, issue, final inspection, close, completion, event, and inspection dates
  with their evidence states;
- immutable raw artifact URI/digest and source payload.

Do not replace raw values with normalized values or resolved IDs. Add resolution evidence
and edges separately. Exclude phone, email, and private contact data from identity
matching. Use only necessary official public identity fields.

### Apply the resolution ladder

Evaluate each permit contact in order and emit one exact terminal outcome:

1. **`verified_license`** — normalize the raw license only with the
   licensing-authority/source profile, then find exactly one official DBPR license
   record. Verify status and effective dates for the permit attribution date. Write
   class `license` with `license_identifier` from that DBPR record, and link it from
   the company with `contractor_has_license`. Do not write that license from the
   permit portal.
2. **`verified_company_via_license_relationship`** — from the verified license, select
   exactly one DBPR qualified-business relationship effective on the permit attribution
   date, then resolve that legal business to exactly one Sunbiz document number and its
   lexicon `company`. Emit the supported company edges only after all checks pass.
   A license may qualify different businesses over time; never use the current business
   for a historical permit without temporal proof.
3. **`accepted_company_qualifier_candidate`** — when the permit omits a license, require
   all of: an exact profile-normalized legal company name, exact official DBPR qualifier
   identity evidence, a DBPR qualified-business relationship, compatible effective
   dates, one exact Sunbiz legal entity/document number, and exactly one candidate after
   collision checks. Treat permit or Sunbiz name text alone as insufficient identity
   evidence.
4. **`unresolved`** — required evidence is absent or no candidate survives.
5. **`ambiguous`** — multiple candidates survive or the qualifier/name cannot be made
   unique.
6. **`conflicting`** — official sources or effective periods disagree.

Map `unresolved`, `ambiguous`, and `conflicting` to review-required/ineligible downstream
states. Do not lower thresholds to force a match. A historical permit display name
without a license/legal identifier remains source-name attribution only.

Choose the permit attribution date from a valid source-profile rule. Prefer an official
issue/work/lifecycle date when the profile supports it. If no valid attribution date
exists, temporal company resolution is `unresolved`; do not substitute the current date.

### Guard collisions

Treat punctuation folding, hyphenation, shared surnames, common officers, shared
addresses, brands, and regex/fuzzy similarity as collision signals, not merge evidence.

Keep a generic collision regression fixture with two distinct legal companies whose
names normalize similarly and whose official license numbers differ. An exact verified
license may resolve only its temporally valid qualified-business relationship. It must
never resolve the other company because normalized names look similar. A permit carrying
only the shared/similar display name, without a license and without unique official
qualifier/effective-period evidence, is `ambiguous`, not linked. Keep historical display
names without licenses as source-name attribution.

### Stamp only supported edges

After a DBPR match, write lexicon relationship objects that are only `from` and `to`:

- Write `property_improvement_has_contractor` from `property_improvement` to `company`.
  The contractor is the company, not a separate class.
- Write `contractor_has_license` from `company` to `license`. The license id is
  `license_identifier` on class `license`.
- Write `contractor_has_person` from `company` to `person` (schema title
  `company_to_person`). The person is an object with `first_name` and `last_name`,
  not a string field. There is no license field on the person.

Do not persist those company, person, or license records from the permit portal.
`source_http_request.url` on the records written from the DBPR record is the official
DBPR license-detail URL, not the permit page and not the Sunbiz download page. If
DBPR returns no match, write no contractor, person, or license.

Emit `property_improvement_has_contractor` only when all relevant contractor-role
contacts on the permit resolve to one company. If they resolve to different companies,
emit no permit-level edge and record outcome `conflicting` in the resolution ledger.
Never write a person from name-only evidence. The lexicon person is the DBPR qualifier
written as `first_name` and `last_name`, linked by `contractor_has_person`.

Never write an inferred or resolved license back into the raw permit artifacts. An
omitted permit license stays omitted. The license id on the lexicon `license` record is
`license_identifier` from the DBPR record.

Before emitting an edge, require:

- the target `company` resolves to the expected Sunbiz document number;
- source-key uniqueness for the permit and contact;
- one immutable resolution-ledger record — JSONL kept privately beside the job's permit
  artifacts — containing raw values, match outcome/method, evidence state,
  resolver/rule version, permit attribution date, effective dates, Sunbiz/DBPR snapshot
  IDs and digests, input/output digests, and superseded-resolution reference;
- an atomic write (temporary file plus rename) of the relationship file and its ledger
  record without losing source evidence;
- uniqueness, dangling-reference, and count reconciliation against the group output
  after the write.

Make resolution idempotent and versioned. Re-running with identical source snapshots,
raw source hashes, and resolver version must be a no-op. Re-resolve only when a source
snapshot/hash, effective relationship, schema capability, or resolver version changes.
Retain the superseded resolution and reason; never treat a prior edge as permanent.

Do not overwrite source payloads, raw names, raw licenses, qualifier text, source URLs,
or artifacts. Do not certify the existing private company matcher as satisfying this
contract merely because it produces company links: its BBB/name/phone candidate
logic and write-if-null behavior do not provide authoritative DBPR temporal proof or
versioned edge provenance.

### Query through verified edges

Build lexicon contractor cohorts through `property_improvement_has_contractor`,
`contractor_has_license`, and `contractor_has_person` in validated group output or the
exported Atlas tables. Use raw name/license regex searches only to
discover repair candidates. A regex, fuzzy-name, shared-address, phone, or raw
display-name hit cannot count as resolved attribution.

Do not join raw `license_number` text as if it were `license_identifier`. The license
id is `license_identifier` on the `license` record linked by `contractor_has_license`.

### Reconcile identity resolution

Record these counters per county, source, resolver version, and source-snapshot set:

- Sunbiz company/registration rows, snapshot time/freshness, invalid rows, and
  reconciled document numbers;
- DBPR license and qualified-business relationship rows, snapshot time/freshness,
  invalid rows, and reconciled effective periods;
- permits and contractor-role contacts evaluated;
- exact license matches and rejected/invalid license values;
- temporally valid company links through verified license relationships;
- company+qualifier candidates accepted, rejected, ambiguous, conflicting, and
  review-required;
- name/address/officer/hyphenation/temporal collisions;
- contact-level resolutions and permit-level edges emitted, preserved, superseded, and
  skipped;
- dangling edges, duplicate source keys, stale resolutions, and unresolved permits.

Add every nonterminal or unsupported result to the existing structured gap ledger. Include
registry freshness/digests, affected permits/contacts, attempted official lookup, terminal
outcome, collision evidence, residual uncertainty, schema capability, and downstream
eligibility.

### Accept the resolver

Require fixture and bounded integration tests proving:

- missing/stale Sunbiz or inadequate DBPR snapshots block automatic linking and enqueue
  official-source acquisition, never permit-first harvest;
- exact DBPR license normalization resolves one license and rejects zero/multiple
  matches;
- a license-to-business relationship is selected only inside its effective period;
- two fixture companies with similar normalized names remain separate, including
  name-only and hyphen-folded cases;
- a unique company+qualifier+temporal candidate is accepted, while name-only, shared
  qualifier, and multiple-candidate cases require review;
- historical display names without license/legal ID remain source-name attribution;
- identical inputs/version produce no new edge or ledger row;
- changed snapshot/hash/version re-resolves and preserves the superseded result;
- every emitted company edge references records present in the group output and
  satisfies source-key uniqueness and count reconciliation;
- raw permit evidence is byte-for-byte preserved and no private contact data participates
  in matching;
- downstream cohort queries traverse verified company edges and reject regex-only
  attribution;
- a live manifest that lacks class `license` or the edges
  `contractor_has_license`, `property_improvement_has_contractor`, and
  `contractor_has_person` produces an explicit capability gap, never a fabricated ID
  or a permit-portal copy.

Return registry revisions/freshness, resolver version, ladder outcome counts, collision
counts, edge emit/reconcile counts, dangling/stale/unresolved counts, schema gaps, allowed
queries, and required operator actions.

## Execute targeted repairs

Plan before execution. Select bounded candidates by immutable source record key and only
for fields that affect a named decision gate. Record candidate count, selection reason,
catalog/profile/source/detail fingerprints, input artifact digests, adapter route, and
the profile-approved rate/concurrency in the plan.

Use official source adapters and conservative source-profile limits. Honor source terms,
CAPTCHA/login/custodian states, cooldowns, leases, fencing, checkpoints, and bounded
retry budgets. Route access blockers through the named records/API request procedure
instead of broadening the scrape.

Do not turn a property-first repair into a countywide traversal. Do not substitute a
different source merely because the intended detail route is blocked. Write immutable
captures, receipts, terminal outcomes, and output digests. Reject changed inputs or plan
digests. Do not reconcile or publish repaired conclusions until acceptance succeeds.

## Maintain the structured gap ledger

Reuse the existing investigation gap envelope when available:
`gapId`, `fact`, `scope`, `beforeState`, `blocker`, `evidence`, `proposedIngest`,
`afterState`, `status`, and `reviewer`.

For each county/source/field gap, record:

- county, jurisdiction, source, source period, field, and affected decision gate;
- observed totals and per-evidence-state counts;
- decision impact and the conclusions currently ineligible;
- immutable evidence references, capture times, and digests;
- attempted repair, bounded candidate count, plan digest, adapter, attempts, and terminal
  outcome;
- residual uncertainty and blocker/owner/fix;
- downstream eligibility for ingest, linkage, lead selection, inference, and publication.

Example:

```json
{
  "gapId": "permit-evidence-contractor-detail",
  "fact": "contractor assignment",
  "scope": {
    "countyKey": "example-county",
    "jurisdictionKey": "example-city",
    "sourceKey": "current-permits",
    "field": "contractor_license"
  },
  "beforeState": {
    "evidenceState": "unavailable",
    "observedCounts": {"listRows": 12, "blankListValues": 12, "detailRows": 0},
    "impact": "unassigned-lead conclusion ineligible"
  },
  "blocker": null,
  "evidence": [{"artifact": "immutable-manifest-key", "sha256": "<sha256>", "capturedAt": "<timestamp>"}],
  "proposedIngest": {
    "attemptedRepair": "official detail and contact lookup",
    "candidateCount": 12,
    "planDigest": "<sha256>"
  },
  "afterState": {
    "evidenceState": "confirmed_empty",
    "residualUncertainty": "none within the reconciled candidate set",
    "downstreamEligibility": {"unassignedLead": true, "legalEntityAttribution": false}
  },
  "status": "resolved",
  "reviewer": null
}
```

Use real immutable artifact references and digests at runtime. Keep unavailable exports
and blocked sources as null/unknown counts, never zero.

## Reconcile and accept

Require all of the following before enabling a decision or publishing its derivative:

- Existing source reconciliation passes for reported, received, normalized, unique,
  duplicate, linked, valid-unlinked, missing, excluded, and invalid counts.
- For each decision-critical field, the unique record count equals the sum of its seven
  evidence-state counts. Every record has exactly one state for that field.
- Detail candidates reconcile to successful details, confirmed source absences,
  unavailable/blocker outcomes, quarantines, and terminal failures. No candidate silently
  disappears.
- Indexed and live observations remain independently traceable; no refresh overwrites
  prior evidence.
- Every quarantined value retains raw provenance and is excluded from date, status,
  identity, linkage, and inference anchors.
- Every company/license join has exact official identifiers and compatible effective
  dates; source-name-only attribution remains separate.
- An identical analysis over the frozen inputs produces the same eligibility and counts.
- The gap ledger names every residual uncertainty and marks affected downstream
  conclusions ineligible.
- Publication validation represents unknown, stale, conflicting, and quarantined evidence
  honestly and omits unsupported conclusions. Unknown evidence does not become a zero,
  negative, or confirmed absence.

## Return the permit evidence report

Add this section to Oracle's operator status whenever permits or permit-backed decisions
are in scope:

- matrix revision/digest and source/profile/detail fingerprints;
- county, jurisdictions, sources, and historical periods evaluated;
- coverage start/end, expected/captured/reconciled counts, and predecessor/archive gaps;
- per-field evidence-state counts;
- detail repair planned/attempted/succeeded/blocked/exhausted counts and plan/output
  digests;
- ingested fields, remaining unknowns, quarantined values, and valid-unlinked records;
- conclusions allowed, conclusions ineligible, residual uncertainty, and exact blocker
  fixes;
- reconciliation and publication-validation results.

## Correct and incorrect decisions

**Incorrect:** “The listing has no contractor column value, so this is an unassigned
lead.”

**Correct:** “The listing field is `unavailable`; bounded official detail/contact repair
is required. Only a successful contractor-capable detail lookup returning no assignment
can set `confirmed_empty`.”

**Incorrect:** “The index says Issued, so the permit is open.”

**Correct:** “Preserve the indexed status, refresh live detail, apply the source-profile
status mapping and precedence, and return `needs_review` if the observations remain
conflicting.”

**Incorrect:** “Strip punctuation from every parcel ID and join the closest result.”

**Correct:** “Apply the county profile's proven lossless normalization. Quarantine an
unsupported format and preserve the permit as valid-unlinked.”

**Incorrect:** “No permit was found in the current portal, so the roof is definitely as
old as the building,” or “partial history makes every roof-age estimate ineligible.”

**Correct:** “Use the latest valid completed replacement close/completion date at high
confidence, otherwise completed new construction at medium confidence, otherwise the
built/home year at low confidence. State every partial-history caveat and never use a
quarantined date or permit absence as a replacement anchor.”

**Incorrect:** “The historical permit names Example Roofing, so attach the likely state
license and corporate entity.”

**Correct:** “Retain `Example Roofing` as source-name attribution only. Require exact
official license/legal IDs and effective-date evidence before legal entity attribution.”

**Incorrect:** “Sunbiz names this officer, so create a canonical person and use that
person to resolve every matching permit qualifier.”

**Correct:** “Keep the Sunbiz filing-party role as source evidence. Require separate
official identity evidence before writing a person or treating name
text as an exact qualifier identity.”

**Incorrect:** “The permit has a license number, so permanently attach the company with
the closest current name.”

**Correct:** “Verify the license with the official licensing authority, select the
qualified-business relationship effective on the permit attribution date, resolve that
legal business to one corporate-registry record and its lexicon `company`, then emit a
versioned company edge.”

**Incorrect:** “Normalize punctuation and merge two distinct companies whose legal names
look similar.”

**Correct:** “Keep both legal entities and licenses distinct. A name-only permit remains
ambiguous without unique official qualifier and temporal evidence.”

**Incorrect:** “DBPR is missing, so record `dbpr_snapshot_unavailable` and harvest
permits anyway, or wait forever for a future skill.”

**Correct:** “When the permit prints a license number, look up the official license
detail for that number, then the Sunbiz company. Persist company, person, and license
from the DBPR record. Do not wait for the statewide relationship extract. Require
that extract only for historical qualification when the permit has no license number.
Do not resolve from a name alone.”

**Incorrect:** “Write the verified DBPR license into `business_reputation_license_id`
and call it the permit's license edge.”

**Correct:** “Write class `license` with `license_identifier` from the DBPR record,
and link it with `contractor_has_license` from the company. Do not copy the permit
portal into that record, and do not use `business_reputation_license_id`.”
