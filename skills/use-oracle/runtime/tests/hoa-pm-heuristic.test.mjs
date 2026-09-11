import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { duvalEnrichmentProfile } from "../src/counties/duval/enrichment-profile.mjs";
import { writeQueryTableParquet } from "../src/core/query-table.mjs";
import {
  findHoaCompanies,
  findPropertyManagementCompany,
  resolveHoaAndPropertyManagement,
  stampPropertyCids,
} from "../src/enrichment/hoa-pm-heuristic.mjs";
import { enrichQueryTableWithHoaPm } from "../src/enrichment/query-table-hoa-pm.mjs";

const temporaryDirectories = [];

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
  });
});

describe("hoa-pm query-table enrich", () => {
  it("writes CID columns and data-group objects", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "hoa-pm-"));
    temporaryDirectories.push(directory);
    const inputParquet = path.join(directory, "input.parquet");
    const inputCoverage = path.join(directory, "input-coverage.json");
    await writeQueryTableParquet({
      parquetPath: inputParquet,
      schemaFields: duvalEnrichmentProfile.queryTable.schemaFields,
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
      countyKey: "duval",
      schemaFields: duvalEnrichmentProfile.queryTable.schemaFields,
      inputParquet,
      inputCoverage,
      companies: [hoaCompany, managerCompany],
      outputParquet: path.join(directory, "output", "query-table.parquet"),
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
    expect(objects.some((object) => object.type === "homeowners_association")).toBe(true);
    expect(objects.some((object) => object.data_group === "Property Management")).toBe(true);
  });
});
