import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveHoaAndPropertyManagement } from "../src/enrichment/hoa-pm-heuristic.mjs";
import {
  findActiveCompanyBySunbizAlias,
  loadSunbizAliasIndex,
  parseSunbizCorporateEventRecord,
  parseSunbizFictitiousEventRecord,
  parseSunbizFictitiousNameRecord,
} from "../src/enrichment/sunbiz-aliases.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function fixedWidth(length, values) {
  const characters = Array(length).fill(" ");
  for (const [start, fieldLength, value] of values) {
    const text = String(value).slice(0, fieldLength).padEnd(fieldLength);
    characters.splice(start - 1, fieldLength, ...text);
  }
  return characters.join("");
}

function corporateEvent({
  documentNumber = "NOLD00000001",
  corporationName = "OLD MANAGEMENT NAME",
  successorDocumentNumber = "LNEW00000001",
  nameChange = "Y",
} = {}) {
  return fixedWidth(662, [
    [1, 12, documentNumber],
    [18, 20, "MERGER"],
    [38, 40, "MERGER OR NAME CHANGE"],
    [199, 12, successorDocumentNumber],
    [211, 192, corporationName],
    [413, 1, nameChange],
  ]);
}

function fictitiousData({
  documentNumber = "G24000000001",
  fictitiousName = "LEGACY MANAGEMENT",
  status = "A",
  owners = [{ type: "C", name: "NEW MANAGEMENT LLC", charter: "LNEW00000001" }],
  moreThanTenOwners = " ",
} = {}) {
  const values = [
    [1, 12, documentNumber],
    [13, 192, fictitiousName],
    [352, 1, status],
    [369, 5, owners.length],
    [388, 1, moreThanTenOwners],
  ];
  owners.forEach((owner, index) => {
    const start = 389 + index * 171;
    values.push(
      [start + 12, 55, owner.name],
      [start + 67, 1, owner.type],
      [start + 159, 12, owner.charter ?? ""],
    );
  });
  return fixedWidth(2098, values);
}

function fictitiousEvent(originalDocumentNumber = "G24000000001") {
  return fixedWidth(762, [
    [1, 12, "E24000000001"],
    [13, 12, originalDocumentNumber],
    [245, 3, "CHO"],
    [741, 12, "LNEW00000001"],
  ]);
}

async function loadFixtureIndex({
  companies,
  events = [corporateEvent()],
  registrations = [fictitiousData()],
  fictitiousEvents = [fictitiousEvent()],
} = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "sunbiz-aliases-"));
  temporaryDirectories.push(directory);
  const eventDirectory = path.join(directory, "events");
  const fictitiousDirectory = path.join(directory, "fictitious");
  await Promise.all([
    mkdir(eventDirectory, { recursive: true }),
    mkdir(fictitiousDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(eventDirectory, "corevent.txt"), `${events.join("\n")}\n`),
    writeFile(path.join(fictitiousDirectory, "ficdata.txt"), `${registrations.join("\n")}\n`),
    writeFile(path.join(fictitiousDirectory, "ficevt.txt"), `${fictitiousEvents.join("\n")}\n`),
  ]);
  return loadSunbizAliasIndex({
    companies,
    corporateEventsDir: eventDirectory,
    fictitiousNamesDir: fictitiousDirectory,
  });
}

const activeSuccessor = {
  documentNumber: "LNEW00000001",
  entityName: "NEW MANAGEMENT LLC",
  status: "ACTIVE",
};

describe("Sunbiz event and fictitious-name records", () => {
  it("parses only official fixed-width layouts", () => {
    expect(parseSunbizCorporateEventRecord(corporateEvent())).toMatchObject({
      corporationName: "OLD MANAGEMENT NAME",
      conversionMergerDocumentNumber: "LNEW00000001",
      nameChange: true,
    });
    expect(parseSunbizFictitiousNameRecord(fictitiousData())).toMatchObject({
      fictitiousName: "LEGACY MANAGEMENT",
      status: "A",
      owners: [
        {
          ownerType: "C",
          ownerCharterDocumentNumber: "LNEW00000001",
        },
      ],
    });
    expect(parseSunbizFictitiousEventRecord(fictitiousEvent())).toMatchObject({
      originalDocumentNumber: "G24000000001",
      actionCode: "CHO",
    });
    expect(parseSunbizCorporateEventRecord("short")).toBeNull();
    expect(parseSunbizFictitiousNameRecord("short")).toBeNull();
    expect(parseSunbizFictitiousEventRecord("short")).toBeNull();
  });
});

describe("fail-closed Sunbiz aliases", () => {
  it("uses corporate events before fictitious names for one ACTIVE successor", async () => {
    const aliases = await loadFixtureIndex({ companies: [activeSuccessor] });
    const result = findActiveCompanyBySunbizAlias(
      "OLD MANAGEMENT NAME",
      [activeSuccessor],
      aliases,
    );
    expect(result.status).toBe("matched");
    expect(result.method).toBe("sunbiz_event");
    expect(result.matches[0].documentNumber).toBe("LNEW00000001");
    expect(aliases.summary.fictitiousEvents.recordCount).toBe(1);
  });

  it("uses an exact ACTIVE fictitious-name registration with one corporate owner", async () => {
    const aliases = await loadFixtureIndex({
      companies: [activeSuccessor],
      events: [],
    });
    const result = findActiveCompanyBySunbizAlias(
      "Legacy Management",
      [activeSuccessor],
      aliases,
    );
    expect(result.status).toBe("matched");
    expect(result.method).toBe("sunbiz_fictitious_name");
    expect(result.matches[0].documentNumber).toBe("LNEW00000001");
  });

  it("fails closed for collisions, inactive filings, and person owners", async () => {
    const other = {
      documentNumber: "LNEW00000002",
      entityName: "OTHER MANAGEMENT LLC",
      status: "ACTIVE",
    };
    const aliases = await loadFixtureIndex({
      companies: [activeSuccessor, other],
      events: [],
      registrations: [
        fictitiousData(),
        fictitiousData({
          documentNumber: "G24000000002",
          owners: [{ type: "C", name: other.entityName, charter: other.documentNumber }],
        }),
        fictitiousData({
          documentNumber: "G24000000003",
          fictitiousName: "PERSON DBA",
          owners: [{ type: "P", name: "JANE PERSON", charter: activeSuccessor.documentNumber }],
        }),
        fictitiousData({
          documentNumber: "G24000000004",
          fictitiousName: "EXPIRED DBA",
          status: "E",
        }),
      ],
    });
    expect(
      findActiveCompanyBySunbizAlias(
        "LEGACY MANAGEMENT",
        [activeSuccessor, other],
        aliases,
      ).status,
    ).toBe("not_unique");
    expect(
      findActiveCompanyBySunbizAlias("PERSON DBA", [activeSuccessor, other], aliases).status,
    ).toBe("no_match");
    expect(
      findActiveCompanyBySunbizAlias("EXPIRED DBA", [activeSuccessor, other], aliases).status,
    ).toBe("no_match");
    expect(
      findActiveCompanyBySunbizAlias("LEGACY MANAGEMEN", [activeSuccessor, other], aliases)
        .status,
    ).toBe("no_match");
  });

  it("bridges an established CTMH HOA but never creates an HOA from a DBA", async () => {
    const aliases = await loadFixtureIndex({
      companies: [activeSuccessor],
      events: [],
      registrations: [
        fictitiousData({
          fictitiousName: "EXAMPLE SHORES CONDOMINIUM ASSOCIATION",
        }),
      ],
    });
    const ctmhRecords = {
      condominium: [
        {
          kind: "condominium",
          projectNumber: "PRTEST001",
          name: "EXAMPLE SHORES CONDOMINIUM",
          county: "Pinellas",
          managingEntityName: "EXAMPLE SHORES CONDOMINIUM ASSOCIATION",
          matchKeys: new Set(["EXAMPLE SHORES", "EXAMPLE SHORES CONDOMINIUM"]),
        },
      ],
      cooperative: [],
      timeshare: [],
    };
    const ctmhResolution = resolveHoaAndPropertyManagement({
      subdivision: "EXAMPLE SHORES CONDOMINIUM",
      companies: [activeSuccessor],
      ctmhRecords,
      countyKey: "pinellas",
      ownershipEstateType: "Condominium",
      sunbizAliases: aliases,
    });
    expect(ctmhResolution.hoa.sunbiz_document_number).toBe("LNEW00000001");
    expect(ctmhResolution.sunbizJoinMethod).toBe("sunbiz_fictitious_name");

    const dbaOnly = resolveHoaAndPropertyManagement({
      subdivision: "EXAMPLE SHORES",
      companies: [activeSuccessor],
      sunbizAliases: aliases,
    });
    expect(dbaOnly.status).toBe("no_sunbiz_hoa");
    expect(dbaOnly.hoa).toBeNull();
  });

  it("never treats a person registered agent as a PM", async () => {
    const aliases = await loadFixtureIndex({
      companies: [activeSuccessor],
      events: [],
      registrations: [fictitiousData({ fictitiousName: "JANE PERSON" })],
    });
    const hoa = {
      documentNumber: "NHOA00000001",
      entityName: "EXAMPLE HOMEOWNERS ASSOCIATION INC",
      status: "ACTIVE",
      registeredAgent: { name: "JANE PERSON", type: "P" },
    };
    const resolution = resolveHoaAndPropertyManagement({
      subdivision: "EXAMPLE",
      companies: [hoa, activeSuccessor],
      sunbizAliases: aliases,
    });
    expect(resolution.status).toBe("no_agent_company");
    expect(resolution.propertyManagement).toBeNull();
  });
});
