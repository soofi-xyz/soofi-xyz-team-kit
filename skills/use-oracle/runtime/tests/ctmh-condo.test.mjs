import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CTMH_OFFICIAL_FILES,
  allCtmhAssociationRecords,
  ctmhLegalKeys,
  findCtmhAssociations,
  findCtmhManagingEntityCompany,
  joinCtmhToSunbiz,
  loadCtmhExtract,
  parseCtmhCsv,
  probeCtmhAssociations,
} from "../src/enrichment/ctmh-condo.mjs";
import { parseHoaPm16377Args } from "../local-output/hoa-pm-16377/run-hoa-pm-16377.mjs";
import {
  resolveHoaAndPropertyManagement,
  searchHoaAssociation,
  stampPropertyCids,
} from "../src/enrichment/hoa-pm-heuristic.mjs";

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "ctmh");

const indigoSunbiz = {
  documentNumber: "N666666",
  entityName: "INDIGO CONDOMINIUM ASSOCIATION, INC.",
  status: "ACTIVE",
  registeredAgent: {
    name: "CAMPBELL PROPERTY MANAGEMENT LLC",
    type: "C",
  },
};

const managerCompany = {
  documentNumber: "L654321",
  entityName: "CAMPBELL PROPERTY MANAGEMENT LLC",
  status: "ACTIVE",
};

const orbitManager = {
  documentNumber: "L777777",
  entityName: "ORBIT MANAGEMENT LLC",
  status: "ACTIVE",
};

describe("CTMH official fixture loader", () => {
  it("indexes the tiny headered condo/coop/timeshare fixtures", async () => {
    const records = await loadCtmhExtract(FIXTURE_DIR);
    expect(records.condominium).toHaveLength(5);
    expect(records.cooperative).toHaveLength(1);
    expect(records.timeshare).toHaveLength(2);
    expect(CTMH_OFFICIAL_FILES.timeshare.map((file) => file.fileName)).toEqual([
      "tsmailing.csv",
      "multitsmailing.csv",
    ]);
    expect(records.condominium[0].projectNumber).toBe("PRTEST001");
    expect(records.condominium[0].managingEntityName).toContain("INDIGO");
  });

  it("parses official-style quoted headers including Managing Entity Name", async () => {
    const text = await readFile(path.join(FIXTURE_DIR, "condo_PB.csv"), "utf8");
    const rows = parseCtmhCsv(text, { kind: "condominium", sourceFile: "condo.csv" });
    expect(rows[0].managingEntityNumber).toBe("MA1001");
    expect(rows[0].county).toBe("Duval");
  });
});

describe("CTMH unique association match", () => {
  it("matches a unique project name to the extracted subdivision", async () => {
    const { condominium } = await loadCtmhExtract(FIXTURE_DIR);
    const result = findCtmhAssociations("LOT 47 INDIGO UNIT 8 PUD MB 42", condominium, {
      countyKey: "duval",
    });
    expect(result.status).toBe("matched");
    expect(result.matches[0].projectNumber).toBe("PRTEST001");
  });

  it("collapses many buildings that share one managing entity", async () => {
    const { condominium } = await loadCtmhExtract(FIXTURE_DIR);
    const result = findCtmhAssociations("PALM CHASE", condominium, { countyKey: "duval" });
    expect(result.status).toBe("matched");
    expect(result.matches[0].managingEntityNumber).toBe("MA1003");
  });

  it("skips CTMH for FeeSimple/Leasehold and unique-matches missing estate from condo first", async () => {
    const records = await loadCtmhExtract(FIXTURE_DIR);
    for (const estate of ["FeeSimple", "Leasehold"]) {
      const result = searchHoaAssociation("INDIGO CONDO UNIT 8", {
        companies: [indigoSunbiz],
        ctmhRecords: records,
        ownershipEstateType: estate,
        countyKey: "duval",
      });
      expect(result.source).toBe("sunbiz");
      expect(result.ctmhStatus).toBe("no_ctmh_estate");
      expect(result.status).toBe("no_sunbiz_hoa");
    }
    const missingEstate = searchHoaAssociation("INDIGO CONDO UNIT 8", {
      companies: [indigoSunbiz],
      ctmhRecords: records,
      ownershipEstateType: null,
      countyKey: "duval",
    });
    expect(missingEstate.source).toBe("ctmh");
    expect(missingEstate.matches[0].projectNumber).toBe("PRTEST001");
    const missingEstateCoop = searchHoaAssociation("PALM HILL COOPERATIVE", {
      ctmhRecords: records,
      ownershipEstateType: null,
      countyKey: "pinellas",
    });
    expect(missingEstateCoop.status).toBe("matched");
    expect(missingEstateCoop.matches[0].kind).toBe("cooperative");
    const feeSimpleCoop = searchHoaAssociation("PALM HILL COOPERATIVE", {
      ctmhRecords: records,
      ownershipEstateType: "FeeSimple",
      countyKey: "pinellas",
    });
    expect(feeSimpleCoop.source).not.toBe("ctmh");
    expect(feeSimpleCoop.ctmhStatus).toBe("no_ctmh_estate");
  });

  it("indexes official-style Project Name rows from multitsmailing.csv", async () => {
    const { timeshare } = await loadCtmhExtract(FIXTURE_DIR);
    const missingCounty = findCtmhAssociations("CEDAR KEY VACATION CLUB PROGRAM", timeshare, {
      countyKey: "orange",
      missStatus: "no_ctmh_timeshare",
    });
    expect(missingCounty.status).toBe("no_ctmh_timeshare");
    const statewide = findCtmhAssociations("CEDAR KEY VACATION CLUB PROGRAM", timeshare, {
      missStatus: "no_ctmh_timeshare",
    });
    expect(statewide.status).toBe("matched");
    expect(statewide.matches[0].projectNumber).toBe("PRMS001");
    expect(statewide.matches[0].kind).toBe("timeshare");
    expect(
      searchHoaAssociation("CEDAR KEY VACATION CLUB PROGRAM", {
        ctmhRecords: { condominium: [], cooperative: [], timeshare },
        ownershipEstateType: "Timeshare",
      }).matches[0].projectNumber,
    ).toBe("PRMS001");
  });

  it("keeps condo, coop, and timeshare pools unmixed", async () => {
    const records = await loadCtmhExtract(FIXTURE_DIR);
    expect(
      searchHoaAssociation("INDIGO CONDOMINIUM", {
        ctmhRecords: records,
        ownershipEstateType: "Cooperative",
        countyKey: "duval",
      }).status,
    ).toBe("no_sunbiz_hoa");
    expect(
      searchHoaAssociation("PALM HILL COOPERATIVE", {
        ctmhRecords: records,
        ownershipEstateType: "Cooperative",
        countyKey: "pinellas",
      }).matches[0].kind,
    ).toBe("cooperative");
    expect(
      searchHoaAssociation("HOLLYWOOD BEACH TOWER", {
        ctmhRecords: records,
        ownershipEstateType: "Timeshare",
        countyKey: "broward",
      }).matches[0].kind,
    ).toBe("timeshare");
    expect(allCtmhAssociationRecords(records)).toHaveLength(8);
    const duplicate = {
      ...records.condominium[0],
      sourceFile: "condo_conv.csv",
    };
    const withConversion = {
      ...records,
      condominium: [...records.condominium, duplicate],
    };
    expect(allCtmhAssociationRecords(withConversion)).toHaveLength(8);
    expect(
      probeCtmhAssociations("INDIGO CONDO UNIT 8", withConversion, { countyKey: "duval" }).matches,
    ).toHaveLength(1);
  });

  it("scopes unique CTMH matches to the parcel county", async () => {
    const records = await loadCtmhExtract(FIXTURE_DIR);
    const steal = findCtmhAssociations("INDIGO CONDO UNIT 8", records.condominium, {
      countyKey: "orange",
    });
    expect(steal.status).toBe("no_ctmh_condo");
    const local = findCtmhAssociations("INDIGO CONDO UNIT 8", records.condominium, {
      countyKey: "duval",
    });
    expect(local.status).toBe("matched");
    const collision = [
      ...records.condominium,
      {
        kind: "condominium",
        projectNumber: "PRORANGE1",
        name: "INDIGO CONDOMINIUM",
        county: "Orange",
        managingEntityNumber: "MAORANGE1",
        managingEntityName: "INDIGO CONDOMINIUM ASSOCIATION, INC.",
        matchKeys: records.condominium[0].matchKeys,
      },
    ];
    const scoped = findCtmhAssociations("INDIGO CONDO UNIT 8", collision, {
      countyKey: "duval",
    });
    expect(scoped.status).toBe("matched");
    expect(scoped.matches[0].projectNumber).toBe("PRTEST001");
    const twoLocal = findCtmhAssociations("INDIGO CONDO UNIT 8", [
      ...collision,
      {
        kind: "condominium",
        projectNumber: "PRDUVAL2",
        name: "INDIGO CONDOMINIUM",
        county: "Duval",
        managingEntityNumber: "MADUVAL2",
        managingEntityName: "INDIGO EAST CONDOMINIUM ASSOCIATION, INC.",
        matchKeys: records.condominium[0].matchKeys,
      },
    ], { countyKey: "duval" });
    expect(twoLocal.status).toBe("not_unique");
    const noCounty = findCtmhAssociations("INDIGO CONDO UNIT 8", [
      {
        ...records.condominium[0],
        county: null,
      },
    ], { countyKey: "duval" });
    expect(noCounty.status).toBe("no_ctmh_condo");
    const missingCannotBreakTie = findCtmhAssociations("INDIGO CONDO UNIT 8", [
      records.condominium[0],
      {
        ...records.condominium[0],
        projectNumber: "PRUNKNOWN1",
        county: null,
        managingEntityNumber: "MAUNKNOWN1",
        managingEntityName: "INDIGO UNKNOWN COUNTY ASSOCIATION, INC.",
      },
    ], { countyKey: "duval" });
    expect(missingCannotBreakTie.status).toBe("matched");
    expect(missingCannotBreakTie.matches[0].projectNumber).toBe("PRTEST001");
  });

  it("does not fall through to coop when condo is not unique", async () => {
    const records = await loadCtmhExtract(FIXTURE_DIR);
    const collidingCondo = {
      condominium: [
        {
          kind: "condominium",
          projectNumber: "PRPALM1",
          name: "PALM HILL CONDOMINIUM",
          county: "Pinellas",
          managingEntityNumber: "MAC1",
          managingEntityName: "PALM HILL CONDOMINIUM ASSOCIATION",
          matchKeys: new Set(["PALM HILL", "PALM HILL CONDOMINIUM"]),
        },
        {
          kind: "condominium",
          projectNumber: "PRPALM2",
          name: "PALM HILL TOWERS",
          county: "Pinellas",
          managingEntityNumber: "MAC2",
          managingEntityName: "PALM HILL TOWERS CONDOMINIUM ASSOCIATION",
          matchKeys: new Set(["PALM HILL", "PALM HILL TOWERS"]),
        },
      ],
      cooperative: records.cooperative,
      timeshare: [],
    };
    const result = probeCtmhAssociations("PALM HILL", collidingCondo, {
      countyKey: "pinellas",
    });
    expect(result.status).toBe("not_unique");
    expect(result.matches.every((row) => row.kind === "condominium")).toBe(true);
  });
});

describe("CTMH to Sunbiz rematch", () => {
  it("joins a unique ACTIVE Sunbiz association and then the RA company as PM", async () => {
    const records = await loadCtmhExtract(FIXTURE_DIR);
    const resolution = resolveHoaAndPropertyManagement({
      subdivision: "INDIGO CONDO UNIT 8",
      companies: [indigoSunbiz, managerCompany],
      ctmhRecords: records,
      ownershipEstateType: "Condominium",
    });
    expect(resolution.source).toBe("ctmh");
    expect(resolution.sunbizJoinStatus).toBe("matched");
    expect(resolution.status).toBe("matched");
    expect(resolution.hoa.sunbiz_document_number).toBe("N666666");
    expect(resolution.hoa.ctmh_project_number).toBe("PRTEST001");
    expect(resolution.propertyManagement.sunbiz_document_number).toBe("L654321");
    const stamped = stampPropertyCids({ parcel_identifier: "1" }, resolution);
    expect(stamped.homeowners_association_type).toBe("Condominium");
    expect(stamped.hoa_ctmh_project_number).toBe("PRTEST001");
  });

  it("keeps the CTMH HOA when Sunbiz has no unique company", async () => {
    const records = await loadCtmhExtract(FIXTURE_DIR);
    const resolution = resolveHoaAndPropertyManagement({
      subdivision: "EXAMPLE SHORES CONDO",
      companies: [],
      ctmhRecords: records,
    });
    expect(resolution.status).toBe("ctmh_not_in_sunbiz");
    expect(resolution.hoa.ctmh_project_number).toBe("PRTEST002");
    expect(resolution.hoa.sunbiz_document_number).toBeNull();
    expect(resolution.propertyManagement).toBeNull();
    const coopOnly = resolveHoaAndPropertyManagement({
      subdivision: "PALM HILL COOPERATIVE",
      companies: [],
      ctmhRecords: records,
      ownershipEstateType: "Cooperative",
      countyKey: "pinellas",
    });
    expect(coopOnly.status).toBe("ctmh_not_in_sunbiz");
    expect(coopOnly.hoa.homeowners_association_type).toBe("Cooperative");
    expect(coopOnly.hoa.ctmh_project_number).toBe("PRCOOP001");
  });

  it("uses a unique Managing Entity Name as PM when it is not the association", async () => {
    const records = await loadCtmhExtract(FIXTURE_DIR);
    const orbit = records.condominium.find((row) => row.projectNumber === "PRTEST004");
    expect(joinCtmhToSunbiz(orbit, []).status).toBe("ctmh_not_in_sunbiz");
    expect(findCtmhManagingEntityCompany(orbit, [orbitManager]).matches[0].documentNumber).toBe(
      "L777777",
    );
    const resolution = resolveHoaAndPropertyManagement({
      subdivision: "ORBIT TOWERS",
      companies: [orbitManager],
      ctmhRecords: records,
    });
    expect(resolution.hoa.sunbiz_document_number).toBeNull();
    expect(resolution.propertyManagement.sunbiz_document_number).toBe("L777777");
  });

  it("does not invent a Sunbiz document number from a CTMH project number", async () => {
    const records = await loadCtmhExtract(FIXTURE_DIR);
    const resolution = resolveHoaAndPropertyManagement({
      subdivision: "EXAMPLE SHORES CONDO",
      companies: [],
      ctmhRecords: records,
    });
    expect(resolution.hoaCompany.sunbiz_document_number).toBeNull();
    expect(resolution.hoa.sunbiz_document_number).toBeNull();
    expect(resolution.hoa.request_identifier).toMatch(/^ctmh:PRTEST002:/);
  });

  it("builds join keys by dropping THE/INC and CONDO ASSOCIATION suffixes", () => {
    expect([...ctmhLegalKeys("THE PALM CHASE CONDO ASSOC., INC.")]).toEqual(
      expect.arrayContaining(["PALM CHASE", "THE PALM CHASE CONDO ASSOC INC"]),
    );
  });
});

describe("hoa-pm-16377 argv", () => {
  it("does not treat --force or --ctmh as the Sunbiz path", () => {
    const parsed = parseHoaPm16377Args([
      "--force",
      "--ctmh-extract",
      "/tmp/hoa-pm-16377/ctmh",
      "duval",
    ]);
    expect(parsed.force).toBe(true);
    expect(parsed.sunbiz).toBeNull();
    expect(parsed.sunbizPm).toBeNull();
    expect(parsed.ctmh).toBe("/tmp/hoa-pm-16377/ctmh");
    expect([...parsed.only]).toEqual(["duval"]);
  });

  it("parses --sunbiz-pm without stealing the HOA index path", () => {
    const parsed = parseHoaPm16377Args([
      "--sunbiz",
      "/tmp/hoa-pm-16377/sunbiz-hoa-index",
      "--sunbiz-pm",
      "/tmp/hoa-pm-16377/sunbiz-pm-index",
    ]);
    expect(parsed.sunbiz).toBe("/tmp/hoa-pm-16377/sunbiz-hoa-index");
    expect(parsed.sunbizPm).toBe("/tmp/hoa-pm-16377/sunbiz-pm-index");
  });
});
