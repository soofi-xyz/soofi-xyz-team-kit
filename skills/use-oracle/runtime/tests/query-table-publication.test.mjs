import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  MCP_OVERLAY_CATALOG_PATH,
  PUBLISHED_COUNTY_CATALOG_PATH,
  queryTablePublicationFromCatalog,
  queryTablePublicationFromSources,
  requireQueryTablePublication,
} from "../src/core/query-table-publication.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(testDir, "../bin/elephant-county.mjs");
const catalog = JSON.parse(
  readFileSync(PUBLISHED_COUNTY_CATALOG_PATH, "utf8"),
);
const overlays = JSON.parse(
  readFileSync(MCP_OVERLAY_CATALOG_PATH, "utf8"),
);

const HOA_PM_COUNTIES = [
  "pinellas",
  "palm-beach",
  "hillsborough",
  "orange",
  "polk",
  "seminole",
  "lee",
  "miami-dade",
  "pasco",
  "osceola",
  "duval",
  "broward",
  "clay",
  "hernando",
  "lake",
  "manatee",
  "marion",
  "sarasota",
  "st-johns",
  "volusia",
];

describe("query-table publication lookup", () => {
  it.each(HOA_PM_COUNTIES)(
    "resolves shared bucket and county-scoped labels for %s",
    (countyKey) => {
      expect(requireQueryTablePublication(countyKey)).toEqual({
        bucket: "elephant-oracle-query-table",
        queryTableIpnsLabel: `oracle-query-table-${countyKey}`,
        coverageIpnsLabel: `oracle-dataset-coverage-${countyKey}`,
      });
    },
  );

  it("rejects counties that are not published in the catalog", () => {
    expect(() =>
      queryTablePublicationFromCatalog(catalog, "not-published"),
    ).toThrow('Unknown published --county "not-published"');
  });

  it("accepts query-table-only counties from the MCP overlay", () => {
    expect(
      queryTablePublicationFromSources(catalog, overlays, "clay"),
    ).toEqual({
      bucket: "elephant-oracle-query-table",
      queryTableIpnsLabel: "oracle-query-table-clay",
      coverageIpnsLabel: "oracle-dataset-coverage-clay",
    });
  });

  it("publishes HOA/PM query tables to separate dataset labels and keys", () => {
    const stdout = execFileSync(
      process.execPath,
      [
        cliPath,
        "hoa-pm-publish",
        "--county",
        "pinellas",
        "--input",
        "/dry-run-input-is-not-read",
        "--dry-run",
        "--query-table-only",
      ],
      { encoding: "utf8" },
    );
    const report = JSON.parse(stdout);

    expect(report.result).toMatchObject({
      dryRun: true,
      bucket: "elephant-oracle-query-table",
      queryTableIpnsLabel: "oracle-query-table-pinellas-hoa-pm",
      coverageIpnsLabel: "oracle-dataset-coverage-pinellas-hoa-pm",
      queryTableKey: "pinellas/hoa-pm/query-table.parquet",
      coverageKey: "pinellas/hoa-pm/dataset-coverage.json",
    });
    expect(report.result).not.toHaveProperty("hoaPmObjectsKey");
    expect(report.result.queryTableKey).not.toBe("pinellas/query-table.parquet");
    expect(report.result.queryTableIpnsLabel).not.toBe(
      "oracle-query-table-pinellas",
    );
    expect(report.result.queryTableIpnsLabel).not.toBe(
      "oracle-query-table-broward",
    );
  });
});
