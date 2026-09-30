# HOA web capture, diagnosis, and shadow-ingest gate

Use this contract when Oracle searches the public web for an HOA association,
property manager, recurring fee, or fee frequency. Keep it separate from the
official Florida identity paths in
[`hoa-property-management.md`](./hoa-property-management.md): Sunbiz and CTMH
establish legal entities; public web pages provide property-level observations
and candidate fee schedules.

Treat NetSuite as the truth for what Opendoor paid during the hold. It is not a
source of truth for an HOA's legal name. Do not publish web-enriched HOA fields
until the complete target cohort passes the shadow gate below.

## Select the runtime and freeze the cohort

Choose exactly one Oracle runtime stack before web capture. Do not invoke local
Restate handlers while operating the bundled AWS stack.

Freeze these inputs before discovery:

- cohort revision, row count, file digest, and row-order digest;
- property/address token, parcel identifier, full normalized situs address, unit,
  county, state, ZIP, subdivision, and ownership-estate type;
- existing HOA/PM identity fields and source provenance;
- the current Prism output used as the control;
- the NetSuite paid-HOA cohort and query revision used for accuracy scoring.

The seed is the input of record. Never rebuild the population from search
results, Query DB joins, or whichever source returned an HOA.

## Preserve input before conversion

Write an immutable raw receipt before parsing or normalizing a result. Use this
minimum shape:

```json
{
  "schemaVersion": "elephant.hoa-web-observation.v1",
  "propertyKey": "stable property/address token",
  "requestedAddress": {
    "raw": "input address",
    "normalized": "normalizer output",
    "unit": null,
    "county": "county",
    "state": "FL",
    "postalCode": "ZIP"
  },
  "request": {
    "query": "exact search query",
    "url": "requested page URL",
    "method": "GET"
  },
  "response": {
    "finalUrl": "resolved URL",
    "retrievedAt": "ISO-8601",
    "pageDate": null,
    "httpStatus": 200,
    "contentSha256": "sha256",
    "contentType": "text/html",
    "artifactUri": "private immutable artifact URI"
  },
  "scope": "exact_property",
  "rawEvidence": {
    "addressQuote": "verbatim",
    "associationQuote": "verbatim or null",
    "managerQuote": "verbatim or null",
    "feeQuotes": ["verbatim"]
  },
  "parsed": null
}
```

Keep raw HTML/markdown/JSON and the normalized receipt outside Git. Never commit
captured pages. Store request, redirect URL, observation time, page/listing
effective date when available, bytes digest, exact quotes, and parser version. A
normalized CSV without its raw receipt cannot be published.

Search broadly, scrape narrowly, and parse locally. Prefer HTML/markdown,
JSON-LD, embedded MLS fields, or source tables over model-generated structured
JSON. The 2026 Firecrawl pilot measured four credits for search plus scraped
markdown and twelve credits for structured extraction; markdown also retained
auditable quotes. Cache by canonical URL/content digest and never pay twice for
identical bytes.

## Classify evidence scope before extracting facts

Assign exactly one scope:

| Scope | Meaning | May stamp property identity? | May stamp property fee? |
| --- | --- | --- | --- |
| `exact_property` | Page displays the target normalized address and unit | Yes, with the identity gates below | Yes |
| `association_property_roster` | Association-controlled source explicitly links the target parcel/address | Yes | Yes when the schedule is explicitly property-wide/current |
| `association_level` | Official association/manager page without target membership evidence | Candidate identity only | No |
| `same_community_other_property` | Another address in the subdivision/community | Candidate only | No |
| `search_snippet` | Search-result text without fetched source bytes | Discovery only | No |
| `unresolved_scope` | Address/scope cannot be established | No | No |

Do not fan a listing fee across sibling addresses merely because `(county,
normalized community)` matches. Community-key deduplication is allowed for URL
discovery and caching, not for property-level acceptance.

Reject geographic mismatch, unit mismatch, nearby-property results, area
estimates, generic directories, social pages, transfer/application/capital-
contribution fees, CDD/tax/rent/insurance values, and one-time assessments from
recurring dues.

## Validate the HOA match with the address

Use the address rendered by the source, not just its title or search snippet.

1. Normalize the requested and observed addresses with the same versioned
   normalizer.
2. Require exact house number, street base, city/state, and unit when the target
   has one. Allow only documented USPS-equivalent suffix/direction variants.
3. Keep a page whose address differs as `same_community_other_property`; never
   promote it.
4. Extract every HOA name explicitly attached to the exact-property HOA section.
   Preserve master and sub-associations as separate candidates.
5. Resolve each candidate fail-closed through the existing CTMH/Sunbiz rules. Do
   not invent suffixes, fuzzy-pick a company, or treat the HOA/manager business
   address as the situs address.
6. Record `input_no_exact_property_evidence`, `input_wrong_property`,
   `identity_not_unique`, or the exact existing HOA/PM miss status when the gate
   fails.

An official association page can establish the association's legal/display name
and manager. It does not prove that the target property is a member unless it
names the parcel/address or is joined through an already-proven exact-property
association observation.

## Capture all price and period observations

Do not collapse the web into one `(amount, frequency, year)` during capture.
Emit one observation for every explicit tuple:

```json
{
  "associationCandidate": "raw association name or null",
  "amountRaw": "$390",
  "amountUsd": 390,
  "frequencyRaw": "semi-annually",
  "frequencyCanonical": "Bi-Annually",
  "annualizedUsd": 780,
  "effectiveDate": null,
  "pageDate": "2026-07-01",
  "scope": "exact_property",
  "sourceUrl": "https://...",
  "evidenceQuote": "Association Fee: $390; Frequency: Semi-Annually"
}
```

Canonicalize only explicit source text:

- month/monthly → `Monthly`, multiplier 12;
- quarter/quarterly → `Quarterly`, multiplier 4;
- annual/annually/year/yearly → `Annually`, multiplier 1;
- semi-annual/semiannually/semi_annually/bi-annual/biannually →
  `Bi-Annually`, multiplier 2;
- one-time/capital contribution/application/transfer → `One-Time`, never
  recurring dues.

Never default a missing or unparsable period to `Monthly`. Set
`frequency_missing` or `frequency_unrecognized` and leave annualized value null.

## Score Prism against NetSuite

Use the paid daily amount exactly as established in the benchmark:

```text
actual_day = -unit_holding_hoa_dues_cost
prism_day = hoa_annualized_usd / 365.25
fee_gap_pct = abs(prism_day - actual_day) / actual_day
```

Do not divide `holding_hoa_dues_cost` by `actual_dip`. `actual_dip` ends at
`forecast_date`; it is not the hold duration. Keep Florida, latest
accounting-closed resale per address, resale 2024+, negative held HOA cost, at
least 30 held days, and `0 < actual_day <= 30`.

Classify a property as a review gap when Prism is missing, has no positive fee,
or `fee_gap_pct > 0.075`. The 7.5% gate prioritizes investigation; it does not
authorize a frequency or amount rewrite without exact-property source evidence.
The 2026-09-29 export contained 1,967 unique gaps: 71 missing Prism rows, 710
rows without a positive Prism fee, and 1,186 rows over 7.5%.

NetSuite paid values can score fee accuracy and identify the period implied by
the paid total. They cannot prove the HOA name, master/sub-association scope, or
the source period by themselves.

## Generate frequency-correction candidates

For every positive Prism amount, score the same dollar value under each allowed
recurring period:

```text
candidate_day(amount, monthly) = amount * 12 / 365.25
candidate_day(amount, quarterly) = amount * 4 / 365.25
candidate_day(amount, bi_annually) = amount * 2 / 365.25
candidate_day(amount, annually) = amount / 365.25
candidate_error = abs(candidate_day - actual_day) / actual_day
```

Mark a high-confidence frequency-review candidate only when:

- the stored Prism frequency has error greater than 7.5%;
- exactly one different period has error at or below 2%;
- the Prism amount is positive and unchanged;
- the property has no unresolved master/sub-association or temporal conflict.

This heuristic identifies likely monthly/quarterly/semiannual/annual label
errors; it does not itself rewrite the frequency. Confirm the candidate with an
exact-property page carrying an explicit period and immutable quote. If the
source does not confirm it, retain `frequency_candidate_unconfirmed` rather
than forcing the NetSuite-implied period.

## Use ATTOM only as corroboration

When ATTOM is available, use the latest unresolved row per address from
`SOURCE_ATTOM_HOA_DATA`. Read `hoas[].fee.value` as cents and preserve each HOA
name and period. Annualize monthly ×12, quarterly ×4, annual/annually ×1, and
semi-annually/semiannually/semi_annually/bi-annually/biannually ×2. Include
`semi_annually`; dropping it silently shrinks the paired cohort.

Do not use resolved HDS or `SOURCE_PROPCO_LISTING`; those values may have been
typed after the hold. ATTOM can corroborate a fee/period candidate and expose a
source conflict, but NetSuite remains the paid-cost truth.

## Run the explicit period matrix as a targeted fallback

After the first exact-address search/scrape pass, select only properties that
remain unresolved, lack an explicit period, contain conflicting eligible
tuples, or remain over the 7.5% NetSuite gap. Do not repeat successful
properties.

Run all four query families for each selected exact address:

```text
"<address>" "HOA fee" monthly
"<address>" "HOA fee" quarterly
"<address>" ("HOA fee" OR "association fee") (semiannual OR "semi-annually" OR biannual)
"<address>" ("HOA fee" OR "association fee") (annual OR annually OR yearly)
```

Record one receipt per query even when it yields no accepted page. Open the
source page; search snippets remain discovery-only. Require the source-rendered
address/unit, positive recurring amount, explicit period, URL, and verbatim
quote. Preserve every eligible tuple and every conflict. Apply a result only
when it improves the current NetSuite absolute error and passes all source
gates; never replace a better accepted observation merely because the matrix
found another value.

Batch by 25 exact addresses per bounded worker, cache URLs/content digests
across period queries, and retry only rate-limited or transport-failed queries.
Keep the query matrix as a second pass: running four searches against every
already-resolved property wastes source capacity without improving evidence.

The 2026-09-29 shadow run applied this fallback to 1,415 first-pass rejections.
It aligned all targets, added 41 safe property updates and 17
fee/frequency-covered rows, and improved target MAE from `$3.372/day` to
`$3.310/day` (1.84% incremental) without changing a non-target row or official
HOA identity field. Treat these figures as dated evidence, not future
acceptance constants.

Compare observations in annualized space while retaining raw tuples:

- `$390 semi-annually` and `$65 monthly` agree at `$780/year`;
- `$690 annually` and `$690 monthly` are a frequency conflict, not an amount
  agreement;
- multiple values at one property may be historical changes, master/sub-
  association fees, unit tiers, or source errors. Keep them separate by
  association, effective/page date, and source.

Sum annualized fees only when exact-property evidence proves distinct
associations apply concurrently. Never sum two sources that describe the same
association. When the lexicon's single fee tuple cannot represent concurrent
fees, retain all observations in raw evidence, mark
`multiple_current_fee_schedules`, and do not publish a lossy chosen tuple.

## Diagnose input versus conversion

Assign one terminal diagnostic per property/field:

| Diagnostic | Definition |
| --- | --- |
| `transformation_problem` | Raw exact-property evidence is correct, but parsing/defaulting/normalization changes, drops, combines, or mislabels it |
| `input_problem` | The accepted input is wrong property, nearby property, stale/undated, search-only, wrong association, or otherwise ineligible |
| `temporal_scope_difference` | Exact sources describe different effective/listing/hold dates |
| `association_scope_difference` | Sources describe master vs sub-association or one fee vs a paid total |
| `equivalent_period_representation` | Raw tuples differ but annualized values agree |
| `source_conflict` | Eligible exact-property sources disagree without defensible precedence |
| `insufficient_evidence` | No exact-property fee/name evidence or period is missing |
| `confirmed_match` | Exact-property observation passes identity, amount, frequency, and provenance gates |

Examples learned from the 2026 review:

- Raw `$400 annually` becoming `$400 monthly` is
  `transformation_problem`.
- An exact listing supporting Prism while a later paid/ATTOM amount differs is
  `temporal_scope_difference` until effective dates prove otherwise.
- `$390 semi-annually` vs `$65 monthly` is
  `equivalent_period_representation`.
- A `$690 annually` value found only on another property in the same
  subdivision is `insufficient_evidence` for the target, not a corrected target
  fee.

Do not label a discrepancy "ours" until the immutable input receipt proves
whether the value entered incorrectly or the conversion changed it.

## Run the adjudicated regression set

Before a broad run, replay
[`../fixtures/hoa-web-evidence-cases.json`](../fixtures/hoa-web-evidence-cases.json)
for these failure modes:

- explicit annual frequency must not become monthly;
- explicit quarterly and semiannual frequencies retain their periods;
- missing frequency remains null;
- exact-property address mismatch rejects the page;
- same-community/different-property fee remains discovery-only;
- equivalent monthly/semiannual values reconcile in annualized space;
- master and sub-association fees remain separate;
- exact source supporting the control is not relabeled as a scraper error;
- conflicting exact sources remain `source_conflict`;
- the 7.5% review-gap boundary is deterministic.

Also run the private, untracked 26-property adjudication bundle produced during
the Prism gap review. Expected outcomes must include exact-source-supports-
control, exact-source-supports-comparison, conflicting, partial, and
no-exact-evidence cases. Do not put captured pages or customer/property evidence
in Git.

## Shadow the complete 18,073-address cohort

Run the candidate ingestion as an immutable shadow job. Do not overwrite the
control CSV, Query DB working table, or any published artifact.

Record these observed control values with their observation date rather than
treating them as permanent constants:

- 18,073 rows and 9,645 deduplicated discovery keys;
- 10,664 positive annualized fees/frequencies in the 2026-09-15 Prism dump;
- 9,954 rows with an HOA name; 7,165 with positive fee + frequency + name;
- 2,258 NetSuite-paid headline homes; 1,477 with a positive Prism fee; 1,053
  with fee + name;
- Prism MAE `$3.613/day` on those 1,477 homes, using
  `-unit_holding_hoa_dues_cost`; never use `actual_dip`.

Compare control and candidate on:

- exact-address eligible pages, association-roster pages, and rejected scope
  counts;
- HOA identity/name coverage and unique official CTMH/Sunbiz resolution;
- amount coverage, explicit frequency coverage, fee + frequency + name
  coverage;
- missing-frequency/default-frequency count (defaulted frequency must be zero);
- raw-receipt, quote, URL, page-date, retrieval-time, and content-digest
  coverage;
- multiple-association and multiple-current-fee preservation;
- diagnostic counts for input vs transformation vs temporal/association scope;
- NetSuite paid-day MAE, median absolute error, RMSE, median bias, within-$1,
  within-7.5%, over-2x, and under-half counts;
- frequency confusion and annualized-equivalence counts;
- county, source domain, evidence scope, confidence, and freshness segments.

## Fail publication unless both coverage and accuracy improve

Require all of these:

- 100% of accepted web fields have an immutable raw receipt and source quote;
- 100% of accepted property-level observations pass address/unit validation;
- zero accepted same-community/other-property or search-snippet fees;
- zero invented/defaulted frequencies;
- the adjudicated regression set has zero unexpected outcomes;
- HOA identity, fee, frequency, and fee+frequency+name coverage do not regress;
- at least one target coverage metric improves over the frozen control;
- NetSuite MAE and RMSE both improve, median bias does not materially worsen,
  and no high-error segment regresses without an approved explanation;
- the count of rows over the 7.5% review threshold decreases;
- the candidate preserves all source conflicts and multi-association cases
  rather than forcing one value;
- row count, row order, property identities, and pre-existing non-HOA columns
  match the frozen cohort.

Write a signed shadow-run evidence manifest containing control/candidate
digests, parser and address-normalizer versions, source-domain counts, metric
deltas, regression outcomes, and the candidate artifact digest. Publication
remains the normal validated lexicon → CAR → tables → Atlas path. Never treat a
shadow pass as publication approval.

## Research lineage

This contract incorporates the measured findings from these Cursor
investigations:

- `e3431a9c-de18-43c8-b694-489913134fab` — 18,073-row Firecrawl run,
  discovery-key fan-out, receipts, coverage, cost, and confidence distribution;
- `97b4bee9-b91e-44c4-9aa1-6b5866d7f198` — search/scrape/markdown comparison
  and source filtering;
- `5cacbb98-052d-46f4-8da5-d7c3c6b21dbe` — Florida HOA directory/detail-page
  behavior;
- `b89b080e-e23c-4114-89ee-78b0fc1da0ac` — fail-closed subdivision → official
  identity matching and CTMH branch;
- `e8b11216-6760-4648-92e8-def25d3207bb` — Prism vs NetSuite/ATTOM scoring and
  the 26-property raw-web adjudication.

The IDs are non-normative lineage. This file is the complete operating contract.
