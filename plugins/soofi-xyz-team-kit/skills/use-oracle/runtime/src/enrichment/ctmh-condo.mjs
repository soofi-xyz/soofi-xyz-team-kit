import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { parseCsvRecords } from "../core/csv.mjs";
import {
  associationBaseName,
  extractCommunityNameFromSubdivision,
  hasHoaNameMarker,
  normalizeEntityName,
  normalizeOwnershipEstateType,
  subdivisionSearchKeys,
} from "./hoa-pm-heuristic.mjs";

export const CTMH_PUBLIC_RECORDS_URL =
  "https://www2.myfloridalicense.com/condos-timeshares-mobile-homes/public-records/#1506105905579-f9864587-f7ca";

export const CTMH_OFFICIAL_FILES = {
  condominium: [
    {
      fileName: "Condo_NF.csv",
      url: "https://www2.myfloridalicense.com/sto/file_download/extracts/Condo_NF.csv",
    },
    {
      fileName: "condo_CE.csv",
      url: "https://www2.myfloridalicense.com/sto/file_download/extracts/condo_CE.csv",
    },
    {
      fileName: "Condo_CW.csv",
      url: "https://www2.myfloridalicense.com/sto/file_download/extracts/Condo_CW.csv",
    },
    {
      fileName: "Condo_MD.csv",
      url: "https://www2.myfloridalicense.com/sto/file_download/extracts/Condo_MD.csv",
    },
    {
      fileName: "condo_PB.csv",
      url: "https://www2.myfloridalicense.com/sto/file_download/extracts/condo_PB.csv",
    },
  ],
  cooperative: [
    {
      fileName: "coopmailing.csv",
      url: "https://www2.myfloridalicense.com/sto/file_download/extracts/coopmailing.csv",
    },
  ],
  timeshare: [
    {
      fileName: "tsmailing.csv",
      url: "https://www2.myfloridalicense.com/sto/file_download/extracts/tsmailing.csv",
    },
    {
      fileName: "multitsmailing.csv",
      url: "https://www2.myfloridalicense.com/sto/file_download/extracts/multitsmailing.csv",
    },
  ],
};

const REJECTED_STATUS = /\b(TERMINATED|REJECTED|WITHDRAWN)\b/;

const JOIN_SUFFIX_PATTERNS = [
  ["CONDOMINIUM", "ASSOCIATION"],
  ["CONDO", "ASSOCIATION"],
  ["CONDO", "ASSOC"],
  ["CONDO", "ASSN"],
  ["CONDOMINIUM"],
  ["CONDOS"],
  ["CONDO"],
  ["COOPERATIVE"],
  ["COOP"],
  ["TIMESHARE"],
];

export function emptyCtmhRecords() {
  return { condominium: [], cooperative: [], timeshare: [] };
}

export function ctmhSourceRequest() {
  return { method: "GET", url: CTMH_PUBLIC_RECORDS_URL };
}

function firstValue(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  const byNormalized = new Map(
    Object.entries(record).map(([key, value]) => [
      normalizeEntityName(key).replace(/\s+/g, ""),
      value,
    ]),
  );
  for (const key of keys) {
    const value = byNormalized.get(normalizeEntityName(key).replace(/\s+/g, ""));
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function unfoldTrailingThe(normalized) {
  const match = normalized.match(/^(.+) THE$/);
  if (!match) return [normalized];
  return [`THE ${match[1]}`, match[1], normalized];
}

function stripJoinSuffix(name) {
  const tokens = normalizeEntityName(name).split(" ").filter(Boolean);
  if (tokens[0] === "THE") tokens.shift();
  while (tokens.at(-1) === "INC" || tokens.at(-1) === "INCORPORATED") tokens.pop();
  for (const suffix of JOIN_SUFFIX_PATTERNS) {
    const start = tokens.length - suffix.length;
    if (start < 0) continue;
    if (suffix.every((token, index) => tokens[start + index] === token)) {
      tokens.splice(start);
      break;
    }
  }
  return tokens.join(" ").trim();
}

export function ctmhLegalKeys(name) {
  const keys = new Set();
  if (!name) return keys;
  for (const unfolded of unfoldTrailingThe(normalizeEntityName(name.replaceAll("#", " ")))) {
    keys.add(unfolded);
    const associationBase = associationBaseName(unfolded);
    if (associationBase) keys.add(associationBase);
    const stripped = stripJoinSuffix(unfolded);
    if (stripped) keys.add(stripped);
  }
  keys.delete("");
  return keys;
}

export function ctmhRecordMatchKeys(record) {
  const keys = new Set();
  for (const name of [record.name, record.managingEntityName]) {
    if (!name) continue;
    for (const key of ctmhLegalKeys(name)) keys.add(key);
    for (const key of subdivisionSearchKeys(name)) keys.add(key);
  }
  keys.delete("");
  return keys;
}

function countyAlias(value) {
  const normalized = normalizeEntityName(value)
    .replace(/\bCOUNTY\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized === "DADE" || normalized === "MIAMI DADE") return "MIAMI DADE";
  if (normalized === "ST JOHNS" || normalized === "SAINT JOHNS") return "ST JOHNS";
  if (normalized === "ST LUCIE" || normalized === "SAINT LUCIE") return "ST LUCIE";
  if (normalized === "DESOTO" || normalized === "DE SOTO") return "DESOTO";
  return normalized;
}

function countiesEquivalent(left, right) {
  const a = countyAlias(left);
  const b = countyAlias(right);
  return Boolean(a) && a === b;
}

function isRejectedStatus(record) {
  return REJECTED_STATUS.test(
    `${record.primaryStatus ?? ""} ${record.secondaryStatus ?? ""}`.toUpperCase(),
  );
}

function associationIdentity(record) {
  return (
    record.managingEntityNumber ||
    normalizeEntityName(record.managingEntityName) ||
    record.projectNumber ||
    record.fileNumber
  );
}

export function mapCtmhRow(row, { kind, sourceFile } = {}) {
  const name = firstValue(row, [
    "Condo Name",
    "COOP Name",
    "Coop Name",
    "TS Name",
    "Project Name",
    "Name",
  ]);
  const projectNumber = firstValue(row, ["Project Number"]);
  if (!name || !projectNumber) return null;
  const record = {
    kind: kind ?? "condominium",
    projectNumber,
    fileNumber: firstValue(row, ["File Number"]) || null,
    name,
    county: firstValue(row, ["County"]) || null,
    primaryStatus: firstValue(row, ["Primary Status", "Project Status Code"]) || null,
    secondaryStatus: firstValue(row, ["Secondary Status", "Secondary Status Code"]) || null,
    managingEntityNumber: firstValue(row, ["Managing Entity Number"]) || null,
    managingEntityName: firstValue(row, ["Managing Entity Name"]) || null,
    sourceFile: sourceFile ?? null,
  };
  if (isRejectedStatus(record)) return null;
  record.matchKeys = ctmhRecordMatchKeys(record);
  return record;
}

export function parseCtmhCsv(text, { kind = "condominium", sourceFile = null } = {}) {
  return parseCsvRecords(text)
    .map((row) => mapCtmhRow(row, { kind, sourceFile }))
    .filter(Boolean);
}

function detectKind(fileName) {
  const base = path.basename(fileName).toLowerCase();
  if (/paymenthist|condo_conv|noic|countysummary|developersummary|mhmailing|ysmailing/.test(base)) {
    return null;
  }
  if (base === "coopmailing.csv") return "cooperative";
  if (base === "tsmailing.csv" || base === "multitsmailing.csv") return "timeshare";
  if (/^condo_(nf|ce|cw|md|pb)\.csv$/.test(base)) return "condominium";
  return null;
}

export async function loadCtmhExtract(extractDir) {
  const records = emptyCtmhRecords();
  if (!extractDir) return records;
  const entries = await readdir(extractDir);
  for (const entry of entries) {
    const kind = detectKind(entry);
    if (!kind) continue;
    const sourceFile = path.join(extractDir, entry);
    const text = await readFile(sourceFile, "utf8");
    records[kind].push(...parseCtmhCsv(text, { kind, sourceFile: entry }));
  }
  return records;
}

const ctmhIndexCache = new WeakMap();

function ctmhKeyIndex(records) {
  const cached = ctmhIndexCache.get(records);
  if (cached) return cached;
  const byKey = new Map();
  for (const record of records) {
    for (const key of record.matchKeys ?? ctmhRecordMatchKeys(record)) {
      const matches = byKey.get(key);
      if (matches) matches.push(record);
      else byKey.set(key, [record]);
    }
  }
  ctmhIndexCache.set(records, byKey);
  return byKey;
}

export function allCtmhAssociationRecords(ctmhRecords) {
  const records = [];
  const seenProjects = new Set();
  for (const kind of ["condominium", "cooperative", "timeshare"]) {
    for (const record of ctmhRecords?.[kind] ?? []) {
      const projectNumber = record?.projectNumber;
      if (projectNumber) {
        if (seenProjects.has(projectNumber)) continue;
        seenProjects.add(projectNumber);
      }
      records.push(record);
    }
  }
  return records;
}

export function probeCtmhAssociations(
  subdivision,
  ctmhRecords,
  { countyKey, ownershipEstateType } = {},
) {
  const estate = normalizeOwnershipEstateType(ownershipEstateType);
  if (estate === "FeeSimple" || estate === "Leasehold") {
    return { status: "no_ctmh_estate", matches: [], source: "ctmh" };
  }
  const searchKind = (kind, missStatus) =>
    findCtmhAssociations(subdivision, ctmhRecords?.[kind] ?? [], {
      countyKey,
      missStatus,
    });
  if (estate === "Condominium") return searchKind("condominium", "no_ctmh_condo");
  if (estate === "Cooperative") return searchKind("cooperative", "no_ctmh_coop");
  if (estate === "Timeshare") return searchKind("timeshare", "no_ctmh_timeshare");

  const condo = searchKind("condominium", "no_ctmh_condo");
  if (condo.status === "matched" || condo.status === "not_unique") return condo;
  const coop = searchKind("cooperative", "no_ctmh_coop");
  if (coop.status === "matched" || coop.status === "not_unique") return coop;
  const timeshare = searchKind("timeshare", "no_ctmh_timeshare");
  if (timeshare.status === "matched" || timeshare.status === "not_unique") return timeshare;
  return condo;
}

function uniqueCtmhAssociations(matches, countyKey) {
  const byIdentity = new Map();
  const seenProjects = new Set();
  for (const record of matches) {
    if (record.projectNumber) {
      if (seenProjects.has(record.projectNumber)) continue;
      seenProjects.add(record.projectNumber);
    }
    const identity = associationIdentity(record);
    if (!identity) continue;
    if (!byIdentity.has(identity)) byIdentity.set(identity, record);
  }
  const unique = [...byIdentity.values()];
  const parcelCounty = countyAlias(countyKey);
  if (!parcelCounty) return unique;
  return unique.filter((record) => countiesEquivalent(record.county, parcelCounty));
}

export function findCtmhAssociations(
  subdivision,
  records,
  { countyKey, missStatus = "no_ctmh_condo" } = {},
) {
  const needles = subdivisionSearchKeys(subdivision);
  if (needles.size === 0) return { status: "no_subdivision", matches: [], source: "ctmh" };
  if (!records?.length) return { status: missStatus, matches: [], source: "ctmh" };
  const byKey = ctmhKeyIndex(records);
  const matches = [];
  const seen = new Set();
  for (const needle of needles) {
    const hits = byKey.get(needle);
    if (!hits) continue;
    for (const record of hits) {
      const identity = associationIdentity(record);
      if (!identity || seen.has(identity)) continue;
      seen.add(identity);
      matches.push(record);
    }
  }
  const unique = uniqueCtmhAssociations(matches, countyKey);
  if (unique.length === 1) return { status: "matched", matches: unique, source: "ctmh" };
  if (unique.length > 1) return { status: "not_unique", matches: unique, source: "ctmh" };
  return { status: missStatus, matches: [], source: "ctmh" };
}

function uniqueByDocument(matches) {
  const documents = new Map();
  for (const match of matches) {
    if (!match.documentNumber) continue;
    documents.set(match.documentNumber, match);
  }
  return [...documents.values()];
}

function looksLikeCondoCompany(entityName) {
  return /\bCONDO(?:MINIUM)?\b/.test(normalizeEntityName(entityName));
}

function looksLikeManagerName(entityName) {
  const normalized = normalizeEntityName(entityName);
  if (hasHoaNameMarker(entityName) || looksLikeCondoCompany(entityName)) return false;
  return /\b(MANAGEMENT|MANAGER|MANAGING)\b/.test(normalized);
}

export function joinCtmhToSunbiz(record, companies) {
  const keys = new Set([
    ...ctmhLegalKeys(record.managingEntityName),
    ...ctmhLegalKeys(record.name),
  ]);
  if (keys.size === 0) return { status: "ctmh_not_in_sunbiz", matches: [] };
  const matches = [];
  for (const company of companies) {
    if (company.status && company.status !== "ACTIVE") continue;
    const entityName = normalizeEntityName(company.entityName);
    const base = associationBaseName(company.entityName);
    const joinBase = stripJoinSuffix(company.entityName);
    if (keys.has(entityName) || (base && keys.has(base)) || (joinBase && keys.has(joinBase))) {
      matches.push(company);
    }
  }
  let unique = uniqueByDocument(matches);
  if (unique.length > 1) {
    const condoMarked = unique.filter((company) => looksLikeCondoCompany(company.entityName));
    if (condoMarked.length === 1) unique = condoMarked;
    else {
      const marked = unique.filter(
        (company) =>
          hasHoaNameMarker(company.entityName) || looksLikeCondoCompany(company.entityName),
      );
      if (marked.length === 1) unique = marked;
    }
  }
  if (
    unique.length === 1 &&
    looksLikeManagerName(unique[0].entityName) &&
    looksLikeManagerName(record.managingEntityName)
  ) {
    return { status: "ctmh_not_in_sunbiz", matches: [] };
  }
  if (unique.length === 1) return { status: "matched", matches: unique };
  if (unique.length === 0) return { status: "ctmh_not_in_sunbiz", matches: [] };
  return { status: "sunbiz_not_unique", matches: unique };
}

export function findCtmhManagingEntityCompany(record, companies, hoaCompany = null) {
  const managerName = record.managingEntityName;
  if (!managerName) return { status: "no_agent_company", matches: [] };
  const hoaName = normalizeEntityName(hoaCompany?.entityName ?? record.managingEntityName);
  const normalizedManager = normalizeEntityName(managerName);
  if (!normalizedManager) return { status: "no_agent_company", matches: [] };
  if (hoaCompany && normalizedManager === hoaName) {
    return { status: "no_agent_company", matches: [] };
  }
  if (!hoaCompany && ctmhLegalKeys(record.name).has(stripJoinSuffix(managerName))) {
    return { status: "no_agent_company", matches: [] };
  }
  const matches = companies.filter((company) => {
    if (company.status && company.status !== "ACTIVE") return false;
    if (hoaCompany && company.documentNumber === hoaCompany.documentNumber) return false;
    return normalizeEntityName(company.entityName) === normalizedManager;
  });
  const unique = uniqueByDocument(matches);
  if (unique.length === 1) return { status: "matched", matches: unique };
  if (unique.length > 1) return { status: "not_unique", matches: unique };
  return { status: "agent_not_in_sunbiz", matches: [] };
}
