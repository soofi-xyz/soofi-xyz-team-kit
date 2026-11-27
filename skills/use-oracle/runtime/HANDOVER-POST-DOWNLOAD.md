# Mortgage Data Group — post-download handover

Last updated 2026-11-27. This covers everything **after** the documents are downloaded:
OCR → field extraction → link to person & parcel → load into Persist. For the download
fleet itself (AWS workers, S3 layout, how to run more years/counties), see
`aws/HANDOFF.md`. Story: Asana task 1220921880558990.

---

## 1. What you're starting from (the raw material in S3)

Bucket `elephant-mortgage-documents-904370092316` (us-east-2). One folder per document:
`documents/<ST>/<county>/<year>/<instrument>/` → `document.pdf` **or** `page-0001.png …`,
plus `index.json` (instrument, recording date, docType, grantors, grantees, legal
description, source URL, sha256). PDF counties: Duval, Hillsborough, Maricopa. PNG
(page-image) counties: the TX publicsearch five + Mecklenburg (their sites sell the PDF;
only page images are free).

**Downloaded so far (document count), as of this handover:**

| County | 2026 | 2025 | Notes |
|---|---|---|---|
| Duval FL | 24,987 ✅ | 28,470 ✅ | complete both years |
| Maricopa AZ | 117,074 ✅ | 74,964 ✅ | complete (missing ~5% of 2026 = newest recordings not yet imaged) |
| Hillsborough FL | ~21,000 (running) | ~4,200 (running) | slow county; still downloading |
| Dallas TX | 7,808 | — | capped ~19% by the "Verify you are human" check |
| Tarrant TX | 10,337 | — | capped ~24% |
| Bexar TX | 11,078 | — | capped ~26% |
| Denton TX | 6,638 | — | capped ~23% |
| Mecklenburg NC | 85 | — | viewer times out from AWS; deprioritized |

The county **index** (every mortgage per county/year, incl. grantor names + legal
description) is also in S3 under `indexes/<county>/<job>/*.jsonl` — richer than the
per-document `index.json`, and the source of clean borrower/lender names.

Reachable-but-not-done counties need a **records request / bulk-data purchase** (the TX
caps, Collin, Harris, and Wake/Clark/Cobb/Fulton/Gwinnett). Never solve or evade a CAPTCHA.

---

## 2. Stage 1 — OCR (image/PDF → text): AWS Textract

- Pilot proven on 27 samples (`start-document-text-detection` for PDFs,
  `detect-document-text` per page for PNGs; concatenate LINE blocks in page order).
- Textract reads PNG pages as well as PDFs (the "Unofficial Copy" watermark that breaks
  macOS Vision OCR does **not** break Textract).
- Cost ≈ $1.50 / 1,000 pages. Docs average ~18 pages → ~$27 / 1,000 docs for all pages,
  or ~$6 / 1,000 if you OCR only pages 1–4 (where borrower, lender, amount, MERS, dates
  live). **Recommendation: OCR pages 1–4 for the fields; OCR all pages only if you need
  full-text.**

---

## 3. Stage 2 — Field extraction — **DECIDED: multimodal `gpt-6.1-terra`, no OCR**

This was tested head-to-head on **1,000 Bexar documents** with **document-derived ground
truth** (Textract OCR + `extractLoanTerms`, independent of the index) and **hand-verified**.
Code: `aws/extract-run.mjs` (runner) + `src/mortgage/extract.mjs` (validation/normalize).

**Send the page images (pages 1–3) straight to `gpt-6.1-terra`** — no OCR, no regex-as-primary,
no Comprehend. Per-field exact accuracy vs ground truth (terra vs gpt-6-luna):

| field | gpt-6-luna | **terra** |
|---|---|---|
| loan_amount | 74% | **95%** |
| note_date | 88% | **96%** |
| maturity_date | 56% | **96%** |
| program | 82% | **91%** |
| lender | 94% | **98%** |
| MERS (exact 18 digits) | 27% | **60%** (→ fixed by the MERS pass) |

**Hand-verified:** on loan-amount disagreements, terra matched the document **every time**;
luna had digit-level errors (transposed/dropped/added digits). So **luna is not adequate for
the loan amount** (the key field) — **use terra.** Cost: terra ~$3.9/1k live, **~$2/1k batch**
(~10× under Comprehend). Config: low reasoning (`additionalModelRequestFields
{"reasoning":{"effort":"low"}}`), `maxTokens` 2500, pages 1–3 at ~1000px, `MAIN_PROMPT` from
`extract.mjs`. terra is a reasoning model — give it room in `maxTokens` or it emits no JSON.

### The MERS pass (critical — MERS is the universal, stable loan ID)
MERS is the one weak field (60% exact) because an 18-digit number loses a digit when the page
is downscaled. The pipeline fixes it:
1. **Validate every MIN with its Luhn check digit** (`luhnValidMin` — verified against real
   recorded MINs; the 18th digit is a mod-10 checksum). A MIN that passes is almost certainly
   read right; one that fails was misread.
2. When a MIN is missing or fails the checksum, **re-read it from a high-resolution page 1**
   (`MERS_PROMPT`, ~2200px) and keep it only if the checksum then passes.
3. A MIN that still fails is dropped and the record is flagged `needs_review`.

### Post-processing & validation — `normalizeExtraction(raw, ctx?)`
Maps the model output to a loadable `loan` record and makes it trustworthy:
program→`mortgage_type` (FHA→Fha, VA→Va, USDA→UsdaRuralDevelopment, GSE→Conventional);
program→prepayment rule; note+maturity→`term_months`; keeps a MERS **only if Luhn-valid**;
sets `needs_review` when the amount is missing or a MIN failed its checksum; carries a
`confidence` block. Names: it uses the county index names if you pass `ctx.index`, else the
model's (terra lender ~98%).

### Comprehend — tested, rejected
Comprehend DetectEntities was wrong on money (returned the **$137.50 recording fee** as an
amount), buried the lender among Fannie/Freddie/MERS/vendors/notaries, and missed MERS and
program. ~$15/1k. **Do not use it.**

### Run modes
- **Testing / moderate volume / per-shard on an EC2 worker:** `aws/extract-run.mjs`
  (env `COUNTY`,`STATE`,`YEAR`,`LIMIT`,`CONC`). Writes `extracted/<ST>/<county>/<year>/<inst>.json`
  (validated record + `confidence` + `needs_review`). Resumable (skips docs already extracted).
- **Production (millions of docs):** build a **Bedrock batch manifest** from the same prompts
  (one request per doc) — ~50% cheaper, high throughput, no rate juggling. Run the **MERS pass
  as a second batch** over only the `needs_review` records. This is the recommended path at scale.

---

## 4. Stage 3 — Linking to person & parcel

**Person (borrower):** the index `grantors` are the borrowers; `grantees` are the
lender + MERS. Normalize names (see `src/mortgage/names.mjs`: `parseIndexedPersonName`,
`chooseLender` — drops MERS, keeps the real lender, handles DBA/AKA/suffixes).

**Parcel:** the recorder index has **no parcel field**, but for **Duval** the legal
description often embeds a **PIN** (e.g. `PIN 162222-1215`). `src/mortgage/parcel-link.mjs`
→ `parcelIdFromRecord()` normalizes it to the Persist `parcel_identifier` (strip dash, add
`R` → `1622221215R`), and `parcelLookupGremlin()` builds the lookup.
- **Verified:** 89 of ~94 distinct Duval PINs in one month matched a real Persist
  parcel (~95%). Persist has full property coverage for our FL counties — **Duval ~404k
  parcels, Hillsborough ~527k**.
- **Gap:** the PIN is only present in *some* index batches (Jan-2026 ~75%, other months
  ~0% — just lot/subdivision text). For no-PIN records **there is no parcel join available
  today**: Persist's Duval property has only parcel_identifier + physical attrs + tax
  (no `subdivision`, address, owner populated, though the lexicon allows them), and the
  **document text does not print the parcel/RE# either** (only Doc#, book/page, LOAN#,
  MERS). → The real fallback is loading the **county appraiser parcel crosswalk**
  (subdivision+lot → RE#, address → RE#) — the "property spine". That is a data-ingestion
  task, not a text matcher.

---

## 5. Stage 4 — Load into Persist (the target model)

Relevant lexicon (from `describe_schema`):

- **`loan`**: `loan_amount`, `note_amount`, `note_date` (date), `note_rate_percent`,
  `prepayment_penalty_indicator` (bool), `lender_name`, `mortgage_type`
  (`Conventional|Va|Fha|UsdaRuralDevelopment|LocalAgency|StateAgency|PublicAndIndianHousing`),
  `loan_purpose_type` (`Purchase|Refinance|MortgageModification|Unknown`),
  `lien_priority_type`, `occupancy`, `loan_closing_date`, `end_date`, `borrower_count`.
- **`person`**: `first_name`, `middle_name`, `last_name`, `person_identifier`.
- **Edges:** `person_has_loan` (borrower → loan), `property_has_loan` (parcel → loan),
  `finance_relation__has_loan`, `terms_of_loan__has_loan`.

Field mapping from the extractor → loan:
`program` → `mortgage_type` (FHA→Fha, VA→Va, USDA→UsdaRuralDevelopment, GSE→Conventional);
`loanAmount` → `loan_amount` **and** `note_amount`; `noteDate` → `note_date`;
`maturityDate` → `end_date`; `initialRatePercent` → `note_rate_percent`;
`prepaymentPenalty` → `prepayment_penalty_indicator`; `lenderName` → `lender_name`.
Link: borrower `person` —`person_has_loan`→ `loan` ←`property_has_loan`— `property`
(the parcel matched in Stage 3).

### ⚠️ Lexicon gap to confirm before loading
Recorded security instruments usually **do not state the note rate**, and the prepayment
penalty is only knowable from a rider or the program rule. If `note_rate_percent` /
`prepayment_penalty_indicator` (or `loan_amount`/`note_amount`) are **required** in the
live lexicon, loads will fail. Per the Nov-27 meeting the plan is to make these
**nullable** (and estimate the rate later from the average market rate at the note date).
Verify the required-fields state with the lexicon owner (Unown/Uxie) and request the
nullability change before a bulk load.

---

## 6. Code pointers (branch `feat/mortgage-data-group-v2`, PR #462)

Run from `skills/use-oracle/runtime`.
- `src/mortgage/loan-terms.mjs` — `extractLoanTerms` (field extractor) + tests.
- `src/mortgage/names.mjs` — name/lender normalization + tests.
- `src/mortgage/parcel-link.mjs` — PIN → parcel matcher + tests (committed `0c8f7c1`).
- `src/mortgage/documents.mjs`, `bin/elephant-county.mjs` — download/index CLI.
- Persist access: the read-only Persist MCP (`run_gremlin`, `describe_schema`,
  `count_by_label`) against the live graph; writes go through the normal ingestion path
  (not these tools).
- Tests: `npx vitest run tests/mortgage-*.test.mjs` (all green).

---

## 7. What's left (the teammate's scope)

1. **Extract at scale:** Textract (pages 1–4) + `extractLoanTerms` over the S3 documents;
   write results keyed by instrument. Comprehend only as an optional name fallback.
2. **Link:** borrower (index names → `person`), parcel (PIN matcher for Duval; design the
   appraiser-crosswalk fallback for no-PIN and for TX/other counties).
3. **Lexicon:** confirm/relax required fields (`note_rate_percent`,
   `prepayment_penalty_indicator`, amounts) before loading.
4. **Load** `loan` + `person` + edges into Persist; expose via the Persist MCP / metrics.
5. **Rate estimation (later):** fill `note_rate_percent` from the market rate at `note_date`
   where the document doesn't state it (as agreed in the meeting).
6. **Coverage:** keep Hillsborough finishing; pursue records-request / bulk-data for the
   CAPTCHA-blocked counties; re-run Maricopa/Duval newest-day gaps in a few days.

---

## 8. Open decisions (for product / Soofi)
- No-PIN parcel fallback = load the appraiser crosswalk (bigger data task) vs. ship
  PIN-only linking first.
- Comprehend: the agent tested it and does **not** recommend it as the extraction method
  (§3); confirm the regex-led approach is accepted.
- TX / blocked counties: records request vs. local human-in-the-loop runner
  (`local/local-run.mjs`) vs. leave partial.
