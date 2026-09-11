// @ts-check

import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import puppeteer from "puppeteer-core";

import { parseCsvRecords, renderCsv } from "../core/csv.mjs";
import { exportValidatedQueryTable } from "./opendoor-query-table.mjs";

const execFileAsync = promisify(execFile);

export const RUNTIME_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const COUNTY_KEYS = /** @type {const} */ (["lake", "clay", "volusia"]);
export const TRANSFORM_SCRIPTS = /** @type {const} */ ([
  "ownerMapping.js",
  "structureMapping.js",
  "utilityMapping.js",
  "layoutMapping.js",
  "data_extractor.js",
]);
export const PUBLICATION_DISABLED = Object.freeze({
  enabled: false,
  parquetPublish: false,
  filebase: false,
  ipns: false,
  catalog: false,
  mcp: false,
});

export const COUNTY_CONFIGS = Object.freeze({
  lake: Object.freeze({
    countyName: "Lake",
    countyFips: "12069",
    expectedRows: 770,
    adapter: "lake-property-details-v1",
    outputContract: "property-parcel-address-v1",
  }),
  clay: Object.freeze({
    countyName: "Clay",
    countyFips: "12019",
    expectedRows: 706,
    adapter: "clay-qpublic-beacon-browser-v1",
    outputContract: "property-address-v1",
  }),
  volusia: Object.freeze({
    countyName: "Volusia",
    countyFips: "12127",
    expectedRows: 784,
    adapter: "volusia-property-summary-browser-v1",
    outputContract: "property-address-v1",
  }),
});

export class LocalIngestError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {boolean} [retryable]
   */
  constructor(code, message, retryable = false) {
    super(message);
    this.name = "LocalIngestError";
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  return value;
}

/** @param {unknown} value */
export function canonicalJson(value) {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

/** @param {string | Uint8Array} value */
export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {string} filePath */
async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} targetPath
 * @param {string | Buffer} body
 */
async function writeImmutable(targetPath, body) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  try {
    const handle = await open(targetPath, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
      throw error;
    }
    const existing = await readFile(targetPath);
    if (!existing.equals(bytes)) {
      throw new LocalIngestError(
        "immutable_conflict",
        `Immutable file conflicts at ${targetPath}`,
      );
    }
  }
  return { bytes: bytes.length, sha256: sha256(bytes) };
}

/**
 * @param {string} targetPath
 * @param {unknown} value
 */
async function atomicWriteJson(targetPath, value) {
  await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, canonicalJson(value), { mode: 0o600 });
  await rename(temporaryPath, targetPath);
}

/** @param {string} value */
function assertSafeSegment(value) {
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(value)) {
    throw new LocalIngestError(
      "invalid_run_id",
      "runId must be 3-80 lowercase alphanumeric/hyphen characters",
    );
  }
}

/** @param {string} county */
export function requireCounty(county) {
  if (!COUNTY_KEYS.includes(/** @type {any} */ (county))) {
    throw new LocalIngestError(
      "invalid_county",
      `Unsupported county "${county}"; expected ${COUNTY_KEYS.join(", ")}`,
    );
  }
  return /** @type {"lake" | "clay" | "volusia"} */ (county);
}

/**
 * @param {URL} url
 * @param {Record<string, string>} expected
 */
function assertExactQuery(url, expected) {
  const entries = [...url.searchParams.entries()];
  if (
    entries.length !== Object.keys(expected).length ||
    Object.entries(expected).some(
      ([key, value]) =>
        entries.filter(([candidate]) => candidate === key).length !== 1 ||
        url.searchParams.get(key) !== value,
    )
  ) {
    throw new LocalIngestError(
      "unreviewed_source_url",
      "Source URL contains missing, duplicate, or unreviewed query parameters",
    );
  }
}

/**
 * Validate a supplied seed URL and return the one reviewed request URL.
 * Volusia's known stale seed route is accepted only when its path identifier
 * exactly matches the row, then normalized to the official summary route.
 *
 * @param {"lake" | "clay" | "volusia"} county
 * @param {string} rawUrl
 * @param {string} parcelId
 */
export function validateSourceUrl(county, rawUrl, parcelId) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new LocalIngestError("unreviewed_source_url", "Source URL is invalid");
  }
  if (url.protocol !== "https:") {
    throw new LocalIngestError(
      "unreviewed_source_url",
      "Source URL must use HTTPS",
    );
  }
  if (county === "lake") {
    if (
      url.hostname !== "www.lakecopropappr.com" ||
      url.pathname.toLowerCase() !== "/property-details.aspx"
    ) {
      throw new LocalIngestError(
        "unreviewed_source_url",
        "Source URL is outside the reviewed Lake adapter",
      );
    }
    assertExactQuery(url, { AltKey: parcelId });
    return `https://www.lakecopropappr.com/property-details.aspx?AltKey=${encodeURIComponent(parcelId)}`;
  }
  if (county === "clay") {
    if (
      url.hostname !== "qpublic.schneidercorp.com" ||
      url.pathname.toLowerCase() !== "/application.aspx"
    ) {
      throw new LocalIngestError(
        "unreviewed_source_url",
        "Source URL is outside the reviewed Clay adapter",
      );
    }
    assertExactQuery(url, {
      AppID: "830",
      LayerID: "15008",
      PageTypeID: "4",
      PageID: "6754",
      KeyValue: parcelId,
    });
    const canonical = new URL(
      "https://qpublic.schneidercorp.com/Application.aspx",
    );
    canonical.searchParams.set("AppID", "830");
    canonical.searchParams.set("LayerID", "15008");
    canonical.searchParams.set("PageTypeID", "4");
    canonical.searchParams.set("PageID", "6754");
    canonical.searchParams.set("KeyValue", parcelId);
    return canonical.toString();
  }
  if (url.hostname !== "paproapp.vcgov.org") {
    throw new LocalIngestError(
      "unreviewed_source_url",
      "Source URL is outside the reviewed Volusia adapter",
    );
  }
  const canonicalPath = ["/parcel/summary", "/parcel/summary/"].includes(
    url.pathname.toLowerCase(),
  );
  const stalePath =
    url.pathname.toLowerCase() ===
    `/search/real-property/${parcelId}`.toLowerCase();
  if (canonicalPath) {
    assertExactQuery(url, { altkey: parcelId });
  } else if (stalePath && [...url.searchParams].length === 0) {
    // Explicitly reviewed normalization.
  } else {
    throw new LocalIngestError(
      "unreviewed_source_url",
      "Source URL is outside the reviewed Volusia route",
    );
  }
  return `https://paproapp.vcgov.org/parcel/summary/?altkey=${encodeURIComponent(parcelId)}`;
}

/**
 * @param {Record<string, string>[]} rows
 * @param {"lake" | "clay" | "volusia"} county
 * @returns {Record<string, string>[]}
 */
export function validateSeedRows(rows, county) {
  if (rows.length === 0) {
    throw new LocalIngestError("empty_seed", "Seed CSV has no data rows");
  }
  const config = COUNTY_CONFIGS[county];
  const required = [
    "parcel_id",
    "source_identifier",
    "url",
    "method",
    "county",
    "county_fips",
    "elephant_uuid",
    "elephant_token",
    "opendoor_address",
  ];
  const validated = rows.map((row, index) => {
    for (const name of required) {
      if (!row[name]?.trim()) {
        throw new LocalIngestError(
          "invalid_seed",
          `Seed row ${index + 2} is missing ${name}`,
        );
      }
    }
    if (row.county !== county || row.county_fips !== config.countyFips) {
      throw new LocalIngestError(
        "county_mismatch",
        `Seed row ${index + 2} is not ${config.countyName} County`,
      );
    }
    if (row.method !== "GET") {
      throw new LocalIngestError(
        "invalid_method",
        `Seed row ${index + 2} must use GET`,
      );
    }
    if (row.source_identifier !== row.parcel_id) {
      throw new LocalIngestError(
        "identifier_mismatch",
        `Seed row ${index + 2} source_identifier must exactly match parcel_id`,
      );
    }
    const identifierPattern =
      county === "clay"
        ? /^[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{6}-[0-9]{3}-[0-9]{2}$/
        : county === "volusia"
          ? /^[0-9]{7}$/
          : /^[0-9]+$/;
    if (!identifierPattern.test(row.parcel_id)) {
      throw new LocalIngestError(
        "invalid_identifier",
        `Seed row ${index + 2} has an invalid ${config.countyName} request identifier`,
      );
    }
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
        row.elephant_uuid,
      )
    ) {
      throw new LocalIngestError(
        "invalid_identity",
        `Seed row ${index + 2} has an invalid elephant_uuid`,
      );
    }
    const token = row.elephant_token.startsWith("address:v1:")
      ? row.elephant_token.slice("address:v1:".length)
      : row.elephant_token;
    if (!/^[a-f0-9]{64}$/i.test(token)) {
      throw new LocalIngestError(
        "invalid_identity",
        `Seed row ${index + 2} has an invalid elephant_token`,
      );
    }
    return /** @type {Record<string, string>} */ ({
      ...row,
      url: validateSourceUrl(county, row.url, row.parcel_id),
      // UUID and token suffix are intentionally not case-normalized or reminted.
      elephant_uuid: row.elephant_uuid,
      elephant_token: token,
    });
  });
  for (const [label, values] of [
    ["request identifiers", validated.map((row) => row.parcel_id)],
    ["elephant_uuid values", validated.map((row) => row.elephant_uuid)],
    ["elephant_token values", validated.map((row) => row.elephant_token)],
  ]) {
    if (new Set(values).size !== validated.length) {
      throw new LocalIngestError(
        "duplicate_seed_identity",
        `Seed contains duplicate ${label}`,
      );
    }
  }
  return validated;
}

/**
 * @param {"lake" | "clay" | "volusia"} county
 * @param {string} html
 * @param {string} parcelId
 */
export function validateSourceHtml(county, html, parcelId) {
  const lowered = html.toLowerCase();
  const blocked = [
    "enable javascript and cookies to continue",
    "access denied",
    "cf-chl-",
    "captcha",
  ].find((marker) => lowered.includes(marker));
  if (blocked) {
    throw new LocalIngestError(
      "source_access_blocked",
      `${COUNTY_CONFIGS[county].countyName} requires a valid public browser session or human-owned access resolution (${blocked}); automation will not bypass it`,
    );
  }
  if (
    county === "lake" &&
    (!html.includes("Property Record Card") ||
      !html.includes("Alternate Key:") ||
      !html.includes(parcelId))
  ) {
    throw new LocalIngestError(
      "source_contract_drift",
      "Lake response is not the reviewed property card",
    );
  }
  if (
    county === "clay" &&
    (!html.includes(parcelId) ||
      !html.includes("dynamicSummary") ||
      !lowered.includes("property use code"))
  ) {
    throw new LocalIngestError(
      "source_contract_drift",
      "Clay response is not the reviewed qPublic property card",
    );
  }
  if (
    county === "volusia" &&
    (!html.includes("Parcel ID:") ||
      !html.includes("Alternate Key:") ||
      !html.includes("Property Use:") ||
      !html.includes("Physical Address:") ||
      !html.includes(parcelId))
  ) {
    throw new LocalIngestError(
      "source_contract_drift",
      "Volusia response is not the reviewed parcel summary",
    );
  }
}

/**
 * @param {"lake" | "clay" | "volusia"} county
 * @param {Record<string, unknown>} property
 * @param {Record<string, unknown> | null} parcel
 * @param {Record<string, unknown>} address
 * @param {Record<string, string>} row
 */
export function validateCountyOutput(county, property, parcel, address, row) {
  if (property.request_identifier !== row.parcel_id) {
    throw new LocalIngestError(
      "transform_identifier_mismatch",
      `${county} property output changed the request identifier`,
    );
  }
  if (county === "lake") {
    if (
      !parcel ||
      parcel.request_identifier !== row.parcel_id ||
      typeof parcel.parcel_identifier !== "string" ||
      parcel.parcel_identifier.length === 0 ||
      property.parcel_identifier !== parcel.parcel_identifier
    ) {
      throw new LocalIngestError(
        "transform_output_invalid",
        "Lake requires matching property and parcel identifiers",
      );
    }
  } else if (
    county === "clay" &&
    property.parcel_identifier !== row.parcel_id
  ) {
    throw new LocalIngestError(
      "transform_output_invalid",
      "Clay did not preserve the exact hyphenated parcel identifier",
    );
  } else if (
    county === "volusia" &&
    (typeof property.parcel_identifier !== "string" ||
      !/^[0-9]{12}$/.test(property.parcel_identifier))
  ) {
    throw new LocalIngestError(
      "transform_output_invalid",
      "Volusia did not emit a twelve-digit official parcel identifier",
    );
  }
  /** @type {Array<[string, Record<string, unknown>]>} */
  const identityOutputs = [
    ["property", property],
    ["address", address],
  ];
  for (const [name, payload] of identityOutputs) {
    if (
      payload.elephant_uuid !== row.elephant_uuid ||
      payload.elephant_token !== row.elephant_token
    ) {
      throw new LocalIngestError(
        "identity_mismatch",
        `${county} ${name} output changed OpenDoor identity`,
      );
    }
  }
}

/** @param {number} attempt */
function retryDelay(attempt) {
  const base = Math.min(8_000, 1_000 * 2 ** (attempt - 1));
  return new Promise((resolve) =>
    setTimeout(resolve, base + Math.floor(Math.random() * 250)),
  );
}

/** @param {string | undefined} explicitPath */
export async function findChromium(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter((candidate) => typeof candidate === "string");
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  throw new LocalIngestError(
    "chromium_missing",
    "No local Chromium/Chrome executable found; pass --chromium or set PUPPETEER_EXECUTABLE_PATH",
  );
}

/**
 * @param {import("puppeteer-core").Browser} browser
 * @param {"lake" | "clay" | "volusia"} county
 * @param {Record<string, string>} row
 */
export async function captureCountyHtml(browser, county, row) {
  const page = await browser.newPage();
  try {
    page.setDefaultNavigationTimeout(60_000);
    page.setDefaultTimeout(30_000);
    const response = await page.goto(row.url, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    const status = response?.status() ?? 0;
    if (status === 429 || status >= 500) {
      throw new LocalIngestError(
        "source_retryable",
        `${county} returned retryable HTTP ${status}`,
        true,
      );
    }
    if (status >= 400) {
      throw new LocalIngestError(
        status === 403 ? "source_access_blocked" : "source_http_error",
        `${county} returned HTTP ${status}`,
      );
    }
    if (county === "volusia") {
      const disclaimer = await page.$("#acceptDataDisclaimer");
      if (disclaimer) {
        const navigation = page
          .waitForNavigation({
            waitUntil: "domcontentloaded",
            timeout: 30_000,
          })
          .catch(() => null);
        await disclaimer.click();
        await navigation;
      }
      let html = await page.content();
      if (
        html.includes('id="acceptDataDisclaimer"') ||
        !html.includes("Parcel ID:")
      ) {
        await page.goto(row.url, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
      }
    } else if (county === "clay") {
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 5_000 }).catch(
        () => null,
      );
    }
    const finalUrl = validateSourceUrl(county, page.url(), row.parcel_id);
    if (finalUrl !== row.url) {
      throw new LocalIngestError(
        "source_redirect_drift",
        `${county} redirected outside its reviewed source contract`,
      );
    }
    const html = await page.content();
    if (Buffer.byteLength(html) > 10 * 1024 * 1024) {
      throw new LocalIngestError(
        "source_response_too_large",
        `${county} response exceeded 10 MiB`,
      );
    }
    validateSourceHtml(county, html, row.parcel_id);
    return html;
  } catch (error) {
    if (error instanceof LocalIngestError) throw error;
    throw new LocalIngestError(
      "browser_error",
      error instanceof Error ? error.message : String(error),
      true,
    );
  } finally {
    await page.close();
  }
}

/**
 * @param {"lake" | "clay" | "volusia"} county
 * @param {Record<string, string>} row
 */
function sourceHttpRequest(county, row) {
  const url = new URL(row.url);
  return {
    method: "GET",
    url: row.url,
    multiValueQueryString: Object.fromEntries(
      [...url.searchParams.entries()].map(([key, value]) => [key, [value]]),
    ),
  };
}

/**
 * @param {string} workDir
 * @param {"lake" | "clay" | "volusia"} county
 * @param {Record<string, string>} row
 * @param {string} html
 */
async function writeTransformInputs(workDir, county, row, html) {
  const config = COUNTY_CONFIGS[county];
  const identity = {
    source: "opendoor-target-seed",
    elephant_uuid: row.elephant_uuid,
    elephant_token: row.elephant_token,
  };
  await mkdir(path.join(workDir, "owners"), { recursive: true, mode: 0o700 });
  await mkdir(path.join(workDir, "data"), { recursive: true, mode: 0o700 });
  const sourceRequest = sourceHttpRequest(county, row);
  const csv = renderCsv(
    ["parcel_id", "altkey", "latitude", "longitude", "parcel_polygon"],
    [
      {
        parcel_id: row.parcel_id,
        altkey: row.parcel_id,
        latitude: row.latitude ?? "",
        longitude: row.longitude ?? "",
        parcel_polygon: row.parcel_polygon ?? "",
      },
    ],
  );
  await Promise.all([
    writeFile(path.join(workDir, "input.html"), html, { mode: 0o600 }),
    writeFile(
      path.join(workDir, "property_seed.json"),
      canonicalJson({
        parcel_id: row.parcel_id,
        altkey: row.parcel_id,
        request_identifier: row.parcel_id,
        source_http_request: sourceRequest,
        county_name: config.countyName,
        ...identity,
      }),
      { mode: 0o600 },
    ),
    writeFile(
      path.join(workDir, "unnormalized_address.json"),
      canonicalJson({
        full_address: row.situs_address || row.opendoor_address,
        latitude: row.latitude || null,
        longitude: row.longitude || null,
        county_jurisdiction: config.countyName,
        request_identifier: row.parcel_id,
        source_http_request: sourceRequest,
        ...identity,
      }),
      { mode: 0o600 },
    ),
    writeFile(path.join(workDir, "identity.json"), canonicalJson(identity), {
      mode: 0o600,
    }),
    writeFile(path.join(workDir, "input.csv"), csv, { mode: 0o600 }),
    writeFile(path.join(workDir, "seed.csv"), csv, { mode: 0o600 }),
  ]);
}

/**
 * @param {"lake" | "clay" | "volusia"} county
 * @param {string} workDir
 */
async function executeTransforms(county, workDir) {
  const scriptsDir = path.join(
    RUNTIME_ROOT,
    "counties",
    county,
    "transforms",
  );
  for (const script of TRANSFORM_SCRIPTS) {
    try {
      await execFileAsync(process.execPath, [path.join(scriptsDir, script)], {
        cwd: workDir,
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          ...process.env,
          NODE_PATH: path.join(RUNTIME_ROOT, "node_modules"),
        },
      });
    } catch {
      throw new LocalIngestError(
        "transform_error",
        `${county} transform ${script} failed`,
      );
    }
  }
}

/**
 * @param {string} filePath
 * @param {Record<string, string>} identity
 */
async function stampJsonIdentity(filePath, identity) {
  const value = JSON.parse(await readFile(filePath, "utf8"));
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LocalIngestError(
      "transform_output_invalid",
      `${filePath} is not a JSON object`,
    );
  }
  await writeFile(filePath, canonicalJson({ ...value, ...identity }), {
    mode: 0o600,
  });
}

/**
 * @param {string} workDir
 * @param {Record<string, string>} row
 */
async function stampIdentity(workDir, row) {
  const identity = {
    elephant_uuid: row.elephant_uuid,
    elephant_token: row.elephant_token,
  };
  const dataDir = path.join(workDir, "data");
  const entities = (await readdir(dataDir))
    .filter(
      (name) =>
        name.endsWith(".json") &&
        !name.startsWith("relationship_") &&
        name !== "error.json",
    )
    .map((name) => path.join(dataDir, name));
  await Promise.all([
    stampJsonIdentity(path.join(workDir, "property_seed.json"), identity),
    stampJsonIdentity(path.join(workDir, "unnormalized_address.json"), identity),
    stampJsonIdentity(path.join(workDir, "identity.json"), identity),
    ...entities.map((filePath) => stampJsonIdentity(filePath, identity)),
  ]);
}

/** @param {string} filePath */
async function readJsonObject(filePath) {
  const value = JSON.parse(await readFile(filePath, "utf8"));
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LocalIngestError(
      "transform_output_invalid",
      `${filePath} is not a JSON object`,
    );
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {string} artifactDir
 * @param {"lake" | "clay" | "volusia"} county
 * @param {Record<string, string>} row
 */
async function validateArtifactDirectory(artifactDir, county, row) {
  const property = await readJsonObject(
    path.join(artifactDir, "data", "property.json"),
  );
  const address = await readJsonObject(
    path.join(artifactDir, "data", "address.json"),
  );
  const parcelPath = path.join(artifactDir, "data", "parcel.json");
  const parcel = (await exists(parcelPath))
    ? await readJsonObject(parcelPath)
    : null;
  validateCountyOutput(county, property, parcel, address, row);
  return { property, address, parcel };
}

/**
 * @param {string} root
 * @param {string} [current]
 * @returns {Promise<string[]>}
 */
async function filesRecursively(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const children = await Promise.all(
    entries.map(async (entry) => {
      const child = path.join(current, entry.name);
      return entry.isDirectory()
        ? filesRecursively(root, child)
        : [path.relative(root, child).replaceAll(path.sep, "/")];
    }),
  );
  return children.flat().sort();
}

/** @param {string} directory */
async function artifactManifest(directory) {
  return Promise.all(
    (await filesRecursively(directory)).map(async (logicalPath) => {
      const body = await readFile(path.join(directory, logicalPath));
      return { logicalPath, bytes: body.length, sha256: sha256(body) };
    }),
  );
}

/** @param {"lake" | "clay" | "volusia"} county */
export async function digestCountyTransforms(county) {
  const hash = createHash("sha256");
  for (const name of ["package.json", ...TRANSFORM_SCRIPTS]) {
    const relativePath = `counties/${county}/transforms/${name}`;
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await readFile(path.join(RUNTIME_ROOT, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * @param {"lake" | "clay" | "volusia"} county
 * @param {Buffer} seedBody
 * @param {Buffer} catalogBody
 */
async function runtimeDigest(county, seedBody, catalogBody) {
  const hash = createHash("sha256");
  for (const relativePath of [
    "src/local/opendoor-local.mjs",
    "src/local/opendoor-query-table.mjs",
    "bin/opendoor-local-appraisal.mjs",
    "package-lock.json",
  ]) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await readFile(path.join(RUNTIME_ROOT, relativePath)));
    hash.update("\0");
  }
  hash.update(seedBody);
  hash.update(catalogBody);
  return hash.digest("hex");
}

/**
 * @param {{
 *   county: string,
 *   mode: string,
 *   runId: string,
 *   seedPath: string,
 *   headless?: boolean,
 *   userDataDir?: string,
 * }} options
 */
export async function buildLocalRequest(options) {
  const county = requireCounty(options.county);
  if (!["smoke", "full"].includes(options.mode)) {
    throw new LocalIngestError("invalid_mode", "mode must be smoke or full");
  }
  assertSafeSegment(options.runId);
  const seedPath = path.resolve(options.seedPath);
  const seedRelative = path.relative(RUNTIME_ROOT, seedPath);
  const syntheticFixture = path.join(
    RUNTIME_ROOT,
    "fixtures",
    "opendoor-local",
    "synthetic-one-row.csv",
  );
  if (
    seedRelative !== "" &&
    !seedRelative.startsWith("..") &&
    !path.isAbsolute(seedRelative) &&
    seedPath !== syntheticFixture &&
    !seedRelative.startsWith(`local-input${path.sep}`)
  ) {
    throw new LocalIngestError(
      "unsafe_seed_path",
      "Private seeds inside the runtime must be under gitignored local-input/",
    );
  }
  const config = COUNTY_CONFIGS[county];
  const catalogPath = path.join(
    RUNTIME_ROOT,
    "docs",
    `${county}-sources.yaml`,
  );
  const [seedBody, catalogBody, transformSha256] = await Promise.all([
    readFile(seedPath),
    readFile(catalogPath),
    digestCountyTransforms(county),
  ]);
  const rows = validateSeedRows(
    parseCsvRecords(seedBody.toString("utf8")),
    county,
  );
  if (options.mode === "full" && rows.length !== config.expectedRows) {
    throw new LocalIngestError(
      "full_seed_count_mismatch",
      `${config.countyName} full mode requires exactly ${config.expectedRows} rows; received ${rows.length}`,
    );
  }
  const request = {
    schemaVersion: "elephant.opendoor-local-request.v1",
    runId: options.runId,
    county,
    countyFips: config.countyFips,
    mode: options.mode,
    adapter: config.adapter,
    outputContract: config.outputContract,
    seed: {
      filename: path.basename(options.seedPath),
      bytes: seedBody.length,
      sha256: sha256(seedBody),
      rows: rows.length,
      selectedRows: options.mode === "smoke" ? 1 : rows.length,
    },
    sourceCatalog: {
      filename: `${county}-sources.yaml`,
      bytes: catalogBody.length,
      sha256: sha256(catalogBody),
    },
    retryPolicy: {
      attempts: 3,
      baseDelayMs: 1_000,
      maximumDelayMs: 8_000,
      jitterMs: 250,
      navigationTimeoutMs: 60_000,
      transformTimeoutMs: 120_000,
    },
    browser: {
      headless: options.headless ?? true,
      persistentSessionProfile: Boolean(options.userDataDir),
    },
    provenance: {
      runtimeSha256: await runtimeDigest(county, seedBody, catalogBody),
      transformSha256,
    },
    publication: PUBLICATION_DISABLED,
  };
  return {
    county,
    rows,
    selectedRows: options.mode === "smoke" ? rows.slice(0, 1) : rows,
    request,
    requestSha256: sha256(canonicalJson(request)),
  };
}

/** @param {string} outputDir */
function assertSafeOutputPath(outputDir) {
  const resolved = path.resolve(outputDir);
  const relative = path.relative(RUNTIME_ROOT, resolved);
  if (
    relative === "" ||
    (!relative.startsWith("..") &&
      !path.isAbsolute(relative) &&
      !relative.startsWith(`local-output${path.sep}`) &&
      relative !== "local-output" &&
      !relative.startsWith(`tmp${path.sep}`) &&
      relative !== "tmp")
  ) {
    throw new LocalIngestError(
      "unsafe_output_path",
      "Output inside the runtime must be under gitignored local-output/ or tmp/",
    );
  }
  return resolved;
}

/** @param {string} lockPath */
async function acquireRunLock(lockPath) {
  const fencingToken = randomUUID();
  const body = canonicalJson({
    pid: process.pid,
    fencingToken,
    acquiredAt: new Date().toISOString(),
  });
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(body);
      await handle.close();
      return fencingToken;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
      const lock = JSON.parse(await readFile(lockPath, "utf8"));
      let active = false;
      if (Number.isInteger(lock.pid)) {
        try {
          process.kill(lock.pid, 0);
          active = true;
        } catch {
          active = false;
        }
      }
      if (active) {
        throw new LocalIngestError(
          "run_locked",
          `Another local process holds ${lockPath}`,
        );
      }
      await rm(lockPath, { force: true });
    }
  }
  throw new LocalIngestError("run_locked", `Could not acquire ${lockPath}`);
}

/** @param {unknown} error */
function failureRecord(error) {
  if (error instanceof LocalIngestError) {
    return {
      category: error.code,
      detail: error.message.replaceAll(/[\r\n\t]+/g, " ").slice(0, 500),
      retryable: error.retryable,
    };
  }
  return {
    category: "worker_error",
    detail: (error instanceof Error ? error.message : String(error))
      .replaceAll(/[\r\n\t]+/g, " ")
      .slice(0, 500),
    retryable: true,
  };
}

/**
 * @param {{
 *   county: string,
 *   mode: string,
 *   runId: string,
 *   seedPath: string,
 *   outputDir: string,
 *   chromiumPath?: string,
 *   headless?: boolean,
 *   userDataDir?: string,
 *   captureHtml?: (context: {county: "lake" | "clay" | "volusia", row: Record<string, string>, browser: import("puppeteer-core").Browser | null}) => Promise<string>,
 *   transformRow?: (context: {county: "lake" | "clay" | "volusia", row: Record<string, string>, workDir: string}) => Promise<void>,
 * }} options
 */
export async function runLocalIngest(options) {
  const plan = await buildLocalRequest(options);
  const outputDir = assertSafeOutputPath(options.outputDir);
  if (options.userDataDir) assertSafeOutputPath(options.userDataDir);
  const lockPath = path.join(outputDir, "run.lock");
  const fencingToken = await acquireRunLock(lockPath);
  let browser = null;
  try {
    await mkdir(outputDir, { recursive: true, mode: 0o700 });
    await writeImmutable(
      path.join(outputDir, "request.json"),
      canonicalJson({
        requestSha256: plan.requestSha256,
        request: plan.request,
      }),
    );
    if (!options.captureHtml) {
      const executablePath = await findChromium(options.chromiumPath);
      browser = await puppeteer.launch({
        executablePath,
        headless: options.headless ?? true,
        userDataDir: options.userDataDir
          ? path.resolve(options.userDataDir)
          : undefined,
        args: ["--disable-dev-shm-usage"],
      });
    }
    const captureHtml =
      options.captureHtml ??
      (async ({ county, row, browser }) => {
        if (!browser) {
          throw new LocalIngestError(
            "chromium_missing",
            "Browser was not initialized",
          );
        }
        return captureCountyHtml(browser, county, row);
      });
    const transformRow =
      options.transformRow ??
      (async ({ county, workDir }) => executeTransforms(county, workDir));

    let captured = 0;
    let failed = 0;
    const receiptPaths = [];
    const failurePaths = [];
    /** @param {number} nextRowIndex */
    const updateCheckpoint = (nextRowIndex) =>
      atomicWriteJson(path.join(outputDir, "checkpoint.json"), {
        schemaVersion: "elephant.opendoor-local-checkpoint.v1",
        requestSha256: plan.requestSha256,
        fencingToken,
        nextRowIndex,
        selectedRows: plan.selectedRows.length,
        capturedRows: captured,
        failedRows: failed,
        updatedAt: new Date().toISOString(),
      });
    for (const [index, row] of plan.selectedRows.entries()) {
      const rowKey = sha256(`${plan.county}\0${row.parcel_id}`);
      const artifactDir = path.join(
        outputDir,
        "artifacts",
        plan.county,
        rowKey,
      );
      const receiptPath = path.join(
        outputDir,
        "receipts",
        plan.county,
        `${rowKey}.json`,
      );
      const failurePath = path.join(
        outputDir,
        "failures",
        plan.county,
        `${rowKey}.json`,
      );
      if (await exists(receiptPath)) {
        const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
        if (
          receipt.requestSha256 !== plan.requestSha256 ||
          receipt.rowKey !== rowKey
        ) {
          throw new LocalIngestError(
            "receipt_conflict",
            `Receipt conflicts for row ${index + 1}`,
          );
        }
        const output = await validateArtifactDirectory(
          artifactDir,
          plan.county,
          row,
        );
        captured += 1;
        receiptPaths.push(path.relative(outputDir, receiptPath));
        await updateCheckpoint(index + 1);
        continue;
      }
      if (await exists(failurePath)) {
        const failure = JSON.parse(await readFile(failurePath, "utf8"));
        if (
          failure.requestSha256 !== plan.requestSha256 ||
          failure.rowKey !== rowKey
        ) {
          throw new LocalIngestError(
            "failure_conflict",
            `Failure record conflicts for row ${index + 1}`,
          );
        }
        failed += 1;
        failurePaths.push(path.relative(outputDir, failurePath));
        await updateCheckpoint(index + 1);
        continue;
      }

      let terminalError = null;
      let attempts = 0;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        attempts = attempt;
        const workDir = path.join(
          outputDir,
          ".scratch",
          `${rowKey}-${fencingToken}`,
        );
        await rm(workDir, { recursive: true, force: true });
        try {
          if (await exists(artifactDir)) {
            const output = await validateArtifactDirectory(
              artifactDir,
              plan.county,
              row,
            );
            const artifacts = await artifactManifest(artifactDir);
            await writeImmutable(
              receiptPath,
              canonicalJson({
                schemaVersion: "elephant.opendoor-local-receipt.v1",
                requestSha256: plan.requestSha256,
                rowKey,
                rowNumber: index + 2,
                county: plan.county,
                transformSha256: plan.request.provenance.transformSha256,
                outputContract: plan.request.outputContract,
                artifacts,
              }),
            );
            captured += 1;
            receiptPaths.push(path.relative(outputDir, receiptPath));
            terminalError = null;
            break;
          }
          const html = await captureHtml({
            county: plan.county,
            row,
            browser,
          });
          validateSourceHtml(plan.county, html, row.parcel_id);
          await writeTransformInputs(workDir, plan.county, row, html);
          await transformRow({ county: plan.county, row, workDir });
          await stampIdentity(workDir, row);
          const output = await validateArtifactDirectory(
            workDir,
            plan.county,
            row,
          );
          await mkdir(path.dirname(artifactDir), {
            recursive: true,
            mode: 0o700,
          });
          await rename(workDir, artifactDir);
          const artifacts = await artifactManifest(artifactDir);
          await writeImmutable(
            receiptPath,
            canonicalJson({
              schemaVersion: "elephant.opendoor-local-receipt.v1",
              requestSha256: plan.requestSha256,
              rowKey,
              rowNumber: index + 2,
              county: plan.county,
              transformSha256: plan.request.provenance.transformSha256,
              outputContract: plan.request.outputContract,
              artifacts,
            }),
          );
          captured += 1;
          receiptPaths.push(path.relative(outputDir, receiptPath));
          terminalError = null;
          break;
        } catch (error) {
          await rm(workDir, { recursive: true, force: true });
          terminalError = error;
          const failure = failureRecord(error);
          if (!failure.retryable || attempt === 3) break;
          await retryDelay(attempt);
        }
      }
      if (terminalError) {
        const failure = failureRecord(terminalError);
        await writeImmutable(
          failurePath,
          canonicalJson({
            schemaVersion: "elephant.opendoor-local-failure.v1",
            requestSha256: plan.requestSha256,
            rowKey,
            rowNumber: index + 2,
            county: plan.county,
            attempts,
            ...failure,
          }),
        );
        failed += 1;
        failurePaths.push(path.relative(outputDir, failurePath));
      }
      await updateCheckpoint(index + 1);
    }

    const queryTable =
      failed === 0 && captured === plan.selectedRows.length
        ? await exportValidatedQueryTable({
            county: plan.county,
            countyName: COUNTY_CONFIGS[plan.county].countyName,
            rows: plan.selectedRows,
            outputDir,
            artifactDirectory: (row) =>
              path.join(
                outputDir,
                "artifacts",
                plan.county,
                sha256(`${plan.county}\0${row.parcel_id}`),
              ),
          })
        : null;
    const handoff = {
      schemaVersion: "elephant.opendoor-local-handoff.v1",
      runId: plan.request.runId,
      requestSha256: plan.requestSha256,
      county: plan.county,
      mode: plan.request.mode,
      status:
        queryTable === null
          ? "complete_with_failures"
          : "captured_transformed_exported_local",
      selectedRows: plan.selectedRows.length,
      capturedRows: captured,
      failedRows: failed,
      loadedRows: 0,
      publishedRows: 0,
      linkedRows: null,
      validUnlinkedRows: null,
      receipts: receiptPaths,
      failures: failurePaths,
      queryTable,
      publication: PUBLICATION_DISABLED,
      nextEligibleStage: null,
    };
    const handoffPath = path.join(
      outputDir,
      "handoffs",
      `${plan.requestSha256}.json`,
    );
    await writeImmutable(handoffPath, canonicalJson(handoff));
    return { ...handoff, handoffPath };
  } finally {
    await browser?.close();
    await rm(lockPath, { force: true });
  }
}
