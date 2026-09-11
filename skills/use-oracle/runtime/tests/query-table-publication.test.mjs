import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  PUBLISHED_COUNTY_CATALOG_PATH,
  queryTablePublicationFromCatalog,
  requireQueryTablePublication,
} from "../src/core/query-table-publication.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(testDir, "../bin/elephant-county.mjs");
const catalog = JSON.parse(
  readFileSync(PUBLISHED_COUNTY_CATALOG_PATH, "utf8"),
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

  it("publishes HOA/PM to separate dataset labels", () => {
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
      ],
      { encoding: "utf8" },
    );
    const report = JSON.parse(stdout);

    expect(report.result).toMatchObject({
      dryRun: true,
      bucket: "elephant-oracle-query-table",
      queryTableIpnsLabel: "oracle-query-table-pinellas-hoa-pm",
      coverageIpnsLabel: "oracle-dataset-coverage-pinellas-hoa-pm",
    });
    expect(report.result.queryTableIpnsLabel).not.toBe(
      "oracle-query-table-pinellas",
    );
    expect(report.result.queryTableIpnsLabel).not.toBe(
      "oracle-query-table-broward",
    );
  });
});
