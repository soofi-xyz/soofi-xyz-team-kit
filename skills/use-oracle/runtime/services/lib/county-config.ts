/**
 * Per-county capture and transform resolution.
 *
 * Capture: `src/counties/<county>/capture.mjs` exporting `capture(...)` wins
 * (custom browser capture such as a challenge-protected appraiser). Otherwise
 * `elephant-cli prepare` runs with the county's flow/config.
 *
 * Transform: a Transform v2 handler package (`--transform-zip`) wins over the
 * county scripts directory (`--scripts-zip`). The transform version is the
 * content digest of that package plus the data-group label, so a changed
 * transform regenerates stale output and an unchanged one is skipped.
 *
 * Every per-county env name uses the `<NAME>_<COUNTY>` suffix rule
 * (`palm-beach` → `PALM_BEACH`).
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import AdmZip from "adm-zip";

import { countyEnv, countyOnlyEnv, envFlag, RUNTIME_DIR } from "./config.ts";
import { dataPath, exists, promote, sha256File, temporaryPathFor } from "./storage.ts";

export type CaptureInput = {
  county: string;
  jobId: string;
  parcel_id: string;
  source_identifier?: string;
  situs_address?: string;
  extra?: Record<string, string>;
  /** Absolute path the plug-in must write the prepared ZIP to. */
  dest: string;
  /** Absolute parcel artifact directory (scratch files may go here). */
  parcelDir: string;
};

export type CaptureOutcome =
  | boolean
  | { status: "captured" }
  | { status: "dead"; reason: string };

export type CapturePlugin = {
  capture: (input: CaptureInput, ctx: { signal?: AbortSignal }) => Promise<CaptureOutcome>;
};

export type PrepareConfig = {
  flags: string[];
  mechanism: string;
};

export type TransformConfig = {
  kind: "handler" | "scripts";
  /** ZIP passed to the CLI. */
  zipPath: string;
  dataGroup: string | null;
  /**
   * `auto`: when the county transform emits no Seed root, also run the CLI's
   * seed-mode transform from the seed row and merge it in (hash needs the
   * Seed group in every property). `off`: the county transform owns Seed.
   */
  seed: "auto" | "off";
  transformVersion: string;
};

const pluginCache = new Map<string, Promise<CapturePlugin | null>>();

/** County capture plug-in, or null when the county uses `elephant-cli prepare`. */
export function loadCapturePlugin(county: string): Promise<CapturePlugin | null> {
  const override = countyOnlyEnv("CAPTURE_MODULE", county);
  const modulePath = override
    ? path.resolve(RUNTIME_DIR, override)
    : path.join(RUNTIME_DIR, "src", "counties", county, "capture.mjs");
  const cacheKey = `${county}\u0000${modulePath}`;
  let loaded = pluginCache.get(cacheKey);
  if (!loaded) {
    loaded = (async () => {
      if (!(await exists(modulePath))) {
        if (override) throw new Error(`CAPTURE_MODULE for ${county} not found`);
        return null;
      }
      const module = (await import(pathToFileURL(modulePath).href)) as Partial<CapturePlugin>;
      if (typeof module.capture !== "function") {
        throw new Error(`${path.relative(RUNTIME_DIR, modulePath)} must export capture()`);
      }
      return module as CapturePlugin;
    })();
    pluginCache.set(cacheKey, loaded);
  }
  return loaded;
}

async function firstExisting(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

/** `palm-beach` → `Palm Beach` unless COUNTY_NAME_<COUNTY> says otherwise. */
export function countyDisplayName(county: string): string {
  return (
    countyOnlyEnv("COUNTY_NAME", county) ??
    county
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

/** `elephant-cli prepare` flags for the county. */
export async function resolvePrepareConfig(county: string): Promise<PrepareConfig> {
  const flags: string[] = [];
  let mechanism = "fetch";
  const flowZip = countyOnlyEnv("PREPARE_BROWSER_FLOW_ZIP", county);
  const multi = countyOnlyEnv("PREPARE_MULTI_REQUEST_FLOW", county);
  const browserFlow = countyOnlyEnv("PREPARE_BROWSER_FLOW", county);
  if (flowZip) {
    flags.push("--browser-flow-zip", path.resolve(RUNTIME_DIR, flowZip));
    mechanism = "browser-flow-zip";
  } else if (multi) {
    flags.push("--multi-request-flow-file", path.resolve(RUNTIME_DIR, multi));
    mechanism = "multi-request-flow";
  } else if (browserFlow) {
    flags.push("--browser-flow-file", path.resolve(RUNTIME_DIR, browserFlow));
    mechanism = "browser-flow";
  } else {
    const flowFile = await firstExisting([
      path.join(RUNTIME_DIR, "counties", county, "flow.json"),
      path.join(RUNTIME_DIR, "flows", `${county}.json`),
    ]);
    if (flowFile) {
      const flow = JSON.parse(await readFile(flowFile, "utf8")) as Record<string, unknown>;
      if (Array.isArray(flow.requests)) {
        flags.push("--multi-request-flow-file", flowFile);
        mechanism = "multi-request-flow";
      } else {
        flags.push("--browser-flow-file", flowFile);
        mechanism = "browser-flow";
      }
    }
  }
  if (envFlag(countyOnlyEnv("PREPARE_USE_BROWSER", county))) {
    flags.push("--use-browser");
    if (mechanism === "fetch") mechanism = "browser";
  }
  const continueButton = countyOnlyEnv("PREPARE_CONTINUE_BUTTON", county);
  if (continueButton) flags.push("--continue-button", continueButton);
  if (envFlag(countyOnlyEnv("PREPARE_IGNORE_CAPTCHA", county))) flags.push("--ignore-captcha");
  // A proxy URL may carry credentials: it is passed through, never logged.
  const proxy = countyOnlyEnv("PREPARE_PROXY", county);
  if (proxy) flags.push("--proxy", proxy);
  return { flags, mechanism };
}

/** Source URL for the parcel's seed request, from the row or a URL template. */
export function resolveSourceRequest(
  county: string,
  row: { parcel_id: string; source_identifier?: string; extra?: Record<string, string> },
): { method: string; url: string } | null {
  const extra = row.extra ?? {};
  const direct = extra.source_url ?? extra.url;
  const method = (extra.method ?? "GET").toUpperCase();
  if (direct) return { method, url: direct };
  const template = countyOnlyEnv("PREPARE_URL_TEMPLATE", county);
  if (!template) return null;
  const identifier = row.source_identifier ?? row.parcel_id;
  const url = template
    .replaceAll("{parcel_id}", encodeURIComponent(row.parcel_id))
    .replaceAll("{source_identifier}", encodeURIComponent(identifier));
  return { method, url };
}

async function directoryDigest(dir: string, files: string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const name of files) {
    hash.update(`${name}\u0000`);
    hash.update(await readFile(path.join(dir, name)));
    hash.update("\u0000");
  }
  return hash.digest("hex");
}

async function scriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  const files: string[] = [];
  for (const name of entries.sort()) {
    if (name.endsWith(".test.js")) continue;
    if (!(name.endsWith(".js") || name.endsWith(".cjs") || name === "package.json")) continue;
    if ((await stat(path.join(dir, name))).isFile()) files.push(name);
  }
  return files;
}

function versionOf(kind: string, digest: string, dataGroup: string | null, seed: string): string {
  return `${kind}:${createHash("sha256")
    .update(JSON.stringify({ kind, digest, dataGroup, seed }))
    .digest("hex")
    .slice(0, 32)}`;
}

/** Transform package for the county; null when none is configured. */
export async function resolveTransformConfig(county: string): Promise<TransformConfig | null> {
  const dataGroup = countyOnlyEnv("TRANSFORM_DATA_GROUP", county) ?? null;
  const seed = countyOnlyEnv("TRANSFORM_SEED", county) === "off" ? "off" : "auto";
  const configuredZip = countyOnlyEnv("TRANSFORM_ZIP", county);
  const handlerZip = configuredZip
    ? path.resolve(RUNTIME_DIR, configuredZip)
    : await firstExisting([
        path.join(RUNTIME_DIR, "counties", county, "transform-v2.zip"),
        path.join(RUNTIME_DIR, "transforms", county, "transform-v2.zip"),
      ]);
  if (handlerZip) {
    if (!(await exists(handlerZip))) throw new Error(`TRANSFORM_ZIP for ${county} not found`);
    const digest = await sha256File(handlerZip);
    return {
      kind: "handler",
      zipPath: handlerZip,
      dataGroup,
      seed,
      transformVersion: versionOf("handler", digest, dataGroup, seed),
    };
  }
  const configuredScripts = countyOnlyEnv("TRANSFORM_SCRIPTS_DIR", county);
  const scriptsDir = configuredScripts
    ? path.resolve(RUNTIME_DIR, configuredScripts)
    : await firstExisting([
        path.join(RUNTIME_DIR, "counties", county, "transforms"),
        path.join(RUNTIME_DIR, "transforms", county, "scripts"),
      ]);
  if (!scriptsDir) return null;
  const files = await scriptFiles(scriptsDir);
  if (files.length === 0) throw new Error(`no transform scripts in ${scriptsDir}`);
  const digest = await directoryDigest(scriptsDir, files);
  const zipPath = dataPath("cache", "transforms", `${county}-${digest.slice(0, 24)}.zip`);
  if (!(await exists(zipPath))) {
    const zip = new AdmZip();
    for (const name of files) zip.addLocalFile(path.join(scriptsDir, name));
    const temporary = temporaryPathFor(zipPath);
    await mkdir(path.dirname(zipPath), { recursive: true });
    zip.writeZip(temporary);
    await promote(temporary, zipPath);
  }
  return {
    kind: "scripts",
    zipPath,
    dataGroup,
    seed,
    transformVersion: versionOf("scripts", digest, dataGroup, seed),
  };
}

/** Permit-eligibility policy for the county (CSV, `__ALL__`, or `__NONE__`). */
export function resolveEligibilityPolicy(county: string): {
  mode: "all" | "none" | "list";
  usageTypes: string[];
  source: string;
  fingerprint: string;
} {
  const scoped = countyOnlyEnv("PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES", county);
  const raw = scoped ?? countyEnv("PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES", county);
  const source = scoped ? "county" : raw ? "bare" : "unset";
  // Unset means appraisal-only: no portal traffic on a guessed policy.
  const value = raw ?? "__NONE__";
  const usageTypes = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .sort();
  const mode = usageTypes.includes("__ALL__")
    ? "all"
    : usageTypes.includes("__NONE__") || usageTypes.length === 0
      ? "none"
      : "list";
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ mode, usageTypes: mode === "list" ? usageTypes : [] }))
    .digest("hex")
    .slice(0, 16);
  return { mode, usageTypes, source, fingerprint };
}
