const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

// Read input HTML
const inputPath = path.join(process.cwd(), "input.html");
const html = fs.readFileSync(inputPath, "utf-8");
const $ = cheerio.load(html);

// Helpers
const normalizeSpace = (s) => (s || "").replace(/\s+/g, " ").trim();
const cleanName = (s) =>
  normalizeSpace(String(s).replace(/\u00A0/g, " "))
    .replace(/^[,;\-]+|[,;\-]+$/g, "")
    .trim();
const isAllCapsWord = (w) => !!w && w === w.toUpperCase();
const hasLetters = (s) => /[A-Za-z]/.test(s || "");
const stripPunctuation = (s) => (s || "").replace(/[\.,;:]+/g, "").trim();

// Company detection keywords (case-insensitive)
const companyKeywords = [
  "inc",
  "llc",
  "l.l.c",
  "ltd",
  "foundation",
  "alliance",
  "solutions",
  "corp",
  "co",
  "company",
  "services",
  "trust",
  "tr",
  "assn",
  "association",
  "partners",
  "lp",
  "llp",
  "pllc",
  "pc",
  "holdings",
  "group",
  "bank",
  "n.a",
  "na",
  "fbo",
  "ministries",
  "church",
  "c/o",
];

function isCompanyName(name) {
  const n = (name || "").toLowerCase();
  return companyKeywords.some((kw) =>
    new RegExp(`(^|[^a-z])${kw}([^a-z]|$)`, "i").test(n),
  );
}

function dedupeOwners(owners) {
  const seen = new Set();
  const out = [];
  for (const o of owners) {
    if (!o) continue;
    let key = "";
    if (o.type === "company") {
      if (!o.name || !hasLetters(o.name)) continue;
      key = `company:${o.name.toLowerCase().trim()}`;
    } else if (o.type === "person") {
      const first = (o.first_name || "").toLowerCase().trim();
      const middle = (o.middle_name || "").toLowerCase().trim();
      const last = (o.last_name || "").toLowerCase().trim();
      if (!first || !last) continue;
      key = `person:${first}|${middle}|${last}`;
    } else {
      continue;
    }
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(o);
    }
  }
  return out;
}

function parsePersonNameTokens(tokens, options = {}) {
  const { preferFirstLast = false, carryLastName = null } = options;
  const t = tokens.filter(Boolean);
  if (t.length < 2) {
    if (t.length === 1 && carryLastName) {
      // Single given name; attach carried last name
      return {
        type: "person",
        first_name: stripPunctuation(t[0]),
        last_name: stripPunctuation(carryLastName),
        middle_name: null,
      };
    }
    return null;
  }

  // If preferFirstLast (e.g., second owner after '&' with shared last name)
  if (preferFirstLast) {
    const first = stripPunctuation(t[0]);
    const last = stripPunctuation(carryLastName || t[t.length - 1]);
    let middle = null;
    if (t.length >= 2) {
      const midCandidate = stripPunctuation(t.slice(1).join(" "));
      if (midCandidate && hasLetters(midCandidate)) middle = midCandidate;
    }
    return { type: "person", first_name: first, last_name: last, middle_name: middle };
  }

  // Heuristic: for ALL-CAPS names without comma, assume LAST FIRST [MIDDLE]
  const allCaps = t.every(isAllCapsWord);
  if (allCaps) {
    if (t.length < 2) return null;
    const last = stripPunctuation(t[0]);
    const first = stripPunctuation(t[1]);
    const middle = t.length > 2 ? stripPunctuation(t.slice(2).join(" ")) : null;
    const middleName = middle && hasLetters(middle) ? middle : null;
    return { type: "person", first_name: first, last_name: last, middle_name: middleName };
  }

  // Default: FIRST [MIDDLE] LAST
  const first = stripPunctuation(t[0]);
  const last = stripPunctuation(t[t.length - 1]);
  const middle =
    t.length > 2 ? stripPunctuation(t.slice(1, -1).join(" ")) : null;
  const middleName = middle && hasLetters(middle) ? middle : null;
  return { type: "person", first_name: first, last_name: last, middle_name: middleName };
}

function parsePersonWithComma(name) {
  // Format: LAST, FIRST [MIDDLE]
  const parts = name.split(",");
  if (parts.length < 2) return null;
  const last = stripPunctuation(parts[0]);
  const rest = normalizeSpace(parts.slice(1).join(", "));
  const tokens = rest.split(/\s+/).filter(Boolean);
  if (tokens.length < 1) return null;
  const first = stripPunctuation(tokens[0]);
  const middle =
    tokens.length > 1 ? stripPunctuation(tokens.slice(1).join(" ")) : null;
  const middleName = middle && hasLetters(middle) ? middle : null;
  return { type: "person", first_name: first, last_name: last, middle_name: middleName };
}

function splitOwners(raw) {
  // Split on common delimiters between multiple owners: '&', ' and ' (case-insensitive), '/'
  // Keep commas inside names intact for Last, First formats
  const replaced = raw
    .replace(/\s+&\s+/g, " | ")
    .replace(/\sand\s/gi, " | ")
    .replace(/\s*\/\s*/g, " | ");
  return replaced
    .split("|")
    .map((s) => cleanName(s))
    .filter((s) => s);
}

function parseOwnersFromString(rawStr) {
  const owners = [];
  const invalid = [];
  const parts = splitOwners(rawStr);
  let priorLastName = null;

  for (let i = 0; i < parts.length; i++) {
    let part = parts[i];
    if (!part) continue;

    // Remove placeholders like ET AL, EST, ESTATE OF, ET UX, ET VIR
    const lowered = part.toLowerCase();
    if (
      /\bet\s*al\b/.test(lowered) ||
      /\best\b/.test(lowered) ||
      /\bestate\b/.test(lowered) ||
      /\bet\s*ux\b/.test(lowered) ||
      /\bet\s*vir\b/.test(lowered)
    ) {
      invalid.push({
        raw: part,
        reason: "not a specific owner name (placeholder)",
      });
      continue;
    }

    // Company classification
    if (isCompanyName(part)) {
      const companyName = cleanName(part);
      if (hasLetters(companyName)) {
        owners.push({ type: "company", name: companyName });
      } else {
        invalid.push({ raw: part, reason: "company name missing letters" });
      }
      continue;
    }

    // Person parsing
    let person = null;
    if (part.includes(",")) {
      person = parsePersonWithComma(part);
    } else {
      const tokens = part.split(/\s+/).filter(Boolean);
      // Heuristic: for subsequent owners with 1-2 tokens and prior last name => FIRST [MIDDLE] LAST(prior)
      const preferFirstLast = i > 0 && tokens.length <= 3 && !!priorLastName; // allow capturing middle initials
      person = parsePersonNameTokens(tokens, {
        preferFirstLast,
        carryLastName: priorLastName,
      });
    }

    if (person && person.first_name && person.last_name) {
      owners.push(person);
      priorLastName = person.last_name || priorLastName;
    } else {
      invalid.push({
        raw: part,
        reason: "unable to confidently parse person name",
      });
    }
  }

  return { owners, invalid };
}

function extractOwnerStrings($) {
  const candidates = [];
  const labelRegex = /^(owner\s*name|owner|name)\s*:*/i;

  $("td.property_field").each((_, el) => {
    const label = normalizeSpace($(el).text());
    if (labelRegex.test(label)) {
      const sibling = $(el).next("td.property_item");
      if (sibling && sibling.length) {
        const txt = normalizeSpace(sibling.text());
        if (txt) candidates.push(txt);
      }
    }
  });

  // Additional heuristic: look for any element with text starting with 'Owner' then next cell
  $("th, td, div, span, label").each((_, el) => {
    const txt = normalizeSpace($(el).text());
    if (/^owner\b/i.test(txt) && $(el).next().length) {
      const n = normalizeSpace($(el).next().text());
      if (n) candidates.push(n);
    }
  });

  // Deduplicate raw strings
  const seen = new Set();
  const unique = [];
  for (const c of candidates) {
    const k = c.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      unique.push(c);
    }
  }
  return unique;
}

function extractPropertyId($) {
  // Try Alternate Key first
  let id = null;
  $("td.property_field").each((_, el) => {
    const label = normalizeSpace($(el).text()).toLowerCase();
    if (label.includes("alternate key")) {
      const val = normalizeSpace($(el).next("td.property_item").text());
      if (val) id = val;
    }
  });

  if (!id) {
    // Try common label text variants
    $("td, th, label, span").each((_, el) => {
      const label = normalizeSpace($(el).text()).toLowerCase();
      if (/(property\s*id|prop(?:erty)?\s*key|alt\s*key|altkey)/i.test(label)) {
        const next = $(el).next();
        const val = normalizeSpace(next.text());
        if (val) id = val;
      }
    });
  }

  if (!id) {
    // Try link with query=ID
    const href = $("#cphMain_lnkGIS").attr("href");
    if (href && /[?&]query=([^&]+)/i.test(href)) {
      id = decodeURIComponent(href.match(/[?&]query=([^&]+)/i)[1]);
    }
  }

  if (!id) {
    // Try form action AltKey param
    const action = $("form").attr("action") || "";
    const m = action.match(/AltKey=([\w-]+)/i);
    if (m) id = m[1];
  }

  if (!id) id = "unknown_id";
  // normalize to digits if looks numeric
  id = id.toString().trim();
  return id;
}

function extractSalesDates($) {
  // Extract sale dates for potential chronological ordering (not mapped to owners due to missing names)
  const dates = [];
  $("table.property_data_table#cphMain_gvSalesHistory tr").each((i, tr) => {
    if (i === 0) return; // skip header
    const tds = $(tr).find("td");
    if (tds.length >= 2) {
      const dateText = normalizeSpace($(tds[1]).text());
      if (/\d{2}\/\d{2}\/\d{4}/.test(dateText)) {
        // Convert to YYYY-MM-DD
        const [mm, dd, yyyy] = dateText.split("/");
        const iso = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
        dates.push(iso);
      }
    }
  });
  // Sort chronological ascending
  dates.sort();
  return dates;
}

// Main extraction
const propertyId = extractPropertyId($);

const ownerStrings = extractOwnerStrings($);
let allOwners = [];
let invalidOwners = [];

for (const raw of ownerStrings) {
  const { owners, invalid } = parseOwnersFromString(raw);
  allOwners = allOwners.concat(owners);
  invalidOwners = invalidOwners.concat(invalid);
}

// Deduplicate owners
const validOwners = dedupeOwners(allOwners);

// Build owners_by_date
const ownersByDate = {};
if (validOwners.length > 0) {
  ownersByDate["current"] = validOwners;
} else {
  ownersByDate["current"] = [];
}

// Prepare final object
const result = {};
result[`property_${propertyId}`] = {
  owners_by_date: ownersByDate,
  invalid_owners: invalidOwners,
};

// Ensure output directory and write file
const outDir = path.join(process.cwd(), "owners");
const outPath = path.join(outDir, "owner_data.json");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf-8");

// Output JSON to stdout
console.log(JSON.stringify(result, null, 2));
