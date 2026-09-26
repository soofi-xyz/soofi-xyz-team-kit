---
name: sunbiz-corporate-ingest
description: "Load Florida Sunbiz corporate registration as the official legal-entity identity baseline (document_number) before county permit harvest - bulk download, ZIP-prefix extraction, and lexicon transform as one durable batch job. Use when pre-populating Florida companies for a county, refreshing quarterly Sunbiz data, or matching corporate entities to county addresses. Sunbiz does not issue contractor licenses."
metadata: {"author":"elephant-xyz"}
---
# Sunbiz Corporate Ingest

Sunbiz is STATEWIDE Florida data — the pipeline is fully reusable across FL counties.
Sunbiz is the official corporate registry (legal entities / `document_number`). It does
not issue contractor licenses and is not a substitute for DBPR. Load and reconcile this
snapshot as identity baseline **before** the county's permit harvest. After Sunbiz,
run `dbpr-license-ingest` and acquire official DBPR if inadequate — Sunbiz is first
among identity sources, not a substitute for licensing. Outside Florida, use the
official corporate registry and official contractor-licensing authority equivalents
named in the county profile; do not run Sunbiz or DBPR for another state. County ZIP scope
comes from the validated county profile under
`skills/use-oracle/runtime/src/counties/`; do not pass an ad hoc production ZIP list.

## 1. Acquire the bulk files

- Source: Sunbiz Data Access Portal, quarterly corporate file `doc > quarterly > cor >
  cordata.zip` (~1.7 GB; expands to ~18 GB — check free disk first).
- For HOA/PM successor and DBA resolution, also acquire `doc > quarterly > cor >
  corevent.zip` and `doc > quarterly > fic > ficdata.zip` plus `ficevt.zip`.
- Reuse archives already present on the operator's disk. Do not automatically download
  these large archives, and never commit ZIPs or expanded fixed-width files.
- The host is Cloudflare-challenged: plain `curl` fails; use a real browser (headless
  Chromium works, manual browser is fine).
- **Deflate64 pitfall**: `cordata.zip` uses ZIP method 9, which streaming unzip libraries
  (yauzl etc.) cannot read. Expand with system `unzip`:

```bash
unzip cordata.zip -d cordata-expanded/
```

Daily incremental files (`YYYYMMDDc.txt`) are plain text and work directly.

## 2. Run the executable ingest

The implementation lives in `skills/use-oracle/runtime/src/enrichment/` and is exposed
through `elephant-county`. It validates the archive entry list and SHA-256, expands with
system `unzip`, streams every fixed-width record once, writes checksummed JSONL chunks,
transforms them to lexicon records, and writes the Sunbiz identity rows used by the
internal reconciliation store. The CLI still uses `sunbiz-enrich`; that command is identity-baseline
load, not post-permit enrichment.

```bash
cd skills/use-oracle/runtime
node bin/elephant-county.mjs sunbiz-prepare \
  --archive <cordata.zip> --sha256 <digest> --output <expanded-dir>
node bin/elephant-county.mjs sunbiz-filter \
  --county duval --quarter 2026Q3 --source-dir <expanded-dir> \
  --output <extract-dir>
node bin/elephant-county.mjs sunbiz-transform \
  --input <extract-dir> --output <lexicon-dir>
node bin/elephant-county.mjs sunbiz-enrich \
  --county duval \
  --input-parquet <query-table.parquet> \
  --input-coverage <dataset-coverage.json> \
  --sunbiz-extract <extract-dir> --output-dir <enriched-dir>
```

Production runs use an approved immutable AWS Batch request, content-addressed S3
inputs, checkpointed handoffs, least-privilege job roles, and the mandatory cost gate.
The request county must resolve to the same reviewed enrichment profile used by the
local commands.

Scale reference (Lee): 12.6M records scanned, ~379k matched, ~80 chunks.

For the optional HOA/PM resolver, expand the three companion archives outside git and
pass their statewide directories:

```bash
node bin/elephant-county.mjs hoa-pm-enrich \
  --county duval \
  --input-parquet <query-table.parquet> \
  --input-coverage <dataset-coverage.json> \
  --sunbiz-extract <statewide-hoa-index-dir> \
  --sunbiz-pm-extract <full-active-sunbiz-dir> \
  --ctmh-extract <ctmh-extract-dir> \
  --sunbiz-events-extract <expanded-corevent-dir> \
  --sunbiz-fictitious-extract <expanded-ficdata-and-ficevt-dir> \
  --output-dir <enriched-dir>
```

Keep `corevent`, `ficdata`, and `ficevt` statewide. Use corporate events only to bridge
an already-established CTMH association or corporate registered-agent name to exactly
one ACTIVE Sunbiz document number. If no event target exists, use an exact ACTIVE
fictitious-name registration only when its current corporate owner resolves to exactly
one ACTIVE document number. Never fuzzy-match, ZIP-filter, promote a person owner/agent,
or treat a fictitious-name registration alone as an HOA.

Humans find associations the matcher misses because they search Sunbiz interactively.
Do not imitate that: strip plat-book/page and trailing `LOT` (Orange parser) before
lookup, do not invent HOA/POA/Community Association suffixes, run the disambiguation
ladder on multiple ACTIVE hits and keep `not_unique` when two remain, and never stamp
a person or lawyer as the HOA. Follow
`skills/use-oracle/reference/hoa-property-management.md`.

## 3. Transform to lexicon

The transform step maps matched records to `business-registration-v1`: emits
`business_registration`, `business_registration_address` (role bridge),
`business_registration_party`, companies, de-duplicated addresses, and relationship
records — a single `classes/` + `relationships/` tree plus `summary.json` with counters.
Complete when `invalidRecordCount == 0` and `transformedRecordCount == sourceRecordCount`.

Apply this for every county. Do not special-case one county.

1. Acquire the official quarterly `cordata.zip`.
2. Filter with that county's ZIP profile.
3. Transform.
4. For each company, set `source_http_request` to a GET of the unique official Sunbiz detail URL calculated from that company's document number. `request_identifier` stays `sunbiz:<documentNumber>:company`.
5. Load only after that stamp is on the company.

The detail URL is:

`https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResultDetail?inquirytype=DocumentNumber&directionType=Initial&searchNameOrder=&aggregateId=&searchTerm=<documentNumber>`

`sunbizCompanyDetailUrl()` in `skills/use-oracle/runtime/src/enrichment/sunbiz.mjs` builds it. The bulk page `https://dos.fl.gov/sunbiz/other-services/data-downloads/` is the archive source. Do not write it onto the company. Address rows keep their own source rule.

Load with the enrichment prefix per `query-db-loading-matching`:
`--sunbiz-prefix enrichment/sunbiz/<quarter>/<county>/business-registration-v1/classes/`.

## 4. Address matching (optional, after both identity and permits exist)

A follow-on step may match a supplied address batch (e.g. permit work locations) against
already-loaded corporate addresses. Do not delay the Sunbiz identity baseline until
permits accumulate. Permit contractor identity uses the permit-evidence-preflight
resolver (license number, else unique company+qualifier with temporal DBPR
qualification), not this address match.

## Known gaps (do not silently fix)

- Corporate-event and fictitious-name files are optional HOA/PM resolver inputs; they are
  not transformed into general query-DB event entities.
- `party_type_code` decoding is incomplete; officers are not normalized to person/company.
- The HOA/PM heuristic (`hoa-pm-enrich`) uses registered-agent **company** name, not officer rows.
- Unmapped fields are intentionally preserved in the output for future lexicon expansion.

## Persist your work

Workflow code lives in `skills/use-oracle/runtime`. Any runbook notes, ZIP-prefix lists, or
mapping findings produced for a county get committed and PR'd to
`github.com/elephant-xyz/Counties-trasform-scripts` under `<county>/docs/`
(`gh pr create`) so they survive outside this machine.
