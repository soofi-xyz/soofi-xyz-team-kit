/**
 * Turn a model's reading of a recorded mortgage into a validated loan record.
 *
 * The extraction itself is done by a multimodal model (gpt-6.1-terra) that reads the page
 * images — see the pipeline runner. This module holds the deterministic parts that make the
 * result trustworthy and loadable: MERS check-digit validation, program→type mapping,
 * prepayment-by-rule, term-from-dates, and a confidence flag per record. Pure and testable.
 *
 * @module src/mortgage/extract
 */

/** Model prompt for the main full-page read (page images 1-3). */
export const MAIN_PROMPT =
  'You extract fields from a recorded U.S. mortgage / deed of trust. You are given the first pages of one document as images, in order. Read carefully, including small print, the signature block, and the form footer.\n' +
  'Return a single JSON object and nothing else. Every key below must be present. If a value is not clearly visible in these pages, set it to null. Never guess, never ask a question, never return a partial answer.\n' +
  'Keys: program ("FHA"/"VA"/"USDA"/"GSE"/null), loan_amount (number, the principal/Note amount, not fees), mers_min (string of exactly 18 digits, digits only, or null), lender_name (the Lender, not MERS/trustee/title company), borrower_name, note_date ("YYYY-MM-DD"), maturity_date ("YYYY-MM-DD" or null), term_months (integer or null), interest_rate_percent (number only if stated, else null), prepayment_penalty (true only if a Prepayment Rider is checked; false if FHA/VA/USDA or a GSE uniform instrument; else null).\n' +
  'Output only the JSON object.';

/** Model prompt for the zoomed MERS pass (a sharp crop of the MIN line). */
export const MERS_PROMPT =
  'This image is a close-up of the "MIN" (Mortgage Identification Number / MERS number) line from a mortgage. ' +
  'Read the 18-digit number exactly, digits only. Return only JSON: {"mers_min":"<18 digits, or null if none>"}.';

/**
 * MERS MIN check-digit test (standard Luhn / mod-10 over all 18 digits).
 * Verified against real recorded MINs. A valid MIN is internally consistent, so a value that
 * passes is almost certainly read correctly; a value that fails was misread.
 *
 * @param {unknown} min - Candidate MIN.
 * @returns {boolean} True when it is 18 digits and the Luhn checksum passes.
 */
export function luhnValidMin(min) {
  const s = String(min ?? "").replace(/\D/g, "");
  if (s.length !== 18) return false;
  let sum = 0;
  let alt = false;
  for (let i = s.length - 1; i >= 0; i -= 1) {
    let d = s.charCodeAt(i) - 48;
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/**
 * @param {unknown} v - Candidate MIN.
 * @returns {string | null} 18 digits, or null.
 */
export function cleanMin(v) {
  const s = String(v ?? "").replace(/\D/g, "");
  return s.length === 18 ? s : null;
}

const PROGRAM_TO_TYPE = { FHA: "Fha", VA: "Va", USDA: "UsdaRuralDevelopment", GSE: "Conventional" };

/**
 * @param {string | null} note - Note date, ISO.
 * @param {string | null} maturity - Maturity date, ISO.
 * @returns {number | null} Whole months between the two, snapped to a multiple of 12 when within 2.
 */
export function termFromDates(note, maturity) {
  if (!note || !maturity) return null;
  const a = new Date(note), b = new Date(maturity);
  if (Number.isNaN(+a) || Number.isNaN(+b) || b <= a) return null;
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  const rem = months % 12;
  if (rem <= 2) months -= rem; else if (rem >= 10) months += 12 - rem;
  return months > 0 ? months : null;
}

/**
 * Normalize a model reading into a validated loan record ready to load.
 *
 * @param {Record<string, any>} raw - The model's JSON (main read; `mers_min` may already be
 *   replaced by the MERS-pass value).
 * @param {{ index?: { grantors?: string[], grantees?: string[] } }} [ctx] - Optional context
 *   (names from the county index are authoritative; passed through only if present).
 * @returns {{
 *   loan_amount: number|null, note_amount: number|null, note_date: string|null,
 *   end_date: string|null, term_months: number|null, note_rate_percent: number|null,
 *   prepayment_penalty_indicator: boolean|null, lender_name: string|null,
 *   mortgage_type: string|null, borrower_name: string|null, mers_min: string|null,
 *   confidence: { mers_valid: boolean, amount: boolean, lender: boolean, dates: boolean },
 *   needs_review: boolean,
 * }} The loan record plus validation flags.
 */
export function normalizeExtraction(raw, ctx = {}) {
  const r = raw ?? {};
  const amount = typeof r.loan_amount === "number" ? r.loan_amount : (r.loan_amount && r.loan_amount !== "null" ? Number(String(r.loan_amount).replace(/[^0-9.]/g, "")) : null);
  const program = r.program && r.program !== "null" ? r.program : null;
  const note = r.note_date && /^\d{4}-\d{2}-\d{2}$/.test(r.note_date) ? r.note_date : null;
  const maturity = r.maturity_date && /^\d{4}-\d{2}-\d{2}$/.test(r.maturity_date) ? r.maturity_date : null;
  const min = cleanMin(r.mers_min);
  const mersValid = luhnValidMin(min);
  // Prepayment: keep an explicit true/false, else infer false from program rule, else null.
  let prepay = typeof r.prepayment_penalty === "boolean" ? r.prepayment_penalty : null;
  if (prepay === null && (program === "FHA" || program === "VA" || program === "USDA" || program === "GSE")) prepay = false;
  const lender = ctx.index?.grantees?.filter((g) => !/MERS|MORTGAGE ELECTRONIC/i.test(g))?.[0] || (r.lender_name && r.lender_name !== "null" ? r.lender_name : null);
  const borrower = ctx.index?.grantors?.[0] || (r.borrower_name && r.borrower_name !== "null" ? r.borrower_name : null);
  const rate = typeof r.interest_rate_percent === "number" ? r.interest_rate_percent : null;
  const record = {
    loan_amount: Number.isFinite(amount) && amount >= 1000 ? amount : null,
    note_amount: Number.isFinite(amount) && amount >= 1000 ? amount : null,
    note_date: note,
    end_date: maturity,
    term_months: (typeof r.term_months === "number" ? r.term_months : null) ?? termFromDates(note, maturity),
    note_rate_percent: rate != null && rate > 0 && rate < 25 ? rate : null,
    prepayment_penalty_indicator: prepay,
    lender_name: lender,
    mortgage_type: program ? PROGRAM_TO_TYPE[program] ?? null : null,
    borrower_name: borrower,
    mers_min: mersValid ? min : null, // only keep a MERS that passes its checksum
  };
  record.confidence = {
    mers_valid: mersValid,
    amount: record.loan_amount != null,
    lender: record.lender_name != null,
    dates: record.note_date != null,
  };
  // Flag for review when a MERS was read but fails its checksum, or the amount is missing.
  record.needs_review = (min != null && !mersValid) || record.loan_amount == null;
  return record;
}
