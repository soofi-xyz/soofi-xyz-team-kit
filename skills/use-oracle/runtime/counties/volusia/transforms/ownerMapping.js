const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

// Load HTML
const html = fs.readFileSync("input.html", "utf8");
const $ = cheerio.load(html);

// Helpers
const toTitle = (s) =>
  s.toLowerCase().replace(/(^|\s|[-'])\p{L}/gu, (m) => m.toUpperCase());
const cleanWhitespace = (s) => s.replace(/\s+/g, " ").trim();
const normalizeName = (s) => cleanWhitespace(s).toLowerCase();

// Elephant Person prefix/suffix enums
const PERSON_PREFIX_ENUM_VALUES = [
  "Mr.",
  "Mrs.",
  "Ms.",
  "Miss",
  "Mx.",
  "Dr.",
  "Prof.",
  "Rev.",
  "Fr.",
  "Sr.",
  "Br.",
  "Capt.",
  "Col.",
  "Maj.",
  "Lt.",
  "Sgt.",
  "Hon.",
  "Judge",
  "Rabbi",
  "Imam",
  "Sheikh",
  "Sir",
  "Dame",
];

const PERSON_SUFFIX_ENUM_VALUES = [
  "Jr.",
  "Sr.",
  "II",
  "III",
  "IV",
  "PhD",
  "MD",
  "Esq.",
  "JD",
  "LLM",
  "MBA",
  "RN",
  "DDS",
  "DVM",
  "CFA",
  "CPA",
  "PE",
  "PMP",
  "Emeritus",
  "Ret.",
];

function normalizeEnumToken(token) {
  return token.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildEnumLookup(values) {
  const map = new Map();
  for (const value of values) {
    if (!value) continue;
    const normalized = normalizeEnumToken(value);
    if (!map.has(normalized)) map.set(normalized, value);
  }
  return map;
}

const PREFIX_LOOKUP = buildEnumLookup(PERSON_PREFIX_ENUM_VALUES);
const SUFFIX_LOOKUP = buildEnumLookup(PERSON_SUFFIX_ENUM_VALUES);

function mapEnumValue(rawToken, lookup) {
  if (!rawToken) return null;
  const normalized = normalizeEnumToken(rawToken);
  if (!normalized) return null;
  if (lookup.has(normalized)) return lookup.get(normalized);
  return null;
}

function extractPrefixSuffix(tokens) {
  const working = [...tokens];
  let prefix = null;
  let suffix = null;

  if (working.length) {
    const candidatePrefix = mapEnumValue(working[0], PREFIX_LOOKUP);
    if (candidatePrefix) {
      prefix = candidatePrefix;
      working.shift();
    }
  }

  if (working.length) {
    const candidateSuffix = mapEnumValue(
      working[working.length - 1],
      SUFFIX_LOOKUP,
    );
    if (candidateSuffix) {
      suffix = candidateSuffix;
      working.pop();
    }
  }

  return {
    tokens: working,
    prefix_name: prefix,
    suffix_name: suffix,
  };
}

function escapeForRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildAcronymPattern(acronym) {
  const letters = acronym.replace(/[^a-z]/gi, "").split("");
  if (!letters.length) return null;
  const body = letters.map((ch) => `${escapeForRegex(ch)}\\.?`).join("\\s*");
  return new RegExp(`\\b${body}\\b`, "i");
}

const COMPANY_PATTERNS = [
  /\bINCORPORATED\b/i,
  /\bINC\b/i,
  /\bCORPORATION\b/i,
  /\bCORP\b/i,
  /\bCOMPANIES\b/i,
  /\bCOMPANY\b/i,
  /\bCO\b/i,
  /\bCO\.\b/i,
  /\bLIMITED\b/i,
  /\bLTD\b/i,
  /\bHOLDINGS?\b/i,
  /\bHOLDING\b/i,
  /\bGROUP\b/i,
  /\bPARTNERSHIP\b/i,
  /\bPARTNERS?\b/i,
  /\bASSOCIATES?\b/i,
  /\bASSOC\b/i,
  /\bASSN\b/i,
  /\bASSOCIATION\b/i,
  /\bFOUNDATION\b/i,
  /\bFUND\b/i,
  /\bTRUSTE?E?\b/i,
  /\bTRUST\b/i,
  /\bESTATE\b/i,
  /\bHOLDCO\b/i,
  /\bINVESTMENTS?\b/i,
  /\bVENTURES?\b/i,
  /\bENTERPRISES?\b/i,
  /\bPROPERT(?:Y|IES)\b/i,
  /\bREALTY\b/i,
  /\bREAL\s+ESTATE\b/i,
  /\bMANAGEMENT\b/i,
  /\bMGMT\b/i,
  /\bSERVICES?\b/i,
  /\bSOLUTIONS?\b/i,
  /\bDEVELOPMENT\b/i,
  /\bDEVELOPERS?\b/i,
  /\bCONSTRUCTION\b/i,
  /\bINDUSTRIES\b/i,
  /\bBANK\b/i,
  /\bN\.?A\.?\b/i,
  /\bCREDIT\s+UNION\b/i,
  /\bCHURCH\b/i,
  /\bMINISTRIES\b/i,
  /\bMISSION\b/i,
  /\bHOSPITAL\b/i,
  /\bAUTHORITY\b/i,
  /\bBOARD\b/i,
  /\bSCHOOL\b/i,
  /\bUNIVERSITY\b/i,
  /\bCOLLEGE\b/i,
  /\bCLUB\b/i,
  /\bDEPARTMENT\b/i,
  /\bAGENCY\b/i,
  /\bCITY\s+OF\b/i,
  /\bTOWN\s+OF\b/i,
  /\bCOUNTY\s+OF\b/i,
  /\bSTATE\s+OF\b/i,
  /\bGOVERNMENT\b/i,
  /\bMUNICIPALITY\b/i,
]
  .concat(
    [
      "LLC",
      "PLLC",
      "LLP",
      "LLLP",
      "LP",
      "PLC",
      "PC",
      "PA",
      "PPLC",
      "REIT",
      "FBO",
    ]
      .map(buildAcronymPattern)
      .filter(Boolean),
  )
  .concat([
    /\bL\.?\s*L\.?\s*C\.?\b/i,
    /\bL\.?\s*L\.?\s*P\.?\b/i,
    /\bL\.?\s*P\.?\b/i,
    /\bP\.?\s*C\.?\b/i,
    /\bP\.?\s*A\.?\b/i,
  ]);

// Property ID extraction (prefer "Parcel ID", fallback to hidden #altkey, then "Alternate Key")
function extractPropertyId($) {
  let id = null;
  $("strong").each((i, el) => {
    const txt = $(el).text().trim().toLowerCase();
    if (!id && txt.includes("parcel id")) {
      const val = $(el).parent().next().text();
      const v = cleanWhitespace(val);
      if (v) id = v;
    }
  });
  if (!id) {
    const alt = $("input#altkey").attr("value");
    if (alt) id = cleanWhitespace(alt);
  }
  if (!id) {
    $("strong").each((i, el) => {
      const txt = $(el).text().trim().toLowerCase();
      if (!id && txt.includes("alternate key")) {
        const val = $(el).parent().next().text();
        const v = cleanWhitespace(val);
        if (v) id = v;
      }
    });
  }
  if (!id) id = "unknown_id";
  return id;
}

// Detect companies using expanded indicator patterns
function isCompany(name) {
  if (!name) return false;
  return COMPANY_PATTERNS.some((pattern) => pattern.test(name));
}

// Basic address-like line filter
function looksLikeAddress(line) {
  const l = line.toUpperCase();
  if (
    /\d{3,}/.test(l) &&
    /( ST | AVE | BLVD | RD | DR | LN | CT | HWY | PKWY | WAY | TER | CIR )/.test(
      " " + l + " ",
    )
  )
    return true;
  if (/(\b[A-Z]{2}\b)\s*\d{5}(-\d{4})?$/.test(l)) return true; // state + zip
  return false;
}

// Extract owner text blocks from areas labeled like Owner(s)
function extractOwnerBlocks($) {
  const blocks = [];
  $("strong").each((i, el) => {
    const label = $(el).text().trim().toLowerCase();
    if (label.includes("owner")) {
      const holder = $(el).parent().next();
      if (holder && holder.length) {
        const html = holder.html() || holder.text();
        if (html) blocks.push(html);
      }
    }
  });
  return blocks;
}

// Parse individual owner lines from blocks
function parseOwnerCandidates(blockHtml) {
  const text = blockHtml
    .replace(/<br\s*\/?>(\s*)/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const lines = text
    .split("\n")
    .map((s) => cleanWhitespace(s))
    .filter(Boolean);
  const results = [];
  for (let line of lines) {
    // Keep only text before first hyphen separator
    const base = cleanWhitespace(line.split(/\s+-\s+/)[0]);
    if (!base) continue;
    if (base.length < 2) continue;
    if (looksLikeAddress(base)) continue;
    if (/^(no\b|apply for homestead)/i.test(base)) continue;
    // remove stray trailing % or roles words
    const cleaned = base
      .replace(/\s*\d+%$/i, "")
      .replace(/\s+life estate$/i, "")
      .replace(/\s+le$/i, "");
    if (cleaned) results.push(cleaned);
  }
  return results;
}

// Heuristic: split multi-person name with & into separate persons using rightmost last name
function splitAmpersandPersons(raw) {
  const parts = raw
    .split("&")
    .map((s) => cleanWhitespace(s))
    .filter(Boolean);
  if (parts.length < 2) return null;
  const allTokens = cleanWhitespace(raw.replace(/&/g, " ")).split(" ");
  const lastName =
    allTokens.length >= 2 ? allTokens[allTokens.length - 1] : null;
  if (!lastName) return null;
  const people = [];
  for (const p of parts) {
    let toks = p.split(" ").filter(Boolean);
    if (toks.length === 0) continue;
    const extracted = extractPrefixSuffix(toks);
    toks = extracted.tokens;
    if (toks.length > 1 && lastName) {
      const maybeLast = toks[toks.length - 1];
      if (
        maybeLast &&
        maybeLast.toLowerCase() === lastName.toLowerCase()
      ) {
        toks = toks.slice(0, -1);
      }
    }
    if (toks.length === 0) continue;
    const first = toks[0];
    const middle = toks.slice(1).join(" ") || null;
    if (!first || !lastName) {
      throw new Error(`Missing required name parts in owner "${raw}"`);
    }
    people.push({
      type: "person",
      first_name: toTitle(first),
      last_name: toTitle(lastName),
      middle_name: middle ? toTitle(middle) : null,
      prefix_name: extracted.prefix_name,
      suffix_name: extracted.suffix_name,
    });
  }
  return people.length ? people : null;
}

// Decide if name is likely LAST FIRST (all caps two tokens)
function isLikelyLastFirstTwoTokens(name) {
  const toks = name.split(" ").filter(Boolean);
  if (toks.length !== 2) return false;
  const bothCaps = toks.every((t) => /[^a-z]/.test(t) && t === t.toUpperCase());
  if (bothCaps) return true;
  // If second token is common first name, assume LAST FIRST
  const second = toks[1].toLowerCase();
  const commonFirst = new Set([
    "john",
    "michael",
    "william",
    "david",
    "james",
    "robert",
    "mary",
    "patricia",
    "jennifer",
    "linda",
    "barbara",
    "elizabeth",
    "maria",
    "susan",
    "margaret",
    "dorothy",
    "lisa",
    "nancy",
    "karen",
    "betty",
    "helen",
    "sandra",
    "donna",
    "carol",
    "ruth",
    "sharon",
    "michelle",
    "laura",
    "sarah",
    "kim",
    "jessica",
    "daniel",
    "paul",
    "mark",
    "donald",
    "george",
    "kenneth",
    "steven",
    "edward",
    "brian",
    "ronald",
    "anthony",
    "kevin",
    "jason",
    "matthew",
    "gary",
    "timothy",
    "jose",
    "larry",
    "jeffrey",
    "frank",
    "scott",
    "eric",
    "andrew",
    "stephen",
    "raymond",
    "gregory",
    "joshua",
    "jerry",
    "dennis",
    "walter",
    "patrick",
    "peter",
    "harold",
    "douglas",
    "henry",
    "carl",
    "arthur",
    "ryan",
    "roger",
    "joe",
    "juan",
    "jack",
    "albert",
    "jonathan",
    "justin",
    "terry",
    "gerald",
    "keith",
    "samuel",
    "willie",
    "ralph",
    "lawrence",
    "nicholas",
    "roy",
    "benjamin",
    "bruce",
    "brandon",
    "adam",
    "harry",
    "fred",
    "wayne",
    "billy",
    "steve",
    "louis",
    "jeremy",
    "aaron",
    "randy",
    "howard",
    "eugene",
    "carlos",
    "russell",
    "bobby",
    "victor",
    "martin",
    "ernest",
    "philip",
    "todd",
    "jesse",
    "craig",
    "alan",
    "shawn",
    "clarence",
    "sean",
    "phillip",
    "chris",
    "johnny",
    "earl",
    "jimmy",
    "antonio",
    "danny",
    "bryan",
    "tony",
    "luis",
    "mike",
    "stanley",
    "leonard",
    "nathan",
    "dale",
    "manuel",
    "rodney",
    "curtis",
    "norman",
    "allen",
    "marvin",
    "vincent",
    "glenn",
    "travis",
    "jeffery",
    "ira",
  ]);
  if (commonFirst.has(second)) return true;
  return false;
}

// Build owner object(s) from a raw candidate
function buildOwnersFromRaw(raw, invalidOut) {
  const owners = [];
  const name = cleanWhitespace(raw);
  if (!name) return owners;

  if (isCompany(name)) {
    owners.push({ type: "company", name: cleanWhitespace(name) });
    return owners;
  }

  if (name.includes("&")) {
    const split = splitAmpersandPersons(name);
    if (split && split.length) return split;
    invalidOut.push({ raw: name, reason: "ambiguous_ampersand_format" });
    return owners;
  }

  // Remove commas
  const plain = name.replace(/,/g, " ");
  let toks = plain.split(/\s+/).filter(Boolean);
  const { tokens: coreTokens, prefix_name, suffix_name } =
    extractPrefixSuffix(toks);
  toks = coreTokens;
  if (toks.length < 2) {
    invalidOut.push({ raw: name, reason: "insufficient_name_parts" });
    return owners;
  }

  let first = toks[0];
  let middle = null;
  let last = toks[toks.length - 1];

  const candidateForOrderCheck = toks.join(" ");
  if (toks.length === 2 && isLikelyLastFirstTwoTokens(candidateForOrderCheck)) {
    // Swap
    first = toks[1];
    last = toks[0];
  } else if (toks.length >= 3) {
    // Heuristic: if all caps and looks like LAST FIRST MIDDLE
    const allCaps = toks.every((t) => t === t.toUpperCase());
    if (allCaps) {
      // Assume first token is last name, second is first name, remaining middle
      last = toks[0];
      first = toks[1];
      middle = toks.slice(2).join(" ");
    } else {
      middle = toks.slice(1, -1).join(" ") || null;
    }
  }

  if (!first || !last) {
    throw new Error(`Missing required name parts in owner "${name}"`);
  }

  owners.push({
    type: "person",
    first_name: toTitle(first),
    last_name: toTitle(last),
    middle_name: middle ? toTitle(middle) : null,
    prefix_name: prefix_name || null,
    suffix_name: suffix_name || null,
  });
  return owners;
}

// Deduplicate owners by normalized identification key
function dedupeOwners(list) {
  const seen = new Set();
  const out = [];
  for (const o of list) {
    let key;
    if (o.type === "company") key = "company:" + normalizeName(o.name);
    else
      key =
        "person:" +
        normalizeName(
          [o.first_name, o.middle_name || "", o.last_name]
            .filter(Boolean)
            .join(" "),
        );
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(o);
    }
  }
  return out;
}

// Main assembly
const propertyId = extractPropertyId($);
const ownerBlocks = extractOwnerBlocks($);
let rawCandidates = [];
for (const b of ownerBlocks) {
  rawCandidates = rawCandidates.concat(parseOwnerCandidates(b));
}

// Unique raw names
const rawSeen = new Set();
rawCandidates = rawCandidates.filter((n) => {
  const k = normalizeName(n);
  if (!k || rawSeen.has(k)) return false;
  rawSeen.add(k);
  return true;
});

const invalidOwners = [];
let ownerObjects = [];
for (const rc of rawCandidates) {
  ownerObjects = ownerObjects.concat(buildOwnersFromRaw(rc, invalidOwners));
}
ownerObjects = dedupeOwners(ownerObjects).filter(Boolean);

// Group by date: only current known from this page structure
const ownersByDate = {};
ownersByDate["current"] = ownerObjects;

const result = {};
result[`property_${propertyId}`] = {
  owners_by_date: ownersByDate,
  invalid_owners: invalidOwners,
};

// Ensure output directory and save
const outDir = path.join("owners");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "owner_data.json"),
  JSON.stringify(result, null, 2),
  "utf8",
);

// Print JSON
console.log(JSON.stringify(result, null, 2));