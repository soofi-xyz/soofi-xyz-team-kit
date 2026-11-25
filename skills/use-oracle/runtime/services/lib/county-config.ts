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
import { normalizeSourceRequest, type SourceRequest } from "./source-request.ts";
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

/** Context handed to a capture plug-in. `signal` aborts at the step timeout. */
export type CaptureContext = { signal: AbortSignal; timeoutMs: number; parcelDir: string };

export type CapturePlugin = {
  capture: (input: CaptureInput, ctx: CaptureContext) => Promise<CaptureOutcome>;
};

/** Capture step timeout: `CAPTURE_TIMEOUT_MS[_<COUNTY>]`, default 10 minutes. */
export function captureTimeoutMs(county: string): number {
  const parsed = Number(countyEnv("CAPTURE_TIMEOUT_MS", county));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 10 * 60 * 1000;
}

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

/**
 * The parcel's source request from the seed row (`source_url`/`url`,
 * `method`, `multiValueQueryString`, `json`, `body`, `headers`,
 * `content_type`) or from the county templates (`PREPARE_URL_TEMPLATE_<COUNTY>`,
 * `PREPARE_METHOD_<COUNTY>`, `PREPARE_JSON_TEMPLATE_<COUNTY>`,
 * `PREPARE_BODY_TEMPLATE_<COUNTY>`, `PREPARE_CONTENT_TYPE_<COUNTY>`; each
 * substitutes `{parcel_id}` and `{source_identifier}`). A query string moves
 * into `multiValueQueryString`. Throws on a malformed request.
 */
export function resolveSourceRequest(
  county: string,
  row: { parcel_id: string; source_identifier?: string; extra?: Record<string, string> },
): SourceRequest | null {
  const extra = row.extra ?? {};
  const direct = extra.source_url ?? extra.url;
  if (direct) {
    return normalizeSourceRequest({
      method: extra.method,
      url: direct,
      multiValueQueryString: extra.multiValueQueryString,
      json: extra.json,
      body: extra.body,
      headers: extra.headers,
      content_type: extra.content_type,
    });
  }
  const template = countyOnlyEnv("PREPARE_URL_TEMPLATE", county);
  if (!template) return null;
  const identifier = row.source_identifier ?? row.parcel_id;
  const fill = (text: string, encode: (value: string) => string) =>
    text
      .replaceAll("{parcel_id}", encode(row.parcel_id))
      .replaceAll("{source_identifier}", encode(identifier));
  const jsonTemplate = countyOnlyEnv("PREPARE_JSON_TEMPLATE", county);
  const bodyTemplate = countyOnlyEnv("PREPARE_BODY_TEMPLATE", county);
  return normalizeSourceRequest({
    method: countyOnlyEnv("PREPARE_METHOD", county) ?? extra.method ?? "GET",
    url: fill(template, encodeURIComponent),
    json: jsonTemplate ? fill(jsonTemplate, (value) => JSON.stringify(value).slice(1, -1)) : undefined,
    body: bodyTemplate ? fill(bodyTemplate, encodeURIComponent) : undefined,
    content_type: countyOnlyEnv("PREPARE_CONTENT_TYPE", county),
  });
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

/**
 * Options for the county's permit adapters, from env (and the profile):
 * - `PERMIT_BULK_DIR_<COUNTY>` (DATA_DIR-relative or absolute): a directory of
 *   per-source `linked-permits.jsonl` + `summary.json` snapshots. PermitHarvest
 *   reads each parcel's records from it and falls back to the live adapter
 *   when the parcel's jurisdiction has no snapshot.
 * - `PERMIT_TIMEOUT_MS_<COUNTY>`, `PERMIT_MAX_ATTEMPTS_<COUNTY>`,
 *   `PERMIT_CHROMIUM_PATH_<COUNTY>` (else `CHROME_EXECUTABLE_PATH`),
 *   `PERMIT_HEADLESS_<COUNTY>`.
 * - `PERMIT_ADAPTER_OPTIONS_<COUNTY>`: a JSON object of further scalar options.
 */
export function resolvePermitAdapterOptions(
  county: string,
  profile?: { countyKey?: string; countyName?: string } | null,
): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (profile?.countyKey) options.countyKey = profile.countyKey;
  if (profile?.countyName) options.countyName = profile.countyName;
  const extra = countyOnlyEnv("PERMIT_ADAPTER_OPTIONS", county);
  if (extra) {
    const parsed = JSON.parse(extra) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("PERMIT_ADAPTER_OPTIONS must be a JSON object");
    }
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === null || ["string", "number", "boolean"].includes(typeof value)) options[key] = value;
    }
  }
  const positive = (name: string) => {
    const parsed = Number(countyOnlyEnv(name, county));
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  };
  const timeoutMs = positive("PERMIT_TIMEOUT_MS");
  if (timeoutMs) options.timeoutMs = timeoutMs;
  const maxAttempts = positive("PERMIT_MAX_ATTEMPTS");
  if (maxAttempts) options.maxAttempts = maxAttempts;
  const chromium = countyOnlyEnv("PERMIT_CHROMIUM_PATH", county) ?? process.env.CHROME_EXECUTABLE_PATH?.trim();
  if (chromium) options.chromiumExecutablePath = chromium;
  const headless = countyOnlyEnv("PERMIT_HEADLESS", county);
  if (headless !== undefined) options.headless = envFlag(headless);
  const bulk = countyOnlyEnv("PERMIT_BULK_DIR", county);
  if (bulk) {
    const dir = path.isAbsolute(bulk) ? bulk : dataPath(...bulk.split("/").filter(Boolean));
    options.bulkLinkedDir = dir;
    options.bulkSnapshotDir = dir;
  }
  return options;
}

export type PermitRoutingHook = {
  /**
   * Return the permit-profile jurisdiction key for this parcel, or null to
   * use the default city routing (`city`, `situs_city`, `address_city`).
   */
  resolveJurisdiction: (input: {
    seedRow: Record<string, string>;
    routing: { parcel_identifier: string; city: string | null; situs_address: string | null };
    profile: { countyKey: string; jurisdictions: Array<{ key: string }> };
  }) => string | null | undefined | Promise<string | null | undefined>;
};

const routingCache = new Map<string, Promise<PermitRoutingHook | null>>();

/**
 * County permit-routing hook: `src/counties/<county>/permit-routing.mjs`
 * (or `PERMIT_ROUTING_MODULE_<COUNTY>`) exporting `resolveJurisdiction`.
 */
export function loadPermitRoutingHook(county: string): Promise<PermitRoutingHook | null> {
  const override = countyOnlyEnv("PERMIT_ROUTING_MODULE", county);
  const modulePath = override
    ? path.resolve(RUNTIME_DIR, override)
    : path.join(RUNTIME_DIR, "src", "counties", county, "permit-routing.mjs");
  const cacheKey = `${county}\u0000${modulePath}`;
  let loaded = routingCache.get(cacheKey);
  if (!loaded) {
    loaded = (async () => {
      if (!(await exists(modulePath))) {
        if (override) throw new Error(`PERMIT_ROUTING_MODULE for ${county} not found`);
        return null;
      }
      const module = (await import(pathToFileURL(modulePath).href)) as Partial<PermitRoutingHook>;
      if (typeof module.resolveJurisdiction !== "function") {
        throw new Error(`${path.relative(RUNTIME_DIR, modulePath)} must export resolveJurisdiction()`);
      }
      return module as PermitRoutingHook;
    })();
    routingCache.set(cacheKey, loaded);
  }
  return loaded;
}
