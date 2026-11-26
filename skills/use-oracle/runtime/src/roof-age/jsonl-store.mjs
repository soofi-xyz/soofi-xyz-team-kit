/**
 * File-backed roof-age store: reads one roof-age property record per line
 * from a JSONL input file and writes the reconciled records to a NEW JSONL
 * output file. It replaces the former SQL store; there is no database.
 *
 * Input line shape (the `RoofAgePropertyRecord` of `integration.ts` plus the
 * scope fields `state` and `county`):
 *
 *   {"state":"FL","county":"Broward","propertyId":"...","structureId":"...",
 *    "sourceSystem":"broward_appraiser","sourceRecordId":"...",
 *    "builtYear":2000,"roofDate":null,"roofAgeYears":null,
 *    "sourcePayload":{},"permits":[...]}
 *
 * SQL-only behaviour and its file equivalent:
 * - transactions → the output file is written once, atomically, on commit;
 *   rollback discards in-memory changes and writes nothing;
 * - advisory lock → an exclusive `<output>.lock` file (created with `wx`);
 * - `SELECT ... FOR UPDATE` row locks → not needed: one writer owns the
 *   output file through the lock;
 * - information_schema column check → per-record shape validation.
 *
 * The input file is never modified; the output path must differ from it.
 *
 * @module roof-age/jsonl-store
 */

import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const REQUIRED_FIELDS = Object.freeze([
  "state",
  "propertyId",
  "structureId",
  "sourceSystem",
  "sourceRecordId",
  "builtYear",
  "roofDate",
  "roofAgeYears",
  "sourcePayload",
  "permits",
]);

/**
 * @param {string} filePath
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function readJsonlRecords(filePath) {
  const records = [];
  const lines = readline.createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      throw new Error(
        `${path.basename(filePath)}:${lineNumber}: invalid JSON (${error.message})`,
      );
    }
  }
  return records;
}

function matchesScope(record, scope) {
  const lower = (value) => String(value ?? "").toLowerCase();
  if (scope.propertyIds?.length && !scope.propertyIds.includes(record.propertyId)) {
    return false;
  }
  if (scope.state && lower(record.state) !== lower(scope.state)) return false;
  if (scope.county && lower(record.county) !== lower(scope.county)) return false;
  if (scope.sourceSystem && record.sourceSystem !== scope.sourceSystem) {
    return false;
  }
  return true;
}

function sortedScope(records, scope) {
  return records
    .filter((record) => matchesScope(record, scope))
    .sort((left, right) =>
      String(left.propertyId).localeCompare(String(right.propertyId)),
    );
}

/**
 * @param {{ inputPath: string, outputPath: string }} options
 */
export function createJsonlRoofAgeStore({ inputPath, outputPath }) {
  if (!inputPath || !outputPath) {
    throw new Error("JSONL roof-age store needs inputPath and outputPath");
  }
  if (path.resolve(inputPath) === path.resolve(outputPath)) {
    throw new Error(
      "Roof-age output must be a new file; never overwrite the input records",
    );
  }
  const lockPath = `${outputPath}.lock`;
  let records = null;
  let readOnly = true;
  let lockHandle = null;

  async function releaseLock() {
    if (!lockHandle) return;
    await lockHandle.close();
    lockHandle = null;
    await rm(lockPath, { force: true });
  }

  return {
    async begin({ readOnly: beginReadOnly = false } = {}) {
      readOnly = beginReadOnly;
      records = await readJsonlRecords(inputPath);
    },
    async validateSchema() {
      records.forEach((record, index) => {
        if (!record || typeof record !== "object" || Array.isArray(record)) {
          throw new Error(`Roof-age record ${index + 1} is not an object`);
        }
        for (const field of REQUIRED_FIELDS) {
          if (!(field in record)) {
            throw new Error(
              `Roof-age record ${index + 1} is missing required field "${field}"`,
            );
          }
        }
        if (!Array.isArray(record.permits)) {
          throw new Error(`Roof-age record ${index + 1} permits must be an array`);
        }
      });
    },
    async acquireLock() {
      await mkdir(path.dirname(lockPath), { recursive: true });
      try {
        lockHandle = await open(lockPath, "wx");
      } catch (error) {
        if (error?.code === "EEXIST") {
          throw new Error(
            `Roof-age output is locked by another writer: ${lockPath}`,
          );
        }
        throw error;
      }
      await lockHandle.writeFile(`${process.pid}\n`, "utf8");
    },
    async countRoofAgeRecords(scope = {}) {
      return sortedScope(records, scope).length;
    },
    async readRoofAgeRecords(scope = {}) {
      const limit =
        Number.isInteger(scope.limit) && scope.limit > 0 ? scope.limit : 1000;
      const offset =
        Number.isInteger(scope.offset) && scope.offset >= 0 ? scope.offset : 0;
      return structuredClone(
        sortedScope(records, scope).slice(offset, offset + limit),
      );
    },
    async writeRoofAgeUpdates(plans) {
      if (readOnly) throw new Error("Roof-age store opened read-only");
      let updated = 0;
      for (const plan of plans) {
        if (!plan.changed || !plan.structureId) continue;
        const target = records.find(
          (record) =>
            record.propertyId === plan.propertyId &&
            record.structureId === plan.structureId,
        );
        if (!target) continue;
        target.roofDate = plan.after.roofDate;
        target.roofAgeYears = plan.after.roofAgeYears;
        target.sourcePayload = {
          ...(target.sourcePayload ?? {}),
          roof_age_lineage: plan.after.lineage,
        };
        updated += 1;
      }
      return updated;
    },
    async commit() {
      try {
        // An apply always writes the complete output, changed or not.
        if (!readOnly) {
          await mkdir(path.dirname(outputPath), { recursive: true });
          const temporaryPath = `${outputPath}.${process.pid}.tmp`;
          await writeFile(
            temporaryPath,
            records.map((record) => JSON.stringify(record)).join("\n") +
              (records.length ? "\n" : ""),
            "utf8",
          );
          await rename(temporaryPath, outputPath);
        }
      } finally {
        await releaseLock();
        records = null;
      }
    },
    async rollback() {
      records = null;
      await releaseLock();
    },
  };
}
