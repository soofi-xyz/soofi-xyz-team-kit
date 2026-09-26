const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

// Load input HTML
const html = fs.readFileSync("input.html", "utf8");
const $ = cheerio.load(html);

// Helper: trim and collapse whitespace
const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

// Helper: parse date formats like 21-May-2001 to YYYY-MM-DD
function toISODate(dstr) {
  const s = clean(dstr);
  if (!s) return null;
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const mon = m[2].toLowerCase();
  const yr = m[3];
  const map = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    sept: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };
  const mm = map[mon];
  if (!mm) return null;
  return `${yr}-${mm}-${day}`;
}

const COMPANY_KEYWORD_SETS = [
  ["LIMITED", "PARTNERSHIP"],
  ["LIMITED", "LIABILITY", "COMPANY"],
  ["LIMITED", "LIABILITY", "PARTNERSHIP"],
  ["LIMITED", "LIABILITY"],
  ["PROFESSIONAL", "ASSOCIATION"],
  ["PROFESSIONAL", "CORPORATION"],
  ["HOMEOWNERS", "ASSOCIATION"],
  ["CONDOMINIUM", "ASSOCIATION"],
  ["PROPERTY", "OWNERS", "ASSOCIATION"],
  ["STATE", "OF"],
  ["CITY", "OF"],
  ["COUNTY", "OF"],
  ["UNITED", "STATES"],
  ["HOUSING", "AUTHORITY"],
  ["COMMUNITY", "DEVELOPMENT"],
  ["ECONOMIC", "DEVELOPMENT"],
  ["FAMILY", "TRUST"],
  ["REVOCABLE", "TRUST"],
  ["LIVING", "TRUST"],
  ["IRREVOCABLE", "TRUST"],
  ["APARTMENTS"],
  ["ASSOCIATES"],
  ["ASSOCIATION"],
  ["AUTOMOTIVE"],
  ["BANK"],
  ["CAPITAL"],
  ["CHURCH"],
  ["CLINIC"],
  ["CO-OP"],
  ["COMPANY"],
  ["CONSTRUCTION"],
  ["CORPORATION"],
  ["DEPARTMENT"],
  ["ENTERPRISE"],
  ["ENTERPRISES"],
  ["ESTATE"],
  ["ESTATES"],
  ["FOUNDATION"],
  ["FUND"],
  ["GROUP"],
  ["HOLDINGS"],
  ["HOSPITAL"],
  ["HOUSING"],
  ["INSURANCE"],
  ["INVESTMENT"],
  ["INVESTMENTS"],
  ["LLC"],
  ["LLP"],
  ["LLLP"],
  ["LTD"],
  ["MANAGEMENT"],
  ["MINISTRIES"],
  ["MINISTRY"],
  ["MORTGAGE"],
  ["PARTNERSHIP"],
  ["PARTNERS"],
  ["PROPERTIES"],
  ["PROPERTY"],
  ["REALTY"],
  ["RESORT"],
  ["SERVICES"],
  ["SOLUTIONS"],
  ["SCHOOL"],
  ["TRUST"],
  ["UNIVERSITY"],
  ["VENTURES"],
];

const COMPANY_TOKENS = new Set([
  "INC",
  "INCORPORATED",
  "CO",
  "CO.",
  "COMPANY",
  "CORP",
  "CORP.",
  "CORPORATION",
  "LLC",
  "L.L.C",
  "L L C",
  "LC",
  "LC.",
  "LTD",
  "L.T.D",
  "L L P",
  "LLP",
  "L.L.P",
  "L L L P",
  "LLLP",
  "PLC",
  "P.L.C",
  "PLLC",
  "P.L.L.C",
  "PC",
  "P.C",
  "PA",
  "P.A",
  "GP",
  "G.P",
  "LP",
  "L.P",
  "TR",
  "TRS",
  "TRUST",
  "FBO",
  "IRA",
  "C/O",
  "ETAL",
  "ET-AL",
  "ASSOC",
  "ASSN",
  "ASPHA",
  "FOUNDATION",
  "FNDN",
  "PARTNERS",
  "PARTNERSHIP",
  "HOLDINGS",
  "INVESTMENTS",
  "PROPERTIES",
  "PROPERTY",
  "REALTY",
  "MANAGEMENT",
  "MGMT",
  "SOLUTIONS",
  "SERVICES",
  "SERVICE",
  "ENTERPRISE",
  "ENTERPRISES",
  "VENTURES",
  "BANK",
  "MORTGAGE",
  "FINANCIAL",
  "FUND",
  "CAPITAL",
  "TRUSTEE",
  "TRUSTEES",
  "AUTHORITY",
  "DEPARTMENT",
  "DEPT",
  "CITY",
  "COUNTY",
  "TOWN",
  "STATE",
  "UNIVERSITY",
  "COLLEGE",
  "SCHOOL",
  "HOSPITAL",
  "MEDICAL",
  "CLINIC",
  "CHURCH",
  "TEMPLE",
  "MOSQUE",
  "SYNAGOGUE",
  "MINISTRY",
  "MINISTRIES",
  "ASSOCIATION",
  "ASSOCIATES",
  "APARTMENTS",
  "PRODUCTIONS",
  "LOGISTICS",
  "TRANSPORT",
  "SUPPLY",
  "SUPPLIES",
  "DISTRIBUTION",
  "DESIGN",
  "DEVELOPMENT",
  "STUDIO",
  "PROPERTIES",
  "ESTATES",
  "ESTATE",
  "HOMES",
  "HOMESITES",
  "HOLDING",
  "SYSTEMS",
  "TECHNOLOGIES",
  "TECHNOLOGY",
  "SOLN",
  "LLC.",
  "LLP.",
  "LLLP.",
  "PLC.",
  "PLLC.",
  "PC.",
  "PA.",
  "GP.",
  "LP.",
  "COOP",
  "CO-OP",
]);

const PREFIX_MAP = {
  MR: "Mr.",
  MRS: "Mrs.",
  MS: "Ms.",
  MISS: "Miss",
  MX: "Mx.",
  DR: "Dr.",
  PROF: "Prof.",
  REV: "Rev.",
  FR: "Fr.",
  SR: "Sr.",
  BR: "Br.",
  CAPT: "Capt.",
  COL: "Col.",
  MAJ: "Maj.",
  LT: "Lt.",
  SGT: "Sgt.",
  HON: "Hon.",
  JUDGE: "Judge",
  RABBI: "Rabbi",
  IMAM: "Imam",
  SHEIKH: "Sheikh",
  SIR: "Sir",
  DAME: "Dame",
};

const SUFFIX_MAP = {
  JR: "Jr.",
  SR: "Sr.",
  II: "II",
  III: "III",
  IV: "IV",
  PHD: "PhD",
  MD: "MD",
  ESQ: "Esq.",
  JD: "JD",
  LLM: "LLM",
  MBA: "MBA",
  RN: "RN",
  DDS: "DDS",
  DVM: "DVM",
  CFA: "CFA",
  CPA: "CPA",
  PE: "PE",
  PMP: "PMP",
  EMERITUS: "Emeritus",
  RET: "Ret.",
};

const PERSON_NAME_REGEX = /^[A-Z][a-z]*([ \-',.][A-Za-z][a-z]*)*$/;
const MIDDLE_NAME_REGEX = /^[A-Z][A-Za-z\s-',.]*$/;

function formatPersonName(value) {
  if (!value) return null;
  const cleaned = value.replace(/[^A-Za-z\s\-',.]/g, " ").trim();
  if (!cleaned) return null;
  const formatted = cleaned
    .toLowerCase()
    .replace(/(^|[ \-'\.])([a-z])/g, (match, sep, char) => `${sep}${char.toUpperCase()}`)
    .replace(/\s+/g, " ")
    .trim();
  const withoutTrailingPeriod = formatted.replace(/\.+$/, "");
  return withoutTrailingPeriod || null;
}

function formatMiddleNameValue(value) {
  const formatted = formatPersonName(value);
  if (!formatted) return null;
  return MIDDLE_NAME_REGEX.test(formatted) ? formatted : null;
}

// Helper: detect if a name is likely a company
function isCompany(raw) {
  const sClean = clean(raw);
  const s = sClean.toUpperCase();
  if (!s) return false;
  const normalized = s.replace(/[.\']/g, " ");
  const tokens = normalized.split(/[^A-Z0-9&]+/).filter(Boolean);
  for (const token of tokens) {
    if (COMPANY_TOKENS.has(token)) {
      return true;
    }
  }
  const words = normalized.split(/\s+/).filter(Boolean);
  for (const keywordSet of COMPANY_KEYWORD_SETS) {
    const matchesAll = keywordSet.every((kw) =>
      words.includes(kw.toUpperCase()) || s.includes(kw.toUpperCase()),
    );
    if (matchesAll) return true;
  }
  return false;
}

// Helper: split multiple parties separated by '&' or ' and '
function splitParties(raw) {
  const s = clean(raw);
  if (!s) return [];
  const normalized = s.replace(/\sand\s/gi, " & ");
  const parts = normalized
    .split(/\s*&\s*/)
    .map((p) => clean(p))
    .filter(Boolean);
  if (parts.length <= 1) {
    return parts;
  }
  if (isCompany(s)) {
    const shouldKeepWhole = parts.some((part) => {
      const tokenCount = part.split(/\s+/).filter(Boolean).length;
      return !isCompany(part) && tokenCount < 2;
    });
    if (shouldKeepWhole) {
      return [s];
    }
  }
  // Normalize common separators for person/person ownership
  return parts;
}

// Helper: Map raw suffix to schema enum
function mapSuffixToSchema(rawSuffix) {
  if (!rawSuffix) return null;
  const normalized = rawSuffix.toUpperCase().replace(/[^A-Z]/g, "");
  return SUFFIX_MAP[normalized] || null;
}

function mapPrefixToSchema(token) {
  if (!token) return null;
  const normalized = token.toUpperCase().replace(/[^A-Z]/g, "");
  return PREFIX_MAP[normalized] || null;
}

function extractSuffixTokens(tokens) {
  let extractedSuffix = null;
  const filteredTokens = [];
  for (let i = tokens.length - 1; i >= 0; i--) {
    const normalizedToken = tokens[i].toUpperCase().replace(/[^A-Z]/g, "");
    const mapped = mapSuffixToSchema(normalizedToken);
    if (!extractedSuffix && mapped) {
      extractedSuffix = mapped;
      continue;
    }
    filteredTokens.unshift(tokens[i]);
  }
  return { extractedSuffix, filteredTokens };
}

// Helper: classify and structure a single name string
function parseOwnerName(raw, requestIdentifier, sourceHttpRequest) {
  const s = clean(raw);
  if (!s) return { valid: false, reason: "empty", raw };

  if (isCompany(s)) {
    const companyName = clean(s);
    return {
      valid: true,
      owner: {
        name: companyName,
        request_identifier: requestIdentifier,
        source_http_request: sourceHttpRequest,
      },
    };
  }

  // Define suffixes to look for and remove from name parts
  let last = null,
    first = null,
    middle = null,
    suffix = null;

  let working = s;
  let prefix = null;
  const leadingParts = working.split(/\s+/);
  if (leadingParts.length > 1) {
    const mappedPrefix = mapPrefixToSchema(leadingParts[0]);
    if (mappedPrefix) {
      prefix = mappedPrefix;
      working = working.slice(leadingParts[0].length).trim();
    }
  }

  if (working.includes(",")) {
    // Format: LAST, FIRST [MIDDLE] [SUFFIX]
    const [left, rightRaw] = working.split(",");
    last = clean(left);
    const rightTokens = clean(rightRaw).split(/\s+/).filter(Boolean);

    const { extractedSuffix, filteredTokens } = extractSuffixTokens(rightTokens);
    suffix = extractedSuffix;

    if (filteredTokens.length >= 1) {
      first = filteredTokens[0];
      if (filteredTokens.length > 1) middle = filteredTokens.slice(1).join(" ");
    }
  } else {
    // Heuristic: FIRST [MIDDLE] LAST [SUFFIX] or LAST FIRST [MIDDLE] (less common for formal records)
    // Given the HTML example "POLYPACK LTD PARTNERSHIP", it's likely company.
    // For persons, "SMITH, DWIGHT R JR" is common.
    // Let's assume if no comma, it's FIRST MIDDLE LAST, or FIRST LAST.
    const toks = working.split(/\s+/).filter(Boolean);
    const { extractedSuffix, filteredTokens } = extractSuffixTokens(toks);
    suffix = extractedSuffix;

    if (filteredTokens.length >= 2) {
      last = filteredTokens[0];
      first = filteredTokens[1];
      if (filteredTokens.length > 2) {
        middle = filteredTokens.slice(2).join(" ");
      }
    } else if (filteredTokens.length === 1) {
      // Only one name part after suffix extraction, likely an error or single name.
      // For now, assign to last name.
      last = filteredTokens[0];
    }
  }

  // Validate required fields - first_name and last_name must have minimum length 1
  const formattedFirst = formatPersonName(first);
  const formattedLast = formatPersonName(last);

  if (
    !formattedFirst ||
    !formattedLast ||
    !PERSON_NAME_REGEX.test(formattedFirst) ||
    !PERSON_NAME_REGEX.test(formattedLast)
  ) {
    return { valid: false, reason: "missing_required_name_fields", raw: s };
  }

  const middleNameFormatted = formatMiddleNameValue(middle);
  const person = {
    source_http_request: sourceHttpRequest,
    request_identifier: requestIdentifier,
    birth_date: null,
    first_name: formattedFirst,
    last_name: formattedLast,
    middle_name: middleNameFormatted,
    prefix_name: prefix,
    suffix_name: suffix,
    us_citizenship_status: null,
    veteran_status: null,
  };
  return { valid: true, owner: person };
}

// Helper: turn any raw string possibly with multiple parties into owners[]; record invalids
function ownersFromRaw(raw, invalids, requestIdentifier, sourceHttpRequest) {
  const parties = splitParties(raw);
  const out = [];
  for (const p of parties) {
    const parsed = parseOwnerName(p, requestIdentifier, sourceHttpRequest);
    if (parsed.valid) out.push(parsed.owner);
    else invalids.push({ raw: p, reason: parsed.reason });
  }
  return out;
}

// Helper: normalize for dedupe
function normalizeOwner(o) {
  if (o && "name" in o && !("first_name" in o)) {
    return `company:${clean(o.name).toLowerCase()}`;
  }
  const f = clean(o.first_name || "").toLowerCase();
  const l = clean(o.last_name || "").toLowerCase();
  const m = o.middle_name ? clean(o.middle_name).toLowerCase() : "";
  const s = o.suffix_name ? clean(o.suffix_name).toLowerCase() : "";
  return `person:${f}|${m}|${l}|${s}`;
}

function dedupeOwners(arr) {
  const seen = new Set();
  const out = [];
  for (const o of arr) {
    const key = normalizeOwner(o);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(o);
    }
  }
  return out;
}

// --- Main Extraction Logic ---
try {
  // Extract Property ID
  let propertyId = clean($("#pacel_no").text());
  if (!propertyId) {
    // Try other hints like g_strap from scripts or input name="pn"
    const scriptsText = $("script")
      .map((i, el) => $(el).html() || "")
      .get()
      .join("\n");
    const m = scriptsText.match(/var\s+g_strap\s*=\s*"(\d+)"/);
    if (m) propertyId = m[1];
    else {
      const strapInput = clean($('#frmTaxEstimator input[name="pn"]').val());
      if (strapInput) propertyId = strapInput;
      else propertyId = "unknown_id"; // Fallback if no ID found
    }
  }

  // Define request_identifier and source_http_request (placeholders)
  // In a real scenario, these would be passed from the calling context
  const requestIdentifier = propertyId; // Using propertyId as request_identifier
  const sourceHttpRequest = {
    method: "GET",
    url: 'https://www.pcpao.gov/property-details', // Example URL
  };

  // Collect owners
  const invalid_owners = [];

  // Current owners
  let currentOwnerText = "";
  // The HTML structure for owner names is a bit tricky with <br/> and multiple spans.
  // Let's get the combined text content and then split by potential owner separators.
  const ownerDetailsDiv = $("#owner_details");
  // Remove the "More" button if it exists, to avoid its text interfering
  ownerDetailsDiv.find(".ownermoreBtn").remove();
  // Get all text nodes and combine, or use .text() and then split by common delimiters
  const rawCurrentOwnerText = ownerDetailsDiv.text().trim();

  let currentOwners = [];
  // Assuming multiple owners are separated by " and " or "&" or new lines in the raw text
  currentOwners = ownersFromRaw(
    rawCurrentOwnerText,
    invalid_owners,
    requestIdentifier,
    sourceHttpRequest,
  );
  currentOwners = dedupeOwners(currentOwners);

  // Historical owners by date via Sales History (use Grantee at sale date)
  const ownersByDate = {};

  $("#tblSalesHistory tbody tr").each((i, el) => {
    const tds = $(el).find("td");
    if (tds.length >= 6) {
      const dateStr = clean($(tds[0]).text());
      const granteeRaw = clean($(tds[5]).text());
      const iso = toISODate(dateStr);
      if (iso && granteeRaw) {
        const owners = ownersFromRaw(
          granteeRaw,
          invalid_owners,
          requestIdentifier,
          sourceHttpRequest,
        );
        if (owners.length) {
          if (!ownersByDate[iso]) ownersByDate[iso] = [];
          ownersByDate[iso] = dedupeOwners(ownersByDate[iso].concat(owners));
        }
      } else if (!iso && granteeRaw) {
        // Unknown date bucket
        let idx = 1;
        let key = `unknown_date_${idx}`;
        while (ownersByDate[key]) {
          idx += 1;
          key = `unknown_date_${idx}`;
        }
        const owners = ownersFromRaw(
          granteeRaw,
          invalid_owners,
          requestIdentifier,
          sourceHttpRequest,
        );
        if (owners.length)
          ownersByDate[key] = dedupeOwners(
            (ownersByDate[key] || []).concat(owners),
          );
      }
    }
  });

  // Add current owners at the end under 'current'
  // ownersByDate["current"] = currentOwners;

  // Sort chronological keys (ISO dates), keep unknown_date_* in insertion order, current last
  const dateKeys = Object.keys(ownersByDate)
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
    .sort();
  const unknownKeys = Object.keys(ownersByDate).filter((k) =>
    /^unknown_date_\d+$/.test(k),
  );
  const finalMap = {};
  for (const k of dateKeys) finalMap[k] = ownersByDate[k];
  for (const k of unknownKeys) finalMap[k] = ownersByDate[k];
  finalMap["current"] = ownersByDate["current"];

  // Build final JSON structure
  const out = {};
  out[`property_${propertyId}`] = { owners_by_date: finalMap, invalid_owners };

  // Ensure output directory and write file
  fs.mkdirSync(path.dirname("owners/owner_data.json"), { recursive: true });
  fs.writeFileSync(
    "owners/owner_data.json",
    JSON.stringify(out, null, 2),
    "utf8",
  );

  // Print JSON to stdout
  console.log(JSON.stringify(out, null, 2));
} catch (error) {
  console.error("An error occurred during owner extraction:", error);
  process.exit(1); // Exit with an error code
}
