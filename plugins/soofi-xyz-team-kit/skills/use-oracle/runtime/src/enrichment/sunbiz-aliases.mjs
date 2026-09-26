import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

const CORPORATE_EVENT_RECORD_LENGTH = 662;
const FICTITIOUS_DATA_RECORD_LENGTH = 2098;
const FICTITIOUS_EVENT_RECORD_LENGTH = 762;
const FICTITIOUS_OWNER_BLOCK_START = 389;
const FICTITIOUS_OWNER_BLOCK_LENGTH = 171;
const FICTITIOUS_OWNER_COUNT = 10;

function field(line, start, length) {
  return line.slice(start - 1, start - 1 + length).trim();
}

function normalizeAlias(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addDocument(index, name, documentNumber) {
  const key = normalizeAlias(name);
  if (!key || !documentNumber) return;
  const documents = index.get(key);
  if (documents) documents.add(documentNumber);
  else index.set(key, new Set([documentNumber]));
}

function activeCompanyMap(companies) {
  return new Map(
    companies
      .filter((company) => !company.status || company.status === "ACTIVE")
      .filter((company) => company.documentNumber)
      .map((company) => [company.documentNumber, company]),
  );
}

export function parseSunbizCorporateEventRecord(line) {
  if (line.length !== CORPORATE_EVENT_RECORD_LENGTH) return null;
  const documentNumber = field(line, 1, 12);
  const corporationName = field(line, 211, 192);
  if (!documentNumber || !corporationName) return null;
  return {
    documentNumber,
    eventCode: field(line, 18, 20) || null,
    eventDescription: field(line, 38, 40) || null,
    conversionMergerDocumentNumber: field(line, 199, 12) || null,
    corporationName,
    nameChange: field(line, 413, 1) === "Y",
    crossReferenceNameChange: field(line, 414, 1) === "Y",
  };
}

export function parseSunbizFictitiousNameRecord(line) {
  if (line.length !== FICTITIOUS_DATA_RECORD_LENGTH) return null;
  const documentNumber = field(line, 1, 12);
  const fictitiousName = field(line, 13, 192);
  if (!documentNumber || !fictitiousName) return null;
  const owners = [];
  for (let index = 0; index < FICTITIOUS_OWNER_COUNT; index += 1) {
    const start = FICTITIOUS_OWNER_BLOCK_START + index * FICTITIOUS_OWNER_BLOCK_LENGTH;
    const ownerType = field(line, start + 67, 1);
    const ownerCharterDocumentNumber = field(line, start + 159, 12);
    const ownerName = field(line, start + 12, 55);
    if (!ownerName && !ownerCharterDocumentNumber) continue;
    owners.push({
      ownerType,
      ownerName: ownerName || null,
      ownerCharterDocumentNumber: ownerCharterDocumentNumber || null,
    });
  }
  return {
    documentNumber,
    fictitiousName,
    status: field(line, 352, 1),
    ownerCount: Number(field(line, 369, 5)) || null,
    moreThanTenOwners: field(line, 388, 1) === "Y",
    owners,
  };
}

export function parseSunbizFictitiousEventRecord(line) {
  if (line.length !== FICTITIOUS_EVENT_RECORD_LENGTH) return null;
  const originalDocumentNumber = field(line, 13, 12);
  if (!originalDocumentNumber) return null;
  return {
    originalDocumentNumber,
    actionCode: field(line, 245, 3) || null,
    ownerCharterDocumentNumber: field(line, 741, 12) || null,
  };
}

async function sourceFiles(directory, pattern, label) {
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort();
  if (files.length === 0) throw new Error(`No ${label} files found in ${directory}`);
  return files;
}

async function scanLines(files, parse, onRecord) {
  let recordCount = 0;
  let invalidRecordCount = 0;
  for (const filePath of files) {
    const input = createReadStream(filePath, { encoding: "utf8" });
    const reader = createInterface({ input, crlfDelay: Infinity });
    for await (const line of reader) {
      const record = parse(line);
      if (!record) {
        invalidRecordCount += 1;
        continue;
      }
      recordCount += 1;
      onRecord(record);
    }
  }
  return { recordCount, invalidRecordCount };
}

export async function loadSunbizAliasIndex({
  companies,
  corporateEventsDir = null,
  fictitiousNamesDir = null,
}) {
  const activeCompanies = activeCompanyMap(companies);
  const corporateEvents = new Map();
  const fictitiousNames = new Map();
  const summary = {
    corporateEvents: null,
    fictitiousNames: null,
    fictitiousEvents: null,
  };

  if (corporateEventsDir) {
    const files = await sourceFiles(
      corporateEventsDir,
      /(?:corevent|ce).*\.txt$/i,
      "corevent*.txt",
    );
    summary.corporateEvents = await scanLines(
      files,
      parseSunbizCorporateEventRecord,
      (event) => {
        if (
          !event.nameChange &&
          !event.crossReferenceNameChange &&
          !event.conversionMergerDocumentNumber
        ) {
          return;
        }
        for (const documentNumber of [
          event.documentNumber,
          event.conversionMergerDocumentNumber,
        ]) {
          if (activeCompanies.has(documentNumber)) {
            addDocument(corporateEvents, event.corporationName, documentNumber);
          }
        }
      },
    );
  }

  if (fictitiousNamesDir) {
    const dataFiles = await sourceFiles(
      fictitiousNamesDir,
      /(?:ficdata|fictitious.*data).*\.txt$/i,
      "ficdata*.txt",
    );
    const eventFiles = await sourceFiles(
      fictitiousNamesDir,
      /(?:ficevt|fictitious.*event).*\.txt$/i,
      "ficevt*.txt",
    );
    const registrationsWithEvents = new Set();
    summary.fictitiousEvents = await scanLines(
      eventFiles,
      parseSunbizFictitiousEventRecord,
      (event) => registrationsWithEvents.add(event.originalDocumentNumber),
    );
    summary.fictitiousNames = await scanLines(
      dataFiles,
      parseSunbizFictitiousNameRecord,
      (registration) => {
        if (
          registration.status !== "A" ||
          registration.moreThanTenOwners ||
          registration.ownerCount !== 1 ||
          registration.owners.length !== 1
        ) {
          return;
        }
        const ownerDocuments = new Set(
          registration.owners
            .filter((owner) => owner.ownerType === "C")
            .map((owner) => owner.ownerCharterDocumentNumber)
            .filter((documentNumber) => activeCompanies.has(documentNumber)),
        );
        if (ownerDocuments.size !== 1) return;
        addDocument(
          fictitiousNames,
          registration.fictitiousName,
          [...ownerDocuments][0],
        );
      },
    );
    summary.fictitiousNames.registrationsWithEvents =
      registrationsWithEvents.size;
  }

  return { corporateEvents, fictitiousNames, summary };
}

function resolveDocuments(name, index, activeCompanies, excludedDocumentNumber) {
  const documents = index.get(normalizeAlias(name)) ?? new Set();
  return [...documents]
    .filter((documentNumber) => documentNumber !== excludedDocumentNumber)
    .map((documentNumber) => activeCompanies.get(documentNumber))
    .filter(Boolean);
}

export function findActiveCompanyBySunbizAlias(
  name,
  companies,
  aliasIndex,
  { excludedDocumentNumber = null } = {},
) {
  if (!name || !aliasIndex) return { status: "no_match", matches: [], method: null };
  const activeCompanies = activeCompanyMap(companies);
  for (const [method, index] of [
    ["sunbiz_event", aliasIndex.corporateEvents],
    ["sunbiz_fictitious_name", aliasIndex.fictitiousNames],
  ]) {
    const matches = resolveDocuments(
      name,
      index ?? new Map(),
      activeCompanies,
      excludedDocumentNumber,
    );
    if (matches.length === 1) return { status: "matched", matches, method };
    if (matches.length > 1) return { status: "not_unique", matches, method };
  }
  return { status: "no_match", matches: [], method: null };
}
