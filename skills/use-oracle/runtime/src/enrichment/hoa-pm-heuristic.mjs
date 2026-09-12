import { createHash } from "node:crypto";

const HOA_NAME_MARKERS =
  /\b(HOMEOWNERS?(?:\s+S)?\s+(?:ASSOCIATION|ASSOC|ASSN)|CONDOMINIUM\s+ASSOCIATION|PROPERTY\s+OWNERS?\s+(?:ASSOCIATION|ASSOC|ASSN)|COMMUNITY\s+(?:ASSOCIATION|ASSOC|ASSN)|CIVIC\s+(?:ASSOCIATION|ASSOC|ASSN)|ASSOCIATION|ASSOC|ASSN|POA|COA|HOA)\b/;

const WORD_NUMBERS = new Map([
  ["ONE", "1"],
  ["TWO", "2"],
  ["THREE", "3"],
  ["FOUR", "4"],
  ["FIVE", "5"],
  ["SIX", "6"],
  ["SEVEN", "7"],
  ["EIGHT", "8"],
  ["NINE", "9"],
  ["TEN", "10"],
  ["ELEVEN", "11"],
  ["TWELVE", "12"],
  ["THIRTEEN", "13"],
  ["FOURTEEN", "14"],
  ["FIFTEEN", "15"],
  ["SIXTEEN", "16"],
  ["SEVENTEEN", "17"],
  ["EIGHTEEN", "18"],
  ["NINETEEN", "19"],
  ["TWENTY", "20"],
]);

const TRAILING_DESIGNATORS = new Set([
  "UNIT",
  "PHASE",
  "SECTION",
  "PARCEL",
  "NBHD",
  "VLG",
]);

const ASSOCIATION_SUFFIX_PATTERNS = [
  ["PROPERTY", "OWNER", "ASSOCIATION"],
  ["PROPERTY", "OWNERS", "ASSOCIATION"],
  ["COMMUNITY", "ASSOCIATION"],
  ["CIVIC", "ASSOCIATION"],
  ["CONDOMINIUM", "ASSOCIATION"],
  ["HOMEOWNER", "S", "ASSOCIATION"],
  ["HOMEOWNERS", "S", "ASSOCIATION"],
  ["HOMEOWNER", "ASSOCIATION"],
  ["HOMEOWNERS", "ASSOCIATION"],
  ["PROPERTY", "OWNER", "ASSOC"],
  ["PROPERTY", "OWNERS", "ASSOC"],
  ["PROPERTY", "OWNER", "ASSN"],
  ["PROPERTY", "OWNERS", "ASSN"],
  ["HOMEOWNER", "S", "ASSOC"],
  ["HOMEOWNERS", "S", "ASSOC"],
  ["HOMEOWNER", "S", "ASSN"],
  ["HOMEOWNERS", "S", "ASSN"],
  ["HOMEOWNER", "ASSOC"],
  ["HOMEOWNERS", "ASSOC"],
  ["HOMEOWNER", "ASSN"],
  ["HOMEOWNERS", "ASSN"],
  ["ASSOCIATION"],
  ["ASSOC"],
  ["ASSN"],
  ["POA"],
  ["COA"],
  ["HOA"],
];

export const HOA_PM_SCHEMA_VERSION = "elephant.hoa-pm-heuristic.v2";

export function normalizeEntityName(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function objectCid(payload) {
  const body = JSON.stringify(payload);
  const digest = createHash("sha256").update(body).digest("hex");
  return `sha256:${digest}`;
}

function uniqueByDocument(matches) {
  const documents = new Map();
  for (const match of matches) {
    documents.set(match.documentNumber, match);
  }
  return [...documents.values()];
}

const LEGACY_HOA_NAME_MARKERS =
  /\b(HOMEOWNERS?\s+ASSOCIATION|HOMEOWNERS?\s+ASSN|HOA|COMMUNITY\s+ASSOCIATION|PROPERTY\s+OWNERS?\s+ASSOCIATION)\b/;

function legacySubdivisionMatchNames(subdivision) {
  const normalized = normalizeEntityName(subdivision);
  if (!normalized) return [];
  const tokens = normalized.split(" ");
  const stripped = [...tokens];
  if (/^\d{3,6}$/.test(stripped[0] ?? "")) stripped.shift();
  if (/^\d{1,3}$/.test(stripped.at(-1) ?? "")) {
    stripped.pop();
    if (/^(BLK|BLOCK|LOT|PHASE|SEC|SECTION|TRACT|UNIT)$/.test(stripped.at(-1) ?? "")) {
      stripped.pop();
    }
  }
  const conservativeBase = stripped.join(" ");
  const alphaTokens = stripped.filter((token) => /[A-Z]/.test(token));
  return conservativeBase !== normalized && alphaTokens.length >= 2
    ? [normalized, conservativeBase]
    : [normalized];
}

function normalizeComparisonTokens(value) {
  return normalizeEntityName(value)
    .split(" ")
    .filter(Boolean)
    .map((token) => {
      if (token === "PH") return "PHASE";
      if (token === "SEC") return "SECTION";
      return WORD_NUMBERS.get(token) ?? token.replace(/^0+(?=\d)/, "");
    });
}

function hasAtLeastTwoAlphaTokens(tokens) {
  return tokens.filter((token) => /[A-Z]/.test(token)).length >= 2;
}

function withoutTrailingSubdivisionDesignator(tokens) {
  const stripped = [...tokens];
  let changed = false;
  if (stripped.at(-1) === "REPLAT") {
    stripped.pop();
    if (stripped.at(-1) === "PARTIAL") stripped.pop();
    changed = true;
  } else {
    const trailing = stripped.at(-1) ?? "";
    const hasNumber = /^\d+[A-Z]?$/.test(trailing);
    if (hasNumber) {
      stripped.pop();
      changed = true;
      if (TRAILING_DESIGNATORS.has(stripped.at(-1))) stripped.pop();
    }
  }
  return changed && hasAtLeastTwoAlphaTokens(stripped) ? stripped : tokens;
}

function subdivisionMatchNames(subdivision) {
  const normalized = normalizeEntityName(subdivision);
  if (!normalized) return [];
  const stripped = normalizeComparisonTokens(subdivision);
  if (/^\d{3,6}$/.test(stripped[0] ?? "")) stripped.shift();
  if (stripped.at(-1) === "CONDOMINIUM" && hasAtLeastTwoAlphaTokens(stripped.slice(0, -1))) {
    stripped.pop();
  }
  const base = withoutTrailingSubdivisionDesignator(stripped).join(" ");
  return [...new Set([normalized, stripped.join(" "), base].filter(Boolean))];
}

function endsWithTokens(tokens, suffix) {
  return (
    tokens.length >= suffix.length &&
    suffix.every((token, index) => tokens[tokens.length - suffix.length + index] === token)
  );
}

function associationBaseName(entityName) {
  const tokens = normalizeComparisonTokens(entityName);
  if (tokens[0] === "THE") tokens.shift();
  while (tokens.at(-1) === "INC" || tokens.at(-1) === "INCORPORATED") tokens.pop();
  for (const suffix of ASSOCIATION_SUFFIX_PATTERNS) {
    if (!endsWithTokens(tokens, suffix)) continue;
    tokens.splice(tokens.length - suffix.length);
    return withoutTrailingSubdivisionDesignator(tokens).join(" ");
  }
  return null;
}

function normalizedCounty(value) {
  return normalizeEntityName(value)
    .replace(/\bCOUNTY\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function companyCounty(company) {
  return normalizedCounty(
    company.principalAddress?.county ??
      company.principalCounty ??
      company.county ??
      "",
  );
}

function compareDuplicateFilings(left, right) {
  const leftDate = Date.parse(left.filedDate ?? "");
  const rightDate = Date.parse(right.filedDate ?? "");
  if (Number.isFinite(leftDate) && Number.isFinite(rightDate) && leftDate !== rightDate) {
    return leftDate - rightDate;
  }
  return String(left.documentNumber).localeCompare(String(right.documentNumber));
}

// Sunbiz occasionally carries duplicate ACTIVE filings for one identical legal name.
// Collapse only byte-equivalent normalized legal names that matched the same subdivision,
// retaining the earliest filed date when available, then the lower document number.
function collapseDuplicateLegalNames(matches) {
  const byLegalName = new Map();
  for (const match of matches) {
    const key = normalizeEntityName(match.entityName);
    const previous = byLegalName.get(key);
    if (!previous || compareDuplicateFilings(match, previous) < 0) {
      byLegalName.set(key, match);
    }
  }
  return [...byLegalName.values()];
}

function resolveCandidateSet(matches, countyKey) {
  const unique = collapseDuplicateLegalNames(uniqueByDocument(matches));
  if (unique.length <= 1) return unique;
  const parcelCounty = normalizedCounty(countyKey);
  if (!parcelCounty) return unique;
  const sameCounty = unique.filter((company) => companyCounty(company) === parcelCounty);
  const unknownCounty = unique.filter((company) => !companyCounty(company));
  return sameCounty.length === 1 && unknownCounty.length === 0 ? sameCounty : unique;
}

const hoaIndexCache = new WeakMap();

function hoaCompanyIndex(companies) {
  const cached = hoaIndexCache.get(companies);
  if (cached) return cached;
  const indexed = [];
  const byBase = new Map();
  for (const company of companies) {
    if (company.status && company.status !== "ACTIVE") continue;
    const entityName = normalizeEntityName(company.entityName);
    if (!entityName) continue;
    const base = associationBaseName(company.entityName);
    indexed.push({
      company,
      entityName,
      base,
      legacyMarker: LEGACY_HOA_NAME_MARKERS.test(entityName),
    });
    if (!base) continue;
    const matches = byBase.get(base);
    if (matches) matches.push(company);
    else byBase.set(base, [company]);
  }
  const index = { indexed, byBase };
  hoaIndexCache.set(companies, index);
  return index;
}

export function createHoaSubdivisionMatcher(subdivisions) {
  const legacyNames = [
    ...new Set(
      subdivisions.flatMap((subdivision) =>
        legacySubdivisionMatchNames(subdivision),
      ),
    ),
  ];
  const legacyNamesByFirstToken = new Map();
  for (const name of legacyNames) {
    const firstToken = name.split(" ", 1)[0];
    const names = legacyNamesByFirstToken.get(firstToken);
    if (names) names.push(name);
    else legacyNamesByFirstToken.set(firstToken, [name]);
  }
  const normalizedBases = new Set(
    subdivisions
      .flatMap((subdivision) => subdivisionMatchNames(subdivision))
      .map((name) =>
        withoutTrailingSubdivisionDesignator(
          normalizeComparisonTokens(name),
        ).join(" "),
      )
      .filter(Boolean),
  );
  return (company) => {
    if (company.status && company.status !== "ACTIVE") return false;
    const entityName = normalizeEntityName(company.entityName);
    if (!entityName) return false;
    const candidateLegacyNames = new Set(
      entityName
        .split(" ")
        .flatMap((token) => legacyNamesByFirstToken.get(token) ?? []),
    );
    if (
      [...candidateLegacyNames].some((name) => entityName.includes(name)) &&
      (LEGACY_HOA_NAME_MARKERS.test(entityName) ||
        candidateLegacyNames.has(entityName))
    ) {
      return true;
    }
    const base = associationBaseName(entityName);
    return base !== null && normalizedBases.has(base);
  };
}

export function findHoaCompanies(subdivision, companies, { countyKey } = {}) {
  const legacyNames = legacySubdivisionMatchNames(subdivision);
  if (legacyNames.length === 0) {
    return { status: "no_subdivision", matches: [] };
  }
  const { indexed, byBase } = hoaCompanyIndex(companies);
  const legacyMatches = [];
  for (const record of indexed) {
    if (!legacyNames.some((name) => record.entityName.includes(name))) continue;
    if (record.legacyMarker || legacyNames.includes(record.entityName)) {
      legacyMatches.push(record.company);
    }
  }
  const legacyUnique = resolveCandidateSet(legacyMatches, countyKey);
  if (legacyUnique.length === 1) return { status: "matched", matches: legacyUnique };
  if (legacyUnique.length > 1) return { status: "not_unique", matches: legacyUnique };

  const subdivisionBases = new Set(
    subdivisionMatchNames(subdivision).map((name) =>
      withoutTrailingSubdivisionDesignator(normalizeComparisonTokens(name)).join(" "),
    ),
  );
  const normalizedMatches = [];
  for (const base of subdivisionBases) {
    if (!base) continue;
    const matches = byBase.get(base);
    if (!matches) continue;
    for (const company of matches) {
      const entityName = normalizeEntityName(company.entityName);
      if (HOA_NAME_MARKERS.test(entityName)) normalizedMatches.push(company);
    }
  }
  const unique = resolveCandidateSet(normalizedMatches, countyKey);
  if (unique.length === 0) return { status: "no_sunbiz_hoa", matches: [] };
  if (unique.length > 1) return { status: "not_unique", matches: unique };
  return { status: "matched", matches: unique };
}

function registeredAgentCompanyName(hoaCompany) {
  const agent = hoaCompany.registeredAgent;
  if (!agent || typeof agent.name !== "string") return null;
  const name = normalizeEntityName(agent.name);
  if (!name) return null;
  const type = String(agent.type ?? "").toUpperCase();
  if (type === "P" || type === "PERSON") return null;
  return agent.name.trim();
}

export function findPropertyManagementCompany(hoaCompany, companies) {
  const agentName = registeredAgentCompanyName(hoaCompany);
  if (!agentName) {
    return { status: "no_agent_company", matches: [] };
  }
  const normalizedAgent = normalizeEntityName(agentName);
  const matches = companies.filter((company) => {
    if (company.status && company.status !== "ACTIVE") return false;
    if (company.documentNumber === hoaCompany.documentNumber) return false;
    return normalizeEntityName(company.entityName) === normalizedAgent;
  });
  const unique = uniqueByDocument(matches);
  if (unique.length === 0) return { status: "agent_not_in_sunbiz", matches: [] };
  if (unique.length > 1) return { status: "not_unique", matches: unique };
  return { status: "matched", matches: unique };
}

function companyObject(company, dataGroup) {
  const payload = {
    data_group: dataGroup,
    type: "company",
    name: company.entityName ?? null,
    sunbiz_document_number: company.documentNumber,
    source_http_request: {
      method: "GET",
      url: "https://dos.fl.gov/sunbiz/other-services/data-downloads/",
    },
    request_identifier: `sunbiz:${company.documentNumber}:company`,
  };
  return { ...payload, cid: objectCid(payload) };
}

function hoaObject({ company, companyCid, propertyManagerCid }) {
  const payload = {
    data_group: "HOA_",
    type: "homeowners_association",
    homeowners_association_name: company.entityName ?? null,
    sunbiz_document_number: company.documentNumber,
    company_cid: companyCid,
    property_manager_cid: propertyManagerCid,
    source_http_request: {
      method: "GET",
      url: "https://dos.fl.gov/sunbiz/other-services/data-downloads/",
    },
    request_identifier: `sunbiz:${company.documentNumber}:homeowners_association`,
  };
  return { ...payload, cid: objectCid(payload) };
}

export function resolveHoaAndPropertyManagement({ subdivision, companies, countyKey }) {
  const hoaSearch = findHoaCompanies(subdivision, companies, { countyKey });
  if (hoaSearch.status !== "matched") {
    return {
      status: hoaSearch.status,
      hoa: null,
      hoaCompany: null,
      propertyManagement: null,
      propertyManagementCompany: null,
    };
  }
  const hoaCompany = hoaSearch.matches[0];
  const hoaCompanyObject = companyObject(hoaCompany, "HOA_");
  const pmSearch = findPropertyManagementCompany(hoaCompany, companies);
  const propertyManagementCompany =
    pmSearch.status === "matched" ? pmSearch.matches[0] : null;
  const propertyManagement =
    propertyManagementCompany === null
      ? null
      : companyObject(propertyManagementCompany, "Property_Management");
  const hoa = hoaObject({
    company: hoaCompany,
    companyCid: hoaCompanyObject.cid,
    propertyManagerCid: propertyManagement?.cid ?? null,
  });
  return {
    status: pmSearch.status,
    hoa,
    hoaCompany: hoaCompanyObject,
    propertyManagement,
    propertyManagementCompany,
  };
}

export function stampPropertyCids(property, resolution) {
  return {
    ...property,
    hoa_cid: resolution.hoa?.cid ?? null,
    hoa_name: resolution.hoa?.homeowners_association_name ?? null,
    hoa_sunbiz_document_number: resolution.hoa?.sunbiz_document_number ?? null,
    property_manager_cid: resolution.propertyManagement?.cid ?? null,
    property_manager_name: resolution.propertyManagement?.name ?? null,
    property_manager_sunbiz_document_number:
      resolution.propertyManagement?.sunbiz_document_number ?? null,
    hoa_pm_status: resolution.status,
  };
}
