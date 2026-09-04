---
name: county-discovery
description: "Research a new US county before onboarding it to the ingestion pipeline - appraiser portal, permit portal vendor, parcel id format, bulk data sources, anti-bot posture, source performance, and bulk-ingest vs runtime-retrieval feasibility. Use when asked to onboard, evaluate, or scope a new county, or when planning appraisal/permit scraping for a county not yet ingested."
metadata: {"author":"elephant-xyz"}
---
# County Discovery

Source preferences (which appraisal/permit websites, prior findings, additional sources)
come from the `onboard-county` intake — don't re-ask what's already established. If
entered directly without that context, gather those answers once before probing, then
proceed without further check-ins.

Produce a county profile document before writing any code. The profile feeds every later
stage: seed data, browser flow, transform scripts, permit adapter, eligibility mapping.

## Output

Write findings to `skills/use-oracle/runtime/docs/<county>-county-findings.md`. Required sections:

1. **Appraiser portal** — base URL, per-parcel detail URL pattern, search mechanism,
   access mode per artifact (plain fetch / modified request replaying a hidden API /
   real browser), CAPTCHA/Cloudflare posture.
2. **Parcel identifier** — official name (STRAP, PCN, folio…), format, punctuation,
   numeric-only variants, how it appears on appraiser vs permit portals (often different).
3. **Permit portal** — vendor (Accela, Tyler, ePZB, custom), search-by-parcel support,
   detail page contents (contractors, inspections, fees), session requirements, rate
   tolerance.
4. **Bulk data sources** — county parcel roll download (seed source), GIS/open-data portals.
5. **Usage-type vocabulary** — the appraiser's property use codes/labels, and which map to
   commercial/industrial (drives permit-harvest eligibility).
6. **Additional data sources** — inventory what else is available for the county (the
   NETR directory step surfaces most of these): business registrations (Sunbiz for FL),
   contractor reputation (BBB), tax collector rolls, recorder/official records (deeds,
   mortgages, liens), GIS/parcel geometry, code enforcement, business licenses. For each:
   URL, bulk-download availability, and whether the operator wants it in scope. Lee
   shipped with two beyond appraisal+permits (Sunbiz, BBB); treat that as the baseline to
   offer, not the ceiling.
7. **Source feasibility** — for every source that needs scraping/downloading, record the
   total record/page/request estimate, probe timings, safe concurrency, failure rate,
   estimated full-download time, and recommended mode: bulk artifact download, query-DB
   ingestion, or runtime retrieval.
8. **Risks** — geo-blocking, bot challenges, throttling expectations.

When the profile is complete, commit it and push a copy to
`github.com/elephant-xyz/Counties-trasform-scripts` under `<county>/docs/` on a branch,
and open a PR (`gh pr create`) so the findings survive outside this machine. Include any
probe/exploration scripts you wrote; reference (don't commit) large sample captures by
their `data/artifacts/...` path or `downloads/` location.

## Workflow

1. Check prior art first:
   - `skills/use-oracle/runtime/docs/` for existing findings docs and sources catalogs (Lee is
     the reference).
   - `skills/use-oracle/runtime/transforms/<county>/` and the county folder in
     `github.com/elephant-xyz/Counties-trasform-scripts` — if transform scripts exist,
     the appraisal side has been at least partially solved before. **Check ALL name
     variants INCLUDING SPACES** (e.g. folder `palm beach`, not just `palm-beach` /
     `palm_beach`) — matching tolerates spaces/underscores/hyphens; don't rebuild an
     already-shipped transform.
   - `skills/use-oracle/runtime/flows/` for an existing browser-flow JSON for the county.
2. Enumerate official data sources via the NETR Online directory:
   `https://publicrecords.netronline.com/state/<STATE>/county/<county>` — it lists the
   county's assessor/appraiser, recorder, tax collector, GIS/mapping, and
   building/permit offices with links to their official sites. Use it to find the
   appraiser portal, permit portal, and bulk-download pages instead of guessing URLs;
   verify each linked site is the current official one.
3. Probe each source with a real parcel id (get a few from the county GIS/open data).
   Always explore with Playwright, even when `curl` works — see "Exploring with
   Playwright" below. Record per source: curl-only / curl-partial / browser-required,
   and the full inventory of data the browser reveals.
4. Benchmark each source before recommending a full scrape:
   - Measure a small representative probe (for example 10-25 records/pages) and record
     p50/p95 latency, retries, failures, session/bootstrap cost, and bytes/artifacts.
   - Test cautious concurrency levels (1, 2, 4; higher only if the source stays healthy)
     and record the highest safe concurrency. Use portal errors, throttles, timeouts,
     CAPTCHA/challenge frequency, and page completeness as health signals.
   - Estimate total work from parcel count, result pages, permit/detail counts, or the
     source's published record count. Compute estimated elapsed time using measured
     latency, safe concurrency, required delays, and retry overhead.
   - **Evaluate Compute Strategy (Local vs Distributed AWS Lambda)**:
     - *Local Execution*: Free compute, but bound by single-IP egress rate limits (e.g., Accela returns 429/500 above 6 req/sec from a single IP; total ETA can exceed 40-50 hours for 500k+ permits).
     - *AWS Lambda Distributed Scraping*: Spreads requests across hundreds of transient IP addresses, allowing concurrency of 60-120 workers, reducing run time to 1-3 hours while keeping AWS compute cost low ($3-$15). Includes automated cost tracking, in-flight self-healing retry buffers, and end-of-stream dead-letter sweeps.
   - If the local estimate is more than 48 hours for that source, stop treating full download as
     the default. Ask the operator whether to run distributed cloud harvesting, ingest into
     the query DB only, or retrieve at runtime.
5. Identify the permit vendor and municipal portals by URL shape:
   - `*.accela.com/<AGENCY>/...` → Accela Citizen Access (e.g. `HCFL`, `TAMPA`). Record agency code, module, and `altId` deep link structures (`CapDetail.aspx?Module=Building&TabName=Building&altId=<PERMIT>`).
   - `*aspgov.com/Click2GovBP/...` → Click2Gov (e.g. Temple Terrace). Requires session cookie bootstrap and application year/number parsing.
   - `*maintstar.com/...` → MaintStar Public Record API (e.g. Plant City). Uses JSON search endpoints (`api/Public/Record/Search`).
   - `*pbc.gov/ePZB/...` or custom → Custom county portals. Note session tokens and CSRF headers.
6. Capture 3-5 sample permit detail pages and 3-5 appraisal pages covering different
   property types (commercial, industrial, residential, condo, vacant) — save HTML to
   `downloads/<county>/samples/`. These become fixtures for transform validation and the
   permit adapter.
7. Florida-specific: Sunbiz corporate data is statewide — only the county ZIP-prefix list
   is new. Collect the county's ZIP codes.

## Exploring with Playwright

Never conclude a source's data inventory from `curl` output alone. A `curl` probe answers
"is there bot protection?", not "what data exists". The failure modes it hides:

- **Blocked outright** — Cloudflare/bot challenges return errors or challenge pages while
  a real browser works (Palm Beach permits require a Playwright session via
  `iPZB.Building/Session` before its API answers; Sunbiz blocks curl entirely).
- **Partial data** — the initial HTML loads fine but tabs, accordions, "more details"
  expanders, and lazy/XHR-loaded sections (valuations, sales history, permits tab, photos,
  cost cards) only materialize after JS runs or a click. Lee's Accela detail pages and
  appraiser cost cards are examples — the richest data sat behind expanders.
- **Hidden APIs** — the page is driven by JSON endpoints that curl CAN fetch, but only
  with the right headers/cookies/POST body discovered from browser traffic.
- **Geo-blocking** — many county/state portals serve 403s, "Access Denied", or blank
  block pages to non-US IPs, in both curl AND a real browser. Before concluding a source
  is bot-protected or broken, verify the current egress IP is in the US
  (`curl -s ipinfo.io/country`). If it isn't, have the operator switch to a US VPN/proxy
  exit and re-probe; tell them explicitly that a US IP is required for this source.
  Distinguish geo-blocks from bot challenges in the findings — they need different
  mitigations (egress location vs browser automation).

For every page type (search results, detail page, each tab):

1. Open it in Playwright; wait for network idle; click through every tab/expander/
   pagination control; scroll to trigger lazy loads.
2. Record all network requests (`page.on('request'/'response')` or HAR) and identify the
   underlying data endpoints — JSON APIs are preferable scrape targets over HTML.
3. Diff what the rendered DOM contains vs the raw `curl` HTML of the same URL; anything
   browser-only must be captured by the browser flow or via the discovered endpoint with
   a modified request (copy headers, cookies, session bootstrap, POST params).
4. Document per source: required session/bootstrap steps, endpoints + required
   headers/params, which artifacts need a real browser vs a modified plain request, and
   the performance/concurrency measurements that support or reject full ingestion.

This inventory feeds `validate-county-transform` — fields missed here become silent
coverage gaps later.

## Permit-source discovery (fragmented jurisdictions)

A county has ONE appraiser but permits are NOT county-level: they live in dozens of
municipal/township/borough portals (Palm Beach = 39 municipalities + unincorporated;
nationally ~3,300 counties but ~25k-60k permit sources). You must **discover** each
jurisdiction's permit portal, **classify its vendor**, and **maintain a source catalog**
of the pointers — knowledge that survives people and scales to all of Florida, then the US.
This is an **agent capability to build, not a county you hand-probe once.**

**Output a source catalog** alongside the findings doc:
`skills/use-oracle/runtime/docs/<county>-sources.yaml` — one machine-readable registry:
countywide appraisal/sunbiz/bbb/gis blocks plus a `permits:` list, one row per
jurisdiction, each `{jurisdiction, url, vendor, search support, probe result, throughput
measurements, status}`. For example (Palm Beach):

```yaml
county: palm-beach
appraisal: {url: "https://pbcpao.gov", mode: plain-http-api}
permits:
  - {jurisdiction: unincorporated, vendor: epzb, url: "https://pbc.gov/ePZB",
     search: by-pcn, probe: playwright-required, throughput: "~2 req/s @ conc 2",
     status: needs-review}  # → discovered → certified as probes pass
```

Downstream skills
(seed data, permit adapter) consult it — it is the durable output of discovery.

Vendor identification is by signature against the known library — Accela, Tyler
EPL/Civic Access, Click2Gov/aspgov, OpenGov, CentralSquare/eHub, ePZB (county-custom),
GovAccess — from the portal's URL shape and page markup. Extend the library in the
catalog notes as new vendors appear. Probing is done directly with Playwright/curl
during discovery; finding each city's official permit page is the agent's job, via
web search and the NETR directory.

Procedure per county:
1. Enumerate jurisdictions (county GIS municipalities layer or Census places); seed the
   catalog's `permits:` with one row per jurisdiction, `status: needs-review`.
2. For each jurisdiction, web-search `"<city> <state> building permit search"`, open the
   official portal, confirm it, classify the vendor, and record search-by-parcel/address
   support + session/bootstrap needs (some need a Playwright session, e.g. PB
   unincorporated ePZB). Flip `status` to `discovered`.
3. Re-probe every catalogued portal before banking: assert it is live and its detected
   vendor matches the catalog row. **This certification pass is the acceptance test for
   "the agent can discover sources"** — report the pass/mismatch/unreachable summary; an
   uncertified catalog is not done.
4. Reuse/build a harvester per vendor via the `county-permit-adapter` skill (one adapter
   serves every jurisdiction on that vendor — the leverage that makes 25k-60k tractable).
5. Bank the catalog (commit + push with the findings doc).

## Reference example

Lee County profile: Accela at `aca-prod.accela.com/LEECO/...` (no CAPTCHA, tolerates
concurrency ~3-4), appraiser `leepa.org` via browser flow with STRAP search, seeds from
the county roll at `data/seeds/lee.csv` (~516k parcels). Treat Lee permits as the
example for source feasibility: measure permit-list and permit-detail throughput, then
estimate the countywide harvest before deciding whether to prefetch everything or serve
permit history through runtime lookup.

Palm Beach (prototyped): appraiser is a **plain-HTTP API, no browser flow** —
`POST pbcpao.gov/AutoComplete/SearchAutoComplete` (body `propertyType=RE&searchText=<q>`
→ `[{text,pcn}]`) then `GET pbcpao.gov/Property/Details?parcelId=<17-digit PCN>`. **Probe
for a plain-HTTP appraiser API first** — it is simpler/faster than a Browser Flow. Geometry
came from the **seed CSV** (`parcel_polygon` / `longitude` / `latitude` / `building_polygon`
columns; the transform reads it). Permits NOT Accela — `pbc.gov/ePZB` guest endpoints
(`iPZB.Building/guest/pcnpermits/<PCN>` and `EPR_BLDG/PermitSearch/GetGuestPermitsRec`),
curl blocked, Playwright required.
