---
name: mortgage-index-harvest
description: "Harvest a county's recorded mortgages (deeds of trust, security deeds) from the Clerk/Recorder official records index as resumable, count-checked date windows, with the per-county source, doc-type codes and known traps for the covered counties. Use when building or running the Mortgage data group, adding a county's mortgage source, auditing mortgage yields, or deciding how to get mortgages from a county behind a CAPTCHA or paywall."
metadata: {"author":"elephant-xyz"}
---
# Mortgage Index Harvest

The Mortgage data group lists every recorded mortgage instrument for a county from its
official records index: instrument number, recording date, book/page, borrowers
(grantors), lender and nominee (grantees), legal description and the portal's own record
id. Loan amounts, note dates and riders usually live only in the document image and come
from a later extraction step. Linking to `property` and `person` and loading into
Persist are separate steps.

Read `skills/use-oracle/reference/source-access.md` before probing any recorder.
Accepting a site disclaimer needs the operator's yes, once per site. Never solve,
bypass or automate past a CAPTCHA (visible or invisible reCAPTCHA v2/v3) and never
scrape a site whose terms forbid robots: route those counties to a records request or a
data purchase (section 6).

## 1. Commands

All three run from `skills/use-oracle/runtime` and write under the given `--output`.

```bash
# Texas publicsearch.us counties (real Chrome, WebSocket search)
node bin/elephant-county.mjs mortgage-index-harvest --county dallas --job-id <id> \
  --from 18000101 --to <YYYYMMDD> --output data/artifacts/mortgage-index \
  --chrome "<path to Chrome>" [--extra-doc-types | --doc-types A,B] [--delay-ms 1500]

# API/form counties: duval, hillsborough, maricopa, harris, mecklenburg
node bin/elephant-county.mjs mortgage-window-harvest --county <key> --job-id <id> \
  --to <YYYYMMDD> --output data/artifacts/mortgage-window [--from <YYYYMMDD>] \
  [--window day|month|year] [--delay-ms 1500] [--with-names] [--chrome <path>]

# Source documents to S3 (no local copies; resumable): duval, hillsborough
AWS_PROFILE=<profile> node bin/elephant-county.mjs mortgage-documents --county duval \
  --index-dir <harvest>/duval/<jobId>/windows --bucket <bucket> --limit N \
  [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--delay-ms 2000]

# One Duval instrument with its PDF (optional IPFS pin)
node bin/elephant-county.mjs mortgage-harvest --county duval --job-id <id> \
  --instruments <csv> --limit N --output <dir> [--pin]
```

Profiles live in `src/counties/mortgage-profiles.mjs` (vendor, base URL, doc-type codes,
extra codes, earliest date, default window). Code is in `src/mortgage/`.

## 2. Run contract

- **Windows.** Every source is harvested in date windows. A window is written as
  `<county>/<jobId>/windows/<from>-<to>.jsonl` plus `.ready.json` (rows, portal count,
  sha256). It is ready only when the rows equal the portal's own count, or when the
  portal answered without truncating. Otherwise it is split in half (down to one day)
  or recorded in `.failed.json`.
- **Resume.** Re-running the same command and job id skips ready windows whose file
  still matches its sha256 and retries everything else. After a run, re-run once to pick
  up failed windows. A finished county has `manifest.json` with `complete: true` (and for
  Texas, `records == portalTotal`).
- **Keys.** Key rows by the portal's own record id (`docId`, `globalId`, `uuid`,
  `transactionItemId`), not the instrument number: older records share instrument
  numbers.
- **Pacing.** Keep `--delay-ms` at 1500 or more. Run at most two Texas counties at once
  (one vendor serves all five). Never start a second runner on the same job id; check
  `pgrep -fl mortgage-` first.
- **Browser runners.** Texas and Mecklenburg drive a real Chrome the runner starts.
  Never `pkill` Chrome by profile pattern: that kills other runners' browsers. Stop a
  runner by its own PID.
- **Data.** Output stays under the runtime's git-ignored `data/`. Never commit it.

## 3. Covered counties

| County | Vendor / command | Doc types | Since | Notes |
|---|---|---|---|---|
| Dallas, Tarrant, Bexar, Collin, Denton TX | publicsearch.us / `mortgage-index-harvest` | `DT`; extras via `--extra-doc-types` | 1800s–1960s | Cloudflare non-interactive check; offset cap 10,000 |
| Duval FL | Acclaim / `mortgage-window-harvest` | MTG, MTGTF, MTGCU, EMTG, MTGG, MTGND, MTGNI | ~1990 | Month windows; disclaimer per session |
| Hillsborough FL | Open JSON API | MTG, MTGNDOC, MTGNT, MTGNIT, MTGREV | 1964 | Month windows; free daily bulk files for updates |
| Maricopa AZ | Public API | `documentCode=DT` | ~1975 | Names need `--with-names` (one call per record); no APN |
| Harris TX | WebForms RP.aspx | `D/T` | 1960s | Day windows only; slow (~60k requests full history) |
| Mecklenburg NC | Aumentum via Chrome | DEED OF TRUST, MORTGAGE, corrected/supplemental, PRE D/T family | Mar 1990 | Disclaimer; pre-1990 is image-only |

Texas extra codes (from each portal's own doc-type counts): Dallas `CORR DT`,
`D/T & ASGMT`, `MTG`, `MDT`, `MORTGAGE`; Tarrant `MDT`; Bexar `MORTG`, `M MORTG`;
Denton `MTG`, `MDT`, `ASSUMED MORTGAG`, `COLLATERAL MTG`, `AMENDED MORTGAG`; Collin none.
Tarrant `DTU` is UCC filings, not mortgages. Modifications (`MODT`), releases and
trustee deeds are deliberately excluded.

## 3a. Source documents

The recorded document is the source of truth. Store documents in a private S3 bucket,
never on the operator's laptop: `s3://<bucket>/documents/<ST>/<county>/<instrument>/`
holds `document.pdf` (or page images) and `index.json` (source URL, sha256, bytes,
fetch time). Free document access (verified 2026-11-26): Duval full PDF (Acclaim
`/Image/DocumentPdfAllPages`), Hillsborough watermarked PDF (`OverlayWatermark` API),
Maricopa unofficial PDF (`/preview/pdf-link` from the recorder site, served by
`legacy.recorder.maricopa.gov/recdocdata/unofficialpdfdocs.aspx`, real browser),
Mecklenburg unofficial page images (LTViewer tiles, real browser), Texas full-resolution
preview PNGs per page (signed per page through the viewer; whole PDFs are paid). Harris
images need a County Clerk login. Full history is tens of millions of documents and
tens of terabytes: agree the scope (covered properties, recent years, first pages) before
a large run.

## 4. Known traps

- **Texas offset cap.** publicsearch.us rejects any offset at or beyond 10,000
  (`FETCH_DOCUMENTS_REJECTED`). The runner plans windows from the portal's per-year
  counts and halves any window over the cap. Data comes over the page's WebSocket; plain
  HTTP gets a Cloudflare 403. The page can reload itself mid-run; the runner reopens it,
  or starts a new Chrome if the old one is gone.
- **Texas amounts.** The index shows `$0.00` consideration. Amounts are in the document:
  the preview PNGs are full resolution but signed per page. In the 2021+ uniform
  instrument the principal is on page 3, so read pages 1–3.
- **Duval stale grid.** Too wide a range returns "exceeded the maximum limit" and the
  grid then serves the previous search. The fetcher treats that message, or any row
  outside the window, as truncated. Never trust a grid without checking row dates.
- **Mecklenburg conversion codes.** Early-1990s deeds of trust are indexed as `PRE D/T`
  and `PRE COR D/T` (1991-06-20: 72 records, 0 under DEED OF TRUST). The search form
  depends on Infragistics client state, so it runs in Chrome; the record count is in the
  `…_TotalRows` span.
- **Harris.** Multi-day ranges warn "too many records"; use one-day windows. The early
  1960s are thin in the index itself, not because of a missing code.
- **Maricopa.** About 1% of mortgages are coded `MORTGAGE`/`MORTGAGE+`, which no API
  filter returns. Record it as a known gap; do not pull every document type per day.
- **Releases and payoffs** (Dallas `REL`, `RE`, `PAR`; Duval `SAT` 129, `SATNF` 130,
  `RELEASE` 126, `PTL REL` 125; Hillsborough `SAT`, `REL`, `PR`) decide whether a loan is
  open. They are mapped but not harvested until the product owner decides.

## 5. Auditing a county's mortgage types

Before a full run, and whenever a yield looks low:

1. Read the portal's own doc-type list or counts for the whole date range (publicsearch:
   `meta.statistics.docTypes` of an unfiltered search; Acclaim: the Doc Type checkboxes;
   Aumentum: the doc-type checkbox labels; Hillsborough: keyword query 322).
2. Keep every new-loan instrument: mortgage, deed of trust, security deed, corrected,
   supplemental, master, credit-union, government, no-tax variants and pre-conversion
   codes. Exclude modifications, assignments, releases, UCC and trustee deeds.
3. Spot-check one weekday in each decade against the portal by hand-count before
   trusting a run.

## 6. Counties behind a CAPTCHA, paywall or terms

Do not automate these. Write the request and hand it to the operator to send.

| County | Block | Route |
|---|---|---|
| Wake NC | reCAPTCHA v2 on rodrecords.wake.gov | Public records request (wakecounty.nextrequest.com; cc rodindexing@wake.gov) for a DEED OF TRUST index export plus a recurring extract |
| Clark NV | Invisible reCAPTCHA v3 on every Acclaim search | Recorder daily Official Records Index FTP feed plus a backfile quote (RecWeb@ClarkCountyNV.gov), or a JustFOIA request |
| Cobb GA | Invisible reCAPTCHA v3 on the clerk's LandmarkWeb search | Georgia Open Records request to GSCCCA, or to the Cobb clerk |
| Fulton, Gwinnett GA | GSCCCA only; terms forbid robots and compiling data | One Open Records request to GSCCCA (AG Opinion 2012-5) for counties 33, 60, 67, instrument SECURITY DEED |

For a new county, the free parcel files (Wake `RealEstData`, Clark Assessor files) give
the parcel spine for linking once the index arrives.

## 7. Report

Report per county: command and job id, portal total vs records, ready/failed windows,
doc types harvested, the earliest year with data, known gaps, and for blocked counties
the request drafted and who must send it. Never report a county complete from a run in
progress.
