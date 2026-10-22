// Fee claim extraction and fee adjudication for HOA web evidence. Claims are
// read from structured listing fields first; summary badges, IDX widgets, and
// prose are weaker signals. A missing period is never defaulted.

import { communityKey } from "./hoa-web-legal.mjs";
import { cleanMarkdown, collapse, contentBeforeSimilarHomes, hostOf, siteOf } from "./hoa-web-text.mjs";

export const PERIOD_MULTIPLIER = Object.freeze({ Monthly: 12, Quarterly: 4, "Bi-Annually": 2, Annually: 1 });
const MULT = PERIOD_MULTIPLIER;
const isPeriod = (frequency) => Object.hasOwn(MULT, frequency ?? "");

// Four-digit amounts must match whole ("1350.0", "1029"); a 1-3 digit
// alternative without a required thousands group splits them into "135"/"9".
const NUM = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`;
const PER = String.raw`(month(?:ly)?|mo|annual(?:ly)?|annum|year(?:ly)?|yr|quarter(?:ly)?|qtr|semi[- ]?annual(?:ly)?|bi[- ]?annual(?:ly)?)`;
const INLINE_PER = String.raw`(?:\s*(?:\/|per|\(\s*paid|paid|,)\s*|\s+)${PER}\b`;
const FREQ_WORDS = String.raw`(Monthly|Month|Annually|Annual|Yearly|Quarterly|Quarter|Semi[- ]?Annual(?:ly)?|Bi[- ]?Annual(?:ly)?|Bi-?Monthly|Weekly|One[- ]?Time|Other|None)`;
const rx = (source, flags = "gi") => new RegExp(source, flags);

const PRIMARY_LABEL = rx(
  String.raw`(?<![\w#])(?:Association Fee(?!\s*(?:Includes|Frequency|Freq|Payment|2|#|Desc|Requirement|Amount Includes|s\b))` +
    String.raw`|Assoc(?:iation)?\.? Fee(?!\s*(?:Freq|Desc|Includes|2|Frequency))` +
    String.raw`|HOA Fee(?!\s*(?:Includes|Freq|Frequency|Desc|s\b))|HOA Fees(?=\s*:)|HOA Dues|Assoc\/Maint Fee` +
    String.raw`|Association Maintenance Fee|HOA Amt \(Monthly\)|Homeowner Association (?:Monthly|Annual|Quarterly) Fee)` +
    String.raw`\s*:?\s*\|?\s*\$?\s*${NUM}(?:${INLINE_PER})?`,
);
const CONDO_LABEL = rx(
  String.raw`(?<![\w#])(?:Condo(?:\/Co-op)? Fees?|Condominium Fee)(?!\s*(?:Includes|Freq|-\d))\s*:?\s*\|?\s*\$?\s*${NUM}(?:${INLINE_PER})?`,
);
const PRIMARY_FREQ = rx(
  String.raw`(?:Association Fee (?:Payment )?Frequency|Assoc(?:iation)?\.? Fee Freq(?:uency)?\.?|HOA Fee Freq(?:uency)?\.?|HOA Payment Schedule|HOA Frequency)\s*:?\s*\|?\s*${FREQ_WORDS}`,
  "i",
);
const PRIMARY_FREQ_STOP = /Association #2 Fee Frequency|Association Fee ?2 Frequency|Master (?:HOA|Hoa) Fee Freq|Primary HOA Fee Freq/i;
const SECOND_LABEL = rx(
  String.raw`(?:Association #2 Fee|Association Fee ?2|Association 2 Fee|Second HOA fee|Other Association Fee|HOA Fee \(second\))(?!\s*(?:Frequency|Freq))\s*:?\s*\|?\s*\$?\s*${NUM}(?:${INLINE_PER})?`,
);
const SECOND_FREQ = rx(
  String.raw`(?:Association #2 Fee Frequency|Association Fee ?2 Frequency|Association 2 Fee Frequency|Second HOA fee frequency|HOA Fee Frequency \(second\))\s*:?\s*\|?\s*${FREQ_WORDS}`,
  "i",
);
const SECOND_FREQ_STOP = /Association Fee(?! ?2)\s*:/i;
const MASTER_LABEL = rx(
  String.raw`(?:Master (?:HOA|Hoa|Association) Fee|Primary HOA Fee)(?!\s*Freq)\s*:?\s*\|?\s*\$?\s*${NUM}(?:${INLINE_PER})?`,
);
const MASTER_FREQ = rx(
  String.raw`(?:Master (?:HOA|Association) Fee Freq(?:uency)?|Primary HOA Fee Freq(?:uency)?)\.?\s*:?\s*\|?\s*${FREQ_WORDS}`,
  "i",
);
const SECOND_NAME = rx(
  String.raw`(?:Association #2 Fee Frequency\s*:\s*\w[\w-]*\s*\n?\s*-?\s*Association|Second HOA name|Association Name 2|HOA Name \(second\))\s*:\s*\|?\s*([^\n|]{3,120})`,
  "i",
);
const SUMMARY_PATTERNS = [
  ["badge_total", rx(String.raw`\$\s*${NUM}\s+Monthly HOA Fees`), "Monthly"],
  ["badge_total", rx(String.raw`Average Monthly Fees\s*:?\s*\|?\s*\$\s*${NUM}`), "Monthly"],
  ["summary", rx(String.raw`(?<!Tax: )(?<!Tax:)\$\s*${NUM}\s*\/\s*mo\s*HOA(?!\s*:)`), "Monthly"],
  ["summary", rx(String.raw`(?<!Tax: )(?<!Tax:)\$\s*${NUM}\s*\/\s*yr\s*HOA(?!\s*:)`), "Annually"],
  ["summary", rx(String.raw`\$\s*${NUM}\s*\/\s*quarter\s*HOA(?!\s*:)`), "Quarterly"],
  ["summary", rx(String.raw`\$\s*${NUM}\s*semi-annually\s*HOA(?!\s*:)`), "Bi-Annually"],
  ["summary", rx(String.raw`Homeowner association fees are \$\s*${NUM}\s*per month`), "Monthly"],
  ["summary", rx(String.raw`\bHOA\s+\$\s*${NUM}\s*\/\s*mo\b`), "Monthly"],
  ["summary", rx(String.raw`\$\s*${NUM}\s*\/\s*mo\s+HOA Fee`), "Monthly"],
  ["summary", rx(String.raw`Monthly HOA\s*\|?\s*\$\s*${NUM}`), "Monthly"],
  ["derived_monthly", rx(String.raw`(?:Monthly HOA Amount|Monthly HOA Fee|Monthly HOA Fees|Monthly Hoa Amount)\s*:\s*\|?\s*\$?\s*${NUM}`), "Monthly"],
  ["total_fees", rx(String.raw`Total Monthly Fees\s*:\s*\|?\s*\$?\s*${NUM}`), "Monthly"],
];
// "HOA Fees $54/ann": the amount is a monthly equivalent and the suffix is the
// billing period.
export const IDX_WIDGET = rx(String.raw`HOA Fees\s*\$\s*${NUM}\s*\/\s*(ann|qua|mon|sem)\b`);
const TEXT_BILLING = [
  rx(String.raw`\b(annual|monthly|quarterly|semi-annual)\s+(?:association|HOA)\s+(?:fee|dues)\s*(?:of\s*)?\(?\$\s*${NUM}`),
  rx(
    String.raw`\b(?:association|HOA)\s+(?:fee|dues)\s*(?:of\s*)?\$\s*${NUM}\s*(?:paid\s*)?(annually|monthly|quarterly|semi-annually|per month|per year|a month|a year|\/\s*year|\/\s*month)`,
  ),
  rx(String.raw`\bwith\s+(annual|monthly|quarterly)\s+fee\s*\(\$\s*${NUM}`),
  rx(String.raw`\b(annual|monthly|quarterly)\s+fee\s+\$\s*${NUM}`),
];
const TEXT_REJECT =
  /\b(?:cdd|community development|tax|rent|insurance|transfer|capital|application|one[- ]?time|special assessment|pet|internet|cable|septic|pool maintenance|utility|deposit|closing|estoppel)\b/i;
const NAME_LABEL =
  /(?:Association Name|HOA Name|HOA name|Association Legal Name|Condo Association Name|Second HOA name|HOA Name \(second\))(?:\s*:\s*|\s*\|\s*(?=[A-Z]))\|?\s*([^\n|]{3,140})|HOA Name(?=[A-Z][a-z])([^\n|]{3,120})/g;
const NAME_LABEL_END =
  /(?:HOA Phone|HOA phone|Association Phone|Has an HOA|Association for this Listing|HOA Name|Association Fee|Association:|Association YN|Pets? |Property Type|\s-\s|\s{2,})/;
const PROPERTY_TYPE =
  /(?:Property Type|Property Sub ?Type|Home Type|Structure Type|Property Subtype|Style)\s*:\s*\|?\s*([A-Za-z /,-]{3,60})/i;

export function normalizeFrequency(word) {
  if (!word) return null;
  const value = String(word).toLowerCase().replace(/[\s-]/g, "");
  if (/^(?:semi|biannual|sem)/.test(value)) return "Bi-Annually";
  if (/^(?:quarter|qtr|qua)/.test(value)) return "Quarterly";
  if (/^(?:month|mo|mon)/.test(value) && !value.startsWith("bimonth")) return "Monthly";
  if (/^(?:annual|year|yr|ann)/.test(value)) return "Annually";
  return null;
}

// Canonicalize only explicit source text; one-time charges are never dues.
export function canonicalFrequency(raw) {
  if (!raw) return null;
  if (/\b(?:one[-\s]?time|capital\s+contribution|application|transfer)\b/i.test(raw)) return "One-Time";
  return normalizeFrequency(raw);
}

export function annualize(amount, frequency) {
  if (amount === null || amount === undefined || amount === "" || !isPeriod(frequency)) return null;
  return round2(Number(amount) * MULT[frequency]);
}

const round2 = (value) => Math.round(value * 100) / 100;

export function parseAmount(raw) {
  const value = Number(String(raw ?? "").replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0 || value > 20000) return null;
  // A bare year next to an HOA label ("Year Built 2004") is not a fee.
  if (value >= 1990 && value <= 2035 && !/[,.]/.test(String(raw))) return null;
  return value;
}

function nextFrequency(text, start, pattern, stop, span = 420) {
  let window = text.slice(start, start + span);
  if (stop) {
    const hit = stop.exec(window);
    if (hit) window = window.slice(0, hit.index);
  }
  const match = pattern.exec(window);
  return match ? normalizeFrequency(match[1]) : null;
}

const DATE_NUMERIC = /(?<!\d)(\d{1,2})\/(\d{1,2})\/(\d{4})/g;
const DATE_WORDS = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})/g;
const DATE_CONTEXT = /sold|listed|list date|closed|close date|pending|for sale|off market|on market|price change|status change/i;
const DATE_NOISE = /updated|as of|copyright|©|generated|refreshed|data relating/i;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

// Newest listing-event date on the page (sold/listed/pending...), ignoring
// copyright and "updated" stamps.
export function pageDate(text, today = new Date().toISOString().slice(0, 10)) {
  let best = null;
  const consider = (match, value) => {
    const window = text.slice(Math.max(0, match.index - 60), match.index + match[0].length + 40);
    const noise = text.slice(Math.max(0, match.index - 40), match.index + match[0].length + 10);
    if (!DATE_CONTEXT.test(window) || DATE_NOISE.test(noise) || !value) return;
    if (value > today || value < "2000-01-01") return;
    if (!best || value > best) best = value;
  };
  for (const match of text.matchAll(DATE_NUMERIC)) consider(match, isoDate(Number(match[3]), Number(match[1]), Number(match[2])));
  for (const match of text.matchAll(DATE_WORDS)) {
    consider(match, isoDate(Number(match[3]), MONTHS.indexOf(match[1].slice(0, 3)) + 1, Number(match[2])));
  }
  return best;
}

// Extract every fee claim, labelled association name, property type, and
// listing date from one fetched page.
export function extractPageClaims(url, markdown, title = "", { today } = {}) {
  const full = cleanMarkdown(markdown, title);
  const text = contentBeforeSimilarHomes(full);
  const claims = [];
  const seen = new Set();
  const add = (kind, amount, frequency, quote, extra = {}) => {
    if (amount === null || amount === undefined) return;
    const key = JSON.stringify([kind, amount, frequency, extra.assocName ?? extra.label ?? null]);
    if (seen.has(key)) return;
    seen.add(key);
    claims.push({
      kind,
      amount,
      frequency,
      annualized: annualize(amount, frequency),
      quote: collapse(quote).slice(0, 200),
      url,
      host: hostOf(url),
      ...extra,
    });
  };
  const slice = (start, end) => text.slice(Math.max(0, start), end);

  for (const match of text.matchAll(CONDO_LABEL)) {
    const amount = parseAmount(match[1]);
    if (amount) {
      add("secondary", amount, normalizeFrequency(match[2]), slice(match.index, match.index + match[0].length + 80), {
        label: "condominium fee",
      });
    }
  }
  for (const match of text.matchAll(PRIMARY_LABEL)) {
    const start = match.index;
    const end = start + match[0].length;
    const before = slice(start - 12, start);
    // "Secondary Association Fee" and "#2" labels are not the primary fee.
    if (before.slice(-3).includes("#") || /second(?:ary)?\s*$/i.test(before)) {
      if (/second(?:ary)?\s*$/i.test(before)) {
        add("secondary", parseAmount(match[1]), normalizeFrequency(match[2]), slice(start - 12, end + 80));
      }
      continue;
    }
    const amount = parseAmount(match[1]);
    let inline = normalizeFrequency(match[2]);
    const labelPeriod = match[0].match(/Homeowner Association (Monthly|Annual|Quarterly) Fee/i);
    if (labelPeriod) inline = normalizeFrequency(labelPeriod[1]);
    if (/HOA Amt \(Monthly\)/i.test(match[0])) inline = "Monthly";
    const later = nextFrequency(text, end, PRIMARY_FREQ, PRIMARY_FREQ_STOP);
    const quote = slice(start, end + 120);
    if (inline && later && inline !== later && inline === "Monthly") {
      add("summary", amount, "Monthly", quote, { billingPeriod: later });
      continue;
    }
    add("primary", amount, inline ?? later, quote);
  }
  for (const match of text.matchAll(SECOND_LABEL)) {
    const start = match.index;
    const end = start + match[0].length;
    const later = nextFrequency(text, end, SECOND_FREQ, SECOND_FREQ_STOP);
    const nameMatch = SECOND_NAME.exec(text.slice(start, start + 600));
    let assocName = null;
    if (nameMatch) {
      assocName = nameMatch[1].trim().split(/\s+-\s+|\s{2,}/)[0].replace(/^[\s|-]+|[\s|-]+$/g, "");
      if (["yes", "no", "1", "0", "true", "false"].includes(assocName.toLowerCase())) assocName = null;
    }
    add("secondary", parseAmount(match[1]), normalizeFrequency(match[2]) ?? later, slice(start, end + 160), { assocName });
  }
  for (const match of text.matchAll(MASTER_LABEL)) {
    const end = match.index + match[0].length;
    add("master", parseAmount(match[1]), normalizeFrequency(match[2]) ?? nextFrequency(text, end, MASTER_FREQ, null), slice(match.index, end + 120));
  }
  for (const [kind, pattern, frequency] of SUMMARY_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const amount = parseAmount(match[1]);
      if (amount) add(kind, amount, frequency, slice(match.index - 10, match.index + match[0].length + 60));
    }
  }
  for (const match of text.matchAll(IDX_WIDGET)) {
    add("idx_equiv", parseAmount(match[1]), "Monthly", match[0], { billingPeriod: normalizeFrequency(match[2]) });
  }
  for (const pattern of TEXT_BILLING) {
    for (const match of text.matchAll(pattern)) {
      const groups = match.slice(1).filter(Boolean);
      const perWord = groups.find((group) => !/^[\d,.]+$/.test(group));
      const numWord = groups.find((group) => /^[\d,.]+$/.test(group));
      const context = slice(match.index - 80, match.index + match[0].length);
      if (TEXT_REJECT.test(context)) continue;
      const period = normalizeFrequency(perWord.replace("per ", "").replace("a ", "").replace("/", "").trim());
      add("text_billing", parseAmount(numWord), period, slice(match.index - 40, match.index + match[0].length + 40));
    }
  }

  const names = [];
  for (const match of text.matchAll(NAME_LABEL)) {
    const raw = match[1] ?? match[2];
    if (!raw) continue;
    const name = raw.split(NAME_LABEL_END)[0].replace(/^[\s\-|,.:]+|[\s\-|,.:]+$/g, "");
    if (name) names.push({ name, url, quote: match[0].slice(0, 160) });
  }
  for (const claim of claims) {
    if (claim.assocName) names.push({ name: claim.assocName, url, quote: claim.quote, secondary: true });
  }
  let ptype = null;
  const typeMatch = text.match(PROPERTY_TYPE);
  if (typeMatch) ptype = typeMatch[1].trim();
  else if (/\bis a \d+ bedroom,? .{0,40}?\b(condo|townhouse|townhome)\b/i.test(text)) {
    ptype = text.match(/\b(condo|townhouse|townhome)\b/i)[1];
  }
  return { url, claims, names, ptype, date: pageDate(full, today) };
}

const NON_HOA_BEFORE =
  /(rent(?:al)?(?: estimate)?|lease|leasing|tax(?:es)?|insurance|internet|cable|septic|pool maintenance|utility|utilities|deposit|mortgage|principal|estimated payment|in addition to rent|cdd)\W{0,25}$/i;
const NON_HOA_FEE_TEXT = /\b(?:rent|leasing|lease|internet|cable|septic|pool maintenance|utility|utilities|in addition to rent)\b/i;

// True when an accepted amount is really a rent estimate, utility, tax, or
// similar value that happened to sit near an HOA label.
export function nonHoaAmount(quote, amount) {
  if (amount === null || amount === undefined || amount === "") return false;
  const value = Number(amount);
  const shown = value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const escaped = shown.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/,/g, ",?");
  const hits = [...String(quote).matchAll(new RegExp(String.raw`\$?\s*${escaped}(?!\d)`, "g"))];
  if (hits.length && hits.every((hit) => NON_HOA_BEFORE.test(String(quote).slice(Math.max(0, hit.index - 40), hit.index)))) {
    return true;
  }
  return NON_HOA_FEE_TEXT.test(quote) && !/\b(?:HOA|association)\b.{0,40}\$/i.test(quote);
}

export const FEE_KINDS = new Set(["primary", "text_billing", "summary", "derived_monthly", "badge_total", "idx_equiv", "secondary", "master"]);

export function close(a, b, rel = 0.03, absolute = 2) {
  return Math.abs(a - b) <= Math.max(rel * Math.max(Math.abs(a), Math.abs(b)), absolute);
}

// A rounded monthly badge ("$12/mo") beside an annual structured fee (143) is
// the same fee, not a conflict.
export function badgeClose(monthlyBadge, annual) {
  return Math.abs(monthlyBadge * 12 - annual) <= Math.max(0.04 * annual, 7);
}

const monthlyEquivalent = (claim) => (claim.frequency === "Monthly" ? claim.amount : claim.annualized / 12);
const money = (value) => (value === null || value === undefined ? "?" : `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

function cluster(claims) {
  const groups = [];
  for (const claim of [...claims].sort((a, b) => b.annualized - a.annualized)) {
    const group = groups.find((candidate) => close(candidate[0].annualized, claim.annualized));
    if (group) group.push(claim);
    else groups.push([claim]);
  }
  return groups;
}

function corroborations(row, annual) {
  const found = [];
  const neighbourFee = row?.neighbour_suggested_fee;
  const neighbourFrequency = row?.neighbour_suggested_fee_frequency;
  if (neighbourFee && isPeriod(neighbourFrequency) && close(neighbourFee * MULT[neighbourFrequency], annual, 0.05, 6)) {
    found.push(`neighbour fee ${money(neighbourFee)} ${neighbourFrequency}`);
  }
  const current = row?.current_fee;
  const currentFrequency = row?.fee_frequency;
  if (current && isPeriod(currentFrequency) && close(current * MULT[currentFrequency], annual, 0.05, 6)) {
    found.push(`original fee ${money(current)} ${currentFrequency}`);
  }
  return found;
}

function pickRepresentative(group) {
  const counts = new Map();
  for (const claim of group) {
    const key = `${claim.amount}|${claim.frequency}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const score = (claim) => [
    counts.get(`${claim.amount}|${claim.frequency}`),
    claim.kind === "primary" ? 1 : 0,
    claim.amount % 1 !== 0 ? 1 : 0,
    -claim.quote.length,
  ];
  let best = group[0];
  for (const claim of group.slice(1)) if (compare(score(claim), score(best)) > 0) best = claim;
  return best;
}

function compare(left, right) {
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if ((left[i] ?? 0) > (right[i] ?? 0)) return 1;
    if ((left[i] ?? 0) < (right[i] ?? 0)) return -1;
  }
  return 0;
}

function combinations(items, size) {
  if (size === 0) return [[]];
  const out = [];
  items.forEach((item, index) => {
    for (const rest of combinations(items.slice(index + 1), size - 1)) out.push([item, ...rest]);
  });
  return out;
}

function product(options) {
  return options.reduce((acc, choices) => acc.flatMap((prefix) => choices.map((choice) => [...prefix, choice])), [[]]);
}

const periodOptions = (claim) => (isPeriod(claim.frequency) ? [claim.frequency] : Object.keys(MULT));

function plausibleFee(claim, kind) {
  if (!isPeriod(claim.frequency)) return false;
  const annual = claim.amount * MULT[claim.frequency];
  if (kind === "sfh") return annual >= 10 && annual <= 9000 && !(claim.frequency === "Monthly" && claim.amount >= 1000);
  return annual >= 10 && annual <= 24000;
}

function sanityCheck(result, kind) {
  if (result.fee === null) return;
  if (kind === "sfh" && result.frequency === "Monthly" && result.fee >= 1000) {
    result.confidence = "low";
    result.rationale += ` Flag: ${money(result.fee)}/month is unusually high for a single-family home.`;
  }
  if (result.annualized && result.annualized < 12) {
    result.confidence = "low";
    result.rationale += " Flag: the annual total is under $12, which may be a parsing artifact.";
  } else if (kind === "condo" && (result.total ?? result.annualized) < 300) {
    result.confidence = "low";
    result.rationale += " Flag: implausibly low for a condominium; probably a master or club fee only.";
  }
}

const downgrade = (confidence) => ({ high: "medium", medium: "low" })[confidence] ?? "low";
const appendSentence = (text, sentence) => `${text.replace(/\.$/, "")}${text ? ". " : ""}${sentence}`;

// Keep a second association fee separate. Combine it into the total only when
// a listing badge equals primary + second; otherwise record it unconfirmed.
function attachSecondary(result, chosen, seconds, summaries) {
  const urls = new Set([...(result.sources ?? []), chosen.url]);
  const valid = [];
  for (const second of seconds.filter((claim) => !claim.rejected && urls.has(claim.url))) {
    if (!valid.some((other) => other.amount === second.amount && other.frequency === second.frequency)) valid.push(second);
  }
  const scoped = summaries.filter((claim) => urls.has(claim.url));
  const totals = (scoped.length ? scoped : summaries).filter(
    (claim) => (claim.kind === "badge_total" || claim.kind === "summary") && claim.frequency === "Monthly",
  );
  if (!valid.length) {
    result.total = result.annualized;
    return;
  }
  let best = null;
  for (let size = 1; size <= Math.min(3, valid.length); size += 1) {
    for (const combo of combinations(valid, size)) {
      for (const periods of product(combo.map(periodOptions))) {
        const extra = combo.reduce((sum, claim, index) => sum + claim.amount * MULT[periods[index]], 0);
        for (const badge of totals) {
          if (!badgeClose(badge.amount, result.annualized + extra)) continue;
          const inferred = combo.filter((claim) => !isPeriod(claim.frequency)).length;
          const error = Math.abs(badge.amount * 12 - result.annualized - extra) + 3 * inferred;
          if (!best || error < best.error - 1e-6) best = { combo, periods, extra, badge, error };
        }
      }
    }
  }
  if (best) {
    const { combo, periods, extra, badge } = best;
    result.second = {
      name: combo.map((claim) => claim.assocName ?? claim.label).filter(Boolean).join("; ") || null,
      fee: combo.length === 1 ? combo[0].amount : round2(extra),
      frequency: combo.length === 1 ? periods[0] : "Annually",
      annualized: round2(extra),
      inferred: combo.some((claim) => !isPeriod(claim.frequency)),
      confirmedByTotal: true,
    };
    result.total = round2(result.annualized + extra);
    result.patterns.push("listing_total_of_associations");
    result.rationale = appendSentence(
      result.rationale,
      `A second association fee applies concurrently: the ${money(badge.amount)}/mo total on ${badge.host} equals all fees combined (${money(result.total)}/yr).`,
    );
    result.sources = [...new Set([...result.sources, ...combo.map((claim) => claim.url)])].sort();
    return;
  }
  const second = valid[0];
  result.second = {
    name: second.assocName ?? null,
    fee: second.amount,
    frequency: isPeriod(second.frequency) ? second.frequency : null,
    annualized: second.annualized,
    inferred: false,
    confirmedByTotal: false,
  };
  result.total = result.annualized;
  result.patterns.push("second_fee_unconfirmed");
  result.rationale = appendSentence(
    result.rationale,
    `A second association fee of ${money(second.amount)} is recorded but not added, because nothing confirms both apply at once.`,
  );
}

function emptyResult() {
  return {
    fee: null,
    frequency: null,
    annualized: null,
    basis: "unresolved",
    confidence: "low",
    sources: [],
    rationale: "",
    second: null,
    total: null,
    notes: [],
    patterns: [],
  };
}

function decideFromPages(row, pages, kind, siblingFees) {
  const claims = pages.flatMap((page) => page.claims.map((claim) => ({ ...claim, date: page.date ?? null })));
  const hasPrimary = new Set(claims.filter((claim) => claim.kind === "primary").map((claim) => claim.url));
  for (const claim of claims) {
    if (claim.kind === "secondary" && !hasPrimary.has(claim.url)) {
      claim.kind = "primary";
      claim.promotedFromSecond = true;
    }
  }
  const billing = claims.filter((claim) => (claim.kind === "primary" || claim.kind === "text_billing") && isPeriod(claim.frequency));
  const noPeriod = claims.filter((claim) => claim.kind === "primary" && !isPeriod(claim.frequency));
  const summaries = claims.filter((claim) => ["summary", "derived_monthly", "badge_total"].includes(claim.kind) && isPeriod(claim.frequency));
  const idx = claims.filter((claim) => claim.kind === "idx_equiv");
  const seconds = claims.filter((claim) => claim.kind === "secondary" || claim.kind === "master");
  const totals = claims.filter((claim) => claim.kind === "total_fees");
  const result = emptyResult();
  for (const second of seconds) {
    if (second.assocName && /\bCDD\b|community development/i.test(second.assocName)) {
      second.rejected = true;
      result.notes.push(`ignored ${money(second.amount)} second fee because it is a CDD`);
    }
  }
  const siblings = siblingFees.get(communityKey(row) ?? "") ?? [];

  const finish = (chosen, basis, confidence, why, sources, checkBadges = false) => {
    Object.assign(result, {
      fee: chosen.amount,
      frequency: chosen.frequency,
      annualized: round2(chosen.amount * MULT[chosen.frequency]),
      basis,
      confidence,
      sources,
      rationale: why,
    });
    attachSecondary(result, chosen, seconds, summaries);
    if (checkBadges) {
      const targets = [result.annualized, ...(result.total ? [result.total] : [])];
      const stale = summaries.filter((claim) => !targets.some((target) => badgeClose(monthlyEquivalent(claim), target)));
      if (stale.length) {
        const badge = stale[0];
        const ratio = result.annualized ? (badge.amount * MULT[badge.frequency]) / result.annualized : 0;
        const mislabel = [
          [3, "a quarterly amount shown as monthly"],
          [12, "an annual amount shown as monthly"],
          [6, "a semi-annual amount shown as monthly"],
        ].find(([factor]) => Math.abs(ratio - factor) / factor < 0.04);
        if (mislabel && badge.frequency === "Monthly") {
          result.rationale = appendSentence(result.rationale, `The ${money(badge.amount)}/mo figure on ${badge.host} is ${mislabel[1]}.`);
        } else {
          if (result.confidence === "high") result.confidence = "medium";
          result.patterns.push("stale_summary");
          result.rationale = appendSentence(result.rationale, `A ${money(badge.amount)} summary on ${badge.host} does not reconcile and was treated as stale.`);
          if (corroborations(row, badge.annualized).length && !corroborations(row, result.annualized).length) result.confidence = "low";
        }
      }
    }
    const dates = claims.filter((claim) => result.sources.includes(claim.url) && claim.date).map((claim) => claim.date);
    if (dates.length && dates.sort().at(-1) < "2018-01-01") {
      result.rationale = appendSentence(result.rationale, "The source listing predates 2018, so the fee may be out of date.");
      if (result.confidence === "high") result.confidence = "medium";
    }
    const listedTotal = result.total ?? result.annualized;
    const big = totals.find((claim) => claim.amount * 12 > listedTotal * 1.1 + 120);
    if (big) {
      result.patterns.push("listing_total_exceeds_hoa_fee");
      result.rationale = appendSentence(result.rationale, `The listing's Total Monthly Fees (${money(big.amount)}) exceeds the HOA fee; another charge may apply.`);
      if (result.confidence === "high") result.confidence = "medium";
    }
    sanityCheck(result, kind);
    return result;
  };

  if (billing.length) {
    let groups = cluster(billing);
    const groupScore = (group) => {
      const urls = new Set(group.map((claim) => claim.url));
      const annual = group[0].annualized;
      const extras = [0];
      for (const second of seconds) {
        if (!urls.has(second.url) || second.rejected) continue;
        for (const period of periodOptions(second)) extras.push(second.amount * MULT[period]);
      }
      const dates = group.map((claim) => claim.date).filter(Boolean).sort();
      return {
        group,
        hosts: new Set(group.map((claim) => siteOf(claim.url))),
        date: dates.at(-1) ?? null,
        structured: group.some((claim) => claim.kind === "primary"),
        support: summaries.filter((claim) => extras.some((extra) => badgeClose(monthlyEquivalent(claim), annual + extra))).length,
      };
    };
    const single = (group, note = "") => {
      const chosen = pickRepresentative(group);
      const { hosts, support } = groupScore(group);
      let why = `Structured fee ${money(chosen.amount)} ${chosen.frequency} on ${[...hosts].sort().join(", ")}${note}`;
      const rounded = summaries.filter(
        (claim) => badgeClose(monthlyEquivalent(claim), chosen.annualized) && Math.abs(claim.amount * MULT[claim.frequency] - chosen.annualized) > 0.5,
      );
      if (rounded.length) {
        result.patterns.push("rounded_badge_same_fee");
        why += `; the ${money(rounded[0].amount)}/${rounded[0].frequency.toLowerCase()} summary is the same fee rounded`;
      }
      const basis = group.length > 1 || support || note ? "structured_exact_property" : "structured_exact_property_single";
      return finish(chosen, basis, "high", `${why}.`, [...new Set(group.map((claim) => claim.url))].sort(), true);
    };
    if (groups.length === 1) return single(groups[0]);

    const totalViews = [];
    for (const a of groups) {
      for (const b of groups) {
        if (a === b || a[0].annualized <= b[0].annualized) continue;
        const bUrls = new Set(b.map((claim) => claim.url));
        const secs = seconds.filter((claim) => bUrls.has(claim.url) && !claim.rejected);
        let hit = false;
        for (let size = 1; size <= Math.min(3, secs.length) && !hit; size += 1) {
          for (const combo of combinations(secs, size)) {
            for (const periods of product(combo.map(periodOptions))) {
              const sum = combo.reduce((acc, claim, index) => acc + claim.amount * MULT[periods[index]], 0);
              if (close(a[0].annualized, b[0].annualized + sum, 0.02, 6)) hit = true;
            }
          }
        }
        if (hit && !totalViews.includes(a)) totalViews.push(a);
      }
    }
    if (totalViews.length && totalViews.length < groups.length) {
      groups = groups.filter((group) => !totalViews.includes(group));
      for (const view of totalViews) summaries.push({ ...pickRepresentative(view), kind: "badge_total" });
    }
    if (groups.length === 1) {
      result.patterns.push("listing_total_of_associations");
      return single(groups[0], "; a larger structured figure is the listing's total of all association fees");
    }

    const scored = groups.map(groupScore);
    const dated = scored.filter((entry) => entry.date);
    let best = null;
    let basis = null;
    let reason = "";
    if (scored.length === 2) {
      const [low, high] = [...scored].sort((a, b) => a.group[0].annualized - b.group[0].annualized);
      const highRep = pickRepresentative(high.group);
      const lowRep = pickRepresentative(low.group);
      const ratio = lowRep.annualized ? highRep.annualized / lowRep.annualized : 0;
      // Only the quarterly-as-monthly mislabel is resolved here. Same-amount
      // annual-vs-monthly disagreements stay a source conflict.
      if (highRep.frequency === "Monthly" && Math.abs(ratio - 3) / 3 < 0.04) {
        best = low;
        basis = "structured_mislabel_resolved";
        reason = `${money(highRep.amount)} 'monthly' is 3x the chosen ${money(lowRep.amount)} ${lowRep.frequency.toLowerCase()} fee, i.e. a quarterly amount labelled monthly`;
        result.patterns.push("quarterly_labelled_monthly");
      }
    }
    if (!best && dated.length >= 2) {
      const sorted = [...dated].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      if (sorted[0].date !== sorted[1].date) {
        best = sorted[0];
        basis = "structured_most_recent_listing";
        reason = `most recent listing (page dated ${best.date})`;
        result.patterns.push("newest_listing");
      }
    }
    if (!best) {
      const key = (entry) => [entry.hosts.size, entry.support, entry.structured ? 1 : 0];
      const ranked = [...scored].sort((a, b) => compare(key(b), key(a)));
      if (compare(key(ranked[0]).slice(0, 2), key(ranked[1]).slice(0, 2)) > 0) {
        best = ranked[0];
        basis = "structured_majority_of_sources";
        reason = `agreed by ${best.hosts.size} sources`;
        result.patterns.push("majority_of_sources");
      }
    }
    if (!best) {
      const backed = scored.filter((entry) => corroborations(row, entry.group[0].annualized).length);
      if (backed.length === 1) {
        best = backed[0];
        basis = "structured_tiebreak_original_or_neighbour";
        reason = `matches ${corroborations(row, best.group[0].annualized).join(", ")}`;
      }
    }
    if (!best) {
      const plausible = scored.filter((entry) => plausibleFee(pickRepresentative(entry.group), kind));
      if (plausible.length === 1) {
        best = plausible[0];
        basis = "structured_tiebreak_plausibility";
        reason = `the other value is implausible for a ${kind}`;
      }
    }
    if (!best && dated.length === 1) {
      best = dated[0];
      basis = "structured_only_dated_listing";
      reason = `the only listing with a visible date, ${best.date}`;
    }
    if (!best) {
      const values = scored
        .map((entry) => {
          const rep = pickRepresentative(entry.group);
          return `${money(rep.amount)} ${rep.frequency} (${[...entry.hosts].sort().join(", ")})`;
        })
        .join("; ");
      Object.assign(result, {
        basis: "unresolved_source_conflict",
        confidence: "low",
        rationale: `Exact-property sources disagree with no date, majority, or corroboration to break the tie: ${values}.`,
        sources: [...new Set(billing.map((claim) => claim.url))].sort(),
      });
      return result;
    }
    const chosen = pickRepresentative(best.group);
    const confidence = basis === "structured_tiebreak_plausibility" || basis === "structured_only_dated_listing" ? "low" : "medium";
    return finish(chosen, basis, confidence, `Chose ${money(chosen.amount)} ${chosen.frequency} (${reason}).`, [
      ...new Set(best.group.map((claim) => claim.url)),
    ].sort());
  }

  if (noPeriod.length) {
    const resolved = [];
    for (const claim of [...noPeriod].sort((a, b) => b.amount - a.amount)) {
      const signals = [];
      for (const summary of summaries) {
        for (const [period, multiplier] of Object.entries(MULT)) {
          if (summary.url === claim.url && badgeClose(monthlyEquivalent(summary), claim.amount * multiplier)) {
            signals.push([period, `${summary.host} summary ${money(summary.amount)}/${summary.frequency.toLowerCase()} equals ${money(claim.amount)} ${period.toLowerCase()}`]);
          }
        }
      }
      if (row?.current_fee && Math.abs(row.current_fee - claim.amount) < 0.5 && isPeriod(row?.fee_frequency)) {
        signals.push([row.fee_frequency, `stripped original value ${money(row.current_fee)} ${row.fee_frequency} has the same amount`]);
      }
      const neighbourFee = row?.neighbour_suggested_fee;
      const neighbourFrequency = row?.neighbour_suggested_fee_frequency;
      if (neighbourFee && isPeriod(neighbourFrequency) && Math.abs(neighbourFee - claim.amount) < 0.5) {
        signals.push([neighbourFrequency, `neighbour fee ${money(neighbourFee)} ${neighbourFrequency} has the same amount`]);
      }
      for (const [period, multiplier] of Object.entries(MULT)) {
        if (siblings.some((annual) => close(claim.amount * multiplier, annual, 0.03, 3))) {
          signals.push([period, `same-subdivision exact-property fees equal ${money(claim.amount * multiplier)}/yr`]);
        }
      }
      const periods = new Set(signals.map(([period]) => period));
      if (periods.size === 1) {
        const [period] = periods;
        resolved.push({ claim: { ...claim, frequency: period, annualized: round2(claim.amount * MULT[period]) }, signals });
      } else if (periods.size > 1) {
        result.notes.push(`${money(claim.amount)} with conflicting period signals (${[...periods].sort().join(", ")})`);
      }
    }
    if (resolved.length) {
      let pick = resolved[0];
      let confidence = "medium";
      if (cluster(resolved.map((entry) => entry.claim)).length > 1) {
        const dated = resolved.filter((entry) => entry.claim.date).sort((a, b) => (a.claim.date < b.claim.date ? 1 : -1));
        if (dated.length && (dated.length === 1 || dated[0].claim.date !== dated[1].claim.date)) pick = dated[0];
        else confidence = "low";
      }
      result.patterns.push("frequency_inferred_two_signals");
      const { claim, signals } = pick;
      return finish(
        claim,
        "frequency_inferred_two_signals",
        confidence,
        `Page shows ${money(claim.amount)} with no period; inferred ${claim.frequency} because ${signals.map(([, text]) => text).join("; ")}.`,
        [claim.url],
      );
    }
    if (!summaries.length && !idx.length) {
      Object.assign(result, {
        basis: "unresolved_frequency_missing",
        confidence: "low",
        rationale: "Exact-property page shows an amount with no period and no second signal agrees on one; the frequency stays blank and the fee is not reported.",
        sources: [...new Set(noPeriod.map((claim) => claim.url))].sort(),
      });
      return result;
    }
  }

  const explicitSummaries = summaries.filter((claim) => claim.kind === "summary" && claim.frequency !== "Monthly");
  if (explicitSummaries.length) {
    const chosen = cluster(explicitSummaries)[0][0];
    return finish(chosen, "summary_with_explicit_period", "medium", `No structured field; the listing summary states ${money(chosen.amount)} ${chosen.frequency} (explicit period, rounded).`, [chosen.url]);
  }
  const monthly = summaries.filter((claim) => claim.frequency === "Monthly");
  if (monthly.length) {
    const groups = cluster(monthly).sort((a, b) => new Set(b.map((c) => siteOf(c.url))).size - new Set(a.map((c) => siteOf(c.url))).size);
    const hostCount = (group) => new Set(group.map((claim) => siteOf(claim.url))).size;
    if (groups.length === 1 || hostCount(groups[0]) > hostCount(groups[1])) {
      const chosen = pickRepresentative(groups[0]);
      const corroborated = corroborations(row, chosen.annualized).length > 0;
      const confidence = (corroborated || hostCount(groups[0]) > 1) && groups.length === 1 ? "medium" : "low";
      return finish(chosen, "summary_badge_monthly_equivalent", confidence, `Only monthly summary figures are shown (${money(chosen.amount)}/mo); reported as a monthly equivalent.`, [
        ...new Set(groups[0].map((claim) => claim.url)),
      ].sort());
    }
  }
  if (idx.length) {
    const widget = idx[0];
    const billed = widget.billingPeriod;
    if (billed && isPeriod(billed)) {
      const annual = round2(widget.amount * 12);
      const signals = corroborations(row, annual);
      if (siblings.some((value) => badgeClose(widget.amount, value))) signals.push("same-subdivision exact-property fees");
      const chosen = { amount: round2((widget.amount * 12) / MULT[billed]), frequency: billed, url: widget.url, host: widget.host, kind: "idx_equiv" };
      result.patterns.push("idx_monthly_equivalent");
      const why = `IDX widget '${widget.quote}' is the monthly equivalent of a fee billed ${billed.toLowerCase()}; reported as about ${money(chosen.amount)} ${billed}`;
      return signals.length
        ? finish(chosen, "idx_monthly_equivalent_with_billing_suffix", "medium", `${why}, corroborated by ${signals.join(", ")}.`, [widget.url])
        : finish(chosen, "idx_monthly_equivalent_with_billing_suffix", "low", `${why}; no second signal confirms it.`, [widget.url]);
    }
  }
  if (!result.rationale) {
    result.basis = "unresolved_no_fee";
    result.rationale = "No recurring HOA fee could be read from the exact-property pages.";
  }
  return result;
}

// Decide one property's fee from tiered pages ({tier, claims, date, ptype}).
// Tier-2 pages decide; tier-1 (unit not shown) pages are used only when no
// tier-2 page carries a fee, and then cap confidence.
export function decideFee(row, pages, kind, siblingFees = new Map()) {
  const confirmed = pages.filter((page) => page.tier === 2);
  const unitUnknown = pages.filter((page) => page.tier === 1);
  const hasFee = (list) => list.some((page) => page.claims.some((claim) => FEE_KINDS.has(claim.kind)));
  const unique = (result) => Object.assign(result, { patterns: [...new Set(result.patterns)] });
  if (hasFee(confirmed) || !hasFee(unitUnknown)) return unique(decideFromPages(row, confirmed, kind, siblingFees));
  const result = decideFromPages(row, unitUnknown, kind, siblingFees);
  if (result.fee !== null) {
    result.confidence = kind === "condo" ? "low" : downgrade(result.confidence);
    result.basis += "_unit_unconfirmed";
    result.patterns.push("unit_unconfirmed");
    result.rationale = appendSentence(result.rationale, "The source page matches the street address but does not show the unit, so confidence is reduced.");
  }
  return unique(result);
}

// The lexicon carries one fee tuple. Concurrent master and sub-association
// schedules stay in raw evidence as multiple_current_fee_schedules instead
// of publishing a lossy chosen tuple.
export function publishableFeeTuple(result) {
  if (result.fee === null || !isPeriod(result.frequency) || result.second) return null;
  return { amountUsd: result.fee, frequency: result.frequency, annualizedUsd: result.annualized };
}

// Same-subdivision exact-property fees, used only as a second signal for a
// period or an IDX conversion, never as the property's fee.
export function buildSiblingFees(rows) {
  const out = new Map();
  for (const row of rows) {
    if (row.fee_scope !== "exact_property" || !row.fee_annualized_usd) continue;
    if (!["confirmed_match", "equivalent_period_representation"].includes(row.diagnostic)) continue;
    const key = communityKey(row);
    if (!key) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(Number(row.fee_annualized_usd));
  }
  return out;
}
