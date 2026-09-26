import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

import {
  createHoaSubdivisionMatcher,
  normalizeEntityName,
} from "./hoa-pm-heuristic.mjs";
import {
  parseCorporateDataRecord,
  SUNBIZ_EXTRACT_SCHEMA_VERSION,
} from "./sunbiz.mjs";

async function outputEntries(outputDir) {
  try {
    return await readdir(outputDir);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function sourceFiles(sourceDir) {
  const files = (await readdir(sourceDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^cordata.*\.txt$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (files.length === 0) {
    throw new Error(`No cordata*.txt files found in ${sourceDir}`);
  }
  return files;
}

async function scanFile(filePath, onEntity, hashInput = false) {
  const hash = hashInput ? createHash("sha256") : null;
  const input = createReadStream(filePath, { encoding: "utf8" });
  if (hash) input.on("data", (chunk) => hash.update(chunk));
  const reader = createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of reader) {
    lineNumber += 1;
    await onEntity(line, lineNumber);
  }
  return {
    recordCount: lineNumber,
    sha256: hash?.digest("hex") ?? null,
  };
}

function indexRecord(line) {
  const documentNumber = line.slice(0, 12).trim();
  if (!documentNumber) return null;
  const statusCode = line.slice(204, 205).trim();
  return {
    documentNumber,
    entityName: line.slice(12, 204).trim(),
    status:
      statusCode === "A"
        ? "ACTIVE"
        : statusCode === "I"
          ? "INACTIVE"
          : statusCode,
    registeredAgent: {
      name: line.slice(544, 586).trim() || null,
      type: line.slice(586, 587).trim() || null,
    },
  };
}

function agentCompanyName(entity) {
  const agent = entity.registeredAgent;
  if (!agent?.name) return null;
  const type = String(agent.type ?? "").toUpperCase();
  if (type === "P" || type === "PERSON") return null;
  return normalizeEntityName(agent.name) || null;
}

export async function buildHoaPmSunbizIndex({
  sourceDir,
  subdivisionsPath,
  outputDir,
  quarter,
  chunkRecordLimit = 5_000,
}) {
  if (!Number.isInteger(chunkRecordLimit) || chunkRecordLimit <= 0) {
    throw new Error("chunkRecordLimit must be a positive integer");
  }
  if ((await outputEntries(outputDir)).length > 0) {
    throw new Error(`HOA/PM Sunbiz index output is not empty: ${outputDir}`);
  }
  const subdivisionPayload = JSON.parse(
    await readFile(subdivisionsPath, "utf8"),
  );
  if (
    !Array.isArray(subdivisionPayload) ||
    subdivisionPayload.some((value) => typeof value !== "string")
  ) {
    throw new Error("Subdivision input must be a JSON array of strings");
  }
  const subdivisions = [
    ...new Set(subdivisionPayload.map((value) => value.trim()).filter(Boolean)),
  ];
  if (subdivisions.length === 0) {
    throw new Error("At least one subdivision is required");
  }

  const files = await sourceFiles(sourceDir);
  const hoaMatcher = createHoaSubdivisionMatcher(subdivisions);
  const selectedByDocument = new Map();
  const sourceReceipts = [];
  let sourceRecordsRead = 0;
  let invalidRecordCount = 0;

  for (const sourceFileName of files) {
    const sourcePath = path.join(sourceDir, sourceFileName);
    let sourceInvalidRecordCount = 0;
    const receipt = await scanFile(
      sourcePath,
      (line, sourceLineNumber) => {
        const indexed = indexRecord(line);
        if (indexed === null) {
          sourceInvalidRecordCount += 1;
          return;
        }
        if (!hoaMatcher(indexed)) return;
        const entity = parseCorporateDataRecord(line);
        selectedByDocument.set(entity.documentNumber, {
          sourceFileName,
          sourceLineNumber,
          entity,
          matchedAddresses: [],
        });
      },
      true,
    );
    sourceRecordsRead += receipt.recordCount;
    invalidRecordCount += sourceInvalidRecordCount;
    sourceReceipts.push({
      sourceFileName,
      bytes: (await stat(sourcePath)).size,
      sha256: receipt.sha256,
      fullyScanned: true,
    });
  }

  const agentNames = new Set(
    [...selectedByDocument.values()]
      .map((record) => agentCompanyName(record.entity))
      .filter(Boolean),
  );
  for (const sourceFileName of files) {
    await scanFile(
      path.join(sourceDir, sourceFileName),
      (line, sourceLineNumber) => {
        const indexed = indexRecord(line);
        if (
          indexed === null ||
          indexed.status !== "ACTIVE" ||
          !agentNames.has(normalizeEntityName(indexed.entityName))
        ) {
          return;
        }
        const entity = parseCorporateDataRecord(line);
        selectedByDocument.set(entity.documentNumber, {
          sourceFileName,
          sourceLineNumber,
          entity,
          matchedAddresses: [],
        });
      },
    );
  }

  await mkdir(path.join(outputDir, "chunks"), { recursive: true });
  const selected = [...selectedByDocument.values()].sort((left, right) =>
    left.entity.documentNumber.localeCompare(right.entity.documentNumber),
  );
  const chunks = [];
  for (let index = 0; index < selected.length; index += chunkRecordLimit) {
    const records = selected.slice(index, index + chunkRecordLimit);
    const relativePath = `chunks/part-${String(chunks.length).padStart(5, "0")}.jsonl`;
    const body = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
    await writeFile(path.join(outputDir, relativePath), body, "utf8");
    chunks.push({
      relativePath,
      recordCount: records.length,
      bytes: Buffer.byteLength(body),
      sha256: createHash("sha256").update(body).digest("hex"),
    });
  }

  const manifest = {
    schemaVersion: SUNBIZ_EXTRACT_SCHEMA_VERSION,
    indexSchemaVersion: "elephant.hoa-pm-sunbiz-index.v1",
    quarter,
    source: "florida-sunbiz-corporate-bulk",
    retrievedAt: new Date().toISOString(),
    subdivisionCount: subdivisions.length,
    sourceRecordsRead,
    invalidRecordCount,
    hoaCompanyCount: [...selectedByDocument.values()].filter((record) =>
      hoaMatcher(record.entity),
    ).length,
    agentCompanyNameCount: agentNames.size,
    matchedRecordCount: selected.length,
    chunkRecordLimit,
    completeSourceScan: true,
    sourceFiles: sourceReceipts,
    chunks,
  };
  await writeFile(
    path.join(outputDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return manifest;
}
