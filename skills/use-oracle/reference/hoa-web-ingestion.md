# HOA web scrape: capture, adjudication, and shadow-ingest gate

Use this playbook when Oracle searches the public web for an HOA association,
property manager, recurring fee, or fee frequency. Keep it separate from the
official Florida identity paths in
[`hoa-property-management.md`](./hoa-property-management.md): Sunbiz and CTMH
establish legal entities; public web pages provide property-level observations
and candidate fee schedules.

Treat NetSuite as the truth for what Opendoor paid during the hold. It is not a
source of truth for an HOA's legal name. Do not publish web-enriched HOA fields
until the complete target cohort passes the shadow gate below.

The deterministic parsers and decision rules in this playbook are implemented
and tested in the bundled runtime (see
[Use the runtime rules](#use-the-runtime-rules)). The network orchestration is
described here; drive it with the runtime rules rather than ad hoc regexes.

## Run the stages in order

```text
freeze cohort and select gap fields
  → pilot 8–12 rows
  → pass 1: exact-address search, open the top 2–4 ranked links,
            four-period query matrix only when no fee is found
  → adjudicate pass 1 offline from cached pages
  → pass 2 (gap rows only): unopened pass-1 links, address variants and
            host-targeted site: queries, Sunbiz ACTIVE exact base,
            validated association pages, neighbour listings (name only)
  → re-adjudicate pass 1 + pass 2 evidence
  → verify
  → write a new versioned output
  → NetSuite scoring and the full-cohort shadow gate before any publication
```

Write every stage to a new versioned file (for example `<cohort>.enriched`,
`<cohort>.adjudicated`, `<cohort>.adjudicated.v2`). Never overwrite the input or
a prior stage's output. Each stage reads the previous stage plus the shared
caches and receipts; it never re-derives the population.

## Select the runtime and freeze the cohort

Choose exactly one Oracle runtime stack before web capture. Do not invoke local
Restate handlers while operating the bundled AWS stack.

Freeze these inputs before discovery:

- cohort revision, row count, file digest, and row-order digest;
- property/address token, parcel identifier, full normalized situs address, unit,
  county, state, ZIP, subdivision, legal description, and ownership-estate type;
- existing HOA/PM identity fields, their status, and source provenance;
- the current Prism output used as the control;
- the NetSuite paid-HOA cohort and query revision used for accuracy scoring.

The seed is the input of record. Never rebuild the population from search
results, Query DB joins, or whichever source returned an HOA.

Select the gap fields per row and record them as `need_name` and `need_fee`:

- missing HOA name;
- missing fee or missing frequency;
- fee stripped by HDS (`fee_status` starting `stripped`). Keep the stripped
  amount only as a second signal for a period; never restore it as the fee;
- placeholder name (`hoa_name_status` is a catch-all or placeholder; see
  [Validate HOA names](#validate-hoa-names)).

Carry `neighbour_suggested_hoa_name`, `neighbour_suggested_fee`, and its
frequency as tie-breakers only. They never become a property's fee.

## Make every pass resumable

- Append one checkpoint record per property (JSON Lines) carrying
  `parserVersion` and a terminal diagnostic. On restart, skip a property only
  when its record has the current parser version and is not a fetch error.
  Bump the parser version whenever extraction or decision logic changes so stale
  rows are recomputed from cache instead of trusted.
- Hold an exclusive, non-blocking lock file for the whole run and refuse to
  start a second copy. On 2026-10-21 an 8-row trial ran twice by accident; the
  lock prevents duplicate spend and interleaved checkpoints.
- Cache search responses by `sha256(query)` and page bodies by `sha256(url)`
  (full-content rescrapes in their own cache). Community and subdivision
  queries are then shared across every parcel in the subdivision, and identical
  bytes are never paid for twice.
- Regenerate outputs from the checkpoint every 25 rows and at the end, so an
  interrupted run still has a consistent partial output.
- Resume the identical command. Never use start-row offsets.

## Preserve input before conversion

Write an immutable raw receipt before parsing or normalizing a result. Use this
minimum shape:

```json
{
  "schemaVersion": "elephant.hoa-web-observation.v1",
  "parserVersion": "versioned parser identifier",
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
  "pageTier": 2,
  "pageTierReason": "address and unit match",
  "rawEvidence": {
    "addressQuote": "verbatim",
    "associationQuote": "verbatim or null",
    "managerQuote": "verbatim or null",
    "feeQuotes": ["verbatim"]
  },
  "parsed": null
}
```

Keep raw HTML/markdown/JSON, caches, checkpoints, and normalized receipts outside
Git. Never commit captured pages, receipts, cohort files, or real addresses.
Store request, redirect URL, observation time, page/listing effective date when
available, bytes digest, exact quotes, parser version, every query issued, every
page opened with its tier and reason, and every rejected page. A normalized CSV
without its raw receipt cannot be published.

Search broadly, scrape narrowly, and parse locally. Prefer HTML/markdown,
JSON-LD, embedded MLS fields, or source tables over model-generated structured
JSON. The 2026 Firecrawl pilot measured four credits for search plus scraped
markdown and twelve credits for structured extraction; markdown also retained
auditable quotes.

## Budget credits and throughput

Measured Firecrawl v2 costs:

| Call | Credits |
| --- | --- |
| `/search`, 5 results, no content | about 2 |
| `/search` with scraped markdown, 3 results | about 5 (4 in the earlier pilot) |
| `/scrape`, one page, markdown | 1 |
| structured extraction (2026 pilot) | 12 |

Use `/search` without content plus targeted `/scrape` calls with
`formats: ["markdown"]`, `onlyMainContent: true`, and a 40 s timeout.

- Read the balance from `/v2/team/credit-usage` (`remainingCredits`) before and
  after every run. Report credits spent as the balance difference, not the sum of
  per-call estimates. Set a budget and a lower stop-at guard; when the guard is
  reached, cancel queued work and finish in-flight rows.
- Load `FIRECRAWL_API_KEY` from the environment or from a mode-0600 env file
  outside Git (for example `~/.config/oracle/firecrawl.env`). Never print, log,
  checkpoint, or receipt the key.
- The plan allows 50 concurrent requests and 500 requests/minute. Drive both
  with the adaptive limiter: start at 20 in-flight requests, raise by 5 after
  60 s of saturation without a 429, cut by 25% on a 429 (at most once per 15 s),
  and never go below 4. Retry 408, 429, and 5xx with backoff plus jitter
  (about 3 s × attempt after a 429, 1.5 s × attempt otherwise), at most 5
  attempts and 2 transport failures per call.
- Bound work per property: at most 8 new searches and 8 new scrapes in pass 2,
  and at most 4 fee searches when three or more exact listing hosts already show
  no fee.
- Use the limiter in pass 1 as well; pass 1 ran at a fixed 5–6 workers.

| Run (2026-10-21) | Rows | Wall time | Concurrency | Credits |
| --- | --- | --- | --- | --- |
| Pass 1 | 2,405 | about 3 h 15 min | 5–6 fixed workers | about 30.7k |
| Adjudication | 2,405 | minutes | offline, cache only | 0 |
| Pass 2 | 1,379 gap rows | about 17 min | adaptive 20 → 50 | 8,927 |

In pass 2 the limiter reached 50 after six minutes, hit the 500 requests/minute
limit (159 HTTP 429 in 6,092 calls), and settled at 37. `/search` latency was
0.9 s median and 1.3 s p90; `/scrape` was 2.9 s median and 9.8 s p90.

## Pilot before the broad run

Run 8–12 rows that cover the cohort's counties, single-family homes, condos
with units, and each gap type. Before scaling:

- inspect every receipt, page tier, and accepted quote by hand;
- confirm no accepted fee comes from a tier-0 page, a snippet, or a defaulted
  period;
- measure credits per row and extrapolate the full-run cost against the budget.

Stop and fix the parser when the pilot accepts a value a human would reject.

## Pass 1: exact address

1. Parse the address with the versioned normalizer
   ([Parse addresses](#parse-addresses-with-one-versioned-normalizer)). An
   unusable address ends as `input_no_address`.
2. Run one search per property:
   `"<house> <street core>" "#<unit>" <City> <ZIP> <County> FL HOA association fee`
   (limit 5).
3. Rank the results: listing hosts first, then +5 when the house number is in
   the URL, +8 when the target unit is supported, +6 when the address appears in
   the URL or title, +2 for the ZIP. Skip social, video, and wiki hosts. For fee
   discovery, drop links whose URL or title names a different unit.
4. Open the top 2–4 ranked links one at a time; stop as soon as the needed
   fields are found.
5. Run the four-period query matrix below only when no exact-property fee was
   found and the page did not show only one-time charges.
6. When no exact-page name was found, run up to three community queries (legal
   community, subdivision community, and the row's suggested query):
   `"<Community>" "<County> County" Florida (HOA OR "homeowners association" OR "condominium association" OR "property owners association")`.
   Open the top 2 results each. Names from these pages are association-level or
   same-community evidence and must pass name validation.

### Run the explicit period matrix as a targeted fallback

Select only properties that remain without an exact-property fee, lack an
explicit period, contain conflicting eligible tuples, or remain over the 7.5%
NetSuite gap. Do not repeat successful properties.

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
when it improves the current NetSuite absolute error (in a NetSuite-scored run)
and passes all source gates; never replace a better accepted observation merely
because the matrix found another value.

Cache URLs/content digests across period queries and retry only rate-limited
or transport-failed queries. Keep the query matrix as a fallback: running four
searches against every already-resolved property wastes source capacity
without improving evidence.

The 2026-09-29 shadow run applied this fallback to 1,415 first-pass rejections.
It aligned all targets, added 41 safe property updates and 17
fee/frequency-covered rows, and improved target MAE from `$3.372/day` to
`$3.310/day` (1.84% incremental) without changing a non-target row or official
HOA identity field. Treat these figures as dated evidence, not future
acceptance constants.

## Pass 2: gap rows only

Target only rows that adjudication left without a final name or fee, ordered
missing-both, then fee-only, then name-only. Load each row's pass-1 pages and
re-tier them first. Pass 2 fills gaps; it never changes a final value that is
already filled.

For a missing fee (usable address required):

1. **Open the links pass 1 found but never opened.** Re-read the cached pass-1
   search results, keep links whose URL or title matches the exact address and
   unit, and open the top 3 by host rank. This was the biggest single win.
2. **Full-content rescrape, rarely.** Rescrape (`onlyMainContent: false`,
   `waitFor: 2500`) at most one exact page whose markdown has no HOA words while
   its search snippet showed a fee. Never rescrape realtor.com this way. On
   2026-10-21 these rescrapes revealed nothing in 16 of 16 tests.
3. **Address variants on host-targeted queries**, in measured fee-yield order,
   skipping hosts that already have an exact page. Vary the unit (`Unit 12`,
   `Apt 12`, `#12`, bare `12`), the suffix (spelled out and USPS-abbreviated), and
   the locality (USPS city, ZIP, or a nearby postal city):

   ```text
   "<short street>" "Unit <u>" <City> FL <ZIP> site:homes.com
   "<full street>" "#<u>" <City> FL <ZIP> site:compass.com
   "<short street>" "Apt <u>" <City> FL <ZIP> site:zillow.com
   "<full street>" "Unit <u>" <ZIP> site:trulia.com
   "<short street>" "<u>" <City> FL site:bhhsfloridarealty.com
   "<short street>" "<u>" FL <ZIP> "HOA" OR "association fee"
   ```

   Open the top 2 identity-matching results per query.

For a missing name (a community must parse from the legal description or
subdivision):

4. **Sunbiz ACTIVE exact base.** Search the official Sunbiz entity-name results
   for the community (and for `<name> <housing word>` when the community reads
   `TOWNHOMES OF <name>`), then apply the Sunbiz rules in
   [Validate HOA names](#validate-hoa-names).
5. **Validated association pages.** Search
   `"<Community>" "<Condominium|Homeowners> Association" <County> County Florida`,
   excluding listing hosts and Sunbiz. Open the top 2 whose title or snippet
   overlaps the community; keep names only from pages that overlap the community
   and mention the property's city, ZIP, or county.
6. **Exact listing with an HOA Name field.** When no homes.com exact page exists
   yet, search the exact address on homes.com and open the first identity match.
7. **Neighbour listings, name only.** Search
   `"<Community>" <City> FL "HOA Name"`. Use only pages for another property in
   the same community (tier 0 for the target) that overlap the community. Take a
   name; never take a fee.

Then re-adjudicate the combined pass-1 and pass-2 evidence with the same rules
and write the next versioned output.

## Choose hosts by measured yield

- Fees came mostly from homes.com, compass.com, bhhsfloridarealty.com,
  floridanetworkrealty.com, and local IDX broker sites. In pass 2, homes.com
  filled 54 fees, compass.com 23, bhhsfloridarealty.com 10, and about 50 other
  broker or IDX hosts 1–5 each.
- Zillow markdown usually lacks the HOA section, which is rendered by
  JavaScript. realtor.com and redfin.com often list no fee. Do not expect a
  full-content rescrape to recover them.
- Search snippets are discovery-only. Use them to choose which links to open;
  never accept a name or fee from a snippet.
- Re-measure host yield per run and keep the host order as configuration, not
  code constants.

## Classify evidence scope before extracting facts

Assign exactly one scope:

| Scope | Meaning | May stamp property identity? | May stamp property fee? |
| --- | --- | --- | --- |
| `exact_property` | Page displays the target normalized address and unit | Yes, with the identity gates below | Yes |
| `association_property_roster` | Association-controlled source explicitly links the target parcel/address | Yes | Yes when the schedule is explicitly property-wide/current |
| `association_level` | Official association/manager page without target membership evidence | Candidate identity only | No |
| `same_community_other_property` | Another address or unit in the subdivision/community | Candidate only | No |
| `search_snippet` | Search-result text without fetched source bytes | Discovery only | No |
| `unresolved_scope` | Address/scope cannot be established | No | No |

Assign each fetched page a tier against the target address:

- **Tier 2** (`exact_property`): house number and street core appear in the URL,
  title, or page head; the unit matches when the target has one; the page
  mentions the property's city or ZIP.
- **Tier 1** (unit not confirmed): the address matches but the page does not show
  the target unit, or a condo page names a unit while the target unit is unknown.
  Use tier-1 fees only when no tier-2 page has a fee, and then cap confidence:
  low for condos (fees vary by unit), one level lower otherwise.
- **Tier 0** (another property): a different street address, a different unit,
  a different city and ZIP, a multi-listing page showing three or more other
  house numbers, or a building page listing three or more units.

Rules learned on 2026-10-21:

- Reject pages for other units or other addresses. One property had been
  matched to pages for three different units.
- Require city or ZIP agreement.
- A page listing three or more units is building-level, not the exact property,
  even when the target unit is among them.
- Ignore MLS numbers and the house number when reading units.

Do not fan a listing fee across sibling addresses merely because `(county,
normalized community)` matches. Community-key deduplication is allowed for URL
discovery and caching, not for property-level acceptance.

Reject geographic mismatch, unit mismatch, nearby-property results, area
estimates, generic directories, social pages, transfer/application/capital-
contribution fees, CDD/tax/rent/insurance values, and one-time assessments from
recurring dues.

## Parse addresses with one versioned normalizer

Normalize requested and observed addresses with the same parser. Handle these
cases explicitly:

- a leading direction before the house number (`N 410 EXAMPLE LAKE AVE`);
- stacked unit tokens (`UNIT APT A201`, `# 103`);
- street names containing unit tokens (`STEVENSON` contains `STE`; `UNITY`,
  `UNITAH`). Match unit tokens only as whole words;
- `AVENUE OF THE <NAME>`, where `AVENUE` is part of the street name;
- addresses without commas, where the city follows the last street suffix;
- USPS suffix and direction equivalents, ordinal street numbers (`1ST`), and
  `ST`/`SAINT`, `MT`/`MOUNT`;
- a unit carried after the suffix or at the start of the city field.

## Validate the HOA match with the address

Use the address rendered by the source, not just its title or search snippet.

1. Normalize the requested and observed addresses with the same versioned
   normalizer.
2. Require exact house number, street base, city/state or ZIP, and unit when the
   target has one. Allow only documented USPS-equivalent suffix/direction
   variants.
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

## Derive the community from the legal description and subdivision

The community is a search key and a validation target, never an identity by
itself. Derive it deterministically:

- Strip section-township-range prefixes (`12-34 21-5S-28E;`), plat book/page
  (`PB 12 PG 34`), O/R book-page (`O R 1234 PG 567`, `ORB`), `CDO BK/PG`, `PI#`,
  lot/block/unit/building/phase/section/tract tokens, `PT OF COMMON AREA`,
  `AS REC`, undivided-interest phrases, and other recording text.
- Read `CONDO <n> OF <name>` as the condominium `<name>`.
- Repair OCR splits (`TH E`, `COMM ON`, split vocabulary words) and truncations
  (`PLANTATIO`) from the subdivision field: when the subdivision extends the
  legal community, use the subdivision.
- Strip leading subdivision codes (`04521 SAMPLE TOWNHOMS …`).
- When the legal description and subdivision disagree, prefer the segment that
  contains the subdivision; otherwise prefer a condominium segment, then the one
  with more distinctive words.
- Build a condominium association name from a condominium named in the legal
  description (`<Name> Condominium Association, Inc.`). Label it
  `inferred_from_legal`, keep it unverified, and resolve it through CTMH/Sunbiz
  before treating it as identity.

## Validate HOA names

A name may be proposed only when all of these hold:

- **Distinctive overlap.** After dropping generic words (association,
  homeowners, condominium, phase, unit, county, and similar), the name shares the
  community's distinctive words. Generic geography (lake, creek, oaks, park,
  pointe …) alone does not count. Classify as `strong` (covers the community),
  `brand` (adds a word), `parent` (covers part; likely a master), or reject
  (`reject_no_overlap`, `reject_generic_only`, `reject_other_community`).
- **Not a manager or lawyer.** Reject management companies, law firms, people,
  and registered agents. Split `Name/Manager` strings and keep the association.
- **Not a caption or fragment.** Strip court-caption prefixes (Plaintiff,
  Defendant, Petitioner, Respondent) before validation; a caption never proves
  membership. Reject sentence fragments ("X has offered exceptional Community
  Association …").
- **Not a placeholder.** Reject names without distinctive words, catch-all
  values ("Condominium or Homeowner Association", "by a condominium"), and names
  propagated across unrelated communities (one HOA name stamped on three or more
  communities it shares no distinctive words with). 84 placeholder originals were
  replaced or blanked on 2026-10-21.
- **In area.** Pages proposing a name must mention the property's city, ZIP, or
  county. Reject other-state and other-city pages.
- **Not a city-only community.** When the community's words are only the city,
  county, or a known place (for example Palm Coast sections parsing to
  `PALM COAST`), do not validate a "<City> Homeowners Association" from an
  association, neighbour, or Sunbiz source. Only an exact-property page may name
  the HOA. 117 rows were nearly misnamed this way.

Sunbiz rules for web-gap names:

- Accept only ACTIVE corporations whose normalized base (generic entity words
  dropped, numbers and plurals canonicalized, tokens sorted) equals the
  community's base exactly.
- A name with an association word qualifies directly. An `INC` without one
  qualifies only when the detail page says Not For Profit.
- When several match, keep `not_unique` unless the property's condo/HOA type
  leaves exactly one.
- Confirm ACTIVE on the detail page. Mark the match low confidence when the
  principal/mailing addresses are outside the property's ZIP3 and city; a
  same-name association elsewhere is possible.

Source precedence and confidence:

| Basis | Confidence |
| --- | --- |
| `exact_property_page` | high when strong, else medium |
| `sunbiz_active_validated` | medium; high with an agreeing source; low when out of area or not strong |
| `association_level_validated` | medium at most |
| `same_community_validated` | medium when strong with agreement, else low |
| `inferred_from_legal` | medium when the subdivision agrees, else low |
| `neighbour_suggested_validated` | low |
| `parent_association_only`, `weak_match_only` | low |

A condominium inferred from the legal description replaces a weaker page name,
a master-association name, or a name missing the condominium's number. Record a
broader association as `final_related_hoa_name` rather than discarding it.

Names whose basis is not `exact_property_page` are candidates for the official
identity path. Resolve them under
[`hoa-property-management.md`](./hoa-property-management.md) before stamping a
lexicon HOA relationship.

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

### Extract fees from structured fields first

Read labelled MLS fields (`Association Fee`, `HOA Fee`, `HOA Dues`, the
frequency field after them) before summary badges, IDX widgets, and prose.
Avoid these measured pitfalls:

- Cut "Similar homes", "Nearby homes", and "Recently sold" carousels only at
  short heading-like lines (80 characters or fewer). A body-wide match cut the HOA
  section from Compass pages.
- Insert a space before `HOA` in glued text (`$376/moHOA Fees`).
- Match four-digit amounts whole. A pattern whose 1–3 digit branch did not
  require a thousands group split `1350.0` into 135 and `1029 Quarterly` into 9.
  Re-read affected rows from structured fields.
- Do not read a label number as a fee: `Association #2` produced $2.
  `Secondary Association Fee` and `#2` fees are second-association claims, not
  the primary fee.
- Reject non-HOA values: rental estimates, internet/cable, pool maintenance,
  septic, utilities, CDD, taxes, insurance, deposits, one-time/transfer/
  capital/estoppel fees, a year read as an amount (`Year Built 2004`), and
  `Calculated Total Monthly Association Fees: 0`. Flag an accepted amount whose
  quote shows it beside a rent/tax/utility word (`systematic_non_hoa_fee_text`).
- Read the listing date only from listing-event context (sold, listed, pending,
  price change). Ignore copyright and "updated" stamps.

## Adjudicate fee conflicts

Adjudicate offline from cached pages; it costs no credits. Decide from tier-2
pages; use tier-1 pages only as described above. Cluster tuples in annualized
space (within 3% or $2) and apply these patterns in order:

1. **Rounded badge beside the structured field is the same fee.** `$12/mo` next
   to `Association Fee: 143, Annually` agrees within 4% or $7 a year. This
   explained 175 of the 210 pass-1 source conflicts.
2. **A listing total can be master plus sub-association.** When a larger figure
   equals the primary fee plus one or more second-association fees, treat it as
   the total, keep both schedules, and combine them only because the total
   confirms it. Without a confirming total, record the second fee as
   unconfirmed and do not add it.
3. **A quarterly amount mislabelled as monthly** shows as about 3× the monthly
   fee. Choose the lower monthly fee at medium confidence. Do not resolve
   same-amount annual-versus-monthly disagreements this way; leave them a
   `source_conflict` for the NetSuite frequency-candidate path.
4. **Newest dated listing**, when two sources carry different listing dates.
5. **Majority of sources** (distinct hosts, then agreeing badges).
6. Corroboration by the original or neighbour value, then plausibility for the
   property kind, then the only dated listing, all at low confidence.
7. Otherwise `unresolved_source_conflict`; publish nothing for the row.

IDX widgets of the form `HOA Fees $X/ann` show a monthly equivalent; the suffix
(`ann`, `qua`, `sem`, `mon`) is the billing period. Convert to the billed amount
(`X × 12 / periods per year`) at low confidence. Raise it to medium only with an
agreeing neighbour, original, or same-subdivision exact-property value. All 8
properties checked on 2026-10-21 that showed both a widget and a structured fee
confirmed this convention.

When an exact page shows an amount without a period, infer the period only
from two agreeing signals: the amount plus one independent signal (a summary
badge on the same page, the HDS-stripped original with the same amount, the
neighbour fee with the same amount, or same-subdivision exact-property fees) that
implies exactly one period. Otherwise leave the fee unreported with
`unresolved_frequency_missing`. Never default to Monthly.

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

Flag and lower confidence for: a single-family monthly fee of $1,000 or more, an
annual total under $12, a condominium total under $300 a year (probably a master
or club fee only), a listing dated before 2018, and a `Total Monthly Fees` figure
well above the HOA fee (another charge may apply).

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

Pass-level statuses also include `partial_match` (one needed field found),
`input_no_address`, `frequency_missing`, `no_recurring_fee` (only one-time
charges), and `fetch_error` (retried on resume).

Examples learned from the 2026 reviews:

- Raw `$400 annually` becoming `$400 monthly` is
  `transformation_problem`.
- An exact listing supporting Prism while a later paid/ATTOM amount differs is
  `temporal_scope_difference` until effective dates prove otherwise.
- `$390 semi-annually` vs `$65 monthly` is
  `equivalent_period_representation`.
- A `$690 annually` value found only on another property in the same
  subdivision is `insufficient_evidence` for the target, not a corrected target
  fee.
- A four-digit amount read as three digits, or `Association #2` read as $2, is
  `transformation_problem`.

Do not label a discrepancy "ours" until the immutable input receipt proves
whether the value entered incorrectly or the conversion changed it.

## Record output, confidence, and coverage

Keep every input column and row order. Add, per row:

- `final_hoa_name`, `final_fee`, `final_fee_frequency`,
  `final_fee_annualized_usd`, `final_second_hoa_name`, `final_second_fee`,
  `final_second_fee_frequency`, `final_total_annual_usd`,
  `final_related_hoa_name`;
- `final_name_basis` and `final_fee_basis` (the bases named in this playbook);
- `name_confidence`, `fee_confidence`, and row `confidence`, the minimum of the
  two for the fields the row needed;
- `rationale` in plain language, `final_sources`, `review_reason`,
  `pages_rejected_as_other_property`, and `decision_changed`;
- for later passes, `pass2_status` (`filled_name`, `filled_fee`, `filled_both`,
  `no_new_evidence`, `not_targeted`), `pass2_sources`, and `pass2_changed`.

Never write a fee without a frequency or a frequency without a basis.

Report coverage before and after every pass: rows missing both fields, name
only, fee only, and rows with name + fee + frequency, plus the confidence
distribution, credits spent, peak stable concurrency, diagnostic counts, and
unresolved reasons.

## Verify, then write a new versioned output

Before writing the next version:

- row count and row order match the frozen cohort;
- rows the stage did not target are identical to the previous version;
- a gap-filling pass changed no already-filled final value;
- every new fee has a cached tier-2 page where the amount appears next to an HOA
  label (for IDX conversions, the widget value equals the fee × periods / 12)
  and the period is explicit or inferred under the two-signal rule;
- every new name passes name validation and cites its source;
- a seeded random sample of about 30 new fees and names is read by hand against
  its quotes.

Write the result as a new versioned file and keep the previous one.

## Run the adjudicated regression set

Before a broad run, replay
[`../fixtures/hoa-web-evidence-cases.json`](../fixtures/hoa-web-evidence-cases.json)
with `npm test` in `skills/use-oracle/runtime` (the cases run in
`tests/hoa-web-evidence.test.mjs`). The set covers:

- explicit annual frequency must not become monthly;
- explicit quarterly and semiannual frequencies retain their periods;
- missing frequency remains null;
- exact-property address mismatch rejects the page;
- same-community/different-property fee remains discovery-only;
- equivalent monthly/semiannual values reconcile in annualized space;
- master and sub-association fees remain separate, and combine only when a
  listing total confirms them;
- exact source supporting the control is not relabeled as a scraper error;
- conflicting exact sources remain `source_conflict`;
- the 7.5% review-gap boundary is deterministic;
- a rounded badge beside the structured field is the same fee;
- four-digit amounts are not split, and `Association #2` is not a fee;
- rental estimates, utilities, CDD, taxes, one-time fees, years, and zero totals
  are not fees;
- an IDX `/ann` widget converts to the billed amount at low confidence;
- a quarterly amount labelled monthly resolves to the monthly fee;
- wrong-unit and building-level pages are rejected;
- city-only communities, out-of-area pages and registrations, placeholders,
  propagated names, managers, law firms, and sentence fragments do not validate;
- OCR-split, truncated, and recording-noise legal descriptions yield the right
  community.

Also run the private, untracked 26-property adjudication bundle produced during
the Prism gap review. Expected outcomes must include exact-source-supports-
control, exact-source-supports-comparison, conflicting, partial, and
no-exact-evidence cases. Do not put captured pages or customer/property evidence
in Git. Add a synthetic fixture for every new failure mode before changing the
parser.

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
- county, source domain, evidence scope, basis, confidence, and freshness
  segments.

## Fail publication unless both coverage and accuracy improve

Require all of these:

- 100% of accepted web fields have an immutable raw receipt and source quote;
- 100% of accepted property-level observations pass address/unit validation;
- zero accepted same-community/other-property or search-snippet fees;
- zero invented/defaulted frequencies;
- zero accepted names that fail name validation (city-only, placeholder,
  propagated, manager, out-of-area);
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
digests, parser and address-normalizer versions, source-domain counts, credits
spent, metric deltas, regression outcomes, and the candidate artifact digest.
Publication remains the normal validated lexicon → CAR → tables → Atlas path.
Never treat a shadow pass as publication approval.

## Use the runtime rules

The bundled runtime implements the deterministic rules above as pure modules
under `skills/use-oracle/runtime/src/enrichment/`:

- `hoa-web-address.mjs`: address parser, page tiers, locality and building-page
  checks, pass-1 query, period matrix, and host-targeted address variants;
- `hoa-web-legal.mjs`: legal-description and subdivision community, OCR repair,
  inferred condominium names, property kind;
- `hoa-web-fees.mjs`: structured fee extraction, non-HOA amount detection, and
  fee adjudication with its conflict patterns;
- `hoa-web-names.mjs`: name classification and validation, city-only and
  placeholder rules, Sunbiz exact-base selection and detail verification;
- `hoa-web-scoring.mjs`: observation diagnosis, NetSuite gap and
  frequency-candidate scoring, confidence, coverage, and output verification;
- `hoa-web-run.mjs`: adaptive limiter, resumable checkpoints, and cache keys.

The search/scrape calls, Sunbiz fetches, receipts, and file layout stay in the
operator's run directory. Keep cohort paths, the key file, and output paths as
arguments; never hardcode a user path.

## Dated evidence: 2026-10-21 gap rescrape

A 2,405-row Florida gap cohort (rows missing a name, a fee, or both, including
HDS-stripped fees and placeholder names) ran through the stages above. These are
observations, not acceptance constants:

- Coverage of rows with name + fee + frequency went from 0 to 1,026 after pass 1
  and adjudication, and to 1,547 after pass 2. Rows missing both fell from 156
  to 104, name only from 851 to 484, fee only from 372 to 270.
- Pass 1 filled 683 of 1,643 needed names and 394 of 1,188 needed fees from
  exact-property pages. Diagnostics: 646 confirmed, 174 partial, 1,158
  insufficient evidence, 182 equivalent periods, 210 source conflicts, 18
  unusable addresses, 15 missing frequencies, 2 one-time only.
- Adjudication reviewed 806 rows offline and changed 474 decisions (306 fee or
  frequency, 205 name): 142 names replaced, 52 blanked, 84 placeholders replaced
  or blanked, 21 frequencies inferred, 19 second-association fees combined, 235
  rows left unresolved.
- Pass 2 targeted 1,379 gap rows and changed 562: names from Sunbiz ACTIVE exact
  base 186, same-community pages 136, association pages 59, exact pages 22; 150
  fees from pass-2 pages. Sunbiz lookups: 186 matched, 884 without an ACTIVE
  exact match, 23 ambiguous.
- Credits: about 30.7k for pass 1 and 8,927 for pass 2; peak stable concurrency
  50.
- NetSuite paid-HOA scoring and the full-cohort shadow gate were not run on this
  cohort. Its outputs are candidates, not publishable HOA fields.

## Research lineage

This playbook incorporates the measured findings from these Cursor
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
  the 26-property raw-web adjudication;
- `65978b8c-5af7-4a40-9bd2-39844be9f330` — 2026-10-21 gap rescrape pass 1,
  address and legal-description parser edge cases, credit and throughput
  measurements;
- `bfdcb454-938b-492e-954c-7e04cb987872` — offline adjudication: conflict
  patterns, IDX widget convention, fee-extraction pitfalls, name validation;
- `3e8f3263-ac1e-4864-af1b-31842e700e82` — pass 2: adaptive limiter at the plan
  cap, host yield, Sunbiz exact base, city-only and locality rules.

The IDs are non-normative lineage. This file is the complete operating contract.
