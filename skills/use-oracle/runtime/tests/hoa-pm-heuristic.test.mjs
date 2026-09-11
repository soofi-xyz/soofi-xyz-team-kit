import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { ParquetSchema, ParquetWriter } from "@dsnp/parquetjs";
import { afterEach, describe, expect, it } from "vitest";

import { toParquetRecord, writeQueryTableParquet } from "../src/core/query-table.mjs";
import {
  findHoaCompanies,
  findPropertyManagementCompany,
  resolveHoaAndPropertyManagement,
  stampPropertyCids,
} from "../src/enrichment/hoa-pm-heuristic.mjs";
import { enrichQueryTableWithHoaPm } from "../src/enrichment/query-table-hoa-pm.mjs";

const require = createRequire(import.meta.url);
const { ParquetReader } = require("@dsnp/parquetjs");
const temporaryDirectories = [];
const portableInputSchema = {
  property_id: { type: "UTF8", optional: true },
  parcel_identifier: { type: "UTF8", optional: true },
  subdivision: { type: "UTF8", optional: true },
};

async function writeZstdQueryTableParquet(parquetPath, rows) {
  const schemaFields = Object.fromEntries(
    Object.entries(portableInputSchema).map(([name, field]) => [
      name,
      { ...field, compression: "ZSTD" },
    ]),
  );
  const writer = await ParquetWriter.openFile(
    new ParquetSchema(schemaFields),
    parquetPath,
  );
  try {
    for (const row of rows) await writer.appendRow(toParquetRecord(row));
  } finally {
    await writer.close();
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const hoaCompany = {
  documentNumber: "N123456",
  entityName: "EXAMPLE SUBDIVISION HOMEOWNERS ASSOCIATION INC",
  status: "ACTIVE",
  registeredAgent: {
    name: "CAMPBELL PROPERTY MANAGEMENT LLC",
    type: "C",
    address: { line1: "100 MANAGER WAY", city: "JACKSONVILLE", state: "FL", zip: "32225" },
  },
};

const managerCompany = {
  documentNumber: "L654321",
  entityName: "CAMPBELL PROPERTY MANAGEMENT LLC",
  status: "ACTIVE",
  registeredAgent: { name: "SOME PERSON", type: "P" },
};

describe("hoa-pm heuristic", () => {
  it("matches a unique Sunbiz HOA for a subdivision", () => {
    const result = findHoaCompanies("Example Subdivision", [hoaCompany, managerCompany]);
    expect(result.status).toBe("matched");
    expect(result.matches[0].documentNumber).toBe("N123456");
  });

  it("strips a numeric tract prefix and trailing unit number", () => {
    const beaconHoa = {
      ...hoaCompany,
      entityName: "BEACON HILLS & HARBOR HOMEOWNERS ASSOCIATION INC",
    };
    const result = findHoaCompanies(
      "02944 BEACON HILLS & HARBOR 01",
      [beaconHoa, managerCompany],
    );
    expect(result.status).toBe("matched");
    expect(result.matches[0].documentNumber).toBe("N123456");
  });

  it("fails closed when stripped subdivision names match multiple HOAs", () => {
    const result = findHoaCompanies("02944 BEACON HILLS & HARBOR 01", [
      {
        ...hoaCompany,
        entityName: "BEACON HILLS & HARBOR HOMEOWNERS ASSOCIATION INC",
      },
      {
        ...hoaCompany,
        documentNumber: "N999999",
        entityName: "BEACON HILLS & HARBOR COMMUNITY ASSOCIATION INC",
      },
    ]);
    expect(result.status).toBe("not_unique");
  });

  it("does not invent an HOA from subdivision name alone", () => {
    const result = findHoaCompanies("Example Subdivision", [managerCompany]);
    expect(result.status).toBe("no_sunbiz_hoa");
  });

  it("fails closed when two HOA companies match", () => {
    const result = findHoaCompanies("Example Subdivision", [
      hoaCompany,
      { ...hoaCompany, documentNumber: "N999999" },
    ]);
    expect(result.status).toBe("not_unique");
  });

  it("resolves property management from the HOA registered-agent company", () => {
    const result = findPropertyManagementCompany(hoaCompany, [hoaCompany, managerCompany]);
    expect(result.status).toBe("matched");
    expect(result.matches[0].documentNumber).toBe("L654321");
  });

  it("reports when the agent company is not in Sunbiz", () => {
    const result = findPropertyManagementCompany(hoaCompany, [hoaCompany]);
    expect(result.status).toBe("agent_not_in_sunbiz");
  });

  it("stamps the explicit property-manager miss reason", () => {
    const resolution = resolveHoaAndPropertyManagement({
      subdivision: "Example Subdivision",
      companies: [{ ...hoaCompany, registeredAgent: null }],
    });
    expect(resolution.status).toBe("no_agent_company");
    expect(
      stampPropertyCids({ parcel_identifier: "1605480000" }, resolution)
        .hoa_pm_status,
    ).toBe("no_agent_company");
  });

  it("stamps HOA and PM CIDs on the property object", () => {
    const resolution = resolveHoaAndPropertyManagement({
      subdivision: "Example Subdivision",
      companies: [hoaCompany, managerCompany],
    });
    expect(resolution.status).toBe("matched");
    expect(resolution.hoa.cid).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(resolution.propertyManagement.cid).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(resolution.hoa.property_manager_cid).toBe(resolution.propertyManagement.cid);

    const stamped = stampPropertyCids({ parcel_identifier: "1605480000" }, resolution);
    expect(stamped.hoa_cid).toBe(resolution.hoa.cid);
    expect(stamped.property_manager_cid).toBe(resolution.propertyManagement.cid);
    expect(stamped.hoa_sunbiz_document_number).toBe("N123456");
    expect(stamped.property_manager_sunbiz_document_number).toBe("L654321");
    expect(stamped.hoa_pm_status).toBe("matched");
  });
});

describe("hoa-pm query-table enrich", () => {
  it("reads ZSTD input and preserves ZSTD output compression", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "hoa-pm-zstd-"));
    temporaryDirectories.push(directory);
    const inputParquet = path.join(directory, "input.parquet");
    const inputCoverage = path.join(directory, "input-coverage.json");
    const outputParquet = path.join(directory, "output", "query-table.parquet");
    await writeZstdQueryTableParquet(inputParquet, [
      {
        property_id: "property-1",
        parcel_identifier: "1605480000",
        subdivision: "Example Subdivision",
      },
      {
        property_id: "property-2",
        parcel_identifier: "0969250000",
        subdivision: "Unknown Place",
      },
    ]);
    await writeFile(
      inputCoverage,
      `${JSON.stringify({ county: "duval", datasets: [] })}\n`,
    );

    const summary = await enrichQueryTableWithHoaPm({
      countyKey: "duval",
      inputParquet,
      inputCoverage,
      companies: [hoaCompany, managerCompany],
      outputParquet,
      outputCoverage: path.join(directory, "output", "dataset-coverage.json"),
      manifestPath: path.join(directory, "output", "manifest.json"),
    });

    expect(summary.propertyCount).toBe(2);
    expect((await stat(inputParquet)).size).toBeLessThan(512 * 1024);
    const reader = await ParquetReader.openFile(outputParquet);
    try {
      expect(
        new Set(
          reader.metadata.row_groups.flatMap((rowGroup) =>
            rowGroup.columns.map((column) => column.meta_data.codec),
          ),
        ),
      ).toEqual(new Set([6]));
      const cursor = reader.getCursor();
      expect((await cursor.next()).hoa_pm_status).toBe("matched");
    } finally {
      await reader.close();
    }
  });

  it("writes CID columns and data-group objects", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "hoa-pm-"));
    temporaryDirectories.push(directory);
    const inputParquet = path.join(directory, "input.parquet");
    const inputCoverage = path.join(directory, "input-coverage.json");
    const outputParquet = path.join(directory, "output", "query-table.parquet");
    await writeQueryTableParquet({
      parquetPath: inputParquet,
      schemaFields: portableInputSchema,
      rows: [
        {
          property_id: "property-1",
          parcel_identifier: "1605480000",
          subdivision: "Example Subdivision",
        },
        {
          property_id: "property-2",
          parcel_identifier: "0969250000",
          subdivision: "Unknown Place",
        },
      ],
    });
    await writeFile(
      inputCoverage,
      `${JSON.stringify({ county: "duval", datasets: [{ county: "duval", source: "appraisal", ingested_count: 2, expected_count: 2 }] })}\n`,
    );

    const summary = await enrichQueryTableWithHoaPm({
      countyKey: "broward",
      inputParquet,
      inputCoverage,
      companies: [hoaCompany, managerCompany],
      outputParquet,
      outputCoverage: path.join(directory, "output", "dataset-coverage.json"),
      objectsDir: path.join(directory, "output", "objects"),
      manifestPath: path.join(directory, "output", "hoa-pm-enrichment-manifest.json"),
    });

    expect(summary.propertyCount).toBe(2);
    expect(summary.statusCounts.matched).toBe(1);
    const objects = (await readFile(path.join(directory, "output", "objects", "hoa-pm-objects.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      objects.some(
        (object) =>
          object.type === "homeowners_association" &&
          object.data_group === "HOA_",
      ),
    ).toBe(true);
    expect(
      objects.some((object) => object.data_group === "Property_Management"),
    ).toBe(true);

    const reader = await ParquetReader.openFile(outputParquet);
    try {
      const cursor = reader.getCursor();
      const rows = [];
      let row = await cursor.next();
      while (row) {
        rows.push(row);
        row = await cursor.next();
      }
      expect(rows.map((row) => row.hoa_pm_status)).toEqual([
        "matched",
        "no_sunbiz_hoa",
      ]);
    } finally {
      await reader.close();
    }
  });
});
