const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

// Read HTML input
const htmlPath = path.join(process.cwd(), "input.html");
const html = fs.readFileSync(htmlPath, "utf-8");
const $ = cheerio.load(html);

const PARCEL_SELECTOR = "#ctlBodyPane_ctl00_ctl01_dynamicSummary_rptrDynamicColumns_ctl00_pnlSingleValue";
const SALES_TABLE_SELECTOR = "#ctlBodyPane_ctl07_ctl01_gvwList tbody tr";
const CURRENT_OWNER_SELECTOR = ".module-content .three-column-blocks";

// Utility helpers
const txt = (s) => (s || "").replace(/\s+/g, " ").trim();
const normalizeName = (s) => txt(s).toLowerCase();

function formatNameForSchema(name) {
  if (!name) return null;
  const formatted = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  const pattern = /^[A-Z][a-z]*([ \-',.][A-Za-z][a-z]*)*$/;
  return pattern.test(formatted) ? formatted : null;
}

function formatMiddleNameForSchema(name) {
  if (!name) return null;
  const formatted = name.charAt(0).toUpperCase() + name.slice(1);
  const pattern = /^[A-Z][a-zA-Z\s\-',.]*$/;
  return pattern.test(formatted) ? formatted : null;
}

function cleanRawName(raw) {
  let s = (raw || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const noisePatterns = [
    /\bU\/A\b/gi,
    /\bU\/D\/T\b/gi,
    /\bAKA\b/gi,
    /\bA\/K\/A\b/gi,
    /\bFBO\b/gi,
    /\bC\/O\b/gi,
    /\b%\s*INTEREST\b/gi,
    /\b\d{1,3}%\b/gi,
    /\b\d{1,3}%\s*INTEREST\b/gi,
  ];
  noisePatterns.forEach((re) => {
    s = s.replace(re, " ");
  });
  s = s.replace(/[(),]/g, " ").replace(/\s+/g, " ").trim();
  s = s
    .replace(/^(&|and)\s+/i, "")
    .replace(/\s+(&|and)$/i, "")
    .trim();
  // If a trailing bare number remains right after a company suffix, drop it
  const companySuffix =
    "(?:LLC|L\\.L\\.C|INC|CORP|CO|COMPANY|LTD|TRUST|LP|LLP|PLC|PLLC)";
  const trailingNumAfterCo = new RegExp(
    `^(.*?\\b${companySuffix}\\b)\\s+\\d{1,3}$`,
    "i",
  );
  const m = s.match(trailingNumAfterCo);
  if (m) {
    s = m[1].trim();
  }
  return s;
}

function normalizeWhitespace(str) {
  return (str || "")
    .replace(/\s+/g, " ")
    .replace(/[\u00A0\s]+/g, " ")
    .trim();
}

function cleanInvalidCharsFromName(raw) {
  let parsedName = normalizeWhitespace(raw)
    .replace(/\([^)]*\)/g, '') // Remove anything in parentheses
    .replace(/[^A-Za-z\-', .]/g, "") // Only keep valid characters
    .trim();
  while (/^[\-', .]/i.test(parsedName)) { // Cannot start or end with special characters
    parsedName = parsedName.slice(1);
  }
  while (/[\-', .]$/i.test(parsedName)) { // Cannot start or end with special characters
    parsedName = parsedName.slice(0, parsedName.length - 1);
  }
  return parsedName;
}

const PREFIX_MAP = {
  mr: "Mr.",
  "mr.": "Mr.",
  mrs: "Mrs.",
  "mrs.": "Mrs.",
  ms: "Ms.",
  "ms.": "Ms.",
  miss: "Miss",
  mx: "Mx.",
  "mx.": "Mx.",
  dr: "Dr.",
  "dr.": "Dr.",
  doctor: "Dr.",
  prof: "Prof.",
  "prof.": "Prof.",
  reverend: "Rev.",
  rev: "Rev.",
  "rev.": "Rev.",
  father: "Fr.",
  fr: "Fr.",
  "fr.": "Fr.",
  sister: "Sr.",
  "sr.": "Sr.",
  brother: "Br.",
  br: "Br.",
  "br.": "Br.",
  captain: "Capt.",
  capt: "Capt.",
  "capt.": "Capt.",
  colonel: "Col.",
  col: "Col.",
  "col.": "Col.",
  major: "Maj.",
  maj: "Maj.",
  "maj.": "Maj.",
  lieutenant: "Lt.",
  lt: "Lt.",
  "lt.": "Lt.",
  sergeant: "Sgt.",
  sgt: "Sgt.",
  "sgt.": "Sgt.",
  hon: "Hon.",
  "hon.": "Hon.",
  honorable: "Hon.",
  judge: "Judge",
  rabbi: "Rabbi",
  imam: "Imam",
  sheikh: "Sheikh",
  sir: "Sir",
  dame: "Dame",
};

const SUFFIX_MAP = {
  jr: "Jr.",
  "jr.": "Jr.",
  sr: "Sr.",
  "sr.": "Sr.",
  ii: "II",
  iii: "III",
  iv: "IV",
  phd: "PhD",
  "ph.d": "PhD",
  md: "MD",
  "m.d": "MD",
  esq: "Esq.",
  "esq.": "Esq.",
  jd: "JD",
  "j.d": "JD",
  llm: "LLM",
  mba: "MBA",
  rn: "RN",
  dds: "DDS",
  dvm: "DVM",
  cfa: "CFA",
  cpa: "CPA",
  pe: "PE",
  "p.e": "PE",
  pmp: "PMP",
  emeritus: "Emeritus",
  ret: "Ret.",
  "ret.": "Ret.",
};

function extractPrefixSuffix(tokens) {
  const normalizeToken = (t) => t.toLowerCase().replace(/[.,]/g, "").trim();
  let outTokens = [...tokens];
  let prefix_name = null;
  let suffix_name = null;

  if (outTokens.length) {
    const firstNorm = normalizeToken(outTokens[0]);
    if (PREFIX_MAP[firstNorm]) {
      prefix_name = PREFIX_MAP[firstNorm];
      outTokens = outTokens.slice(1);
    }
  }

  if (outTokens.length) {
    const lastNorm = normalizeToken(outTokens[outTokens.length - 1]);
    if (SUFFIX_MAP[lastNorm]) {
      suffix_name = SUFFIX_MAP[lastNorm];
      outTokens = outTokens.slice(0, -1);
    }
  }

  return { tokens: outTokens, prefix_name, suffix_name };
}

const COMPANY_KEYWORDS = [
  "inc",
  "inc.",
  "incorporated",
  "corp",
  "corp.",
  "corporation",
  "co",
  "co.",
  "company",
  "ltd",
  "ltd.",
  "limited",
  "llc",
  "l.l.c",
  "lc",
  "l.c",
  "lp",
  "l.p",
  "llp",
  "l.l.p",
  "plc",
  "p.l.c",
  "pllc",
  "p.l.l.c",
  "pc",
  "p.c",
  "pa",
  "p.a",
  "partners",
  "partnership",
  "group",
  "holdings",
  "investments",
  "solutions",
  "services",
  "associates",
  "association",
  "assn",
  "foundation",
  "trust",
  "tr",
  "trustee",
  "authority",
  "bank",
  "na",
  "n.a",
  "hoa",
  "church",
  "school",
  "university",
  "ministries",
  "apartments",
];

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isCompanyName(name) {
  const n = name.toLowerCase();
  return COMPANY_KEYWORDS.some((kw) =>
    new RegExp(`(^|\\b)${escapeRegExp(kw)}(\\b|\\.)`, "i").test(n),
  );
}

function splitCompositeNames(name) {
  const cleaned = cleanRawName(name);
  if (!cleaned) return [];
  const parts = cleaned
    .split(/\s*&\s*|\s+and\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts;
}

function classifyOwner(raw) {
  const cleaned = cleanRawName(raw);
  if (!cleaned) {
    return { valid: false, reason: "empty_after_clean", raw };
  }
  if (isCompanyName(cleaned)) {
    return { valid: true, owner: { type: "company", name: cleaned } };
  }
  const tokens = cleaned.split(/\s+/).map((p) => p.trim()).filter(Boolean);
  const { tokens: nameTokens, prefix_name, suffix_name } = extractPrefixSuffix(tokens);
  if (nameTokens.length < 2) {
    return { valid: false, reason: "person_missing_last_name", raw: cleaned };
  }
  const first = cleanInvalidCharsFromName(nameTokens[0]);
  const last = cleanInvalidCharsFromName(nameTokens[nameTokens.length - 1]);
  const middleTokens = nameTokens.slice(1, -1);
  const middle = cleanInvalidCharsFromName(middleTokens.join(" ").trim());
  if (first && last) {
    const person = {
      type: "person",
      first_name: first,
      last_name: last,
      middle_name: middle ? middle : null,
      prefix_name: prefix_name || null,
      suffix_name: suffix_name || null,
    };
    return { valid: true, owner: person };
  }
  return { valid: false, reason: "person_missing_first_or_last", raw: cleaned };
}

function dedupeOwners(owners) {
  const seen = new Set();
  const out = [];
  for (const o of owners) {
    let norm;
    if (o.type === "company") {
      norm = `company:${normalizeName(o.name)}`;
    } else {
      const middle = o.middle_name ? normalizeName(o.middle_name) : "";
      const prefix = o.prefix_name ? normalizeName(o.prefix_name) : "";
      const suffix = o.suffix_name ? normalizeName(o.suffix_name) : "";
      norm = `person:${normalizeName(o.first_name)}|${middle}|${normalizeName(o.last_name)}|${prefix}|${suffix}`;
    }
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(o);
    }
  }
  return out;
}

function getParcelId($) {
  let parcelIdText = $(PARCEL_SELECTOR).text().trim();
  if (parcelIdText) {
    return parcelIdText;
  }
  return null;
}

function extractCurrentOwners($) {
  const owners = [];
  
  // Try multiple selectors to find owner information
  const selectors = [
    'a[id*="sprDeedName_lnkUpmSearchLinkSuppressed_lnkSearch"]',
    'span[id*="sprDeedName_lnkUpmSearchLinkSuppressed_lblSearch"]',
    'a[id*="lnkSearch"]',
    'span[id*="lblSearch"]'
  ];
  
  for (const selector of selectors) {
    const element = $(selector).first();
    if (element.length) {
      const ownerText = element.text().trim();
      if (ownerText) {
        owners.push(ownerText);
        break;
      }
    }
  }
  
  return owners;
}

function extractSalesOwnersByDate($) {
  const map = {};
  const priorOwners = [];
  const rows = $(SALES_TABLE_SELECTOR);
  rows.each((i, tr) => {
    const $tr = $(tr);
    const th = $tr.find("th").first();
    const tds = $tr.find("td");
    const saleDateRaw = txt(th.text());
    if (!saleDateRaw) return;
    const dm = saleDateRaw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!dm) return;
    const mm = dm[1].padStart(2, "0");
    const dd = dm[2].padStart(2, "0");
    const yyyy = dm[3];
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const grantee = txt(tds.last().text());
    if (grantee) {
      if (!map[dateStr]) map[dateStr] = [];
      map[dateStr].push(grantee);
    }
    const grantor = txt(tds.eq(tds.length - 2).text());
    if (grantor) priorOwners.push(grantor);
  });
  return { map, priorOwners };
}

function resolveOwnersFromRawStrings(rawStrings, invalidCollector) {
  const owners = [];
  for (const raw of rawStrings) {
    const parts = splitCompositeNames(raw);
    if (parts.length === 0) {
      invalidCollector.push({ raw, reason: "unparseable_or_empty" });
      continue;
    }
    for (const part of parts) {
      const res = classifyOwner(part);
      if (res.valid) {
        owners.push(res.owner);
      } else {
        invalidCollector.push({
          raw: part,
          reason: res.reason || "invalid_owner",
        });
      }
    }
  }
  return dedupeOwners(owners);
}

const parcelId = getParcelId($);
const currentOwnerRaw = extractCurrentOwners($);
const { map: salesMap, priorOwners } = extractSalesOwnersByDate($);
// console.log(salesMap)

const invalid_owners = [];
const dates = Object.keys(salesMap).sort();
const owners_by_date = {};
for (const d of dates) {
  const owners = resolveOwnersFromRawStrings(salesMap[d], invalid_owners);
  if (owners.length > 0) {
    owners_by_date[d] = owners;
  }
}

if (priorOwners && priorOwners.length > 0) {
  const granteeNamesNorm = new Set();
  Object.values(owners_by_date).forEach((arr) => {
    arr.forEach((o) => {
      if (o.type === "company")
        granteeNamesNorm.add(`company:${normalizeName(o.name)}`);
      else
        granteeNamesNorm.add(
          `person:${normalizeName(o.first_name)}|${o.middle_name ? normalizeName(o.middle_name) : ""}|${normalizeName(o.last_name)}`,
        );
    });
  });
  const placeholderRaw = [];
  for (const p of priorOwners) {
    const parts = splitCompositeNames(p);
    for (const part of parts) {
      const res = classifyOwner(part);
      if (res.valid) {
        const o = res.owner;
        let key;
        if (o.type === "company") key = `company:${normalizeName(o.name)}`;
        else
          key = `person:${normalizeName(o.first_name)}|${o.middle_name ? normalizeName(o.middle_name) : ""}|${normalizeName(o.last_name)}`;
        if (!granteeNamesNorm.has(key)) {
          placeholderRaw.push(part);
        }
      } else {
        invalid_owners.push({
          raw: part,
          reason: res.reason || "invalid_owner",
        });
      }
    }
  }
  if (placeholderRaw.length > 0) {
    const unknownOwners = resolveOwnersFromRawStrings(
      placeholderRaw,
      invalid_owners,
    );
    if (unknownOwners.length > 0) {
      let idx = 1;
      let unknownKey = `unknown_date_${idx}`;
      while (Object.prototype.hasOwnProperty.call(owners_by_date, unknownKey)) {
        idx += 1;
        unknownKey = `unknown_date_${idx}`;
      }
      owners_by_date[unknownKey] = unknownOwners;
    }
  }
}

const currentOwnersStructured = resolveOwnersFromRawStrings(
  currentOwnerRaw,
  invalid_owners,
);
if (currentOwnersStructured.length > 0) {
  owners_by_date["current"] = currentOwnersStructured;
} else {
  owners_by_date["current"] = [];
}

const orderedOwnersByDate = {};
const dateKeys = Object.keys(owners_by_date)
  .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
  .sort();
for (const dk of dateKeys) orderedOwnersByDate[dk] = owners_by_date[dk];
Object.keys(owners_by_date)
  .filter((k) => /^unknown_date_\d+$/.test(k))
  .forEach((k) => {
    orderedOwnersByDate[k] = owners_by_date[k];
  });
if (Object.prototype.hasOwnProperty.call(owners_by_date, "current")) {
  orderedOwnersByDate["current"] = owners_by_date["current"];
}

const propKey = `property_${parcelId || "unknown_id"}`;
const output = {};
output[propKey] = { owners_by_date: orderedOwnersByDate };

function dedupeInvalidOwners(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = `${normalizeName(item.raw)}|${item.reason}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ raw: item.raw, reason: item.reason });
    }
  }
  return out;
}

output.invalid_owners = dedupeInvalidOwners(invalid_owners);

const outDir = path.join(process.cwd(), "owners");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "owner_data.json");
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");

console.log(JSON.stringify(output));
