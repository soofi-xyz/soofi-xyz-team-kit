/**
 * Mortgage document harvest: for each recorded instrument, capture the clerk
 * index facts and the source document, optionally pin the document to IPFS,
 * and write a fail-closed ready marker.
 *
 * Artifacts (deterministic, idempotent; a ready instrument is skipped on resume):
 *   <output>/<county>/<jobId>/<instrument>/details.html   raw detail page, byte for byte
 *   <output>/<county>/<jobId>/<instrument>/index.json     parsed index facts + provenance
 *   <output>/<county>/<jobId>/<instrument>/document.pdf   source document
 *   <output>/<county>/<jobId>/<instrument>/pin.json       IPFS pin receipt (when pinning)
 *   <output>/<county>/<jobId>/<instrument>/ready.json     marker whose hashes cover the above
 *   <output>/<county>/<jobId>/<instrument>/invalid.json   not a mortgage (doc type mismatch)
 *   <output>/<county>/<jobId>/<instrument>/failed.json    last error (retried on resume)
 *   <output>/<county>/<jobId>/manifest.json               counts for the run
 *
 * @module src/mortgage/harvest
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { atomicWriteJson, readJson } from "../permits/storage.mjs";
import { createAcclaimSession } from "./acclaim.mjs";
import { pinAndVerify, sha256Hex } from "./ipfs-pin.mjs";

export const MORTGAGE_INDEX_SCHEMA = "elephant.mortgage-index.v1";

/**
 * Parse instrument numbers from a CSV/text list. Accepts a bare instrument per
 * line, an `instrument_number` column, or a `request_identifier` column such as
 * `duval-or:2025129715` (checked against the profile prefix).
 *
 * @param {string} text - File contents.
 * @param {string} prefix - Expected request identifier prefix.
 * @returns {string[]} Unique instrument numbers, in input order.
 */
export function parseInstrumentList(text, prefix) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const header = lines[0].split(",").map((cell) => cell.trim().toLowerCase());
  let column = header.indexOf("instrument_number");
  if (column < 0) column = header.indexOf("request_identifier");
  const rows = column >= 0 ? lines.slice(1) : lines;
  const seen = new Set();
  for (const row of rows) {
    let value = column >= 0 ? row.split(",")[column]?.trim() : row.split(",")[0];
    if (!value) continue;
    if (value.includes(":")) {
      const [valuePrefix, instrument] = value.split(":");
      if (valuePrefix !== prefix) {
        throw new Error(`Request identifier ${value} does not match prefix ${prefix}`);
      }
      value = instrument;
    }
    if (!/^\d+$/.test(value)) throw new Error(`Invalid instrument number: ${value}`);
    seen.add(value);
  }
  return [...seen];
}

/**
 * @param {string} filePath - File path.
 * @returns {Promise<boolean>} Whether it exists.
 */
async function exists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check that an existing ready marker still covers the files on disk.
 *
 * @param {string} dir - Instrument directory.
 * @param {boolean} requirePin - Whether a pin receipt is required.
 * @returns {Promise<boolean>} Whether the instrument is complete.
 */
async function readyIsCurrent(dir, requirePin) {
  const readyPath = path.join(dir, "ready.json");
  if (!(await exists(readyPath))) return false;
  const ready = await readJson(readyPath);
  if (requirePin && !ready.pin) return false;
  for (const [name, expected] of Object.entries(ready.files ?? {})) {
    try {
      const actual = sha256Hex(await readFile(path.join(dir, name)));
      if (actual !== expected) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Harvest a list of instruments for one county.
 *
 * @param {{
 *   profile: import("../counties/mortgage-profiles.mjs").MortgageProfile,
 *   jobId: string,
 *   instruments: readonly string[],
 *   outputDir: string,
 *   pin?: { api: string, gateway: string, token: string } | null,
 *   delayMs?: number,
 *   session?: ReturnType<typeof createAcclaimSession>,
 *   fetchImpl?: typeof fetch,
 *   now?: () => Date,
 *   onProgress?: (event: Record<string, unknown>) => void,
 * }} input - Run inputs.
 * @returns {Promise<{ manifestPath: string, counts: Record<string, number> }>} Summary.
 */
export async function harvestMortgageDocuments(input) {
  if (!/^[A-Za-z0-9_.-]+$/.test(input.jobId)) {
    throw new Error(`Invalid job id: ${input.jobId}`);
  }
  const { profile } = input;
  const now = input.now ?? (() => new Date());
  const delayMs = input.delayMs ?? 2_000;
  const session =
    input.session ??
    createAcclaimSession({
      baseUrl: profile.baseUrl,
      bookType: profile.bookType,
      fetchImpl: input.fetchImpl,
    });
  const runDir = path.join(input.outputDir, profile.county, input.jobId);
  await mkdir(runDir, { recursive: true });

  const counts = { ready: 0, skipped: 0, invalid: 0, failed: 0 };
  let requested = 0;

  for (const instrument of input.instruments) {
    const dir = path.join(runDir, instrument);
    if (await readyIsCurrent(dir, Boolean(input.pin))) {
      counts.skipped += 1;
      input.onProgress?.({ event: "mortgage_skip", instrument });
      continue;
    }
    const invalidPath = path.join(dir, "invalid.json");
    if (await exists(invalidPath)) {
      const invalid = await readJson(invalidPath);
      if (!profile.mortgageDocTypeCodes.includes(invalid.docTypeCode ?? "")) {
        counts.invalid += 1;
        continue;
      }
      // The profile now accepts this doc type: capture it.
      await rm(invalidPath, { force: true });
    }
    if (requested > 0 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    requested += 1;
    await mkdir(dir, { recursive: true });
    try {
      const capturedAt = now().toISOString();
      const details = await session.fetchDetails(instrument);
      await writeFile(path.join(dir, "details.html"), details.html);

      const { facts } = details;
      if (!profile.mortgageDocTypeCodes.includes(facts.docTypeCode ?? "")) {
        await atomicWriteJson(path.join(dir, "invalid.json"), {
          instrument,
          reason: `doc type ${facts.docTypeCode ?? "unknown"} is not a mortgage`,
          docTypeCode: facts.docTypeCode,
          docType: facts.docType,
          capturedAt,
        });
        counts.invalid += 1;
        input.onProgress?.({ event: "mortgage_invalid", instrument });
        continue;
      }

      const pdf = await session.fetchDocumentPdf(facts.transactionItemId);
      await writeFile(path.join(dir, "document.pdf"), pdf.bytes);

      const index = {
        schemaVersion: MORTGAGE_INDEX_SCHEMA,
        county: profile.county,
        state: profile.state,
        requestIdentifier: `${profile.requestIdentifierPrefix}:${instrument}`,
        instrumentNumber: instrument,
        recordDate: facts.recordDate,
        bookType: facts.bookType,
        book: facts.book,
        page: facts.page,
        pageCount: facts.pageCount,
        docTypeCode: facts.docTypeCode,
        docType: facts.docType,
        grantors: facts.grantors,
        grantees: facts.grantees,
        consideration: facts.consideration,
        executionDate: facts.executionDate,
        legalDescriptions: facts.legalDescriptions,
        source: {
          vendor: profile.vendor,
          detailUrl: details.url,
          documentUrl: pdf.url,
          capturedAt,
        },
      };
      await atomicWriteJson(path.join(dir, "index.json"), index);

      /** @type {Awaited<ReturnType<typeof pinAndVerify>> | null} */
      let pin = null;
      if (input.pin) {
        pin = await pinAndVerify({
          bytes: pdf.bytes,
          fileName: `${profile.requestIdentifierPrefix}-${instrument}.pdf`,
          contentType: "application/pdf",
          config: input.pin,
          fetchImpl: input.fetchImpl,
        });
        await atomicWriteJson(path.join(dir, "pin.json"), pin);
      }

      const files = {};
      for (const name of ["details.html", "index.json", "document.pdf"]) {
        files[name] = sha256Hex(await readFile(path.join(dir, name)));
      }
      if (pin) files["pin.json"] = sha256Hex(await readFile(path.join(dir, "pin.json")));
      await atomicWriteJson(path.join(dir, "ready.json"), {
        instrument,
        requestIdentifier: index.requestIdentifier,
        documentSha256: files["document.pdf"],
        pin: pin ? { cid: pin.cid, ipfsUrl: pin.ipfsUrl } : null,
        files,
        readyAt: now().toISOString(),
      });
      await rm(path.join(dir, "failed.json"), { force: true });
      counts.ready += 1;
      input.onProgress?.({
        event: "mortgage_ready",
        instrument,
        cid: pin?.cid ?? null,
      });
    } catch (error) {
      counts.failed += 1;
      await atomicWriteJson(path.join(dir, "failed.json"), {
        instrument,
        error: error instanceof Error ? error.message : String(error),
        failedAt: now().toISOString(),
      });
      input.onProgress?.({
        event: "mortgage_failed",
        instrument,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const manifestPath = path.join(runDir, "manifest.json");
  await atomicWriteJson(manifestPath, {
    county: profile.county,
    jobId: input.jobId,
    requested: input.instruments.length,
    counts,
    pinned: Boolean(input.pin),
    completedAt: now().toISOString(),
  });
  return { manifestPath, counts };
}
