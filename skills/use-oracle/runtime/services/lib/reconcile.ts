/**
 * Run reconciliation (completion gates) from the CountyLedger plus artifact
 * files — never from SQL rows. Writes the durable per-run manifest, because
 * Restate keeps finished workflow state only for its retention window.
 *
 * Gates:
 *  - seed_accounted:  every seed parcel has exactly one ledger entry and
 *                     seed = ready + dead + invalid + pending + failed
 *  - seed_complete:   seed = ready + dead + invalid (nothing pending/failed)
 *  - no_duplicate_keys: no duplicate seed parcel_id, no artifact-key collision
 *  - ready_hash_coverage: every ledger-ready parcel has ready.json whose hash
 *                     matches the ledger and the transformed.zip on disk
 *  - ledger_files_agree: ledger status and status markers agree
 *  - permits_linked:  every harvested permit is linked to its requested parcel
 *                     or explicitly unlinked with a reason
 *  - permits_complete: every eligible ready parcel has a permit status file
 *                     (reported "not_started" when no permit pass ran)
 *  - tombstones_excluded: group directories hold only verified ready parcels;
 *                     a parcel that was ready and is now dead/invalid is out
 */
import { readdir } from "node:fs/promises";
import path from "node:path";

import { emptyCounts, type LedgerEntry, type LedgerStatus, type LedgerSummary } from "./ledger-state.ts";
import { FILES, type ReadyMarker } from "./parcel-steps.ts";
import type { PermitParcelStatus } from "./permit-steps.ts";
import { readSeedRange, scanSeed } from "./seed.ts";
import {
  atomicWriteJson,
  dataPath,
  exists,
  paths,
  readJsonIfExists,
  removeIfExists,
  resolveUnderData,
  safeKeyPart,
  sha256File,
} from "./storage.ts";
import { filterZipToGroup } from "./zip.ts";

export const MANIFEST_SCHEMA = "oracle.run-manifest.v1";

export type LedgerSnapshot = {
  source: "admin-sql" | "ingress" | "none";
  parcels: Map<string, LedgerEntry>;
  permits: Map<string, LedgerEntry>;
  summary: LedgerSummary | null;
  error: string | null;
};

type FetchLike = typeof fetch;

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function splitEntries(rows: Array<{ key: string; value: unknown }>) {
  const parcels = new Map<string, LedgerEntry>();
  const permits = new Map<string, LedgerEntry>();
  for (const row of rows) {
    if (row.key.startsWith("p:")) parcels.set(row.key.slice(2), row.value as LedgerEntry);
    else if (row.key.startsWith("permit:")) permits.set(row.key.slice(7), row.value as LedgerEntry);
  }
  return { parcels, permits };
}

/** Preferred: the Restate admin SQL query API over CountyLedger state. */
export async function readLedgerViaAdminSql(
  adminUrl: string,
  key: string,
  fetchImpl: FetchLike = fetch,
): Promise<LedgerSnapshot> {
  const response = await fetchImpl(`${adminUrl.replace(/\/$/, "")}/query`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      query: `SELECT key, value_utf8 FROM state WHERE service_name = 'CountyLedger' AND service_key = ${sqlString(key)}`,
    }),
  });
  if (!response.ok) throw new Error(`admin query HTTP ${response.status}`);
  const body = (await response.json()) as { rows?: Array<{ key: string; value_utf8: string | null }> };
  if (!Array.isArray(body.rows)) throw new Error("admin query returned no rows array");
  const decoded = body.rows.map((row) => ({
    key: row.key,
    value: row.value_utf8 === null ? null : JSON.parse(row.value_utf8),
  }));
  const { parcels, permits } = splitEntries(decoded);
  const valueOf = (name: string) => decoded.find((row) => row.key === name)?.value ?? null;
  const counts = valueOf("counts") as LedgerSummary["counts"] | null;
  const permitCounts = valueOf("permitCounts") as LedgerSummary["counts"] | null;
  const summary: LedgerSummary | null =
    counts || permitCounts
      ? {
          key,
          parcels: parcels.size,
          counts: { ...emptyCounts(), ...(counts ?? {}) },
          tombstones: (valueOf("tombstones") as number | null) ?? 0,
          permits: {
            parcels: permits.size,
            counts: { ...emptyCounts(), ...(permitCounts ?? {}) },
          },
          updatedAt: (valueOf("updatedAt") as string | null) ?? null,
        }
      : null;
  return { source: "admin-sql", parcels, permits, summary, error: null };
}

/** Fallback: CountyLedger/summary + list through the ingress. */
export async function readLedgerViaIngress(
  ingressUrl: string,
  key: string,
  fetchImpl: FetchLike = fetch,
): Promise<LedgerSnapshot> {
  const base = `${ingressUrl.replace(/\/$/, "")}/CountyLedger/${encodeURIComponent(key)}`;
  const call = async (handler: string, body?: unknown) => {
    const response = await fetchImpl(`${base}/${handler}`, {
      method: "POST",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`ingress ${handler} HTTP ${response.status}`);
    return response.json();
  };
  const summary = (await call("summary")) as LedgerSummary;
  const page = async (stage?: "permits") => {
    const entries = new Map<string, LedgerEntry>();
    let cursor: string | null = null;
    do {
      const result = (await call("list", { cursor: cursor ?? undefined, limit: 5000, stage })) as {
        entries: LedgerEntry[];
        cursor: string | null;
      };
      for (const entry of result.entries) entries.set(entry.parcel_id, entry);
      cursor = result.cursor;
    } while (cursor);
    return entries;
  };
  return {
    source: "ingress",
    parcels: await page(),
    permits: await page("permits"),
    summary,
    error: null,
  };
}

/**
 * The seed the run used, from CountyIngest state (key `<county>-<jobId>`):
 * admin SQL first, then the ingress `status` handler. Null when neither has it.
 */
export async function readIngestSeedPath(options: {
  adminUrl: string;
  ingressUrl: string;
  key: string;
  fetchImpl?: FetchLike;
}): Promise<{ path: string; source: "countyingest-state" | "countyingest-status" } | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${options.adminUrl.replace(/\/$/, "")}/query`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        query: `SELECT value_utf8 FROM state WHERE service_name = 'CountyIngest' AND service_key = ${sqlString(options.key)} AND key = 'seed'`,
      }),
    });
    if (response.ok) {
      const body = (await response.json()) as { rows?: Array<{ value_utf8: string | null }> };
      const value = body.rows?.[0]?.value_utf8;
      const seed = value ? (JSON.parse(value) as { path?: unknown }) : null;
      if (typeof seed?.path === "string" && seed.path) return { path: seed.path, source: "countyingest-state" };
    }
  } catch {
    // fall through to the ingress
  }
  try {
    const response = await fetchImpl(
      `${options.ingressUrl.replace(/\/$/, "")}/CountyIngest/${encodeURIComponent(options.key)}/status`,
      { method: "POST" },
    );
    if (response.ok) {
      const status = (await response.json()) as { seed?: { path?: unknown } | null };
      if (typeof status.seed?.path === "string" && status.seed.path) {
        return { path: status.seed.path, source: "countyingest-status" };
      }
    }
  } catch {
    // no live status
  }
  return null;
}

export async function loadLedger(options: {
  adminUrl: string;
  ingressUrl: string;
  key: string;
  fetchImpl?: FetchLike;
}): Promise<LedgerSnapshot> {
  const errors: string[] = [];
  try {
    return await readLedgerViaAdminSql(options.adminUrl, options.key, options.fetchImpl);
  } catch (error) {
    errors.push(`admin-sql: ${(error as Error).message}`);
  }
  try {
    const snapshot = await readLedgerViaIngress(options.ingressUrl, options.key, options.fetchImpl);
    return { ...snapshot, error: errors.join("; ") || null };
  } catch (error) {
    errors.push(`ingress: ${(error as Error).message}`);
  }
  return {
    source: "none",
    parcels: new Map(),
    permits: new Map(),
    summary: null,
    error: errors.join("; "),
  };
}

type FileParcel = {
  key: string;
  parcelId: string | null;
  ready: ReadyMarker | null;
  dead: { reason?: string } | null;
  invalid: { reason?: string } | null;
  failed: { reason?: string } | null;
  eligible: boolean | null;
  transformedPresent: boolean;
  transformedHash: string | null;
};

async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await mapper(items[index]!);
      }
    }),
  );
  return results;
}

async function scanParcelFiles(county: string, jobId: string, rehash: boolean): Promise<FileParcel[]> {
  const jobDir = paths.appraisalJob(county, jobId);
  if (!(await exists(jobDir))) return [];
  const keys = (await readdir(jobDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return mapLimit(keys, 16, async (key) => {
    const dir = path.join(jobDir, key);
    const ready = await readJsonIfExists<ReadyMarker>(path.join(dir, FILES.ready));
    const dead = await readJsonIfExists<{ reason?: string; parcel_id?: string }>(path.join(dir, FILES.dead));
    const invalid = await readJsonIfExists<{ reason?: string; parcel_id?: string }>(path.join(dir, FILES.invalid));
    const failed = await readJsonIfExists<{ reason?: string; parcel_id?: string }>(path.join(dir, FILES.failed));
    const eligibility = await readJsonIfExists<{ eligible?: boolean; parcel_id?: string }>(
      path.join(dir, FILES.eligibility),
    );
    const transformedPath = path.join(dir, FILES.transformed);
    const transformedPresent = await exists(transformedPath);
    const transformedHash =
      ready && transformedPresent
        ? rehash
          ? await sha256File(transformedPath)
          : ((await readJsonIfExists<{ transformedHash?: string }>(path.join(dir, FILES.transformedMeta)))
              ?.transformedHash ?? null)
        : null;
    const parcelId =
      ready?.parcel_id ?? dead?.parcel_id ?? invalid?.parcel_id ?? failed?.parcel_id ?? eligibility?.parcel_id ?? null;
    return {
      key,
      parcelId,
      ready,
      dead,
      invalid,
      failed,
      eligible: typeof eligibility?.eligible === "boolean" ? eligibility.eligible : null,
      transformedPresent,
      transformedHash,
    };
  });
}

async function readSeedIds(seedAbsolute: string): Promise<string[]> {
  const index = await scanSeed(seedAbsolute, 50_000);
  const ids: string[] = [];
  for (const chunk of index.chunks) {
    for (const row of await readSeedRange(seedAbsolute, index.headerText, chunk.start, chunk.end)) {
      ids.push(row.parcel_id);
    }
  }
  return ids;
}

function reasonCategory(reason: string | null | undefined): string {
  if (!reason) return "unspecified";
  return reason.split(":")[0]!.trim() || "unspecified";
}

function bump(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

export type Gate = { name: string; status: "pass" | "fail" | "not_started"; detail: string };

export type ReconcileOptions = {
  county: string;
  jobId: string;
  ledger: LedgerSnapshot;
  seedPath?: string;
  /** Where seedPath came from: argument, CountyIngest state, or the default. */
  seedSource?: string;
  strict?: boolean;
  assemble?: string | null;
  rehash?: boolean;
  now?: () => Date;
};

const SAMPLE = 200;

export async function reconcileCounty(options: ReconcileOptions) {
  const { county, jobId, ledger } = options;
  const rehash = options.rehash !== false;
  const now = options.now ?? (() => new Date());
  const seedRelative = options.seedPath ?? path.join("seeds", `${county}.csv`);
  const seedAbsolute = resolveUnderData(seedRelative);

  // --- seed -----------------------------------------------------------------
  const seedIds = (await exists(seedAbsolute)) ? await readSeedIds(seedAbsolute) : [];
  const seedSet = new Set<string>();
  const duplicateSeedIds: string[] = [];
  for (const id of seedIds) {
    if (seedSet.has(id)) duplicateSeedIds.push(id);
    seedSet.add(id);
  }
  const keyOwners = new Map<string, string>();
  const keyCollisions: Array<{ key: string; parcelIds: string[] }> = [];
  for (const id of seedSet) {
    const key = safeKeyPart(id);
    const owner = keyOwners.get(key);
    if (owner !== undefined && owner !== id) keyCollisions.push({ key, parcelIds: [owner, id] });
    else keyOwners.set(key, id);
  }

  // --- files ----------------------------------------------------------------
  const files = await scanParcelFiles(county, jobId, rehash);
  const filesByParcel = new Map<string, FileParcel>();
  const markerKeyMismatches: Array<{ key: string; parcel_id: string }> = [];
  for (const parcel of files) {
    if (parcel.parcelId === null) continue;
    if (safeKeyPart(parcel.parcelId) !== parcel.key) {
      markerKeyMismatches.push({ key: parcel.key, parcel_id: parcel.parcelId });
    }
    filesByParcel.set(parcel.parcelId, parcel);
  }

  // --- ledger accounting ----------------------------------------------------
  const counts: Record<LedgerStatus, number> = emptyCounts();
  const reasons: Record<"dead" | "invalid" | "failed", Record<string, number>> = {
    dead: {},
    invalid: {},
    failed: {},
  };
  const unrecorded: string[] = [];
  for (const id of seedSet) {
    const entry = ledger.parcels.get(id);
    if (!entry) {
      unrecorded.push(id);
      continue;
    }
    counts[entry.status] += 1;
    if (entry.status === "dead" || entry.status === "invalid" || entry.status === "failed") {
      bump(reasons[entry.status], reasonCategory(entry.reason));
    }
  }
  const ledgerOutsideSeed = [...ledger.parcels.keys()].filter((id) => !seedSet.has(id));
  const tombstones = [...ledger.parcels.values()].filter((entry) => entry.tombstoned).map((entry) => entry.parcel_id);

  // --- ledger vs files ------------------------------------------------------
  const mismatches: Array<{ parcel_id: string; issue: string }> = [];
  const verifiedReady = new Map<string, { key: string; transformedHash: string }>();
  let readyMarkers = 0;
  const hashMismatches: Array<{ parcel_id: string; issue: string }> = [];
  for (const [id, entry] of ledger.parcels) {
    const file = filesByParcel.get(id);
    if (entry.status === "ready") {
      if (!file?.ready) {
        mismatches.push({ parcel_id: id, issue: "ledger ready but ready.json missing" });
        hashMismatches.push({ parcel_id: id, issue: "no ready marker" });
        continue;
      }
      readyMarkers += 1;
      if (file.ready.transformedHash !== entry.artifactHash) {
        hashMismatches.push({ parcel_id: id, issue: "ready.json hash differs from ledger artifactHash" });
      } else if (file.ready.transformVersion !== entry.transformVersion) {
        hashMismatches.push({ parcel_id: id, issue: "ready.json transformVersion differs from ledger" });
      } else if (!file.transformedPresent) {
        hashMismatches.push({ parcel_id: id, issue: "transformed.zip missing" });
      } else if (file.transformedHash !== file.ready.transformedHash) {
        hashMismatches.push({ parcel_id: id, issue: "transformed.zip content differs from ready.json hash" });
      } else {
        verifiedReady.set(id, { key: file.key, transformedHash: file.ready.transformedHash });
      }
    } else if (entry.status === "dead" && !file?.dead) {
      mismatches.push({ parcel_id: id, issue: "ledger dead but dead.json missing" });
    } else if (entry.status === "invalid" && !file?.invalid) {
      mismatches.push({ parcel_id: id, issue: "ledger invalid but invalid.json missing" });
    } else if (entry.status === "failed" && !file?.failed) {
      mismatches.push({ parcel_id: id, issue: "ledger failed but failed.json missing" });
    }
    if (entry.status !== "ready" && entry.status !== "pending" && file?.ready) {
      mismatches.push({ parcel_id: id, issue: `ready.json present but ledger says ${entry.status}` });
    }
  }
  for (const [id, file] of filesByParcel) {
    if (!ledger.parcels.has(id) && (file.ready || file.dead || file.invalid || file.failed)) {
      mismatches.push({ parcel_id: id, issue: "status marker without a ledger entry" });
    }
  }

  // --- permits ----------------------------------------------------------------
  const statusDir = dataPath("artifacts", "permits", county, jobId, "status");
  const statusFiles = (await exists(statusDir))
    ? (await readdir(statusDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name)
    : [];
  const permitStats = {
    statusFiles: statusFiles.length,
    harvestStatus: {} as Record<string, number>,
    permits: 0,
    linked: 0,
    unlinked: 0,
    unlinkedByReason: {} as Record<string, number>,
    parcelsWithoutPermitsByReason: {} as Record<string, number>,
    unlinkedWithoutReason: [] as Array<{ parcel_id: string; sourceRecordId: string }>,
    wrongParcel: [] as string[],
    eligibleWithoutStatus: 0,
    ledgerMismatches: [] as Array<{ parcel_id: string; issue: string }>,
    // A blocked source (captcha, login, custodian-only) is harvestable later;
    // reported apart from parcels that have no permit source at all.
    blocked: { parcels: 0, byJurisdiction: {} as Record<string, number> },
  };
  const statusParcels = new Set<string>();
  for (const name of statusFiles) {
    const status = await readJsonIfExists<PermitParcelStatus>(path.join(statusDir, name));
    if (!status || typeof status.parcel_id !== "string") continue;
    statusParcels.add(status.parcel_id);
    if (`${safeKeyPart(status.parcel_id)}.json` !== name) permitStats.wrongParcel.push(name);
    bump(permitStats.harvestStatus, status.harvestStatus);
    if (status.harvestStatus === "blocked") {
      permitStats.blocked.parcels += 1;
      bump(permitStats.blocked.byJurisdiction, status.jurisdictionKey ?? "unknown");
    }
    if (status.parcelReason && status.permits.length === 0) {
      bump(permitStats.parcelsWithoutPermitsByReason, reasonCategory(status.parcelReason));
    }
    for (const permit of status.permits ?? []) {
      permitStats.permits += 1;
      if (permit.link === "linked") {
        permitStats.linked += 1;
      } else {
        permitStats.unlinked += 1;
        if (!permit.reason) {
          permitStats.unlinkedWithoutReason.push({
            parcel_id: status.parcel_id,
            sourceRecordId: permit.sourceRecordId,
          });
        } else {
          bump(permitStats.unlinkedByReason, reasonCategory(permit.reason));
        }
      }
    }
    if (ledger.source !== "none" && !ledger.permits.has(status.parcel_id)) {
      permitStats.ledgerMismatches.push({ parcel_id: status.parcel_id, issue: "status file without ledger permits entry" });
    }
  }
  for (const [id, file] of filesByParcel) {
    if (file.ready && file.eligible === true && !statusParcels.has(id)) permitStats.eligibleWithoutStatus += 1;
  }
  const permitsStarted = statusFiles.length > 0 || ledger.permits.size > 0;

  // --- gates -------------------------------------------------------------------
  const ledgerOk = ledger.source !== "none";
  const seedUnique = seedSet.size;
  const ledgerReadyTotal = [...ledger.parcels.values()].filter((entry) => entry.status === "ready").length;
  const accounted = counts.ready + counts.dead + counts.invalid + counts.pending + counts.failed;
  const gates: Gate[] = [
    {
      name: "seed_accounted",
      status:
        ledgerOk && seedUnique > 0 && accounted === seedUnique && unrecorded.length === 0 && ledgerOutsideSeed.length === 0
          ? "pass"
          : "fail",
      detail: ledgerOk
        ? `seed ${seedUnique} = ready ${counts.ready} + dead ${counts.dead} + invalid ${counts.invalid} + pending ${counts.pending} + failed ${counts.failed}; unrecorded ${unrecorded.length}; ledger-only ${ledgerOutsideSeed.length}`
        : `ledger unavailable: ${ledger.error ?? "unknown"}`,
    },
    {
      name: "seed_complete",
      status:
        ledgerOk && seedUnique > 0 && counts.ready + counts.dead + counts.invalid === seedUnique ? "pass" : "fail",
      detail: `seed ${seedUnique} vs ready+dead+invalid ${counts.ready + counts.dead + counts.invalid} (pending ${counts.pending}, failed ${counts.failed})`,
    },
    {
      name: "no_duplicate_keys",
      status:
        duplicateSeedIds.length === 0 && keyCollisions.length === 0 && markerKeyMismatches.length === 0
          ? "pass"
          : "fail",
      detail: `duplicate seed ids ${duplicateSeedIds.length}; key collisions ${keyCollisions.length}; marker/key mismatches ${markerKeyMismatches.length}`,
    },
    {
      name: "ready_hash_coverage",
      status: ledgerOk && hashMismatches.length === 0 ? "pass" : "fail",
      detail: `${verifiedReady.size}/${ledgerReadyTotal} ledger-ready parcels verified${rehash ? " (rehashed)" : " (marker-only)"}; ${hashMismatches.length} mismatch(es)`,
    },
    {
      name: "ledger_files_agree",
      status: ledgerOk && mismatches.length === 0 ? "pass" : "fail",
      detail: `${mismatches.length} mismatch(es) between ledger and status markers`,
    },
    {
      name: "permits_linked",
      status: permitStats.unlinkedWithoutReason.length === 0 && permitStats.wrongParcel.length === 0 ? "pass" : "fail",
      detail: `${permitStats.permits} harvested: ${permitStats.linked} linked, ${permitStats.unlinked} unlinked (${permitStats.unlinkedWithoutReason.length} without reason)`,
    },
    {
      name: "permits_complete",
      status: !permitsStarted
        ? "not_started"
        : permitStats.eligibleWithoutStatus === 0 && permitStats.ledgerMismatches.length === 0
          ? "pass"
          : "fail",
      detail: permitsStarted
        ? `${permitStats.eligibleWithoutStatus} eligible ready parcel(s) without a permit status; ${permitStats.ledgerMismatches.length} status/ledger mismatch(es)`
        : "no permit pass has run for this job",
    },
  ];
  // --- assembly + tombstones ------------------------------------------------
  // With --strict, a failing gate blocks assembly: nothing partial is staged.
  const preAssemblyFailures = gates.filter((gate) => gate.status === "fail").map((gate) => gate.name);
  const assembly = !options.assemble
    ? null
    : options.strict && preAssemblyFailures.length
      ? { group: options.assemble, skipped: true, reason: `strict gates failed: ${preAssemblyFailures.join(", ")}` }
      : await assembleGroup(county, jobId, options.assemble, verifiedReady, filesByParcel);
  const groupsRoot = dataPath("groups", county, jobId);
  const groupViolations: Array<{ group: string; entry: string; issue: string }> = [];
  const readyByKey = new Map([...verifiedReady.values()].map((value) => [value.key, value]));
  const tombstoneKeys = new Set(tombstones.map((id) => safeKeyPart(id)));
  if (await exists(groupsRoot)) {
    for (const group of await readdir(groupsRoot, { withFileTypes: true })) {
      if (!group.isDirectory()) continue;
      const index =
        (await readJsonIfExists<{ entries?: Record<string, { transformedHash: string }> }>(
          path.join(groupsRoot, `${group.name}.assembly.json`),
        )) ?? {};
      for (const entry of await readdir(path.join(groupsRoot, group.name))) {
        const key = entry.replace(/\.zip$/, "");
        if (tombstoneKeys.has(key)) {
          groupViolations.push({ group: group.name, entry, issue: "tombstoned parcel in group" });
        } else if (!readyByKey.has(key)) {
          groupViolations.push({ group: group.name, entry, issue: "parcel is not verified ready" });
        } else if (index.entries?.[key]?.transformedHash !== readyByKey.get(key)!.transformedHash) {
          groupViolations.push({ group: group.name, entry, issue: "stale: assembled from an older transform" });
        }
      }
    }
  }

  gates.push({
    name: "tombstones_excluded",
    status: groupViolations.length === 0 ? "pass" : "fail",
    detail: `${tombstones.length} tombstone(s); ${groupViolations.length} group entr(y/ies) that are not verified ready`,
  });
  const failed = gates.filter((gate) => gate.status === "fail").map((gate) => gate.name);

  const manifest = {
    schemaVersion: MANIFEST_SCHEMA,
    county,
    jobId,
    generatedAt: now().toISOString(),
    ledger: {
      source: ledger.source,
      key: `${county}-${jobId}`,
      error: ledger.error,
      entries: ledger.parcels.size,
      summary: ledger.summary,
    },
    seed: {
      path: seedRelative,
      source: options.seedSource ?? (options.seedPath ? "argument" : "default"),
      present: seedIds.length > 0,
      rows: seedIds.length,
      unique: seedUnique,
      duplicates: duplicateSeedIds.slice(0, SAMPLE),
      keyCollisions: keyCollisions.slice(0, SAMPLE),
    },
    counts: { ...counts, unrecorded: unrecorded.length, ledgerOutsideSeed: ledgerOutsideSeed.length },
    reasons,
    tombstones: { count: tombstones.length, parcels: tombstones.slice(0, SAMPLE) },
    readyHashCoverage: {
      ledgerReady: counts.ready,
      readyMarkers,
      verified: verifiedReady.size,
      rehashed: rehash,
      mismatches: hashMismatches.slice(0, SAMPLE),
    },
    permits: {
      ...permitStats,
      started: permitsStarted,
      unlinkedWithoutReason: permitStats.unlinkedWithoutReason.slice(0, SAMPLE),
      ledgerMismatches: permitStats.ledgerMismatches.slice(0, SAMPLE),
      ledgerCounts: ledger.summary?.permits ?? null,
    },
    mismatches: {
      count: mismatches.length,
      items: mismatches.slice(0, SAMPLE),
      markerKeyMismatches: markerKeyMismatches.slice(0, SAMPLE),
      unrecordedSeedParcels: unrecorded.slice(0, SAMPLE),
      ledgerOutsideSeed: ledgerOutsideSeed.slice(0, SAMPLE),
    },
    groups: { violations: groupViolations.slice(0, SAMPLE), assembly },
    gates,
    failedGates: failed,
    strict: options.strict === true,
  };
  const manifestPath = path.join(paths.run(county, jobId), "manifest.json");
  await atomicWriteJson(manifestPath, manifest);
  return { manifest, manifestPath, exitCode: options.strict && failed.length ? 1 : 0 };
}

/**
 * Assemble `data/groups/<county>/<jobId>/<group>/<parcelKey>.zip` from
 * verified ready parcels only, each filtered to the requested data group.
 * Entries for parcels that are no longer ready (tombstones) are removed;
 * unchanged entries are skipped by transformed hash.
 */
export async function assembleGroup(
  county: string,
  jobId: string,
  group: string,
  verifiedReady: Map<string, { key: string; transformedHash: string }>,
  filesByParcel: Map<string, FileParcel>,
) {
  const groupDir = paths.group(county, jobId, group);
  const indexPath = path.join(path.dirname(groupDir), `${group}.assembly.json`);
  const previous =
    (await readJsonIfExists<{ entries?: Record<string, { parcel_id: string; transformedHash: string }> }>(indexPath))
      ?.entries ?? {};
  const entries: Record<string, { parcel_id: string; transformedHash: string; labels: string[] }> = {};
  let written = 0;
  let skipped = 0;
  let withoutGroup = 0;
  for (const [parcelId, ready] of [...verifiedReady.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const dest = path.join(groupDir, `${ready.key}.zip`);
    const prior = previous[ready.key];
    if (prior?.transformedHash === ready.transformedHash && (await exists(dest))) {
      entries[ready.key] = { parcel_id: parcelId, transformedHash: ready.transformedHash, labels: [] };
      skipped += 1;
      continue;
    }
    const file = filesByParcel.get(parcelId)!;
    const source = path.join(paths.appraisalJob(county, jobId), file.key, FILES.transformed);
    const result = await filterZipToGroup(source, dest, group);
    if (result.files === 0) {
      await removeIfExists(dest);
      withoutGroup += 1;
      continue;
    }
    entries[ready.key] = { parcel_id: parcelId, transformedHash: ready.transformedHash, labels: result.labels };
    written += 1;
  }
  let removed = 0;
  if (await exists(groupDir)) {
    for (const entry of await readdir(groupDir)) {
      if (!entries[entry.replace(/\.zip$/, "")]) {
        await removeIfExists(path.join(groupDir, entry));
        removed += 1;
      }
    }
  }
  await atomicWriteJson(indexPath, {
    county,
    jobId,
    group,
    generatedAt: new Date().toISOString(),
    entries,
  });
  return {
    group,
    groupDir: path.relative(dataPath(), groupDir),
    parcels: Object.keys(entries).length,
    written,
    skipped,
    removed,
    withoutGroup,
  };
}
