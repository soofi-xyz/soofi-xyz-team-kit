// Address parsing, page-identity tiers, and query shapes for HOA web
// evidence. A page may stamp a property fee only at tier 2 (address and unit
// confirmed, locality agrees, not a multi-unit building page).

import { condoLike } from "./hoa-web-legal.mjs";
import { cleanMarkdown, collapse, countyLabel, normalizeName, stripChars, titleCase, upperSquash } from "./hoa-web-text.mjs";

export const STREET_SUFFIXES = new Map(
  Object.entries({
    ALY: "ALLEY", ALLEY: "ALLEY", AVE: "AVENUE", AVENUE: "AVENUE",
    BLVD: "BOULEVARD", BOULEVARD: "BOULEVARD", CIR: "CIRCLE", CIRCLE: "CIRCLE",
    CT: "COURT", COURT: "COURT", CV: "COVE", COVE: "COVE",
    DR: "DRIVE", DRIVE: "DRIVE", EXPY: "EXPRESSWAY", HWY: "HIGHWAY",
    HIGHWAY: "HIGHWAY", LN: "LANE", LANE: "LANE", LOOP: "LOOP",
    PATH: "PATH", PIKE: "PIKE", PKWY: "PARKWAY", PARKWAY: "PARKWAY",
    PL: "PLACE", PLACE: "PLACE", PT: "POINT", POINT: "POINT",
    RD: "ROAD", ROAD: "ROAD", RUN: "RUN", SQ: "SQUARE", SQUARE: "SQUARE",
    ST: "STREET", STREET: "STREET", TER: "TERRACE", TERR: "TERRACE",
    TERRACE: "TERRACE", TRL: "TRAIL", TRAIL: "TRAIL", WALK: "WALK",
    WAY: "WAY", XING: "CROSSING", CROSSING: "CROSSING", ROW: "ROW",
    PASS: "PASS", PLZ: "PLAZA", PLAZA: "PLAZA", TRCE: "TRACE", TRACE: "TRACE",
  }),
);
const SUFFIX_ALTERNATION = [...STREET_SUFFIXES.keys()].join("|");
export const DIRECTIONS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW", "NORTH", "SOUTH", "EAST", "WEST"]);

const ABBREVIATION = new Map();
for (const [short, full] of STREET_SUFFIXES) {
  if (short.length < full.length && !ABBREVIATION.has(full)) ABBREVIATION.set(full, short);
}

// Unit tokens must stand alone: STEVENSON, UNITY, and UNITAH contain STE/UNIT.
const UNIT_TOKEN =
  /(?:#|\b(?:APT|APARTMENT|UNIT|STE|SUITE)\b)(?:\s+\b(?:APT|APARTMENT|UNIT|STE|SUITE)\b)*\s*#?\s*([A-Z0-9-]+)/;

export function parseAddress(value) {
  if (!value || !String(value).trim()) return null;
  let text = upperSquash(value);
  let postal = null;
  const zip = text.match(/\b(\d{5})(?:-\d{4})?\s*$/);
  if (zip) {
    postal = zip[1];
    text = stripChars(text.slice(0, zip.index).trim(), " ,");
  }
  text = stripChars(collapse(text.replace(/\bFLORIDA\b|\bFL\b/g, " ")), " ,");
  let city = null;
  let streetPart = text;
  if (text.includes(",")) {
    const parts = text.split(",").map((part) => stripChars(part, " ,")).filter(Boolean);
    streetPart = parts[0];
    city = parts[1] ?? null;
  }
  const direction = [];
  let house = null;
  let rest = streetPart;
  // A leading direction before the house number ("N 410 EXAMPLE LAKE AVE").
  const leading = streetPart.match(/^(N|S|E|W|NE|NW|SE|SW|NORTH|SOUTH|EAST|WEST)\s+(\d+[A-Z]?)\b\s*(.*)$/);
  const numbered = streetPart.match(/^(\d+[A-Z]?)\b\s*(.*)$/);
  if (leading) {
    direction.push(leading[1]);
    house = leading[2];
    rest = leading[3];
  } else if (numbered) {
    house = numbered[1];
    rest = numbered[2];
  }
  let unit = null;
  const unitMatch = UNIT_TOKEN.exec(rest);
  if (unitMatch && !STREET_SUFFIXES.has(unitMatch[1]) && !DIRECTIONS.has(unitMatch[1])) {
    unit = unitMatch[1];
    rest = `${rest.slice(0, unitMatch.index)} ${rest.slice(unitMatch.index + unitMatch[0].length)}`.trim();
  }
  let suffix = null;
  let core = [];
  const avenueOf = rest.match(/^AVENUE OF THE ([A-Z0-9]+)\b\s*(.*)$/);
  if (avenueOf) {
    core = ["AVENUE", "OF", "THE", avenueOf[1]];
    city = city || avenueOf[2] || null;
  } else {
    const tokens = rest.split(" ").filter(Boolean);
    let suffixAt = -1;
    tokens.forEach((token, index) => {
      if (STREET_SUFFIXES.has(token)) suffixAt = index;
    });
    if (suffixAt >= 0) {
      suffix = STREET_SUFFIXES.get(tokens[suffixAt]);
      const before = tokens.slice(0, suffixAt);
      const after = tokens.slice(suffixAt + 1);
      while (before.length && DIRECTIONS.has(before[0])) direction.push(before.shift());
      core = before.filter((token) => !DIRECTIONS.has(token));
      // Addresses without commas carry the city after the suffix.
      if (city === null && after.length) city = after.join(" ");
    } else {
      core = tokens.filter((token) => !DIRECTIONS.has(token));
    }
  }
  city = collapse(city ?? "") || null;
  const parsed = { raw: value, house, core, direction, suffix, unit, city, postal, usable: Boolean(house && core.length) };
  if (!parsed.usable) return parsed;
  const prettyStreet = [house, ...direction, ...core, ...(suffix ? [titleCase(suffix)] : [])].join(" ");
  const prettyCity = city ? titleCase(city) : "";
  parsed.queryStreet = [house, ...core].join(" ");
  parsed.quoted = `${prettyStreet}${unit ? ` #${unit}` : ""}${prettyCity ? `, ${prettyCity}` : ""}${postal ? `, FL ${postal}` : ", FL"}`;
  return parsed;
}

export function normUnit(unit) {
  if (!unit) return null;
  const value = String(unit).toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(?:APT|UNIT|STE)/, "");
  return value.replace(/^0+/, "") || null;
}

export function targetAddress(row) {
  const parsed = parseAddress(row?.full_address);
  if (!parsed?.house) return null;
  let unit = parsed.unit;
  const city = parsed.city ?? "";
  if (!unit && city) {
    const first = city.split(" ")[0];
    if (/\d/.test(first) && !/^\d{5}$/.test(first)) unit = first;
  }
  if (!unit) {
    const street = String(row?.full_address ?? "").toUpperCase().split(",")[0];
    const tail = street.match(new RegExp(`\\b(?:${SUFFIX_ALTERNATION})\\s+([A-Z]?\\d+[A-Z]?(?:-[A-Z0-9]+)?)\\s*$`));
    if (tail && tail[1].length <= 6) unit = tail[1];
  }
  let legalUnit = null;
  if (condoLike(row)) {
    const legal = upperSquash(row?.legal_description);
    const match = legal.match(/\b(?:DWELLING\s+)?UNIT\s+(?:NO\.?\s*)?#?\s*([A-Z]?-?\d+(?:-?[A-Z0-9]{1,3})?)(?!\S*\s+(?:LOT|BLK|BLOCK)\b)/);
    if (match) legalUnit = match[1].replace(/(PER|OR|PI|BLDG)$/, "");
  }
  return {
    house: parsed.house,
    core: parsed.core.filter((token) => !DIRECTIONS.has(token)),
    unit: normUnit(unit),
    legalUnit: normUnit(legalUnit),
    postal: parsed.postal,
    city: parsed.city,
  };
}

const ORDINAL = new Map([["1", "ST"], ["2", "ND"], ["3", "RD"]]);
export const UNIT_IN_TEXT =
  /(?<!MLS )(?<!MLS)(?:#|\bUNIT\b|\bAPT\b|\bAPARTMENT\b|\bSTE\b|\bSUITE\b)[\s\-_.]*#?\s*([A-Z]?\d{1,5}[A-Z]?(?:-[A-Z0-9]{1,4})?(?![\dA-Z])|[A-Z](?=[\s_\-,]|$)(?!\s*\/\s*A))/g;
const MLS_ID = /\bMLS\s*#?\s*[A-Z]*\d+/g;

function unitsIn(text) {
  const units = new Set();
  for (const match of text.matchAll(UNIT_IN_TEXT)) {
    const unit = normUnit(match[1]);
    if (unit) units.add(unit);
  }
  return units;
}

function identityText(url, title) {
  const path = String(url ?? "").replace(/^https?:\/\/[^/]+/, "");
  const text = `${path} ${title ?? ""}`.toUpperCase().replace(MLS_ID, " ").replace(/\bN\s*\/\s*A\b/g, " ");
  return collapse(text.replace(/[^A-Z0-9#]+/g, " "));
}

function coreOk(core, tokens) {
  for (const token of core) {
    const options = new Set([token]);
    if (/^\d+$/.test(token)) {
      const teen = /(?:11|12|13)$/.test(token);
      options.add(token + (teen ? "TH" : ORDINAL.get(token.at(-1)) ?? "TH"));
    }
    if (token === "SAINT") options.add("ST");
    if (token === "MOUNT") options.add("MT");
    if (![...options].some((option) => tokens.has(option))) return false;
  }
  return true;
}

// 2 = address and unit confirmed, 1 = address confirmed but unit not shown,
// 0 = a different property, unit, or a multi-listing page.
export function pageTier(target, url, title, body, isCondoLike) {
  if (!target?.core?.length) return { tier: 1, reason: "no usable target address" };
  const ident = identityText(url, title);
  const identTokens = new Set(ident.replace(/#/g, " ").split(" ").filter(Boolean));
  const head = upperSquash(String(body ?? "").slice(0, 2500));
  const headTokens = new Set(head.replace(/[^A-Z0-9]+/g, " ").split(" ").filter(Boolean));
  const inIdent = identTokens.has(target.house) && coreOk(target.core, identTokens);
  const inHead = headTokens.has(target.house) && coreOk(target.core, headTokens);
  if (!inIdent && !inHead) return { tier: 0, reason: "street address differs" };
  if (!inIdent) {
    const listed = new Set(
      [...head.matchAll(new RegExp(`\\b(\\d{2,6})\\s+(?:[NSEW]\\s+)?[A-Z][A-Z]+(?:\\s+[A-Z]+)?\\s+(?:${SUFFIX_ALTERNATION})\\b`, "g"))].map(
        (match) => match[1],
      ),
    );
    listed.delete(target.house);
    if (listed.size >= 3) return { tier: 0, reason: "multi-listing or community page" };
  }
  if (inHead && !inIdent) {
    const houseLike = (ident.match(/\b\d{3,6}\b/g) ?? []).filter(
      (token) => token !== target.house && token !== target.postal && identTokens.has(token),
    );
    if (houseLike.length && new RegExp(`\\b(?:${SUFFIX_ALTERNATION})\\b`).test(ident)) {
      return { tier: 0, reason: "page is for a different address" };
    }
  }
  const want = target.unit ?? target.legalUnit;
  const pageUnits = unitsIn(ident);
  pageUnits.delete(target.house.replace(/^0+/, ""));
  if (want) {
    if (pageUnits.has(want)) return { tier: 2, reason: "address and unit match" };
    if (pageUnits.size) return { tier: 0, reason: `different unit (${[...pageUnits].sort().join(", ")})` };
    const bodyUnits = unitsIn(upperSquash(String(body ?? "").slice(0, 6000)).replace(MLS_ID, " "));
    if (bodyUnits.has(want)) return { tier: 2, reason: "address and unit match (page body)" };
    const escapedHouse = target.house.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedUnit = want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escapedHouse}\\s+[A-Z0-9 ]{2,40}\\s+(?:#|UNIT|APT)?\\s*0*${escapedUnit}\\b`).test(upperSquash(String(body ?? "").slice(0, 3000)))) {
      return { tier: 2, reason: "address and unit match (page body)" };
    }
    return { tier: 1, reason: "address matches but unit not shown" };
  }
  if (pageUnits.size && isCondoLike) {
    return { tier: 1, reason: `page names unit ${[...pageUnits].sort().join(", ")} but the target unit is unknown` };
  }
  return { tier: 2, reason: "address matches" };
}

export function localityOk(address, url, title, body) {
  if (!address) return true;
  const hay = normalizeName(
    `${String(url ?? "").replace(/[-_]/g, " ")} ${title ?? ""} ${String(body ?? "").slice(0, 5000)}`,
  ).replace(/SAINT/g, "ST");
  const words = new Set(hay.split(" "));
  if (address.postal && words.has(address.postal)) return true;
  const city = normalizeName(address.city ?? "").replace(/SAINT/g, "ST").split(" ").filter(Boolean);
  if (city.length && city.every((part) => words.has(part))) return true;
  return !address.postal && !city.length;
}

// Tier a fetched page for one cohort row: address/unit identity, city or ZIP
// agreement, and the building-page rule (three or more units listed).
export function pageEvidenceTier(row, { url, title = "", markdown = "" }) {
  const body = cleanMarkdown(markdown, "");
  const target = targetAddress(row);
  const { tier, reason } = pageTier(target, url, title, body, condoLike(row));
  if (tier && !localityOk(parseAddress(row?.full_address), url, title, body)) {
    return { tier: 0, reason: "city and ZIP differ" };
  }
  if (tier === 2 && reason.includes("(page body)")) {
    const units = unitsIn(upperSquash(body.slice(0, 20000)).replace(MLS_ID, " "));
    // A markdown heading ("# 960 Example Dr") reads as unit 960.
    units.delete(target.house.replace(/^0+/, ""));
    if (units.size >= 3) {
      return { tier: 0, reason: `building page listing ${units.size} units; the target unit is not the page subject` };
    }
  }
  return { tier, reason };
}

export function evidenceScopeForTier(tier) {
  return tier === 2 ? "exact_property" : tier === 1 ? "unresolved_scope" : "same_community_other_property";
}

export function streetForms(address) {
  const lead = [address.house, ...(address.direction ?? []), ...address.core];
  const suffix = address.suffix;
  return {
    full: titleCase([...lead, ...(suffix ? [suffix] : [])].join(" ")),
    short: titleCase([...lead, ...(suffix ? [ABBREVIATION.get(suffix) ?? suffix] : [])].join(" ")),
  };
}

export function exactAddressQuery(address, county) {
  let query = `"${address.queryStreet}"`;
  if (address.unit) query += ` "#${address.unit}"`;
  if (address.city) query += ` ${titleCase(address.city)}`;
  if (address.postal) query += ` ${address.postal}`;
  return `${query} ${countyLabel(county)} FL HOA association fee`;
}

export function periodMatrixQueries(address) {
  const quoted = address.quoted;
  return [
    `"${quoted}" "HOA fee" monthly`,
    `"${quoted}" "HOA fee" quarterly`,
    `"${quoted}" ("HOA fee" OR "association fee") (semiannual OR "semi-annually" OR biannual)`,
    `"${quoted}" ("HOA fee" OR "association fee") (annual OR annually OR yearly)`,
  ];
}

// Hosts in measured pass-1 fee-yield order. Override per run with the
// operator's own yield table.
export const DEFAULT_FEE_HOSTS = [
  { host: "homes.com", street: "short", unit: "unit", locality: "city-zip" },
  { host: "compass.com", street: "full", unit: "hash", locality: "city-zip" },
  { host: "zillow.com", street: "short", unit: "apt", locality: "city-zip" },
  { host: "trulia.com", street: "full", unit: "unit", locality: "zip" },
  { host: "bhhsfloridarealty.com", street: "short", unit: "bare", locality: "city" },
  { host: null, street: "short", unit: "bare", locality: "zip" },
  { host: "coldwellbankerhomes.com", street: "full", unit: "unit", locality: "zip" },
  { host: "redfin.com", street: "short", unit: "unit", locality: "zip" },
];

function unitPhrase(unit, style) {
  if (!unit) return "";
  return { unit: ` "Unit ${unit}"`, apt: ` "Apt ${unit}"`, hash: ` "#${unit}"`, bare: ` "${unit}"` }[style];
}

// Address-format variants (Unit/Apt/#, suffix spelled out or abbreviated,
// USPS city vs ZIP) paired with host-targeted site: queries.
export function hostTargetedQueries(address, hosts = DEFAULT_FEE_HOSTS, { alternateCity = null } = {}) {
  const forms = streetForms(address);
  const city = titleCase(alternateCity ?? address.city ?? "");
  const postal = address.postal ?? "";
  return hosts.map(({ host, street, unit, locality }) => {
    const where =
      locality === "city-zip" ? `${city} FL ${postal}` : locality === "city" ? `${city} FL` : host ? postal : `FL ${postal}`;
    const base = `"${forms[street]}"${unitPhrase(address.unit, unit)} ${where}`.replace(/\s+/g, " ").trim();
    return {
      host: host ?? "general",
      query: host ? `${base} site:${host}` : `${base} "HOA" OR "association fee"`,
    };
  });
}
