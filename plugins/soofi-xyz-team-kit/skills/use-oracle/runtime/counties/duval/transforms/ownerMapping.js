const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

function loadHtml() {
  const primary = path.join(process.cwd(), "input.html");
  if (fs.existsSync(primary)) return fs.readFileSync(primary, "utf8");
  const alternate = path.join(process.cwd(), "0020608295R.html");
  if (fs.existsSync(alternate)) return fs.readFileSync(alternate, "utf8");
  throw new Error("Unable to locate input HTML");
}

// Read input HTML
const html = loadHtml();
const $ = cheerio.load(html);

// Utility: clean text
function cleanText(str) {
  return (str || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:\-–]+|[\s:\-–]+$/g, "")
    .trim();
}

// Detect company by keywords
function isCompanyName(name) {
  const s = name.toLowerCase();
  const keywords = [
    "inc",
    "llc",
    "l.l.c",
    "ltd",
    "foundation",
    "alliance",
    "solutions",
    "corp",
    "co",
    "services",
    "trust",
    " tr",
    "association",
    "associates",
    "partners",
    "lp",
    "llp",
    "plc",
    "company",
    "holdings",
    "properties",
    "property",
    "management",
  ];
  return keywords.some((k) => s.includes(k));
}

function removeEtAl(name) {
  return cleanText(
    name.replace(/\bET\s*AL\b\.?/i, "").replace(/\bet\s*al\.?/i, ""),
  );
}

function removeInvalidNameSuffixes(name) {
  // Remove R/S (revocable/living trust abbreviation) and similar suffixes
  // Also remove T/C (trustee/co-trustee), TTE (trustee), TR (trustee), etc.
  return cleanText(
    name.replace(/\bR\/S\b\.?/gi, "")
        .replace(/\bR\/s\b\.?/g, "")
        .replace(/\bT\/C\b\.?/gi, "")  // Remove T/C (trustee/co-trustee)
        .replace(/\bT\/c\b\.?/g, "")
        .replace(/\bTTE\b\.?/gi, "")   // Remove TTE (trustee)
        .replace(/\bTR\b\.?/gi, "")    // Remove TR (trustee) - but only as suffix
        .replace(/\s+\/\s+/g, " ")
        .replace(/\s+[A-Z]\s*\/\s*[A-Za-z]\b/gi, "")  // Remove any X/Y patterns
        .replace(/\s+R\s*\/\s*[A-Za-z]\b/gi, ""),
  );
}

function normalizeNameKey(obj) {
  if (!obj) return "";
  if (obj.type === "company") {
    return cleanText(obj.name).toLowerCase();
  } else if (obj.type === "person") {
    const parts = [obj.first_name, obj.middle_name || "", obj.last_name].filter(
      Boolean,
    );
    return cleanText(parts.join(" ")).toLowerCase();
  }
  return "";
}

function toTitleCaseName(s) {
  // Keep original casing for acronyms like LLC, INC, etc. Only title-case person name parts.
  return s
    .split(/\s+/)
    .map((p) => {
      if (p.toUpperCase() === p && p.length <= 4) return p;
      return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
    })
    .join(" ");
}

// Classification of a raw owner string
function classifyOwner(raw, invalid) {
  let name = cleanText(raw);
  if (!name) return null;

  // Exclude obvious non-owner patterns
  if (/^c\/?o\b|\bc\/?o\b/i.test(name)) {
    invalid.push({ raw: name, reason: "care-of entry, not an owner" });
    return null;
  }
  if (/\baka\b|\bfka\b/i.test(name)) {
    // Keep AKA/FKA text but strip the marker to get the base name
    name = cleanText(name.replace(/\baka\b|\bfka\b/gi, ""));
  }
  name = removeEtAl(name);
  name = removeInvalidNameSuffixes(name);

  // If mostly address-like (contains digits and street terms), exclude
  if (
    /\d/.test(name) &&
    /(st|street|ave|avenue|blvd|road|rd|ct|court|ln|lane|dr|drive|fl|zip)/i.test(
      name,
    )
  ) {
    invalid.push({ raw: raw, reason: "address-like string, not an owner" });
    return null;
  }

  // Company classification
  if (isCompanyName(name)) {
    return { type: "company", name: cleanText(name) };
  }

  // Person classification
  let personStr = name;
  personStr = personStr.replace(/\s*&\s*/g, " ").replace(/\s{2,}/g, " ");

  // Function to extract and remove suffix from token array
  function extractSuffix(tokens) {
    if (tokens.length === 0) return { tokens, suffix: null };

    // Map input tokens to schema-compliant suffix values
    const suffixMapping = {
      "JR": "Jr.",
      "JR.": "Jr.",
      "SR": "Sr.",
      "SR.": "Sr.",
      "II": "II",
      "III": "III",
      "IV": "IV",
      "PHD": "PhD",
      "PHD.": "PhD",
      "MD": "MD",
      "MD.": "MD",
      "ESQ": "Esq.",
      "ESQ.": "Esq.",
      "JD": "JD",
      "LLM": "LLM",
      "MBA": "MBA",
      "RN": "RN",
      "DDS": "DDS",
      "DDS.": "DDS",
      "DVM": "DVM",
      "CFA": "CFA",
      "CPA": "CPA",
      "PE": "PE",
      "PMP": "PMP",
      "EMERITUS": "Emeritus",
      "RET": "Ret.",
      "RET.": "Ret."
    };

    const lastToken = tokens[tokens.length - 1].toUpperCase().replace(/,/g, "");
    if (suffixMapping[lastToken]) {
      return { tokens: tokens.slice(0, -1), suffix: suffixMapping[lastToken] };
    }

    return { tokens, suffix: null };
  }

  // Common person formats: "LAST, FIRST M" or "LAST FIRST M" or "First M Last"
  let first = null,
    middle = null,
    last = null,
    suffix = null;
  if (/,/.test(personStr)) {
    // Format: LAST, FIRST [MIDDLE] [SUFFIX]
    const [l, rest] = personStr.split(",", 2).map((s) => cleanText(s));
    let tokens = rest.split(" ").filter(Boolean);
    const extracted = extractSuffix(tokens);
    tokens = extracted.tokens;
    suffix = extracted.suffix;

    if (tokens.length >= 1) {
      last = toTitleCaseName(l);
      first = toTitleCaseName(tokens[0]);
      if (tokens.length > 1) {
        middle = toTitleCaseName(tokens.slice(1).join(" "));
      }
    }
  } else {
    let tokens = personStr.split(" ").filter(Boolean);
    const extracted = extractSuffix(tokens);
    tokens = extracted.tokens;
    suffix = extracted.suffix;

    if (tokens.length >= 2) {
      // Check if the first token is all uppercase (likely last name)
      // or if it's from a structured field (e.g., property records typically use LAST FIRST MIDDLE format)
      const firstTokenAllCaps = tokens[0] === tokens[0].toUpperCase();
      const allTokensAllCaps = tokens.every(t => t === t.toUpperCase());

      // If all tokens are uppercase or first token is all caps with length > 3, assume LAST FIRST MIDDLE format
      if (allTokensAllCaps || (firstTokenAllCaps && tokens[0].length > 3)) {
        // Format: LAST FIRST [MIDDLE]
        last = toTitleCaseName(tokens[0]);
        first = toTitleCaseName(tokens[1]);
        if (tokens.length > 2) {
          middle = toTitleCaseName(tokens.slice(2).join(" "));
        }
      } else {
        // Format: FIRST [MIDDLE] LAST
        first = toTitleCaseName(tokens[0]);
        last = toTitleCaseName(tokens[tokens.length - 1]);
        if (tokens.length > 2) {
          middle = toTitleCaseName(tokens.slice(1, -1).join(" "));
        }
      }
    }
  }

  if (!first || !last) {
    invalid.push({ raw: raw, reason: "unable to confidently parse as person" });
    return null;
  }

  const person = { type: "person", first_name: first, last_name: last };
  if (middle && cleanText(middle)) person.middle_name = middle;
  if (suffix) person.suffix = suffix;
  return person;
}

// Extract property id heuristically
function extractPropertyId($) {
  // 1) Direct element by id
  const direct = cleanText($("#ctl00_cphBody_lblRealEstateNumber").text());
  if (direct) return direct;
  // 2) Find table row where TH contains RE #
  let id = "";
  $("table tr").each((_, tr) => {
    const th = cleanText($(tr).find("th").first().text());
    if (/^re\s*#/i.test(th)) {
      const tdText = cleanText($(tr).find("td").first().text());
      if (tdText) {
        id = tdText;
        return false;
      }
    }
  });
  if (id) return id;
  // 3) Fallback via query param RE= in form action or links
  const formAction = $("form").attr("action") || "";
  const reMatch = /[?&]RE=([^&]+)/i.exec(formAction);
  if (reMatch) return reMatch[1];
  const link = $("a[href*='RE=']").attr("href") || "";
  const reMatch2 = /[?&]RE=([^&]+)/i.exec(link);
  if (reMatch2) return reMatch2[1];
  return "unknown_id";
}

// Extract plausible owner name strings from DOM
function extractRawOwnerStrings($) {
  const candidates = new Set();

  // 1) Primary owner header area
  const ownerHeader = cleanText($("#ownerName h2 span").first().text());
  if (ownerHeader) candidates.add(ownerHeader);

  // 2) Any element id/class containing "Owner" likely indicates owner fields
  $('[id*="Owner" i], [class*="Owner" i]').each((_, el) => {
    const t = cleanText($(el).text());
    if (t && t.length <= 200) candidates.add(t);
  });

  // 3) Exclude mailing address C/O lines as owners but capture to review
  $("#ownerName .data li span").each((_, el) => {
    const t = cleanText($(el).text());
    if (t) candidates.add(t);
  });

  // Return array
  return Array.from(candidates).filter(Boolean);
}

// Extract sale dates and format to YYYY-MM-DD
function extractSaleDates($) {
  const dates = [];
  $("#ctl00_cphBody_gridSalesHistory tr").each((i, tr) => {
    if (i === 0) return; // skip header
    const tds = $(tr).find("td");
    if (tds.length >= 2) {
      const raw = cleanText($(tds[1]).text());
      if (raw) {
        const parts = raw.split("/");
        if (parts.length === 3) {
          const m = String(parts[0]).padStart(2, "0");
          const d = String(parts[1]).padStart(2, "0");
          const y = parts[2];
          const iso = `${y}-${m}-${d}`;
          dates.push(iso);
        }
      }
    }
  });
  // Unique and sort ascending
  const uniq = Array.from(new Set(dates));
  uniq.sort();
  return uniq;
}

const propertyId = extractPropertyId($);

const rawOwners = extractRawOwnerStrings($);
const invalidOwners = [];

// Build lists of valid owners
const validOwnerObjects = [];
const seenKeys = new Set();

for (const raw of rawOwners) {
  // Skip obvious non-owner labels and long blocks
  const text = cleanText(raw);
  if (!text) continue;
  const lower = text.toLowerCase();
  if (
    lower.includes("mailing address") ||
    lower.includes("primary site address") ||
    lower.includes("official record book") ||
    lower.includes("tile #") ||
    lower.includes("value summary") ||
    lower.includes("legal desc") ||
    lower.includes("land & legal") ||
    lower.includes("buildings") ||
    lower.includes("traversing data") ||
    lower.includes("note") ||
    lower.includes("exemptions") ||
    lower.includes("sales history") ||
    /\$|\d{2,}/.test(text) // amounts or heavy numerics
  ) {
    continue;
  }

  const ownerObj = classifyOwner(text, invalidOwners);
  if (!ownerObj) continue;
  const key = normalizeNameKey(ownerObj);
  if (!key) continue;
  if (seenKeys.has(key)) continue;
  seenKeys.add(key);
  validOwnerObjects.push(ownerObj);
}

// If no owners found, attempt to specifically pick the Owner's Name span
if (validOwnerObjects.length === 0) {
  const fallback = cleanText(
    $("#ctl00_cphBody_repeaterOwnerInformation_ctl00_lblOwnerName").text(),
  );
  if (fallback) {
    const obj = classifyOwner(fallback, invalidOwners);
    if (obj) validOwnerObjects.push(obj);
  }
}

// Owners by date mapping
const ownersByDate = {};
const saleDates = extractSaleDates($);

// If we have a reliable latest sale date, associate to owners
if (saleDates.length > 0 && validOwnerObjects.length > 0) {
  // Use the latest date as the acquisition date for the current owner group
  const lastDate = saleDates[saleDates.length - 1];
  ownersByDate[lastDate] = validOwnerObjects.slice();
}

// Always include current
ownersByDate["current"] = validOwnerObjects.slice();

// Build final JSON
const result = {};
result[`property_${propertyId || "unknown_id"}`] = {
  owners_by_date: ownersByDate,
};
result.invalid_owners = invalidOwners;

// Ensure output directory exists and write file
const outDir = path.join("owners");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "owner_data.json");
fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");

// Print the JSON result
console.log(JSON.stringify(result, null, 2));
