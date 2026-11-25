/**
 * Permit side: eligibility index for `PermitFeed` and the one-parcel harvest
 * for `PermitHarvest`, routed through the county permit profile to the
 * existing vendor adapters in `src/permits/adapters/*`.
 *
 * Artifacts: `data/artifacts/permits/<county>/<jobId>/{raw,extracted,status}/`.
 * The adapters keep their own `raw|extracted|status/<jurisdiction>/<key>.json`
 * files; this module adds the per-parcel link status
 * `status/<parcelKey>.json`, which says for every harvested permit whether it
 * is linked to the requested parcel or unlinked, with a reason.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";

import { permitProfileRegistry } from "../../src/counties/permit-profiles.mjs";
import { harvestPermitProperty } from "../../src/permits/harvest.mjs";
import { routePermitJurisdiction } from "../../src/permits/normalization.mjs";
import { artifactPaths } from "../../src/permits/storage.mjs";
import { resolveEligibilityPolicy } from "./county-config.ts";
import { gate } from "./limits.ts";
import { type Eligibility, FILES, writeEligibility } from "./parcel-steps.ts";
import {
  atomicWriteJson,
  dataPath,
  exists,
  paths,
  readJsonIfExists,
  safeKeyPart,
} from "./storage.ts";

export const PERMIT_STATUS_SCHEMA = "oracle.permit-parcel-status.v1";

export type PermitLink = {
  sourceRecordId: string;
  permitNumber: string | null;
  link: "linked" | "unlinked";
  reason: string | null;
};

export type PermitParcelStatus = {
  schemaVersion: typeof PERMIT_STATUS_SCHEMA;
  county: string;
  jobId: string;
  parcel_id: string;
  parcelKey: string;
  requestedParcelIdentifier: string | null;
  jurisdictionKey: string | null;
  adapterKey: string | null;
  harvestStatus: "done" | "failed" | "blocked" | "unrouted" | "no_profile" | "not_eligible";
  /** Reason when the parcel as a whole produced no linkable permits. */
  parcelReason: string | null;
  permitCount: number;
  linkedCount: number;
  unlinkedCount: number;
  permits: PermitLink[];
  transientFailures: number;
  artifacts: { raw: string | null; extracted: string | null; status: string | null };
  completedAt: string;
};

type HarvestRecord = {
  sourceRecordId: string;
  permit_number: string | null;
  parcel_identifier: string | null;
  requestedParcelIdentifier: string;
};

type HarvestFailure = { classification: string; errorCode: string; message: string };

type HarvestStatus = {
  status: "done" | "failed" | "blocked" | "unrouted";
  parcelIdentifier: string;
  jurisdictionKey: string;
};

type HarvestResult = { status: HarvestStatus; records: HarvestRecord[]; failures: HarvestFailure[] };

type PermitProfile = { countyKey: string; jurisdictions: Array<{ key: string; adapterKey?: string | null }> };

const registry = permitProfileRegistry as {
  countyKeys: readonly string[];
  require(county: string): PermitProfile;
};

export function permitProfileFor(county: string): PermitProfile | null {
  return registry.countyKeys.includes(county) ? registry.require(county) : null;
}

function relativeToData(absolute: string): string {
  return path.relative(dataPath(), absolute);
}

/**
 * Link every harvested permit to the requested parcel, or mark it unlinked
 * with a reason. A record is linked only when its bound parcel identifier is
 * the requested one (never whatever parcel a detail page displays).
 */
export function computePermitLinks(
  requested: string,
  references: Array<{ sourceRecordId: string; permitNumber?: string | null }>,
  records: HarvestRecord[],
  failures: HarvestFailure[],
): PermitLink[] {
  const byId = new Map(records.map((record) => [record.sourceRecordId, record]));
  const links: PermitLink[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    seen.add(record.sourceRecordId);
    const bound =
      record.parcel_identifier === requested && record.requestedParcelIdentifier === requested;
    links.push({
      sourceRecordId: record.sourceRecordId,
      permitNumber: record.permit_number ?? null,
      link: bound ? "linked" : "unlinked",
      reason: bound ? null : `parcel_mismatch: bound to ${record.parcel_identifier ?? "none"}`,
    });
  }
  const detailFailure = failures.find((failure) => failure.classification !== "unrouted");
  for (const reference of references) {
    if (seen.has(reference.sourceRecordId) || byId.has(reference.sourceRecordId)) continue;
    seen.add(reference.sourceRecordId);
    links.push({
      sourceRecordId: reference.sourceRecordId,
      permitNumber: reference.permitNumber ?? null,
      link: "unlinked",
      reason: detailFailure ? `detail_failed: ${detailFailure.errorCode}` : "detail_not_captured",
    });
  }
  return links.sort((left, right) => left.sourceRecordId.localeCompare(right.sourceRecordId));
}

function statusFile(
  base: Omit<PermitParcelStatus, "schemaVersion" | "completedAt" | "permitCount" | "linkedCount" | "unlinkedCount">,
): PermitParcelStatus {
  return {
    schemaVersion: PERMIT_STATUS_SCHEMA,
    ...base,
    permitCount: base.permits.length,
    linkedCount: base.permits.filter((permit) => permit.link === "linked").length,
    unlinkedCount: base.permits.filter((permit) => permit.link === "unlinked").length,
    completedAt: new Date().toISOString(),
  };
}

export class TransientPermitError extends Error {}

/** Harvest one parcel; writes artifacts and `status/<parcelKey>.json`. */
export async function harvestOneParcel(req: {
  county: string;
  jobId: string;
  parcel_id: string;
}): Promise<PermitParcelStatus> {
  const parcelDir = paths.parcelDir(req.county, req.jobId, req.parcel_id);
  const statusPath = paths.permitStatus(req.county, req.jobId, req.parcel_id);
  const parcelKey = safeKeyPart(req.parcel_id);
  const eligibility = await readJsonIfExists<Eligibility>(path.join(parcelDir, FILES.eligibility));
  const ready = await exists(path.join(parcelDir, FILES.ready));
  const empty = {
    county: req.county,
    jobId: req.jobId,
    parcel_id: req.parcel_id,
    parcelKey,
    requestedParcelIdentifier: eligibility?.routing.parcel_identifier ?? null,
    jurisdictionKey: null,
    adapterKey: null,
    permits: [] as PermitLink[],
    transientFailures: 0,
    artifacts: { raw: null, extracted: null, status: null },
  };
  if (!ready || !eligibility?.eligible) {
    const status = statusFile({
      ...empty,
      harvestStatus: "not_eligible",
      parcelReason: ready ? "not_eligible" : "parcel_not_ready",
    });
    await atomicWriteJson(statusPath, status);
    return status;
  }
  const profile = permitProfileFor(req.county);
  if (!profile) {
    const status = statusFile({ ...empty, harvestStatus: "no_profile", parcelReason: "no_permit_profile" });
    await atomicWriteJson(statusPath, status);
    return status;
  }
  const routing = eligibility.routing;
  const jurisdiction = routePermitJurisdiction(profile, routing.city ?? routing.situs_address) as
    | { key: string; adapterKey?: string | null }
    | null
    | undefined;
  const adapterKey = jurisdiction?.adapterKey ?? null;
  const outputDir = paths.permitsJob(req.county, req.jobId);
  const result = (await gate(`permit_${adapterKey ?? "unrouted"}`, 2)(() =>
    harvestPermitProperty({
      row: {
        parcel_identifier: routing.parcel_identifier,
        property_id: null,
        city: routing.city,
        situs_address: routing.situs_address,
      },
      profile,
      outputDir,
      jobId: req.jobId,
      resume: true,
    }),
  )) as HarvestResult;
  const harvested = result.status;
  const files = artifactPaths(outputDir, harvested.jurisdictionKey, harvested.parcelIdentifier) as {
    raw: string;
    extracted: string;
    status: string;
  };
  const raw = await readJsonIfExists<{
    references?: Array<{ sourceRecordId: string; permitNumber?: string | null }>;
    failures?: HarvestFailure[];
  }>(files.raw);
  const failures = result.failures.length ? result.failures : (raw?.failures ?? []);
  const permits = computePermitLinks(
    harvested.parcelIdentifier,
    raw?.references ?? [],
    result.records,
    failures,
  );
  const firstFailure = failures[0];
  const transientFailures = failures.filter((failure) => failure.classification === "transient").length;
  const status = statusFile({
    ...empty,
    requestedParcelIdentifier: harvested.parcelIdentifier,
    jurisdictionKey: harvested.jurisdictionKey,
    adapterKey,
    harvestStatus: harvested.status,
    parcelReason:
      harvested.status === "done"
        ? null
        : `${harvested.status}: ${firstFailure?.errorCode ?? "unknown"}`,
    permits,
    transientFailures,
    artifacts: {
      raw: relativeToData(files.raw),
      extracted: relativeToData(files.extracted),
      status: relativeToData(files.status),
    },
  });
  await atomicWriteJson(statusPath, status);
  if (transientFailures > 0) {
    // Never record a transient failure as done: retry with backoff, then pause.
    throw new TransientPermitError(
      `${transientFailures} transient permit failure(s) for ${harvested.jurisdictionKey}: ${firstFailure?.errorCode}`,
    );
  }
  return status;
}

/** Ledger record for a permit status (stage "permits"). */
export function permitLedgerRecord(status: PermitParcelStatus) {
  const detail = {
    harvestStatus: status.harvestStatus,
    permitCount: status.permitCount,
    linked: status.linkedCount,
    unlinked: status.unlinkedCount,
  };
  if (status.harvestStatus === "done") {
    return {
      parcel_id: status.parcel_id,
      stage: "permits" as const,
      status: "ready" as const,
      reason: status.unlinkedCount ? `unlinked: ${status.unlinkedCount}` : null,
      detail,
    };
  }
  if (status.harvestStatus === "failed") {
    return {
      parcel_id: status.parcel_id,
      stage: "permits" as const,
      status: "failed" as const,
      reason: status.parcelReason ?? "failed",
      detail,
    };
  }
  return {
    parcel_id: status.parcel_id,
    stage: "permits" as const,
    status: "dead" as const,
    reason: status.parcelReason ?? status.harvestStatus,
    detail,
  };
}

export type EligibleIndex = {
  feedKey: string;
  eligible: number;
  scanned: number;
  refreshed: number;
  malformed: Array<{ parcelKey: string; error: string }>;
  policyFingerprint: string;
  chunks: Array<{ index: number; path: string; rows: number }>;
};

/**
 * Rebuild the eligible-parcel index for one feed pass, in chunk files under
 * `data/artifacts/permits/<county>/<jobId>/eligible/<feedKey>/`. Eligibility
 * written under a different policy is recomputed; a malformed
 * `eligibility.json` is recorded and skipped, never thrown.
 */
export async function buildEligibleIndex(
  county: string,
  jobId: string,
  feedKey: string,
  chunkSize: number,
): Promise<EligibleIndex> {
  const policy = resolveEligibilityPolicy(county);
  const jobDir = paths.appraisalJob(county, jobId);
  const entries = (await exists(jobDir)) ? (await readdir(jobDir)).sort() : [];
  const eligible: string[] = [];
  const malformed: EligibleIndex["malformed"] = [];
  let refreshed = 0;
  const batch = 256;
  for (let start = 0; start < entries.length; start += batch) {
    const slice = entries.slice(start, start + batch);
    const results = await Promise.all(
      slice.map(async (parcelKey) => {
        const dir = path.join(jobDir, parcelKey);
        if (!(await exists(path.join(dir, FILES.ready)))) return null;
        try {
          let eligibility = await readJsonIfExists<Eligibility>(path.join(dir, FILES.eligibility));
          if (!eligibility) return null;
          if (typeof eligibility.parcel_id !== "string" || typeof eligibility.eligible !== "boolean") {
            throw new Error("eligibility.json is missing parcel_id or eligible");
          }
          if (eligibility.policyFingerprint !== policy.fingerprint) {
            eligibility = await writeEligibility(
              {
                county,
                jobId,
                parcel_id: eligibility.parcel_id,
                source_identifier: eligibility.routing?.source_identifier ?? undefined,
                situs_address: eligibility.routing?.situs_address ?? undefined,
                extra: {
                  ...(eligibility.routing?.city ? { city: eligibility.routing.city } : {}),
                  ...(eligibility.routing?.parcel_identifier
                    ? { permit_parcel_identifier: eligibility.routing.parcel_identifier }
                    : {}),
                },
              },
              dir,
            );
            refreshed += 1;
          }
          return eligibility.eligible ? eligibility.parcel_id : null;
        } catch (error) {
          malformed.push({ parcelKey, error: (error as Error).message.slice(0, 200) });
          return null;
        }
      }),
    );
    for (const parcelId of results) if (parcelId) eligible.push(parcelId);
  }
  eligible.sort();
  const indexDir = dataPath("artifacts", "permits", county, jobId, "eligible", safeKeyPart(feedKey));
  const chunks: EligibleIndex["chunks"] = [];
  for (let offset = 0, index = 0; offset < eligible.length; offset += chunkSize, index += 1) {
    const rows = eligible.slice(offset, offset + chunkSize);
    const chunkPath = path.join(indexDir, `c${index}.json`);
    await atomicWriteJson(chunkPath, rows);
    chunks.push({ index, path: relativeToData(chunkPath), rows: rows.length });
  }
  const index: EligibleIndex = {
    feedKey,
    eligible: eligible.length,
    scanned: entries.length,
    refreshed,
    malformed,
    policyFingerprint: policy.fingerprint,
    chunks,
  };
  await atomicWriteJson(path.join(indexDir, "index.json"), index);
  return index;
}
