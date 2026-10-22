// Shared text normalization for HOA web evidence. See
// skills/use-oracle/reference/hoa-web-ingestion.md for the operating playbook.

const ENTITIES = new Map([
  ["&amp;", "&"],
  ["&#39;", "'"],
  ["&apos;", "'"],
  ["&quot;", '"'],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&nbsp;", " "],
]);

export function upperSquash(value) {
  const decoded = String(value ?? "").replace(
    /&(?:amp|#39|apos|quot|lt|gt|nbsp);/gi,
    (entity) => ENTITIES.get(entity.toLowerCase()) ?? entity,
  );
  return decoded.toUpperCase().split(/\s+/).filter(Boolean).join(" ");
}

export function compact(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function collapse(value) {
  return String(value ?? "").split(/\s+/).filter(Boolean).join(" ");
}

export function stripChars(value, chars) {
  let start = 0;
  let end = value.length;
  while (start < end && chars.includes(value[start])) start += 1;
  while (end > start && chars.includes(value[end - 1])) end -= 1;
  return value.slice(start, end);
}

export function normalizeName(value) {
  return collapse(
    upperSquash(value)
      .replace(/&/g, " AND ")
      .replace(/@/g, " AT ")
      .replace(/[^A-Z0-9]+/g, " "),
  );
}

export const NAME_STOP = new Set([
  "THE", "OF", "AND", "AT", "A", "AN", "FOR", "IN", "ON", "BY",
  "HOA", "POA", "COA", "INC", "LLC", "ASSOC", "ASSN", "ASSOCIATION",
  "HOMEOWNER", "HOMEOWNERS", "HOMEOWNER'S", "OWNER", "OWNERS",
  "PROPERTY", "CONDO", "CONDOS", "CONDOMINIUM", "CONDOMINIUMS",
  "COMMUNITY", "MASTER", "PHASE", "SECTION", "UNIT", "TOWNHOME",
  "TOWNHOMES", "TOWNHOUSE", "TOWNHOUSES", "ESTATES", "VILLAGE",
  "VILLAGES", "SUBDIVISION", "PLAT", "COUNTY", "FLORIDA", "FL",
]);

export function distinctiveTokens(value) {
  const tokens = new Set();
  for (const token of normalizeName(value).split(" ")) {
    if (token.length < 4 || NAME_STOP.has(token) || /^\d+$/.test(token)) continue;
    tokens.add(token);
  }
  return tokens;
}

export function namesOverlap(left, right) {
  const rightTokens = distinctiveTokens(right);
  for (const token of distinctiveTokens(left)) if (rightTokens.has(token)) return true;
  return false;
}

const GENERIC_COMMUNITY = new Set([
  "COMMON AREA", "COMMON ELEMENTS", "COMM ON AREA", "PT OF COMMON AREA",
  "UNDIVIDED INTEREST", "CONDOMINIUM", "TOWNHOMES", "TOWNHOMES OF",
  "LOT", "UNIT", "PT RECD", "RECD",
]);
const RECORDING_WORDS = new Set(["PART", "RECD", "RECORDED", "COMMON", "AREA", "INTEREST"]);
const LONE_GEOGRAPHY = new Set(["CREEK", "POINT", "POINTE", "LAKE", "PARK", "RIDGE", "PLACE"]);

export function communityOk(text) {
  if (!text) return false;
  const cleaned = stripChars(collapse(text), " -&,/");
  if (cleaned.length < 4 || GENERIC_COMMUNITY.has(cleaned)) return false;
  if (/\b(?:DEG|POB|R\/W)\b/.test(cleaned)) return false;
  const words = cleaned.match(/[A-Z]{3,}/g) ?? [];
  const distinctive = words.some(
    (word) => word.length >= 4 && !NAME_STOP.has(word) && !RECORDING_WORDS.has(word),
  );
  if (!distinctive) return false;
  if (words.length === 1 && LONE_GEOGRAPHY.has(words[0])) return false;
  return true;
}

const SMALL_WORDS = new Set(["of", "at", "the", "on", "and", "in", "by", "a"]);

function capitalize(word) {
  return word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word;
}

export function titleCase(text) {
  return String(text ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => {
      const upper = stripChars(word.toUpperCase(), ",.");
      if (/^(?:II|III|IV|VI|VII|VIII|IX|XI|XII|HOA|POA|COA|CDD|LLC)$/.test(upper)) {
        return word.toUpperCase();
      }
      if (index && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
      if (word.includes("'") || word.includes("’")) {
        return word[0].toUpperCase() + word.slice(1).toLowerCase();
      }
      return capitalize(word);
    })
    .join(" ");
}

function matchingCharacters(a, b) {
  if (!a.length || !b.length) return 0;
  let best = 0;
  let bestA = 0;
  let bestB = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k += 1;
      if (k > best) {
        best = k;
        bestA = i;
        bestB = j;
      }
    }
  }
  if (!best) return 0;
  return (
    best +
    matchingCharacters(a.slice(0, bestA), b.slice(0, bestB)) +
    matchingCharacters(a.slice(bestA + best), b.slice(bestB + best))
  );
}

// Ratcliff/Obershelp similarity, equivalent to Python difflib's ratio() for
// the short tokens compared here.
export function sequenceRatio(a, b) {
  const total = a.length + b.length;
  return total ? (2 * matchingCharacters(a, b)) / total : 1;
}

export function cleanMarkdown(markdown, title = "") {
  let text = `${title ?? ""}\n${markdown ?? ""}`;
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\*\*/g, "").replace(/\\/g, "");
  text = text.replace(/General Property Information:\s*/g, "");
  text = text.replace(/\bMFR_/g, "");
  text = text.replace(/<br\s*\/?>/g, "\n");
  // Listing markdown often glues the badge to the label ("$376/moHOA Fees").
  text = text.replace(/(?<=[a-z0-9/])(?=hoa\b)/gi, " ");
  text = text.replace(/Has an HOA\s*HOA Fee/g, "Has an HOA | HOA Fee");
  text = text.replace(/(HOA Fee \(second\)|HOA Fee Frequency \(second\)|HOA Phone|HOA Name)/g, " | $1");
  return text;
}

const SIMILAR_HOMES =
  /\b(?:similar homes|nearby homes|homes for sale|recommended homes|recently sold|other homes|you may also)\b/i;

// Cut recommendation carousels only at short heading-like lines; a body-wide
// match removes the HOA section on some listing layouts.
export function contentBeforeSimilarHomes(text) {
  const kept = [];
  for (const line of String(text ?? "").split("\n")) {
    const plain = line
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[#*_]+/g, "")
      .trim();
    if (plain.length <= 80 && SIMILAR_HOMES.test(plain)) break;
    kept.push(line);
  }
  return kept.join("\n");
}

const BLOCKED_PAGE =
  /\b(?:captcha|verify you are human|access denied|just a moment|enable javascript|attention required)\b/i;

export function pageBlocked(markdown, title = "") {
  const sample = `${title}\n${String(markdown ?? "").slice(0, 1500)}`;
  return BLOCKED_PAGE.test(sample) && String(markdown ?? "").length < 4000;
}

export function hostOf(url) {
  const host = String(url ?? "").replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
  return host.replace(/^www\./, "");
}

export function siteOf(url) {
  const parts = hostOf(url).split(".");
  return parts.length >= 2 ? parts.slice(-2).join(".") : parts.join(".");
}

const COUNTY_LABEL = new Map([
  ["miami-dade", "Miami-Dade"],
  ["palm-beach", "Palm Beach"],
  ["st-johns", "St. Johns"],
  ["st-lucie", "St. Lucie"],
]);

export function countyLabel(slug) {
  const value = String(slug ?? "");
  return COUNTY_LABEL.get(value) ?? titleCase(value.replace(/-/g, " "));
}
