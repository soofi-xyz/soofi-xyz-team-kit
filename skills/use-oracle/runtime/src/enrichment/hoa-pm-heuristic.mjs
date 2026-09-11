import { createHash } from "node:crypto";

const HOA_NAME_MARKERS =
  /\b(HOMEOWNERS?\s+ASSOCIATION|HOMEOWNERS?\s+ASSN|HOA|COMMUNITY\s+ASSOCIATION|PROPERTY\s+OWNERS?\s+ASSOCIATION)\b/;

export const HOA_PM_SCHEMA_VERSION = "elephant.hoa-pm-heuristic.v1";

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

function subdivisionMatchNames(subdivision) {
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

export function findHoaCompanies(subdivision, companies) {
  const subdivisionNames = subdivisionMatchNames(subdivision);
  if (subdivisionNames.length === 0) {
    return { status: "no_subdivision", matches: [] };
  }
  const matches = companies.filter((company) => {
    if (company.status && company.status !== "ACTIVE") return false;
    const entityName = normalizeEntityName(company.entityName);
    if (!entityName) return false;
    if (!subdivisionNames.some((name) => entityName.includes(name))) return false;
    return HOA_NAME_MARKERS.test(entityName) || subdivisionNames.includes(entityName);
  });
  const unique = uniqueByDocument(matches);
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

export function resolveHoaAndPropertyManagement({ subdivision, companies }) {
  const hoaSearch = findHoaCompanies(subdivision, companies);
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
