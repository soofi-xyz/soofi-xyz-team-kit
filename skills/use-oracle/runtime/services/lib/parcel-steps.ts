/**
 * Per-parcel step functions called by `Parcel.process` inside `ctx.run`.
 *
 * Each step is idempotent with deterministic paths under
 * `data/artifacts/appraisal/<county>/<jobId>/<parcelKey>/` and skips existing
 * work when its input hash and the transform version match. Status markers are
 * ordered (durable-workflow-builder pattern 7): transform removes `ready.json`
 * before regenerating, `ready.json` is written only after validation passes,
 * and dead/invalid/failed remove `ready.json` and `eligibility.json`.
 */
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import AdmZip from "adm-zip";

import { encodeCsvCell } from "../../src/core/csv.mjs";
import {
  cliErrorText,
  cliIdentity,
  type CliIdentity,
  isTransientCliFailure,
  runElephantCli,
} from "./cli.ts";
import {
  captureTimeoutMs,
  type CaptureOutcome,
  countyDisplayName,
  loadCapturePlugin,
  resolveEligibilityPolicy,
  resolvePrepareConfig,
  resolveSourceRequest,
  type TransformConfig,
} from "./county-config.ts";
import {
  atomicWriteJson,
  exists,
  promote,
  readJsonIfExists,
  removeIfExists,
  sha256File,
  temporaryPathFor,
} from "./storage.ts";
import { seedCsvColumns, type SourceRequest } from "./source-request.ts";
import { captureSourceRequest, listDataGroups, mergeTransformedZips, readZipJson } from "./zip.ts";

export type ParcelRequest = {
  county: string;
  jobId: string;
  parcel_id: string;
  source_identifier?: string;
  situs_address?: string;
  extra?: Record<string, string>;
};

export const FILES = {
  seed: "seed.zip",
  capture: "capture.zip",
  transformed: "transformed.zip",
  transformedMeta: "transformed.meta.json",
  findings: "validate-findings.csv",
  ready: "ready.json",
  dead: "dead.json",
  invalid: "invalid.json",
  failed: "failed.json",
  eligibility: "eligibility.json",
} as const;

export type ReadyMarker = {
  parcel_id: string;
  captureHash: string;
  transformVersion: string;
  transformedHash: string;
  validatedAt: string;
  cli: { version: string | null; commit: string | null };
  dataGroups: string[];
};

export type TransformMeta = {
  parcel_id: string;
  captureHash: string;
  transformVersion: string;
  transformedHash: string;
  transformedAt: string;
  cli: { version: string | null; commit: string | null };
  seed?: { mode: "auto" | "off"; merged: boolean; added?: string[]; keptCountyCopy?: string[] };
};

export type CaptureResult =
  | { status: "captured"; captureHash: string; mechanism: string; skipped: boolean }
  | { status: "dead"; reason: string }
  | { status: "failed"; reason: string };

export type TransformResult =
  | { status: "transformed"; transformedHash: string; transformVersion: string; skipped: boolean }
  | { status: "failed"; reason: string };

export type ValidateResult =
  | { valid: true; skipped: boolean }
  | { valid: false; errorCount: number; errors: Array<Record<string, string>> };

const file = (dir: string, name: keyof typeof FILES) => path.join(dir, FILES[name]);

/** HTTP 404/410 from the source means the parcel is gone: dead, not retried. */
export function isGoneAtSource(message: string): boolean {
  return /\bHTTP (?:error )?(404|410)\b/i.test(message);
}

/** Prepare mechanisms that build their own requests from `request_identifier`. */
export const FLOW_MECHANISMS = new Set(["multi-request-flow", "browser-flow", "browser-flow-zip"]);

async function buildSeedZip(
  req: ParcelRequest,
  dest: string,
  mechanism: string,
  request: SourceRequest | null,
): Promise<boolean> {
  if (!request && !FLOW_MECHANISMS.has(mechanism)) return false;
  const identifier = req.source_identifier ?? req.parcel_id;
  const zip = new AdmZip();
  zip.addFile(
    "property_seed.json",
    Buffer.from(
      `${JSON.stringify(
        {
          parcel_id: req.parcel_id,
          ...(request ? { source_http_request: request } : {}),
          request_identifier: identifier,
        },
        null,
        2,
      )}\n`,
    ),
  );
  const address = req.situs_address ?? req.extra?.address ?? null;
  zip.addFile(
    "unnormalized_address.json",
    Buffer.from(
      `${JSON.stringify(
        {
          full_address: address,
          unnormalized_address: address,
          county_jurisdiction: countyDisplayName(req.county),
          request_identifier: identifier,
        },
        null,
        2,
      )}\n`,
    ),
  );
  const temporary = temporaryPathFor(dest);
  zip.writeZip(temporary);
  await promote(temporary, dest);
  return true;
}

/**
 * Raw capture to `capture.zip` (raw-first: transform never reads a live page).
 * Skips when the capture already exists.
 */
export async function captureParcel(req: ParcelRequest, dir: string): Promise<CaptureResult> {
  const dest = file(dir, "capture");
  if (await exists(dest)) {
    return { status: "captured", captureHash: await sha256File(dest), mechanism: "existing", skipped: true };
  }
  const plugin = await loadCapturePlugin(req.county);
  if (plugin) {
    // The plug-in may write scratch files next to the capture.
    await mkdir(dir, { recursive: true });
    const temporary = temporaryPathFor(dest);
    const timeoutMs = captureTimeoutMs(req.county);
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort(new Error(`capture timed out after ${timeoutMs} ms`));
        reject(new Error(`capture plug-in timed out after ${timeoutMs} ms`));
      }, timeoutMs);
    });
    let outcome: CaptureOutcome;
    try {
      outcome = await Promise.race([
        plugin.capture(
          {
            county: req.county,
            jobId: req.jobId,
            parcel_id: req.parcel_id,
            source_identifier: req.source_identifier,
            situs_address: req.situs_address,
            extra: req.extra ?? {},
            dest: temporary,
            parcelDir: dir,
          },
          { signal: controller.signal, timeoutMs, parcelDir: dir },
        ),
        timedOut,
      ]);
    } catch (error) {
      // Timeouts and plug-in errors are transient: retried with backoff.
      await removeIfExists(temporary);
      throw error;
    } finally {
      clearTimeout(timer);
    }
    const captured = outcome === true || (typeof outcome === "object" && outcome.status === "captured");
    if (!captured) {
      await removeIfExists(temporary);
      const reason =
        typeof outcome === "object" && outcome.status === "dead" ? outcome.reason : "gone-at-source";
      return { status: "dead", reason };
    }
    if (!(await exists(temporary))) {
      throw new Error("capture plug-in reported success but wrote no capture ZIP");
    }
    await promote(temporary, dest);
    return { status: "captured", captureHash: await sha256File(dest), mechanism: "plugin", skipped: false };
  }
  const prepare = await resolvePrepareConfig(req.county);
  const seedZip = file(dir, "seed");
  let request: SourceRequest | null;
  try {
    request = resolveSourceRequest(req.county, req);
  } catch (error) {
    return { status: "failed", reason: `bad-source-request: ${(error as Error).message}` };
  }
  if (!(await buildSeedZip(req, seedZip, prepare.mechanism, request))) {
    // A configuration gap, not a gone parcel: recorded as failed for redrive.
    return { status: "failed", reason: "no-source-url: set source_url in the seed or PREPARE_URL_TEMPLATE_<COUNTY>" };
  }
  const temporary = temporaryPathFor(dest);
  const result = await runElephantCli(
    ["prepare", seedZip, "--output-zip", temporary, ...prepare.flags],
    { cwd: dir, timeoutMs: 15 * 60 * 1000 },
  );
  if (result.code !== 0) {
    await removeIfExists(temporary);
    const message = cliErrorText(result);
    if (isGoneAtSource(message)) return { status: "dead", reason: `gone-at-source: ${message}` };
    // Anything else (network, 5xx, browser start) is transient: retry with backoff.
    throw new Error(`prepare failed: ${message}`);
  }
  await promote(temporary, dest);
  return {
    status: "captured",
    captureHash: await sha256File(dest),
    mechanism: prepare.mechanism,
    skipped: false,
  };
}

/**
 * Seed group from the seed row (the CLI's seed-mode transform), merged into
 * the county output when the county transform does not emit Seed itself.
 * Files present in both keep the county copy, so both groups share them.
 */
async function mergeSeedGroup(
  req: ParcelRequest,
  dir: string,
  countyOutput: string,
): Promise<
  | { status: "merged"; seed: NonNullable<TransformMeta["seed"]> }
  | { status: "failed"; reason: string }
> {
  // The request the capture actually made wins; the seed row/template is the fallback.
  let request: SourceRequest | null;
  try {
    request = captureSourceRequest(file(dir, "capture")) ?? resolveSourceRequest(req.county, req);
  } catch (error) {
    return { status: "failed", reason: `seed-transform-failed: ${(error as Error).message}` };
  }
  if (!request) {
    return { status: "failed", reason: "seed-transform-failed: no source request for the Seed group" };
  }
  const row: Record<string, string> = {
    parcel_id: req.parcel_id,
    address: req.situs_address ?? req.extra?.address ?? "",
    county: countyDisplayName(req.county),
    source_identifier: req.source_identifier ?? req.parcel_id,
    ...seedCsvColumns(request),
  };
  const columns = Object.keys(row);
  const values = columns.map((column) => row[column]!);
  const seedInput = path.join(dir, "seed-transform-input.zip");
  const zip = new AdmZip();
  zip.addFile(
    "seed.csv",
    Buffer.from(`${columns.join(",")}\n${values.map((value) => encodeCsvCell(value)).join(",")}\n`),
  );
  const temporaryInput = temporaryPathFor(seedInput);
  zip.writeZip(temporaryInput);
  await promote(temporaryInput, seedInput);
  const seedOutput = temporaryPathFor(path.join(dir, "seed-transformed.zip"));
  const result = await runElephantCli(
    ["transform", "--input-zip", seedInput, "--output-zip", seedOutput],
    { cwd: dir, timeoutMs: 5 * 60 * 1000 },
  );
  if (result.code !== 0) {
    await removeIfExists(seedOutput);
    const message = cliErrorText(result);
    if (isTransientCliFailure(message)) throw new Error(`seed transform could not run: ${message}`);
    return { status: "failed", reason: `seed-transform-failed: ${message}` };
  }
  const merged = await mergeTransformedZips(countyOutput, seedOutput, countyOutput);
  await removeIfExists(seedOutput);
  return {
    status: "merged",
    seed: { mode: "auto", merged: true, added: merged.added, keptCountyCopy: merged.keptPrimary },
  };
}

/** Transform `capture.zip` → `transformed.zip`; skips iff capture hash and version match. */
export async function transformParcel(
  req: ParcelRequest,
  dir: string,
  captureHash: string,
  transform: TransformConfig,
): Promise<TransformResult> {
  const dest = file(dir, "transformed");
  const metaPath = file(dir, "transformedMeta");
  const meta = await readJsonIfExists<TransformMeta>(metaPath);
  if (
    meta &&
    meta.captureHash === captureHash &&
    meta.transformVersion === transform.transformVersion &&
    (await exists(dest)) &&
    (await sha256File(dest)) === meta.transformedHash
  ) {
    return {
      status: "transformed",
      transformedHash: meta.transformedHash,
      transformVersion: meta.transformVersion,
      skipped: true,
    };
  }
  // A replacement is never loadable until it is validated again.
  await removeIfExists(file(dir, "ready"));
  await removeIfExists(metaPath);
  const temporary = temporaryPathFor(dest);
  const args = [
    "transform",
    "--input-zip",
    file(dir, "capture"),
    "--output-zip",
    temporary,
    transform.kind === "handler" ? "--transform-zip" : "--scripts-zip",
    transform.zipPath,
  ];
  if (transform.dataGroup) args.push("--data-group", transform.dataGroup);
  const result = await runElephantCli(args, { cwd: dir, timeoutMs: 15 * 60 * 1000 });
  if (result.code !== 0) {
    await removeIfExists(temporary);
    const message = cliErrorText(result);
    if (isTransientCliFailure(message)) throw new Error(`transform could not run: ${message}`);
    // The script or handler rejected this input: deterministic, so recorded, not retried.
    return { status: "failed", reason: `transform-failed: ${message}` };
  }
  let seed: TransformMeta["seed"] = { mode: transform.seed, merged: false };
  if (transform.seed === "auto" && !listDataGroups(temporary).some((label) => label === "Seed")) {
    const merged = await mergeSeedGroup(req, dir, temporary);
    if (merged.status === "failed") {
      await removeIfExists(temporary);
      return merged;
    }
    seed = merged.seed;
  }
  await promote(temporary, dest);
  const transformedHash = await sha256File(dest);
  const identity = await cliIdentity();
  await atomicWriteJson(metaPath, {
    parcel_id: req.parcel_id,
    captureHash,
    transformVersion: transform.transformVersion,
    transformedHash,
    transformedAt: new Date().toISOString(),
    cli: { version: identity.version, commit: identity.commit },
    seed,
  } satisfies TransformMeta);
  return { status: "transformed", transformedHash, transformVersion: transform.transformVersion, skipped: false };
}

function parseFindings(csv: string, limit: number): Array<Record<string, string>> {
  const lines = csv.trim().split("\n");
  if (lines.length <= 1) return [];
  return lines.slice(1, limit + 1).map((line) => ({ finding: line.slice(0, 400) }));
}

/** Fail-closed validation: only exit 0 marks the parcel ready. */
export async function validateParcel(
  dir: string,
  transformedHash: string,
  transformVersion: string,
): Promise<ValidateResult> {
  const ready = await readJsonIfExists<ReadyMarker>(file(dir, "ready"));
  if (ready && ready.transformedHash === transformedHash && ready.transformVersion === transformVersion) {
    return { valid: true, skipped: true };
  }
  const findings = file(dir, "findings");
  const result = await runElephantCli(
    ["validate", file(dir, "transformed"), "--output-csv", findings],
    { cwd: dir, timeoutMs: 15 * 60 * 1000 },
  );
  if (result.code === 0) return { valid: true, skipped: false };
  if (result.code === 1) {
    const csv = await readFile(findings, "utf8").catch(() => "");
    const errorCount = Number(result.json?.error_count ?? 0) || Math.max(0, csv.trim().split("\n").length - 1);
    return { valid: false, errorCount, errors: parseFindings(csv, 20) };
  }
  // Exit 2: could not run. Network-shaped failures retry; anything else fails closed.
  const message = cliErrorText(result);
  if (isTransientCliFailure(message)) throw new Error(`validate could not run: ${message}`);
  return { valid: false, errorCount: 1, errors: [{ finding: `validate could not run: ${message}` }] };
}

export async function markReady(
  req: ParcelRequest,
  dir: string,
  values: { captureHash: string; transformVersion: string; transformedHash: string },
  identity?: CliIdentity,
): Promise<ReadyMarker> {
  const cli = identity ?? (await cliIdentity());
  const marker: ReadyMarker = {
    parcel_id: req.parcel_id,
    captureHash: values.captureHash,
    transformVersion: values.transformVersion,
    transformedHash: values.transformedHash,
    validatedAt: new Date().toISOString(),
    cli: { version: cli.version, commit: cli.commit },
    dataGroups: listDataGroups(file(dir, "transformed")),
  };
  // Status files reflect CURRENT state: a pass clears every stale marker.
  await removeIfExists(file(dir, "dead"));
  await removeIfExists(file(dir, "invalid"));
  await removeIfExists(file(dir, "failed"));
  await atomicWriteJson(file(dir, "ready"), marker);
  return marker;
}

async function writeTerminal(
  dir: string,
  name: "dead" | "invalid" | "failed",
  body: Record<string, unknown>,
): Promise<void> {
  await removeIfExists(file(dir, "ready"));
  await removeIfExists(file(dir, "eligibility"));
  for (const other of ["dead", "invalid", "failed"] as const) {
    if (other !== name) await removeIfExists(file(dir, other));
  }
  await atomicWriteJson(file(dir, name), { ...body, recordedAt: new Date().toISOString() });
}

export const markDead = (req: ParcelRequest, dir: string, reason: string) =>
  writeTerminal(dir, "dead", { parcel_id: req.parcel_id, reason });

export const markInvalid = (
  req: ParcelRequest,
  dir: string,
  result: { errorCount: number; errors: Array<Record<string, string>> },
) =>
  writeTerminal(dir, "invalid", {
    parcel_id: req.parcel_id,
    reason: `validation-failed: ${result.errorCount} finding(s)`,
    errorCount: result.errorCount,
    errors: result.errors,
    findings: FILES.findings,
  });

export const markFailed = (req: ParcelRequest, dir: string, reason: string) =>
  writeTerminal(dir, "failed", { parcel_id: req.parcel_id, reason });

export type Eligibility = {
  parcel_id: string;
  eligible: boolean;
  usageType: string | null;
  policyFingerprint: string;
  policyMode: string;
  routing: {
    parcel_identifier: string;
    source_identifier: string | null;
    situs_address: string | null;
    city: string | null;
    /** The full seed row (canonical fields + extra columns) for routing hooks. */
    seed?: Record<string, string>;
  };
};

/** Permit eligibility from the TRANSFORMED output (usage type), not the seed row. */
export async function writeEligibility(req: ParcelRequest, dir: string): Promise<Eligibility> {
  const policy = resolveEligibilityPolicy(req.county);
  const property = readZipJson(file(dir, "transformed"), "property.json");
  const usageType =
    typeof property?.property_usage_type === "string" ? property.property_usage_type : null;
  const eligible =
    policy.mode === "all" ||
    (policy.mode === "list" && usageType !== null && policy.usageTypes.includes(usageType));
  const extra = req.extra ?? {};
  const eligibility: Eligibility = {
    parcel_id: req.parcel_id,
    eligible,
    usageType,
    policyFingerprint: policy.fingerprint,
    policyMode: policy.mode,
    routing: {
      parcel_identifier: extra.permit_parcel_identifier ?? req.parcel_id,
      source_identifier: req.source_identifier ?? null,
      situs_address: req.situs_address ?? extra.address ?? null,
      city: extra.city ?? extra.situs_city ?? extra.address_city ?? null,
      seed: {
        ...extra,
        parcel_id: req.parcel_id,
        ...(req.source_identifier ? { source_identifier: req.source_identifier } : {}),
        ...(req.situs_address ? { situs_address: req.situs_address } : {}),
      },
    },
  };
  await atomicWriteJson(file(dir, "eligibility"), eligibility);
  return eligibility;
}
