/**
 * Loan terms from the OCR text of a recorded mortgage / deed of trust / security deed.
 *
 * Recorded security instruments rarely state the note rate (it lives in the unrecorded
 * promissory note), but they do carry evidence we can trust:
 *   - Adjustable-rate riders state the initial interest rate.
 *   - The rider checklist on page 1-2 marks a Prepayment Rider when there is one.
 *   - The loan program is printed (FHA case number, VA/Title 38 language, USDA/Rural
 *     Development, the "Fannie Mae/Freddie Mac UNIFORM INSTRUMENT" footer). Federal rules
 *     forbid prepayment penalties on FHA (24 CFR 203.22(b)), VA (38 CFR 36.4310) and USDA
 *     guaranteed loans, and GSE uniform instruments carry no penalty clause, so those
 *     loans get `prepaymentPenalty: false` with that reason.
 * Every value carries its evidence; anything not proven stays null.
 *
 * @module src/mortgage/loan-terms
 */

const MONTHS = "(January|February|March|April|May|June|July|August|September|October|November|December)";
const MONTH_INDEX = Object.fromEntries(
  "January February March April May June July August September October November December".split(" ").map((m, i) => [m.toLowerCase(), i + 1]),
);

/**
 * @param {string} month - Month name.
 * @param {string} day - Day.
 * @param {string} year - Year.
 * @returns {string} ISO date.
 */
function isoDate(month, day, year) {
  return `${year}-${String(MONTH_INDEX[month.toLowerCase()]).padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/**
 * @param {string} text - Text.
 * @param {RegExpExecArray} match - Match.
 * @returns {string} A short quote around the match, for the evidence trail.
 */
function quote(text, match) {
  return text.slice(Math.max(0, match.index - 60), match.index + match[0].length + 40).trim();
}

/**
 * Extract loan terms from a document's OCR text.
 *
 * @param {string} rawText - OCR text of all pages, in order.
 * @returns {{
 *   program: "FHA" | "VA" | "USDA" | "GSE" | null,
 *   loanAmount: number | null,
 *   termMonths: number | null,
 *   min: string | null,
 *   loanNumber: string | null,
 *   lenderName: string | null,
 *   borrowerText: string | null,
 *   mers: boolean,
 *   noteDate: string | null,
 *   maturityDate: string | null,
 *   initialRatePercent: number | null,
 *   adjustableRate: boolean,
 *   prepaymentPenalty: boolean | null,
 *   riders: string[],
 *   evidence: Record<string, string>,
 * }} Terms with evidence quotes.
 */
export function extractLoanTerms(rawText) {
  const text = String(rawText ?? "").replace(/\s+/g, " ");
  const evidence = {};

  // Program.
  const programs = [
    ["FHA", /\bFHA\s*Case\s*(?:No|Number|#)|Federal Housing Administration|insured under the National Housing Act/i],
    ["VA", /Department of Veterans Affairs|Veterans Administration|Title 38(?:,| of the) United States Code|\bVA\s*(?:Loan|Case|Guaranty)\s*(?:No|Number|#)/i],
    ["USDA", /Rural Housing Service|Rural Development|United States Department of Agriculture/i],
    ["GSE", /Fannie Mae\s*\/\s*Freddie Mac\s*(?:UNIFORM INSTRUMENT)?|UNIFORM INSTRUMENT\s*Form\s*3\d{3}/i],
  ];
  let program = null;
  for (const [name, re] of programs) {
    const m = re.exec(text);
    if (m) {
      program = name;
      evidence.program = quote(text, m);
      break;
    }
  }

  // Principal amount.
  let loanAmount = null;
  for (const re of [
    /U\.?\s*S\.?\s*\$\s*([\d,]+\.\d{2})/i,
    /principal (?:sum|amount) of[^$]{0,120}\$\s*([\d,]+\.\d{2})/i,
    /Dollars\s*\(\s*\$\s*([\d,]+\.\d{2})/i,
    // Revolving credit (HELOC) deeds of trust state a maximum instead of a principal.
    /(?:shall not exceed|maximum (?:principal )?amount[^$]{0,60}?|credit limit[^$]{0,40}?)\s*\(?\s*\$\s*([\d,]+\.\d{2})/i,
  ]) {
    const m = re.exec(text);
    if (m) {
      const value = Number(m[1].replace(/,/g, ""));
      if (value >= 1000) {
        loanAmount = value;
        evidence.loanAmount = quote(text, m);
        break;
      }
    }
  }

  // Note date and maturity.
  const note = new RegExp(`Note[^.]{0,100}?dated\\s+${MONTHS}\\s+(\\d{1,2}),?\\s+(\\d{4})`, "i").exec(text);
  let noteDate = note ? isoDate(note[1], note[2], note[3]) : null;
  if (note) evidence.noteDate = quote(text, note);
  if (!noteDate) {
    const made = /(?:is made on|dated)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(text);
    if (made) {
      noteDate = `${made[3]}-${made[1].padStart(2, "0")}-${made[2].padStart(2, "0")}`;
      evidence.noteDate = quote(text, made);
    }
  }
  const maturity = new RegExp(`(?:not later than|maturity date[^A-Za-z]{0,10}(?:is|of)?)\\s*${MONTHS}\\s+(\\d{1,2}),?\\s+(\\d{4})`, "i").exec(text);
  const maturityDate = maturity ? isoDate(maturity[1], maturity[2], maturity[3]) : null;
  if (maturity) evidence.maturityDate = quote(text, maturity);

  // MERS Mortgage Identification Number: 18 digits, printed as "MIN: 1000xxx-xxxxxxxxxx-x".
  const minMatch = /\bMIN\b\s*(?:No\.?|Number|#)?\s*[:#]?\s*((?:\d[\s-]?){17}\d)/i.exec(text);
  const min = minMatch ? minMatch[1].replace(/\D/g, "") : null;
  if (minMatch) evidence.min = quote(text, minMatch);
  const loanNo = /Loan\s*(?:Number|No\.?|#)\s*:?\s*([A-Z0-9][A-Z0-9-]{4,})/i.exec(text);
  const loanNumber = loanNo ? loanNo[1] : null;
  if (loanNo) evidence.loanNumber = quote(text, loanNo);
  // Lender as the instrument defines it: '"Lender" is <NAME>.'
  const lenderMatch = /"?Lender"?\s+is\s+([A-Z0-9][^.]{2,120}?)(?:\.\s|,\s*(?:a|an)\s)/.exec(text);
  const lenderName = lenderMatch ? lenderMatch[1].trim() : null;
  if (lenderMatch) evidence.lenderName = quote(text, lenderMatch);
  const borrowerMatch = /"?Borrower"?\s+is\s+([A-Z][^.]{2,160}?)(?:\.\s|,\s*(?:whose|as|husband|wife|a single|an unmarried|married))/.exec(text);
  const borrowerText = borrowerMatch ? borrowerMatch[1].trim() : null;
  if (borrowerMatch) evidence.borrowerText = quote(text, borrowerMatch);
  const mers = /Mortgage Electronic Registration Systems|\bMERS\b/.test(text) || Boolean(min);

  // Interest rate: only where the instrument states it (ARM riders, some private notes).
  let initialRatePercent = null;
  for (const re of [
    /initial (?:fixed )?interest rate of\s*([\d]{1,2}\.\d{1,4})\s*%/i,
    /(?:bear|bearing|accrue|at) interest at (?:the |a )?(?:fixed )?(?:annual |yearly )?rate of\s*([\d]{1,2}(?:\.\d{1,4})?)\s*%/i,
    /interest (?:rate )?of\s*([\d]{1,2}\.\d{1,4})\s*%\s*per annum/i,
  ]) {
    const m = re.exec(text);
    if (m) {
      const value = Number(m[1]);
      // A late charge or default rate is not the note rate.
      const before = text.slice(Math.max(0, m.index - 80), m.index);
      if (value > 0 && value < 25 && !/late charge|default rate|after maturity/i.test(before)) {
        initialRatePercent = value;
        evidence.initialRatePercent = quote(text, m);
        break;
      }
    }
  }
  // The rider must be attached (its upper-case heading) or its terms present; an unticked
  // "[ ] Adjustable Rate Rider" checklist label does not count.
  const adjustableRate =
    /(?:^|\s)(?:FIXED\/)?ADJUSTABLE RATE RIDER\b/.test(text) ||
    /change in the initial fixed interest rate to an adjustable|Interest Rate Change Date|initial interest rate of/i.test(text);

  // Riders ticked on the checklist (and riders attached as their own page heading).
  const riders = [];
  for (const [name, re] of [
    ["Adjustable Rate", /[xX☒✓✔]\s*Adjustable Rate Rider|^|\s(?:FIXED\/)?ADJUSTABLE RATE RIDER\b/],
    ["Prepayment", /[xX☒✓✔]\s*(?:Other\(?s?\)?[^:]{0,20}:\s*)?[^.]{0,40}?Prepayment Rider|\bPREPAYMENT RIDER\b/],
    ["Condominium", /[xX☒✓✔]\s*Condominium Rider|\bCONDOMINIUM RIDER\b/],
    ["Planned Unit Development", /[xX☒✓✔]\s*Planned Unit Development Rider|\bPLANNED UNIT DEVELOPMENT RIDER\b/],
    ["1-4 Family", /[xX☒✓✔]\s*1-4 Family Rider|\b1-4 FAMILY RIDER\b/],
    ["Second Home", /[xX☒✓✔]\s*Second Home Rider|\bSECOND HOME RIDER\b/],
  ]) {
    if (name === "Adjustable Rate" ? adjustableRate : re.test(text)) riders.push(name);
  }

  // Prepayment penalty: proven true only by a Prepayment Rider; proven false by program rules.
  let prepaymentPenalty = null;
  const prepayRider = /[xX☒✓✔]\s*(?:Other\(?s?\)?[^:]{0,20}:\s*)?[^.]{0,40}?Prepayment Rider|\bPREPAYMENT RIDER\b/.exec(text);
  if (prepayRider) {
    prepaymentPenalty = true;
    evidence.prepaymentPenalty = quote(text, prepayRider);
  } else if (program === "FHA" || program === "VA" || program === "USDA") {
    prepaymentPenalty = false;
    evidence.prepaymentPenalty = `${program} loan: federal program rules forbid prepayment penalties`;
  } else if (program === "GSE") {
    prepaymentPenalty = false;
    evidence.prepaymentPenalty = "Fannie Mae/Freddie Mac uniform instrument with no Prepayment Rider";
  }

  // Term in months from note date to maturity (e.g. 360 for 30 years), when both are known.
  let termMonths = null;
  if (noteDate && maturityDate) {
    const [ny, nm] = noteDate.split("-").map(Number);
    const [my, mm] = maturityDate.split("-").map(Number);
    let months = (my - ny) * 12 + (mm - nm);
    // First payment is usually the month after the note, so 361 means a 360-month loan.
    const nearest = Math.round(months / 12) * 12;
    if (Math.abs(months - nearest) <= 2) months = nearest;
    if (months > 0 && months <= 600) termMonths = months;
  }

  return {
    program, loanAmount, noteDate, maturityDate, termMonths, min, loanNumber, lenderName, borrowerText, mers,
    initialRatePercent, adjustableRate, prepaymentPenalty, riders, evidence,
  };
}
