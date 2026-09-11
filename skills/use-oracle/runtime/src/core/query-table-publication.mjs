import { readFileSync } from "node:fs";

export const QUERY_TABLE_BUCKET = "elephant-oracle-query-table";
export const PUBLISHED_COUNTY_CATALOG_PATH = new URL(
  "../../catalog/published-counties.json",
  import.meta.url,
);

const COUNTY_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function queryTablePublicationFromCatalog(catalog, countyKey) {
  if (
    typeof countyKey !== "string" ||
    !COUNTY_KEY_PATTERN.test(countyKey)
  ) {
    throw new Error(`Invalid published county key "${countyKey}"`);
  }

  const counties = Array.isArray(catalog?.counties) ? catalog.counties : [];
  const matches = counties.filter((county) => county?.countyKey === countyKey);
  if (matches.length !== 1 || matches[0].status !== "published") {
    const known = counties
      .filter((county) => county?.status === "published")
      .map((county) => county.countyKey)
      .filter((key) => typeof key === "string")
      .sort();
    throw new Error(
      `Unknown published --county "${countyKey}". Known published counties: ${known.join(", ")}`,
    );
  }

  const county = matches[0];
  if (
    typeof county.queryTableUrl !== "string" ||
    typeof county.datasetCoverageUrl !== "string"
  ) {
    throw new Error(
      `Published county "${countyKey}" must have queryTableUrl and datasetCoverageUrl`,
    );
  }

  return Object.freeze({
    bucket: QUERY_TABLE_BUCKET,
    queryTableIpnsLabel: `oracle-query-table-${countyKey}`,
    coverageIpnsLabel: `oracle-dataset-coverage-${countyKey}`,
  });
}

export function requireQueryTablePublication(countyKey) {
  const catalog = JSON.parse(
    readFileSync(PUBLISHED_COUNTY_CATALOG_PATH, "utf8"),
  );
  return queryTablePublicationFromCatalog(catalog, countyKey);
}
