import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { ParquetReader } from "@dsnp/parquetjs";
import { describe, expect, it } from "vitest";

import { renderCsv } from "../src/core/csv.mjs";
import {
  LocalIngestError,
  RUNTIME_ROOT,
  buildLocalRequest,
  canonicalJson,
  runLocalIngest,
  validateCountyOutput,
  validateSeedRows,
  validateSourceHtml,
  validateSourceUrl,
} from "../src/local/opendoor-local.mjs";

const execFileAsync = promisify(execFile);
const CLI_PATH = path.join(RUNTIME_ROOT, "bin", "opendoor-local-appraisal.mjs");
const FIXTURE_PATH = path.join(
  RUNTIME_ROOT,
  "fixtures",
  "opendoor-local",
  "synthetic-one-row.csv",
);
const UUID = "00000000-0000-5000-8000-000000000001";
const TOKEN = "A".repeat(64);

function rowFor(county) {
  if (county === "lake") {
    return {
      parcel_id: "1000001",
      source_identifier: "1000001",
      situs_address: "1 SYNTHETIC TEST WAY",
      method: "GET",
      url: "https://www.lakecopropappr.com/property-details.aspx?AltKey=1000001",
      county,
      county_fips: "12069",
      elephant_uuid: UUID,
      elephant_token: `address:v1:${TOKEN}`,
      opendoor_address: "1 Synthetic Test Way, Example, FL, 00000",
    };
  }
  if (county === "clay") {
    const parcelId = "01-02-03-000001-001-01";
    return {
      parcel_id: parcelId,
      source_identifier: parcelId,
      situs_address: "1 SYNTHETIC TEST WAY",
      method: "GET",
      url: `https://qpublic.schneidercorp.com/Application.aspx?AppID=830&LayerID=15008&PageTypeID=4&PageID=6754&KeyValue=${parcelId}`,
      county,
      county_fips: "12019",
      elephant_uuid: UUID,
      elephant_token: `address:v1:${TOKEN}`,
      opendoor_address: "1 Synthetic Test Way, Example, FL, 00000",
    };
  }
  return {
    parcel_id: "1000001",
    source_identifier: "1000001",
    situs_address: "1 SYNTHETIC TEST WAY",
    method: "GET",
    url: "https://paproapp.vcgov.org/search/real-property/1000001",
    county,
    county_fips: "12127",
    elephant_uuid: UUID,
    elephant_token: `address:v1:${TOKEN}`,
    opendoor_address: "1 Synthetic Test Way, Example, FL, 00000",
  };
}

function htmlFor(county, parcelId) {
  if (county === "lake") {
    return `<html><body>Property Record Card Alternate Key: ${parcelId}</body></html>`;
  }
  if (county === "clay") {
    return `<html><body><div id="dynamicSummary">${parcelId} Property Use Code</div></body></html>`;
  }
  return `<html><body>Parcel ID: 123456789012 Alternate Key: ${parcelId} Property Use: Residential Physical Address: 1 SYNTHETIC TEST WAY</body></html>`;
}

async function writeSeed(directory, county) {
  const row = rowFor(county);
  const filePath = path.join(directory, `${county}.csv`);
  const headers = Object.keys(row);
  await writeFile(filePath, renderCsv(headers, [row]));
  return filePath;
}

async function mockTransform({ county, row, workDir }) {
  const parcelIdentifier =
    county === "volusia"
      ? "123456789012"
      : county === "lake"
        ? "OFFICIAL-1000001"
        : row.parcel_id;
  await mkdir(path.join(workDir, "data"), { recursive: true });
  await writeFile(
    path.join(workDir, "data", "property.json"),
    canonicalJson({
      request_identifier: row.parcel_id,
      parcel_identifier: parcelIdentifier,
      property_type: "Building",
      property_usage_type: "Residential",
    }),
  );
  await writeFile(
    path.join(workDir, "data", "address.json"),
    canonicalJson({
      request_identifier: row.parcel_id,
      unnormalized_address: row.opendoor_address,
    }),
  );
  if (county === "lake") {
    await writeFile(
      path.join(workDir, "data", "parcel.json"),
      canonicalJson({
        request_identifier: row.parcel_id,
        parcel_identifier: parcelIdentifier,
      }),
    );
  }
}

async function readParquetRows(filePath) {
  const reader = await ParquetReader.openFile(filePath);
  const rows = [];
  try {
    const cursor = reader.getCursor();
    let row = await cursor.next();
    while (row) {
      rows.push(row);
      row = await cursor.next();
    }
  } finally {
    await reader.close();
  }
  return rows;
}

describe("OpenDoor county request contracts", () => {
  it("preserves opaque identity and only strips the exact token prefix", () => {
    for (const county of ["lake", "clay", "volusia"]) {
      const [validated] = validateSeedRows([rowFor(county)], county);
      expect(validated.elephant_uuid).toBe(UUID);
      expect(validated.elephant_token).toBe(TOKEN);
    }
  });

  it("requires the reviewed Clay qPublic parameters and exact hyphenated KeyValue", () => {
    const row = rowFor("clay");
    const canonical = validateSourceUrl("clay", row.url, row.parcel_id);
    expect(new URL(canonical).searchParams.get("KeyValue")).toBe(row.parcel_id);
    expect(() =>
      validateSourceUrl(
        "clay",
        row.url.replace("PageTypeID=4", "PageTypeID=2"),
        row.parcel_id,
      ),
    ).toThrow(/unreviewed query parameters/);
    expect(() =>
      validateSeedRows(
        [
          {
            ...row,
            parcel_id: row.parcel_id.replaceAll("-", ""),
            source_identifier: row.parcel_id.replaceAll("-", ""),
          },
        ],
        "clay",
      ),
    ).toThrow(/invalid Clay request identifier/);
  });

  it("normalizes only Volusia's reviewed stale route to seven-digit ALTKEY summary", () => {
    const row = rowFor("volusia");
    expect(validateSourceUrl("volusia", row.url, row.parcel_id)).toBe(
      "https://paproapp.vcgov.org/parcel/summary/?altkey=1000001",
    );
    expect(() =>
      validateSourceUrl(
        "volusia",
        "https://paproapp.vcgov.org/search/real-property/9999999",
        row.parcel_id,
      ),
    ).toThrow(/outside the reviewed Volusia route/);
  });

  it("fails closed on CAPTCHA or anti-bot responses", () => {
    expect(() =>
      validateSourceHtml(
        "clay",
        "<html>Enable JavaScript and cookies to continue cf-chl-</html>",
        rowFor("clay").parcel_id,
      ),
    ).toThrow(/will not bypass/);
  });
});

describe("OpenDoor county output contracts", () => {
  const identity = { elephant_uuid: UUID, elephant_token: TOKEN };

  it("allows Lake ALTKEY to differ from the official emitted parcel identifier", () => {
    const row = { ...rowFor("lake"), elephant_token: TOKEN };
    expect(() =>
      validateCountyOutput(
        "lake",
        {
          ...identity,
          request_identifier: row.parcel_id,
          parcel_identifier: "OFFICIAL-PARCEL",
        },
        {
          request_identifier: row.parcel_id,
          parcel_identifier: "OFFICIAL-PARCEL",
        },
        identity,
        row,
      ),
    ).not.toThrow();
  });

  it("allows Clay and Volusia to omit parcel.json under their safe contracts", () => {
    const clay = { ...rowFor("clay"), elephant_token: TOKEN };
    expect(() =>
      validateCountyOutput(
        "clay",
        {
          ...identity,
          request_identifier: clay.parcel_id,
          parcel_identifier: clay.parcel_id,
        },
        null,
        identity,
        clay,
      ),
    ).not.toThrow();
    const volusia = { ...rowFor("volusia"), elephant_token: TOKEN };
    expect(() =>
      validateCountyOutput(
        "volusia",
        {
          ...identity,
          request_identifier: volusia.parcel_id,
          parcel_identifier: "123456789012",
        },
        null,
        identity,
        volusia,
      ),
    ).not.toThrow();
  });
});

describe("local capture, receipt, resume, and Parquet handoff", () => {
  it.each(["lake", "clay", "volusia"])(
    "writes and validates one final %s query-table.parquet with exact identity",
    async (county) => {
      const temp = await mkdtemp(path.join(tmpdir(), `opendoor-${county}-`));
      try {
        const seedPath = await writeSeed(temp, county);
        const outputDir = path.join(temp, "output");
        let captures = 0;
        const options = {
          county,
          mode: "smoke",
          runId: `${county}-synthetic-smoke`,
          seedPath,
          outputDir,
          captureHtml: async ({ row }) => {
            captures += 1;
            return htmlFor(county, row.parcel_id);
          },
          transformRow: mockTransform,
        };
        const handoff = await runLocalIngest(options);
        expect(handoff).toMatchObject({
          selectedRows: 1,
          capturedRows: 1,
          failedRows: 0,
          loadedRows: 0,
          publishedRows: 0,
          status: "captured_transformed_exported_local",
          publication: {
            enabled: false,
            filebase: false,
            ipns: false,
          },
          queryTable: {
            path: "query-table.parquet",
            validation: {
              rows: 1,
              distinctRequestIdentifiers: 1,
              distinctPropertyIds: 1,
              identityMatches: 1,
            },
          },
        });
        const [parquetRow] = await readParquetRows(
          path.join(outputDir, "query-table.parquet"),
        );
        expect(parquetRow.request_identifier).toBe(rowFor(county).parcel_id);
        expect(parquetRow.elephant_uuid).toBe(UUID);
        expect(parquetRow.elephant_token).toBe(TOKEN);

        const resumed = await runLocalIngest({
          ...options,
          captureHtml: async () => {
            throw new Error("resume must not recapture a valid receipt");
          },
        });
        expect(resumed.queryTable.sha256).toBe(handoff.queryTable.sha256);
        expect(captures).toBe(1);
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    },
  );

  it("writes a failure handoff and never creates a partial Parquet file", async () => {
    const temp = await mkdtemp(path.join(tmpdir(), "opendoor-blocked-"));
    try {
      const seedPath = await writeSeed(temp, "clay");
      const outputDir = path.join(temp, "output");
      const handoff = await runLocalIngest({
        county: "clay",
        mode: "smoke",
        runId: "clay-blocked-smoke",
        seedPath,
        outputDir,
        captureHtml: async () => {
          throw new LocalIngestError(
            "source_access_blocked",
            "Human-owned Cloudflare/session resolution required",
          );
        },
        transformRow: mockTransform,
      });
      expect(handoff).toMatchObject({
        selectedRows: 1,
        capturedRows: 0,
        failedRows: 1,
        loadedRows: 0,
        publishedRows: 0,
        queryTable: null,
      });
      await expect(
        access(path.join(outputDir, "query-table.parquet")),
      ).rejects.toThrow();
      const failure = JSON.parse(
        await readFile(
          path.join(outputDir, handoff.failures[0]),
          "utf8",
        ),
      );
      expect(failure).toMatchObject({
        category: "source_access_blocked",
        attempts: 1,
      });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("plans from an arbitrary cwd without capturing or requiring Chromium", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "opendoor-cwd-"));
    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          CLI_PATH,
          "plan",
          "--county",
          "lake",
          "--seed",
          FIXTURE_PATH,
          "--run-id",
          "lake-synthetic-plan",
          "--mode",
          "smoke",
        ],
        { cwd },
      );
      const output = JSON.parse(stdout);
      expect(output.event).toBe("opendoor_local_plan");
      expect(output.request.publication.enabled).toBe(false);
      expect(output.request.seed.selectedRows).toBe(1);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects a one-row seed in full mode", async () => {
    await expect(
      buildLocalRequest({
        county: "lake",
        seedPath: FIXTURE_PATH,
        runId: "lake-invalid-full",
        mode: "full",
      }),
    ).rejects.toThrow(/exactly 770 rows/);
  });
});
