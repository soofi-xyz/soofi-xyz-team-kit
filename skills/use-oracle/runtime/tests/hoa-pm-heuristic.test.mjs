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

  it.each([
    ["05042 SAN PABLO CREEK UNIT 3A", "SAN PABLO CREEK HOMEOWNERS' ASSOCIATION, INC.", "N93000001051"],
    ["06540 COTTAGES AT ARGYLE CONDOMINIUM", "THE COTTAGES AT ARGYLE CONDOMINIUM ASSOCIATION, INC.", "N06000009522"],
    ["DUPREE LAKES PHASE 3D", "DUPREE LAKES HOMEOWNERS ASSOCIATION, INC.", "N05000002012"],
    ["SUNDANCE PLACE PHASE TWO", "SUNDANCE PLACE HOMEOWNERS ASSOCIATION, INC.", "N14000002147"],
    ["ASHLEY COVE UNIT 3", "ASHLEY COVE HOMEOWNER'S ASSOCIATION, INC.", "N98000004343"],
    ["PINE RIDGE UNIT 01", "PINE RIDGE HOA, INC.", "N10000000001"],
    ["PINE RIDGE PH 2", "PINE RIDGE POA, INC.", "N10000000002"],
    ["PINE RIDGE SEC 14", "PINE RIDGE COA, INC.", "N10000000003"],
    ["PINE RIDGE SECTION 3", "PINE RIDGE ASSN, INC.", "N10000000004"],
    ["PINE RIDGE NBHD 4", "PINE RIDGE ASSOC, INC.", "N10000000005"],
    ["PINE RIDGE VLG 5", "PINE RIDGE ASSOCIATION, INC.", "N10000000006"],
    ["PINE RIDGE REPLAT", "PINE RIDGE COMMUNITY ASSOCIATION, INC.", "N10000000007"],
    ["PINE RIDGE PARTIAL REPLAT", "PINE RIDGE CIVIC ASSOCIATION, INC.", "N10000000008"],
    ["PINE RIDGE 20", "PINE RIDGE PROPERTY OWNERS ASSOCIATION, INC.", "N10000000009"],
    ["PINE RIDGE TWENTY", "PINE RIDGE HOMEOWNERS' ASSOCIATION, INC.", "N10000000010"],
  ])("matches deterministic subdivision normalization: %s", (subdivision, entityName, documentNumber) => {
    const result = findHoaCompanies(subdivision, [
      { ...hoaCompany, documentNumber, entityName },
    ]);
    expect(result.status).toBe("matched");
    expect(result.matches[0].documentNumber).toBe(documentNumber);
  });

  it.each([
    "PINE & GLEN HOMEOWNERS ASSOCIATION, INC.",
    "PINE AND GLEN HOMEOWNERS' ASSOCIATION INC",
    "PINE AND GLEN HOMEOWNER'S ASSOCIATION, INC.",
    "PINE AND GLEN CONDOMINIUM ASSOCIATION, INC.",
    "PINE AND GLEN ASSOCIATION, INC.",
    "PINE AND GLEN ASSOC, INC.",
    "PINE AND GLEN ASSN, INC.",
    "PINE AND GLEN PROPERTY OWNERS ASSOCIATION, INC.",
    "PINE AND GLEN COMMUNITY ASSOCIATION, INC.",
    "PINE AND GLEN CIVIC ASSOCIATION, INC.",
    "PINE AND GLEN POA, INC.",
    "PINE AND GLEN COA, INC.",
    "PINE AND GLEN HOA, INC.",
    "THE PINE AND GLEN HOMEOWNERS ASSOCIATION, INC.",
  ])("recognizes deterministic Sunbiz association suffix: %s", (entityName) => {
    const result = findHoaCompanies("Pine & Glen", [
      { ...hoaCompany, entityName },
    ]);
    expect(result.status).toBe("matched");
  });

  it("normalizes PH/PHASE, SEC/SECTION, and word-number forms", () => {
    const phase = findHoaCompanies("PINE RIDGE PH TWO", [
      {
        ...hoaCompany,
        entityName: "PINE RIDGE PHASE 2 HOMEOWNERS ASSOCIATION, INC.",
      },
    ]);
    const section = findHoaCompanies("PINE RIDGE SEC THREE", [
      {
        ...hoaCompany,
        entityName: "PINE RIDGE SECTION 3 HOMEOWNERS ASSOCIATION, INC.",
      },
    ]);
    expect(phase.status).toBe("matched");
    expect(section.status).toBe("matched");
  });

  it("uses principal-address county only to resolve an explicit statewide collision", () => {
    const result = findHoaCompanies(
      "Pine Ridge",
      [
        {
          ...hoaCompany,
          documentNumber: "N10000000001",
          entityName: "PINE RIDGE HOMEOWNERS ASSOCIATION, INC.",
          principalAddress: { county: "Duval County" },
        },
        {
          ...hoaCompany,
          documentNumber: "N10000000002",
          entityName: "PINE RIDGE COMMUNITY ASSOCIATION, INC.",
          principalAddress: { county: "Orange" },
        },
      ],
      { countyKey: "duval" },
    );
    expect(result.status).toBe("matched");
    expect(result.matches[0].documentNumber).toBe("N10000000001");
  });

  it("stays not_unique when geography cannot disambiguate a collision", () => {
    const result = findHoaCompanies(
      "Pine Ridge",
      [
        {
          ...hoaCompany,
          documentNumber: "N10000000001",
          entityName: "PINE RIDGE HOMEOWNERS ASSOCIATION, INC.",
          principalAddress: { county: "Duval" },
        },
        {
          ...hoaCompany,
          documentNumber: "N10000000002",
          entityName: "PINE RIDGE COMMUNITY ASSOCIATION, INC.",
          principalAddress: {},
        },
      ],
      { countyKey: "duval" },
    );
    expect(result.status).toBe("not_unique");
  });

  it("keeps a unique legacy match even when a different normalized candidate exists", () => {
    const result = findHoaCompanies("FOO BAR UNIT 3A", [
      {
        ...hoaCompany,
        documentNumber: "N11111111111",
        entityName: "FOO BAR UNIT 3A HOMEOWNERS ASSOCIATION INC",
      },
      {
        ...hoaCompany,
        documentNumber: "N22222222222",
        entityName: "FOO BAR HOMEOWNERS ASSOCIATION INC",
      },
    ]);
    expect(result.status).toBe("matched");
    expect(result.matches[0].documentNumber).toBe("N11111111111");
  });

  it("collapses duplicate ACTIVE filings with an identical normalized legal name", () => {
    const result = findHoaCompanies("Villages of Westport", [
      {
        ...hoaCompany,
        documentNumber: "L25000228020",
        entityName: "VILLAGES OF WESTPORT HOMEOWNERS ASSOCIATION, INC.",
      },
      {
        ...hoaCompany,
        documentNumber: "N25000008620",
        entityName: "VILLAGES OF WESTPORT HOMEOWNERS ASSOCIATION INC",
      },
    ]);
    expect(result.status).toBe("matched");
    expect(result.matches[0].documentNumber).toBe("L25000228020");
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

  it("rejects an INACTIVE Sunbiz association", () => {
    const result = findHoaCompanies("Example Subdivision", [
      { ...hoaCompany, status: "INACTIVE" },
    ]);
    expect(result.status).toBe("no_sunbiz_hoa");
  });

  it("fails closed when two HOA companies match", () => {
    const result = findHoaCompanies("Example Subdivision", [
      hoaCompany,
      {
        ...hoaCompany,
        documentNumber: "N999999",
        entityName: "EXAMPLE SUBDIVISION COMMUNITY ASSOCIATION INC",
      },
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
