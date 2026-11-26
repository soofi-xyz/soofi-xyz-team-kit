import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  normalizedPermitRecordSchema,
  parcelPermitStatusSchema,
} from "./contracts.mjs";
import { artifactPaths, atomicWriteJson, readJson } from "./storage.mjs";

/**
 * Per-parcel permit harvest from bulk snapshots that were already enumerated
 * and linked to the county seed. No source traffic.
 *
 * Layout (`PERMIT_BULK_DIR_<COUNTY>`, written by any county bulk tool):
 *
 *   <bulkDir>/<jurisdiction key or adapter-route key>/
 *     linked-permits.jsonl   one normalized permit record per line
 *                            (`normalizedPermitRecordSchema`), each already
 *                            bound to its `parcel_identifier`
 *     summary.json           {jurisdictionKey, routeKey?, adapterKey?,
 *                             snapshotSha256?, completedAt?,
 *                             detailFingerprintVersion?}
 *
 * A jurisdiction's bulk subdirectories are its own key (primary route) and the
 * key of each supplemental adapter route (for example a county GIS extract
 * behind a login-gated portal). A subdirectory counts only when its
 * `summary.json` names the same jurisdiction. Returns null when none exists,
 * so the caller falls back to the live adapter path.
 */

const cache = new Map();

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function readIfExists(filePath) {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function loadSubdir(dir) {
  const linkedPath = path.join(dir, "linked-permits.jsonl");
  const [linkedBuffer, summaryBuffer] = await Promise.all([
    readIfExists(linkedPath),
    readIfExists(path.join(dir, "summary.json")),
  ]);
  if (!linkedBuffer || !summaryBuffer) return null;
  const linkedSha256 = sha256(linkedBuffer);
  const cached = cache.get(linkedPath);
  if (cached?.linkedSha256 === linkedSha256) return cached;
  const summary = JSON.parse(summaryBuffer.toString("utf8"));
  const byParcel = new Map();
  for (const line of linkedBuffer.toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    const key = record.parcel_identifier;
    if (!byParcel.has(key)) byParcel.set(key, []);
    byParcel.get(key).push(record);
  }
  const loaded = {
    dir,
    linkedSha256,
    summary: {
      routeKey: summary.routeKey ?? "primary",
      adapterKey: summary.adapterKey ?? null,
      jurisdictionKey: summary.jurisdictionKey ?? null,
      snapshotSha256: summary.snapshotSha256 ?? null,
      completedAt: summary.completedAt ?? null,
      detailFingerprintVersion: summary.detailFingerprintVersion ?? null,
    },
    byParcel,
  };
  cache.set(linkedPath, loaded);
  return loaded;
}

/** Bulk sources for a jurisdiction, or [] when none was snapshotted. */
export async function bulkSourcesFor(bulkDir, jurisdiction) {
  const subdirs = [
    jurisdiction.key,
    ...(jurisdiction.adapterRoutes ?? []).map((route) => route.key),
  ];
  const sources = [];
  for (const subdir of [...new Set(subdirs)]) {
    const loaded = await loadSubdir(path.join(bulkDir, subdir));
    if (loaded && loaded.summary.jurisdictionKey === jurisdiction.key) {
      sources.push({ subdir, ...loaded });
    }
  }
  return sources;
}

function fingerprint(value) {
  return createHash("sha256").update(`${JSON.stringify(value)}\n`).digest("hex");
}

/**
 * Write the same raw/extracted/status artifacts the live path writes, from
 * the bulk-linked records for one parcel. `null` when the jurisdiction has no
 * bulk snapshot.
 */
export async function harvestFromBulkLinked({
  bulkDir,
  profile,
  profileSha256,
  jurisdiction,
  parcelIdentifier,
  propertyId,
  outputDir,
  jobId,
  resume,
  clock,
}) {
  const sources = await bulkSourcesFor(bulkDir, jurisdiction);
  if (sources.length === 0) return null;
  const paths = artifactPaths(outputDir, jurisdiction.key, parcelIdentifier);
  const sourceFingerprint = fingerprint({
    countyKey: profile.countyKey,
    profileSha256,
    jurisdictionKey: jurisdiction.key,
    mode: "bulk-linked",
    sources: sources.map((source) => [source.subdir, source.linkedSha256]),
  });
  const completionFingerprint = fingerprint({
    sourceFingerprint,
    parcelIdentifier,
    propertyId,
  });
  if (resume) {
    try {
      const completed = parcelPermitStatusSchema.parse(await readJson(paths.status));
      if (
        completed.status === "done" &&
        completed.sourceFingerprint === sourceFingerprint &&
        completed.completionFingerprint === completionFingerprint
      ) {
        const extracted = await readJson(paths.extracted);
        return {
          status: completed,
          records: (extracted.records ?? []).map((record) =>
            normalizedPermitRecordSchema.parse(record),
          ),
          failures: [],
          resumed: true,
        };
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const seen = new Set();
  const records = [];
  for (const source of sources) {
    for (const record of source.byParcel.get(parcelIdentifier) ?? []) {
      const parsed = normalizedPermitRecordSchema.parse(record);
      if (seen.has(parsed.property_improvement_id)) continue;
      seen.add(parsed.property_improvement_id);
      records.push(parsed);
    }
  }
  records.sort((left, right) => left.sourceRecordId.localeCompare(right.sourceRecordId));
  const completedAt = new Date(clock()).toISOString();
  const status = parcelPermitStatusSchema.parse({
    countyKey: profile.countyKey,
    jobId,
    parcelIdentifier,
    propertyId,
    jurisdictionKey: jurisdiction.key,
    status: "done",
    permitCount: records.length,
    failureCount: 0,
    attempts: 1,
    completedAt,
    sourceFingerprint,
    completionFingerprint,
    detailFingerprintVersion: jurisdiction.adapterConfig?.detailFingerprintVersion ?? null,
    detailComplete: true,
  });
  await Promise.all([
    atomicWriteJson(paths.raw, {
      mode: "bulk-linked",
      // The jurisdiction's primary portal status (a blocked primary still
      // reads a public supplemental bulk route; coverage is that route's).
      primarySourceStatus: jurisdiction.status,
      bulkSources: sources.map((source) => ({
        subdir: path.relative(outputDir, source.dir),
        ...source.summary,
        linkedSha256: source.linkedSha256,
      })),
      references: records.map((record) => ({
        sourceRecordId: record.sourceRecordId,
        permitNumber: record.permit_number ?? null,
      })),
      sourcePayloads: records.map((record) => record.sourcePayload),
      failures: [],
    }),
    atomicWriteJson(paths.extracted, { records }),
    atomicWriteJson(paths.status, status),
  ]);
  return { status, records, failures: [], resumed: false };
}
