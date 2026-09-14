import { createHash } from "node:crypto";

import {
  findCtmhManagingEntityCompany,
  joinCtmhToSunbiz,
  ctmhSourceRequest,
  probeCtmhAssociations,
} from "./ctmh-condo.mjs";

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

export const HOA_PM_SCHEMA_VERSION = "elephant.hoa-pm-heuristic.v7";

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

const LEGAL_SKIP_PATTERN =
  /\b(BEGINNING|THENCE|RECORDED W OUT LEGAL|INCORRECT LEGAL|BEING PART|INT IN)\b/;
const METES_PATTERN = /\b(COM|RUN)\b.+\b(FT|FEET)\b/;
const SINGLE_TOKEN_STOPWORDS = new Set([
  "LOT",
  "LOTS",
  "BLOCK",
  "UNIT",
  "PHASE",
  "SECTION",
  "PARCEL",
  "SUBDIVISION",
  "SUB",
  "REPLAT",
  "PUD",
  "ACRES",
  "ACREAGE",
  "TOWN",
  "CITY",
  "COUNTY",
  "PARK",
  "LAKE",
  "LAKES",
  "OAKS",
  "WOODS",
  "HILLS",
  "GROVE",
  "ESTATES",
  "HEIGHTS",
  "VILLAGE",
  "VILLAGES",
]);

function preprocessLegalSubdivision(value) {
  return String(value ?? "")
    .replace(/\bS\/D\b/gi, " SUBDIVISION ")
    .replace(/\bSUBD\b/gi, " SUBDIVISION ")
    .replace(/\bU-(\d+[A-Z]?)\b/gi, " UNIT $1 ");
}

function isNumericToken(token) {
  return /^\d+[A-Z]?$/.test(token);
}

function isSectionTownshipRange(tokens, normalized = "") {
  const text = `${tokens.join(" ")} ${normalized}`;
  return (
    /\b(SEC|SECTION)\b/.test(text) &&
    /\b(TWP|TOWNSHIP)\b/.test(text) &&
    /\b(RGE|RANGE|RNG)\b/.test(text)
  );
}

function isUnparseableLegal(normalized) {
  return LEGAL_SKIP_PATTERN.test(normalized) || METES_PATTERN.test(normalized);
}

function stripLeadingLegalPrefixes(tokens) {
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === "LOT" || token === "LOTS") {
      index += 1;
      while (
        index < tokens.length &&
        (isNumericToken(tokens[index]) ||
          tokens[index] === "AND" ||
          tokens[index] === "THRU" ||
          /^[A-Z]$/.test(tokens[index]))
      ) {
        index += 1;
      }
      if (tokens[index] === "OF") index += 1;
      continue;
    }
    if (token === "BLK" || token === "BLOCK" || token === "PARCEL") {
      index += 1;
      if (index < tokens.length) index += 1;
      continue;
    }
    if (token === "AC" || token === "ACRE" || token === "ACRES" || token === "ACREAGE") {
      index += 1;
      continue;
    }
    if (isNumericToken(token) && index + 1 < tokens.length && /[A-Z]/.test(tokens[index + 1])) {
      index += 1;
      continue;
    }
    if (
      isNumericToken(token) &&
      index + 1 < tokens.length &&
      isNumericToken(tokens[index + 1])
    ) {
      index += 2;
      if (index < tokens.length && isNumericToken(tokens[index])) index += 1;
      continue;
    }
    if (
      ["E", "W", "N", "S", "NE", "NW", "SE", "SW", "NORTH", "SOUTH", "EAST", "WEST"].includes(
        token,
      ) &&
      tokens[index + 1] === "1" &&
      tokens[index + 2] === "2"
    ) {
      index += 3;
      if (tokens[index] === "OF") index += 1;
      continue;
    }
    if ((token === "ALL" || token === "PT" || token === "PART") && tokens[index + 1] === "OF") {
      index += 2;
      continue;
    }
    if (token === "THE") {
      index += 1;
      continue;
    }
    break;
  }
  return tokens.slice(index);
}

function stripTrailingLegalSuffixes(tokens) {
  const stripped = [...tokens];
  const cite = new Set(["PB", "PG", "PGS", "MB", "OR", "REC", "AS", "PUD", "MAP", "BOOK", "PAGE", "PAGES"]);
  let changed = true;
  while (changed && stripped.length > 0) {
    changed = false;
    const last = stripped.at(-1);
    if (last === "SUBDIVISION" || last === "SUB" || last === "SUBD" || last === "SD") {
      stripped.pop();
      changed = true;
      continue;
    }
    if (last === "CONDO" || last === "CONDOS" || last === "CONDOMINIUM") {
      stripped.pop();
      changed = true;
      continue;
    }
    if (last === "PHASE" || last === "UNIT" || last === "SECTION") {
      stripped.pop();
      changed = true;
      continue;
    }
    if (stripped.length >= 2 && (stripped.at(-2) === "LOT" || stripped.at(-2) === "LOTS") && isNumericToken(last)) {
      stripped.pop();
      stripped.pop();
      changed = true;
      continue;
    }
    if (
      stripped.length >= 2 &&
      /^[A-Z]$/.test(last) &&
      (cite.has(stripped.at(-2)) || isNumericToken(stripped.at(-2)))
    ) {
      stripped.pop();
      changed = true;
      continue;
    }
    if (stripped.length >= 2 && cite.has(stripped.at(-2))) {
      stripped.pop();
      stripped.pop();
      changed = true;
      continue;
    }
    if (cite.has(last) || isNumericToken(last)) {
      stripped.pop();
      if (cite.has(stripped.at(-1))) stripped.pop();
      if (stripped.at(-1) === "NO") stripped.pop();
      changed = true;
    }
  }
  return stripped;
}

function isViableCommunityName(tokens) {
  const alpha = tokens.filter((token) => /[A-Z]/.test(token));
  if (alpha.length >= 2) return true;
  if (alpha.length === 1) {
    const token = alpha[0];
    return token.length >= 5 && !SINGLE_TOKEN_STOPWORDS.has(token);
  }
  return false;
}

export function extractCommunityNameFromSubdivision(subdivision) {
  const preprocessed = preprocessLegalSubdivision(subdivision);
  const normalized = normalizeEntityName(preprocessed);
  if (!normalized) return null;
  const tokens = normalizeComparisonTokens(preprocessed);
  if (isSectionTownshipRange(tokens, normalized) || isUnparseableLegal(normalized)) return null;
  const stripped = stripTrailingLegalSuffixes(stripLeadingLegalPrefixes(tokens));
  if (/^\d{3,6}$/.test(stripped[0] ?? "")) stripped.shift();
  const withoutUnit = withoutTrailingSubdivisionDesignator(stripped);
  if (isSectionTownshipRange(withoutUnit, withoutUnit.join(" "))) return null;
  if (!isViableCommunityName(withoutUnit)) return null;
  const extracted = withoutUnit.join(" ");
  return extracted === normalized ? null : extracted;
}

function endsWithTokens(tokens, suffix) {
  return (
    tokens.length >= suffix.length &&
    suffix.every((token, index) => tokens[tokens.length - suffix.length + index] === token)
  );
}

export function hasHoaNameMarker(entityName) {
  return HOA_NAME_MARKERS.test(normalizeEntityName(entityName));
}

export function subdivisionSearchKeys(subdivision) {
  const keys = new Set();
  for (const name of subdivisionMatchNames(subdivision)) {
    keys.add(name);
    keys.add(withoutTrailingSubdivisionDesignator(normalizeComparisonTokens(name)).join(" "));
  }
  const extracted = extractCommunityNameFromSubdivision(subdivision);
  if (extracted) {
    keys.add(extracted);
    keys.add(
      withoutTrailingSubdivisionDesignator(normalizeComparisonTokens(extracted)).join(" "),
    );
  }
  keys.delete("");
  return keys;
}

export function associationBaseName(entityName) {
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

export function normalizeOwnershipEstateType(value) {
  const normalized = normalizeEntityName(value).replace(/\s+/g, "");
  if (normalized === "CONDOMINIUM" || normalized === "CONDO") return "Condominium";
  if (normalized === "FEESIMPLE") return "FeeSimple";
  if (normalized === "LEASEHOLD") return "Leasehold";
  if (normalized === "COOPERATIVE" || normalized === "COOP") return "Cooperative";
  if (normalized === "TIMESHARE") return "Timeshare";
  return null;
}

function sourceLooksLikeCondo(subdivision) {
  return /\bCONDO(?:MINIUM)?S?\b/.test(normalizeEntityName(subdivision));
}

function companyLooksLikeCondo(company) {
  return /\bCONDOMINIUM\s+ASSOCIATION\b/.test(normalizeEntityName(company?.entityName));
}

function companyAllowedForEstate(company, estate) {
  if (!estate) return true;
  const condo = companyLooksLikeCondo(company);
  return estate === "Condominium" ? condo : !condo;
}

function rejectCondoUnlessSourceSaysCondo(matches, subdivision, extracted, estate) {
  if (estate || !extracted || sourceLooksLikeCondo(subdivision)) return matches;
  return matches.filter((company) => !companyLooksLikeCondo(company));
}

export function homeownersAssociationType(company, estate, ctmhKind) {
  if (ctmhKind === "condominium" || estate === "Condominium" || companyLooksLikeCondo(company)) {
    return "Condominium";
  }
  if (ctmhKind === "cooperative" || estate === "Cooperative") return "Cooperative";
  if (ctmhKind === "timeshare" || estate === "Timeshare") return "Timeshare";
  return "Homeowners";
}

export function findHoaCompanies(subdivision, companies, { countyKey, ownershipEstateType } = {}) {
  const legacyNames = legacySubdivisionMatchNames(subdivision);
  if (legacyNames.length === 0) {
    return { status: "no_subdivision", matches: [], source: "sunbiz" };
  }
  const estate = normalizeOwnershipEstateType(ownershipEstateType);
  const extracted = extractCommunityNameFromSubdivision(subdivision);
  const { indexed, byBase } = hoaCompanyIndex(companies);
  const legacyMatches = [];
  for (const record of indexed) {
    if (!companyAllowedForEstate(record.company, estate)) continue;
    if (!legacyNames.some((name) => record.entityName.includes(name))) continue;
    if (record.legacyMarker || legacyNames.includes(record.entityName)) {
      legacyMatches.push(record.company);
    }
  }
  const legacyUnique = rejectCondoUnlessSourceSaysCondo(
    resolveCandidateSet(legacyMatches, countyKey),
    subdivision,
    extracted,
    estate,
  );
  if (legacyUnique.length === 1) {
    return { status: "matched", matches: legacyUnique, source: "sunbiz" };
  }
  if (legacyUnique.length > 1) {
    return { status: "not_unique", matches: legacyUnique, source: "sunbiz" };
  }

  const subdivisionBases = new Set(
    subdivisionMatchNames(subdivision).map((name) =>
      withoutTrailingSubdivisionDesignator(normalizeComparisonTokens(name)).join(" "),
    ),
  );
  if (extracted) {
    subdivisionBases.add(extracted);
    subdivisionBases.add(
      withoutTrailingSubdivisionDesignator(normalizeComparisonTokens(extracted)).join(" "),
    );
  }
  const normalizedMatches = [];
  for (const base of subdivisionBases) {
    if (!base) continue;
    const matches = byBase.get(base);
    if (!matches) continue;
    for (const company of matches) {
      if (!companyAllowedForEstate(company, estate)) continue;
      const entityName = normalizeEntityName(company.entityName);
      if (HOA_NAME_MARKERS.test(entityName)) normalizedMatches.push(company);
    }
  }
  const unique = rejectCondoUnlessSourceSaysCondo(
    resolveCandidateSet(normalizedMatches, countyKey),
    subdivision,
    extracted,
    estate,
  );
  if (unique.length === 0) return { status: "no_sunbiz_hoa", matches: [], source: "sunbiz" };
  if (unique.length > 1) return { status: "not_unique", matches: unique, source: "sunbiz" };
  return { status: "matched", matches: unique, source: "sunbiz" };
}

export function searchHoaAssociation(
  subdivision,
  { companies = [], ctmhRecords = null, countyKey, ownershipEstateType } = {},
) {
  const estate = normalizeOwnershipEstateType(ownershipEstateType);
  const ctmhSearch = probeCtmhAssociations(subdivision, ctmhRecords, {
    countyKey,
    ownershipEstateType: estate,
  });
  if (ctmhSearch.status === "matched") {
    return { ...ctmhSearch, ctmhStatus: "matched" };
  }
  const sunbiz = findHoaCompanies(subdivision, companies, {
    countyKey,
    ownershipEstateType: estate,
  });
  return { ...sunbiz, ctmhStatus: ctmhSearch.status };
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

function sunbizCompanyObject(company, dataGroup) {
  const payload = {
    data_group: dataGroup,
    type: "company",
    name: company.entityName ?? null,
    sunbiz_document_number: company.documentNumber ?? null,
    source_http_request: {
      method: "GET",
      url: "https://dos.fl.gov/sunbiz/other-services/data-downloads/",
    },
    request_identifier: `sunbiz:${company.documentNumber}:company`,
  };
  return { ...payload, cid: objectCid(payload) };
}

function ctmhCompanyObject(record, dataGroup) {
  const payload = {
    data_group: dataGroup,
    type: "company",
    name: record.managingEntityName || record.name || null,
    sunbiz_document_number: null,
    ctmh_project_number: record.projectNumber ?? null,
    ctmh_managing_entity_number: record.managingEntityNumber ?? null,
    source_http_request: ctmhSourceRequest(),
    request_identifier: `ctmh:${record.projectNumber}:company`,
  };
  return { ...payload, cid: objectCid(payload) };
}

function hoaObject({
  name,
  associationType,
  sunbizDocumentNumber,
  ctmhProjectNumber,
  companyCid,
  propertyManagerCid,
  request,
  requestIdentifier,
}) {
  const payload = {
    data_group: "HOA_",
    type: "homeowners_association",
    homeowners_association_name: name ?? null,
    homeowners_association_type: associationType ?? null,
    sunbiz_document_number: sunbizDocumentNumber ?? null,
    ctmh_project_number: ctmhProjectNumber ?? null,
    company_cid: companyCid,
    property_manager_cid: propertyManagerCid,
    source_http_request: request,
    request_identifier: requestIdentifier,
  };
  return { ...payload, cid: objectCid(payload) };
}

function resolveCtmhPropertyManagement(record, companies, hoaCompany) {
  if (hoaCompany?.documentNumber) {
    const raSearch = findPropertyManagementCompany(hoaCompany, companies);
    if (raSearch.status === "matched") return raSearch;
    const managerSearch = findCtmhManagingEntityCompany(record, companies, hoaCompany);
    if (managerSearch.status === "matched") return managerSearch;
    return raSearch;
  }
  return findCtmhManagingEntityCompany(record, companies, hoaCompany);
}

export function resolveHoaAndPropertyManagement({
  subdivision,
  companies,
  pmCompanies = null,
  countyKey,
  ownershipEstateType,
  ctmhRecords = null,
}) {
  const estate = normalizeOwnershipEstateType(ownershipEstateType);
  const pmPool = pmCompanies ?? companies;
  const hoaSearch = searchHoaAssociation(subdivision, {
    companies,
    ctmhRecords,
    countyKey,
    ownershipEstateType,
  });
  const ctmhStatus = hoaSearch.ctmhStatus ?? (hoaSearch.source === "ctmh" ? hoaSearch.status : null);
  if (hoaSearch.status !== "matched") {
    return {
      status: hoaSearch.status,
      hoa: null,
      hoaCompany: null,
      propertyManagement: null,
      propertyManagementCompany: null,
      source: hoaSearch.source ?? null,
      sunbizJoinStatus: null,
      ctmhStatus,
    };
  }

  if (hoaSearch.source === "ctmh") {
    const ctmhRecord = hoaSearch.matches[0];
    const sunbizJoin = joinCtmhToSunbiz(ctmhRecord, companies);
    const hoaCompany = sunbizJoin.status === "matched" ? sunbizJoin.matches[0] : null;
    const hoaCompanyObject = hoaCompany
      ? sunbizCompanyObject(hoaCompany, "HOA_")
      : ctmhCompanyObject(ctmhRecord, "HOA_");
    const pmSearch = resolveCtmhPropertyManagement(ctmhRecord, pmPool, hoaCompany);
    const propertyManagementCompany =
      pmSearch.status === "matched" ? pmSearch.matches[0] : null;
    const propertyManagement =
      propertyManagementCompany === null
        ? null
        : sunbizCompanyObject(propertyManagementCompany, "Property_Management");
    const hoa = hoaObject({
      name: hoaCompany?.entityName || ctmhRecord.managingEntityName || ctmhRecord.name,
      associationType: homeownersAssociationType(hoaCompany, estate, ctmhRecord.kind),
      sunbizDocumentNumber: hoaCompany?.documentNumber ?? null,
      ctmhProjectNumber: ctmhRecord.projectNumber,
      companyCid: hoaCompanyObject.cid,
      propertyManagerCid: propertyManagement?.cid ?? null,
      request: ctmhSourceRequest(),
      requestIdentifier: `ctmh:${ctmhRecord.projectNumber}:homeowners_association`,
    });
    const status =
      sunbizJoin.status === "matched"
        ? pmSearch.status
        : sunbizJoin.status;
    return {
      status,
      hoa,
      hoaCompany: hoaCompanyObject,
      propertyManagement,
      propertyManagementCompany,
      source: "ctmh",
      sunbizJoinStatus: sunbizJoin.status,
      ctmhStatus,
    };
  }

  const hoaCompany = hoaSearch.matches[0];
  const hoaCompanyObject = sunbizCompanyObject(hoaCompany, "HOA_");
  const pmSearch = findPropertyManagementCompany(hoaCompany, pmPool);
  const propertyManagementCompany =
    pmSearch.status === "matched" ? pmSearch.matches[0] : null;
  const propertyManagement =
    propertyManagementCompany === null
      ? null
      : sunbizCompanyObject(propertyManagementCompany, "Property_Management");
  const hoa = hoaObject({
    name: hoaCompany.entityName,
    associationType: homeownersAssociationType(hoaCompany, estate),
    sunbizDocumentNumber: hoaCompany.documentNumber,
    ctmhProjectNumber: null,
    companyCid: hoaCompanyObject.cid,
    propertyManagerCid: propertyManagement?.cid ?? null,
    request: {
      method: "GET",
      url: "https://dos.fl.gov/sunbiz/other-services/data-downloads/",
    },
    requestIdentifier: `sunbiz:${hoaCompany.documentNumber}:homeowners_association`,
  });
  return {
    status: pmSearch.status,
    hoa,
    hoaCompany: hoaCompanyObject,
    propertyManagement,
    propertyManagementCompany,
    source: "sunbiz",
    sunbizJoinStatus: null,
    ctmhStatus,
  };
}

export function stampPropertyCids(property, resolution) {
  return {
    ...property,
    hoa_cid: resolution.hoa?.cid ?? null,
    hoa_name: resolution.hoa?.homeowners_association_name ?? null,
    homeowners_association_type: resolution.hoa?.homeowners_association_type ?? null,
    hoa_sunbiz_document_number: resolution.hoa?.sunbiz_document_number ?? null,
    hoa_ctmh_project_number: resolution.hoa?.ctmh_project_number ?? null,
    property_manager_cid: resolution.propertyManagement?.cid ?? null,
    property_manager_name: resolution.propertyManagement?.name ?? null,
    property_manager_sunbiz_document_number:
      resolution.propertyManagement?.sunbiz_document_number ?? null,
    hoa_pm_status: resolution.status,
  };
}
