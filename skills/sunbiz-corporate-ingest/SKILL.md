---
name: sunbiz-corporate-ingest
description: "Ingest Florida Sunbiz corporate registration bulk data scoped to a county - bulk download, ZIP-prefix extraction, and lexicon transform as one durable batch job. Use when onboarding a Florida county's business-registration data, refreshing quarterly Sunbiz data, or matching corporate entities to county addresses."
metadata: {"author":"elephant-xyz"}
---
# Sunbiz Corporate Ingest

Sunbiz is STATEWIDE Florida data — the pipeline is fully reusable across FL counties.
The only county-specific input is the ZIP-code prefix list (from `county-discovery`).

## 1. Acquire the bulk file

- Source: Sunbiz Data Access Portal, quarterly corporate file `doc > quarterly > cor >
  cordata.zip` (~1.7 GB; expands to ~18 GB — check free disk first).
- The host is Cloudflare-challenged: plain `curl` fails; use a real browser (headless
  Chromium works, manual browser is fine).
- **Deflate64 pitfall**: `cordata.zip` uses ZIP method 9, which streaming unzip libraries
  (yauzl etc.) cannot read. Expand with system `unzip`:

```bash
unzip cordata.zip -d cordata-expanded/
```

Daily incremental files (`YYYYMMDDc.txt`) are plain text and work directly.

## 2. Run the `SunbizIngest` workflow

The job is a Restate workflow in `skills/use-oracle/runtime/services/enrichment.ts`, keyed by
jobId `sunbiz-<county>-<quarter>` (exactly-once per quarter per county). This
`SunbizIngest` workflow is authored per `durable-workflow-builder`; the steps and
outputs below are its contract, not existing code. Steps, each an
idempotent `ctx.run`:

1. Download via browser (or accept a pre-downloaded local path as input).
2. Expand with system `unzip` under
   `data/artifacts/enrichment/sunbiz/<quarter>/source/` (raw-first — the expanded
   `cordata*.txt` files are the kept source artifacts).
3. Scan the fixed-width records and match principal, mailing, registered-agent, AND
   officer addresses against the county ZIP prefixes.
4. Write chunked JSONL + `manifest.json` to
   `data/artifacts/enrichment/sunbiz/<quarter>/<county>/`.
5. Lexicon transform (below) → `summary.json`.

Because this runs as a local long-lived process, extraction streams the whole expanded
set from local disk in one pass — no per-file fan-out or temp-space juggling. The
download/unzip/scan steps run for many minutes, so the workflow's service needs raised
`inactivityTimeout`/`abortTimeout` (defaults abort a handler stuck in one `ctx.run`
after ~11 min — `durable-workflow-builder` authoring rule 3). Even so, prefer splitting
the extract/transform into per-chunk `ctx.run` steps (or per-chunk sub-invocations) so
progress is journaled and a crash resumes mid-quarter — see `durable-workflow-builder`
patterns 4 (idempotent side effects) and 11 (chunked fan-out).

```bash
curl localhost:8080/restate/send/SunbizIngest/sunbiz-<county>-<quarter>/run \
  --json '{"jobId":"sunbiz-<county>-<quarter>","county":"lee","quarter":"2025Q3","zipPrefixes":["334","33401"],"sourcePath":"<DATA_DIR-relative path to cordata.zip or expanded dir>"}'
```

`jobId` matches the workflow key; the handler uses it for artifact paths. `sourcePath`
is optional and takes precedence: when set, the download step is skipped and the
workflow starts from the given local `cordata.zip` (or already-expanded dir).

Watch it in the Web UI at `http://localhost:9070`. A failed step retries with backoff
and then **pauses visibly** — fix the code/source, then `restate invocations resume`.

Scale reference (Lee): 12.6M records scanned, ~379k matched, ~80 chunks.

## 3. Transform to lexicon

The transform step maps matched records to `business-registration-v1`: emits
`business_registration`, `business_registration_address` (role bridge),
`business_registration_party`, companies, de-duplicated addresses, and relationship
records — a single `classes/` + `relationships/` tree plus `summary.json` with counters.
Complete when `invalidRecordCount == 0` and `transformedRecordCount == sourceRecordCount`.

Load with the enrichment prefix per `query-db-loading-matching`:
`--sunbiz-prefix enrichment/sunbiz/<quarter>/<county>/business-registration-v1/classes/`.

## 4. Address matching (optional, later)

A follow-on step matches a supplied address batch (e.g. permit work locations) against
the corporate addresses — useful once enough permits have accumulated for the county.

## Known gaps (do not silently fix)

- `corevent.zip` (filing-history events) is not ingested — separate scope.
- `party_type_code` decoding is incomplete; officers are not normalized to person/company.
- Unmapped fields are intentionally preserved in the output for future lexicon expansion.

## Persist your work

Workflow code lives in `skills/use-oracle/runtime`. Any runbook notes, ZIP-prefix lists, or
mapping findings produced for a county get committed and PR'd to
`github.com/elephant-xyz/Counties-trasform-scripts` under `<county>/docs/`
(`gh pr create`) so they survive outside this machine.
