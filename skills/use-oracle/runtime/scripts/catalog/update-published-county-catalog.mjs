#!/usr/bin/env node

// Ported from `oracle-node@ff68b0b6812598d07e0f4aaa322ddbfe230f20b9`
// `scripts/update-published-county-catalog.mjs`. Behavior is unchanged; the only
// adaptation is that the default `--catalog` path resolves from this file's own
// location (`import.meta.url`), not `process.cwd()`, so the CLI works the same way
// no matter where it is invoked from.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const COUNTY_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STATE_CODE_PATTERN = /^[A-Z]{2}$/;
const COUNTY_FIPS_PATTERN = /^\d{5}$/;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** Default catalog path, resolved relative to this runtime package, not the CWD. */
export const DEFAULT_CATALOG_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../catalog/published-counties.json",
);

/**
 * @typedef {Object} PublishedCounty
 * @property {string} countyKey Stable lower-kebab county identifier.
 * @property {string} countyName Human-readable county name.
 * @property {string} stateCode Two-letter uppercase state code.
 * @property {string} countyFips Stable five-digit US county FIPS code.
 * @property {"published"} status Publication state.
 * @property {string} queryTableUrl Public query-table Parquet URL.
 * @property {string} datasetCoverageUrl Public dataset coverage URL.
 * @property {string | null} permitQueryTableUrl Public permit query-table URL.
 * @property {string | null} placesTableUrl Public Overture places-table URL.
 * @property {string} updatedAt ISO-8601 timestamp of the latest published data change.
 */

/**
 * @typedef {Object} PublishedCountyCatalog
 * @property {"1.0"} schemaVersion Catalog schema version.
 * @property {string} generatedAt ISO-8601 catalog generation timestamp.
 * @property {PublishedCounty[]} counties Published counties sorted by countyKey.
 */

/**
 * Normalize a county key to lower-kebab form.
 *
 * @param {string} value Raw county name/key.
 * @returns {string} Normalized county key.
 */
export function normalizeCountyKey(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Assert that a value is an HTTP(S) URL.
 *
 * @param {unknown} value Candidate URL.
 * @param {string} fieldName Field name for errors.
 * @param {boolean} nullable Whether null is accepted.
 * @returns {asserts value is string | null}
 */
function assertUrl(value, fieldName, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== "string") {
    throw new Error(
      `${fieldName} must be an HTTP(S) URL${nullable ? " or null" : ""}`,
    );
  }
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${fieldName} must use http or https`);
  }
}

/**
 * Validate and return a canonical published-county catalog.
 *
 * @param {unknown} input Untrusted parsed JSON.
 * @returns {PublishedCountyCatalog} Validated, deterministically sorted catalog.
 */
export function validateCatalog(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("catalog must be a JSON object");
  }
  const catalog = /** @type {Record<string, unknown>} */ (input);
  if (catalog.schemaVersion !== "1.0") {
    throw new Error("schemaVersion must be '1.0'");
  }
  if (
    typeof catalog.generatedAt !== "string" ||
    !ISO_TIMESTAMP_PATTERN.test(catalog.generatedAt)
  ) {
    throw new Error("generatedAt must be an ISO-8601 UTC timestamp");
  }
  if (!Array.isArray(catalog.counties)) {
    throw new Error("counties must be an array");
  }

  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Set<string>} */
  const seenFips = new Set();
  const counties = catalog.counties.map((raw, index) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error(`counties[${index}] must be an object`);
    }
    const row = /** @type {Record<string, unknown>} */ (raw);
    const countyKey =
      typeof row.countyKey === "string"
        ? normalizeCountyKey(row.countyKey)
        : "";
    if (!COUNTY_KEY_PATTERN.test(countyKey) || row.countyKey !== countyKey) {
      throw new Error(
        `counties[${index}].countyKey must be normalized lower-kebab`,
      );
    }
    if (seen.has(countyKey)) {
      throw new Error(`duplicate countyKey '${countyKey}'`);
    }
    seen.add(countyKey);
    if (typeof row.countyName !== "string" || row.countyName.trim() === "") {
      throw new Error(`counties[${index}].countyName is required`);
    }
    if (
      typeof row.stateCode !== "string" ||
      !STATE_CODE_PATTERN.test(row.stateCode)
    ) {
      throw new Error(
        `counties[${index}].stateCode must be two uppercase letters`,
      );
    }
    if (
      typeof row.countyFips !== "string" ||
      !COUNTY_FIPS_PATTERN.test(row.countyFips)
    ) {
      throw new Error(`counties[${index}].countyFips must be five digits`);
    }
    if (seenFips.has(row.countyFips)) {
      throw new Error(`duplicate countyFips '${row.countyFips}'`);
    }
    seenFips.add(row.countyFips);
    if (row.status !== "published") {
      throw new Error(`counties[${index}].status must be 'published'`);
    }
    assertUrl(row.queryTableUrl, `counties[${index}].queryTableUrl`);
    assertUrl(row.datasetCoverageUrl, `counties[${index}].datasetCoverageUrl`);
    assertUrl(
      row.permitQueryTableUrl,
      `counties[${index}].permitQueryTableUrl`,
      true,
    );
    const placesTableUrl =
      row.placesTableUrl === undefined ? null : row.placesTableUrl;
    assertUrl(placesTableUrl, `counties[${index}].placesTableUrl`, true);
    if (
      typeof row.updatedAt !== "string" ||
      !ISO_TIMESTAMP_PATTERN.test(row.updatedAt)
    ) {
      throw new Error(
        `counties[${index}].updatedAt must be an ISO-8601 UTC timestamp`,
      );
    }
    return /** @type {PublishedCounty} */ ({
      countyKey,
      countyName: row.countyName.trim(),
      stateCode: row.stateCode,
      countyFips: row.countyFips,
      status: "published",
      queryTableUrl: row.queryTableUrl,
      datasetCoverageUrl: row.datasetCoverageUrl,
      permitQueryTableUrl: row.permitQueryTableUrl,
      placesTableUrl,
      updatedAt: row.updatedAt,
    });
  });

  return {
    schemaVersion: "1.0",
    generatedAt: catalog.generatedAt,
    counties: counties.sort((a, b) => a.countyKey.localeCompare(b.countyKey)),
  };
}

/**
 * Insert or replace one county and return a deterministic catalog.
 *
 * @param {PublishedCountyCatalog} catalog Existing validated catalog.
 * @param {PublishedCounty} county County to upsert.
 * @param {string} generatedAt Catalog generation timestamp.
 * @returns {PublishedCountyCatalog} Updated validated catalog.
 */
export function upsertCounty(catalog, county, generatedAt) {
  const keyMatch = catalog.counties.find(
    (entry) => entry.countyKey === county.countyKey,
  );
  if (keyMatch !== undefined && keyMatch.countyFips !== county.countyFips) {
    throw new Error(
      `countyKey '${county.countyKey}' is already assigned to FIPS '${keyMatch.countyFips}'`,
    );
  }
  const fipsMatch = catalog.counties.find(
    (entry) => entry.countyFips === county.countyFips,
  );
  if (fipsMatch !== undefined && fipsMatch.countyKey !== county.countyKey) {
    throw new Error(
      `countyFips '${county.countyFips}' is already assigned to '${fipsMatch.countyKey}'`,
    );
  }
  const counties = catalog.counties.filter(
    (entry) => entry.countyKey !== county.countyKey,
  );
  counties.push(county);
  return validateCatalog({
    schemaVersion: "1.0",
    generatedAt,
    counties,
  });
}

/**
 * Parse CLI flags in `--name value` form.
 *
 * @param {string[]} argv Process arguments excluding node/script.
 * @returns {Record<string, string>} Parsed flags.
 */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      !flag?.startsWith("--") ||
      value === undefined ||
      value.startsWith("--")
    ) {
      throw new Error(
        `Expected --flag value pairs; invalid argument '${flag ?? ""}'`,
      );
    }
    result[flag.slice(2)] = value;
  }
  return result;
}

/**
 * Convert optional CLI URL values to null.
 *
 * @param {string | undefined} value Raw optional URL.
 * @returns {string | null} URL or null.
 */
function optionalUrl(value) {
  return value && value.trim() !== "" ? value.trim() : null;
}

/**
 * Verify both required public artifacts before admitting a county.
 *
 * @param {PublishedCounty} county Candidate county entry.
 * @param {(input: string | URL | Request, init?: RequestInit) => Promise<Response>} fetchImpl Fetch implementation.
 * @returns {Promise<void>}
 */
export async function verifyPublishedCountyArtifacts(
  county,
  fetchImpl = fetch,
) {
  const queryResponse = await fetchImpl(county.queryTableUrl, {
    method: "HEAD",
    redirect: "follow",
  });
  if (!queryResponse.ok) {
    throw new Error(
      `query table verification failed with HTTP ${queryResponse.status}`,
    );
  }

  const coverageResponse = await fetchImpl(county.datasetCoverageUrl, {
    redirect: "follow",
  });
  if (!coverageResponse.ok) {
    throw new Error(
      `dataset coverage verification failed with HTTP ${coverageResponse.status}`,
    );
  }
  const coverage = /** @type {unknown} */ (await coverageResponse.json());
  if (
    typeof coverage !== "object" ||
    coverage === null ||
    Array.isArray(coverage) ||
    typeof (/** @type {Record<string, unknown>} */ (coverage).county) !==
      "string"
  ) {
    throw new Error("dataset coverage response is missing county identity");
  }
  const coverageCounty = normalizeCountyKey(
    /** @type {string} */ (
      /** @type {Record<string, unknown>} */ (coverage).county
    ),
  );
  if (coverageCounty !== county.countyKey) {
    throw new Error(
      `dataset coverage county '${coverageCounty}' does not match '${county.countyKey}'`,
    );
  }

  if (county.permitQueryTableUrl !== null) {
    const permitResponse = await fetchImpl(county.permitQueryTableUrl, {
      method: "HEAD",
      redirect: "follow",
    });
    if (!permitResponse.ok) {
      throw new Error(
        `permit query table verification failed with HTTP ${permitResponse.status}`,
      );
    }
  }

  if (county.placesTableUrl !== null) {
    const placesResponse = await fetchImpl(county.placesTableUrl, {
      method: "HEAD",
      redirect: "follow",
    });
    if (!placesResponse.ok) {
      throw new Error(
        `places table verification failed with HTTP ${placesResponse.status}`,
      );
    }
  }
}

/**
 * Run the catalog update CLI.
 *
 * @param {string[]} argv Process arguments excluding node/script.
 * @returns {Promise<void>}
 */
export async function main(argv) {
  const args = parseArgs(argv);
  const catalogPath = args.catalog ?? DEFAULT_CATALOG_PATH;
  const now = args["generated-at"] ?? new Date().toISOString();
  const required = [
    "county-key",
    "county-name",
    "state-code",
    "county-fips",
    "query-table-url",
    "dataset-coverage-url",
    "updated-at",
  ];
  for (const key of required) {
    if (!args[key]) throw new Error(`--${key} is required`);
  }

  const catalog = validateCatalog(
    JSON.parse(await readFile(catalogPath, "utf8")),
  );
  const county = /** @type {PublishedCounty} */ ({
    countyKey: normalizeCountyKey(args["county-key"]),
    countyName: args["county-name"],
    stateCode: args["state-code"].toUpperCase(),
    countyFips: args["county-fips"],
    status: "published",
    queryTableUrl: args["query-table-url"],
    datasetCoverageUrl: args["dataset-coverage-url"],
    permitQueryTableUrl: optionalUrl(args["permit-query-table-url"]),
    placesTableUrl: optionalUrl(args["places-table-url"]),
    updatedAt: args["updated-at"],
  });
  validateCatalog({
    schemaVersion: "1.0",
    generatedAt: now,
    counties: [county],
  });
  await verifyPublishedCountyArtifacts(county);
  const updated = upsertCounty(catalog, county, now);
  await writeFile(catalogPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Updated ${catalogPath}: ${updated.counties.length} published counties\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
