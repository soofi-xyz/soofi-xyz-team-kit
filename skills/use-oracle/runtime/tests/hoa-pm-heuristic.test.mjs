import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { ParquetSchema, ParquetWriter } from "@dsnp/parquetjs";
import { afterEach, describe, expect, it } from "vitest";

import { toParquetRecord, writeQueryTableParquet } from "../src/core/query-table.mjs";
import {
  extractCommunityNameFromSubdivision,
  findHoaCompanies,
  findHoaCompaniesByRecordedName,
  homeownersAssociationType,
  normalizeOwnershipEstateType,
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

  it("prefers the one nonprofit HOA over an ACTIVE LLC developer", () => {
    const result = findHoaCompanies("Oak Grove", [
      {
        ...hoaCompany,
        documentNumber: "N24000000001",
        entityName: "OAK GROVE HOMEOWNERS ASSOCIATION, INC.",
        filingTypeCode: "DOMNP",
        filingType: "Domestic Non-Profit",
      },
      {
        ...hoaCompany,
        documentNumber: "L24000000002",
        entityName: "OAK GROVE",
        filingTypeCode: "FLAL",
        filingType: "Florida Limited Liability Company",
      },
    ]);
    expect(result.status).toBe("matched");
    expect(result.matches[0].documentNumber).toBe("N24000000001");
  });

  it("collapses two event names onto one ACTIVE Sunbiz successor", () => {
    const survivor = {
      ...hoaCompany,
      documentNumber: "N24000000003",
      entityName: "OAK GROVE COMMUNITY ASSOCIATION, INC.",
      filingTypeCode: "DOMNP",
    };
    const priorName = {
      ...hoaCompany,
      documentNumber: "N24000000002",
      entityName: "OAK GROVE HOMEOWNERS ASSOCIATION, INC.",
      filingTypeCode: "DOMNP",
    };
    const result = findHoaCompanies("Oak Grove", [priorName, survivor], {
      sunbizAliases: {
        corporateEvents: new Map([
          [
            "OAK GROVE HOMEOWNERS ASSOCIATION INC",
            new Set([survivor.documentNumber]),
          ],
        ]),
      },
    });
    expect(result.status).toBe("matched");
    expect(result.matches[0].documentNumber).toBe(survivor.documentNumber);
  });

  it("uses parcel city only when it uniquely separates two HOAs", () => {
    const fortMyers = {
      ...hoaCompany,
      documentNumber: "N24000000004",
      entityName: "OAK GROVE HOMEOWNERS ASSOCIATION, INC.",
      filingTypeCode: "DOMNP",
      principalAddress: { city: "Fort Myers" },
    };
    const naples = {
      ...hoaCompany,
      documentNumber: "N24000000005",
      entityName: "OAK GROVE COMMUNITY ASSOCIATION, INC.",
      filingTypeCode: "DOMNP",
      mailingAddress: { city: "Naples" },
    };
    const matched = findHoaCompanies("Oak Grove", [fortMyers, naples], {
      parcelCity: "Fort Myers",
      parcelCounty: "Lee",
    });
    expect(matched.status).toBe("matched");
    expect(matched.matches[0].documentNumber).toBe(fortMyers.documentNumber);
    expect(
      findHoaCompanies("Oak Grove", [fortMyers, naples], {
        parcelCounty: "Lee",
      }).status,
    ).toBe("not_unique");
  });

  it("uses one existing official document number and rejects people or lawyers", () => {
    const first = {
      ...hoaCompany,
      documentNumber: "N24000000006",
      entityName: "OAK GROVE HOMEOWNERS ASSOCIATION, INC.",
      filingTypeCode: "DOMNP",
    };
    const second = {
      ...hoaCompany,
      documentNumber: "N24000000007",
      entityName: "OAK GROVE COMMUNITY ASSOCIATION, INC.",
      filingTypeCode: "DOMNP",
    };
    const documented = findHoaCompanies("Oak Grove", [first, second], {
      officialDocumentNumbers: [second.documentNumber],
    });
    expect(documented.status).toBe("matched");
    expect(documented.matches[0].documentNumber).toBe(second.documentNumber);
    expect(
      findHoaCompanies("Oak Grove", [
        {
          ...hoaCompany,
          documentNumber: "A24000000001",
          entityName: "OAK GROVE",
          filingTypeCode: "AGENT",
          entityKind: "PERSON",
        },
        {
          ...hoaCompany,
          documentNumber: "L24000000008",
          entityName: "OAK GROVE LAW OFFICES, P.A.",
        },
      ]).status,
    ).toBe("no_sunbiz_hoa");
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

  it("uses one exact clerk-recorded name only after appraisal misses", () => {
    const evidence = {
      recordedName: "Example Subdivision",
      normalizedName: "EXAMPLE SUBDIVISION",
      sourceProfileId: "duval-official-records-pilot-v1",
      sourceUrl: "https://or.duvalclerk.com/",
      instruments: [
        {
          instrumentType: "plat",
          instrumentNumber: "2026123456",
          evidenceReference: "duval-or:2026123456",
        },
      ],
    };
    const exact = findHoaCompaniesByRecordedName(
      evidence.recordedName,
      [hoaCompany],
    );
    expect(exact.status).toBe("matched");
    expect(
      findHoaCompaniesByRecordedName("Example Subdivisio", [hoaCompany])
        .status,
    ).toBe("clerk_recorded_name_not_in_sunbiz");

    const resolution = resolveHoaAndPropertyManagement({
      subdivision: null,
      companies: [hoaCompany, managerCompany],
      recordedCommunityEvidence: evidence,
      recordedCommunityEvidenceStatus: "matched",
    });
    expect(resolution.source).toBe("clerk_official_records");
    expect(resolution.hoa.sunbiz_document_number).toBe("N123456");
    expect(resolution.hoa.hoa_discovery_source).toBe(
      "clerk_official_records",
    );
  });

  it("fails closed on ambiguous clerk names or Sunbiz companies", () => {
    const ambiguousEvidence = resolveHoaAndPropertyManagement({
      subdivision: null,
      companies: [hoaCompany],
      recordedCommunityEvidenceStatus: "not_unique",
    });
    expect(ambiguousEvidence.status).toBe(
      "clerk_recorded_name_not_unique",
    );
    expect(ambiguousEvidence.hoa).toBeNull();

    const duplicate = findHoaCompaniesByRecordedName(
      "Example Subdivision",
      [
        hoaCompany,
        {
          ...hoaCompany,
          documentNumber: "N999999",
          entityName:
            "EXAMPLE SUBDIVISION COMMUNITY ASSOCIATION INC",
        },
      ],
    );
    expect(duplicate.status).toBe("clerk_sunbiz_not_unique");
  });

  it("fails closed when parsed legal text and clerk evidence disagree", () => {
    const legalHoa = {
      ...hoaCompany,
      documentNumber: "N888888",
      entityName: "HIBERNIA FOREST HOMEOWNERS ASSOCIATION, INC.",
    };
    const result = resolveHoaAndPropertyManagement({
      subdivision: "LOT 25 HIBERNIA FOREST UNIT 2",
      companies: [legalHoa, hoaCompany],
      recordedCommunityEvidenceStatus: "matched",
      recordedCommunityEvidence: {
        recordedName: "Example Subdivision",
        normalizedName: "EXAMPLE SUBDIVISION",
        sourceProfileId: "duval-official-records-pilot-v1",
        sourceUrl: "https://or.duvalclerk.com/",
        instruments: [],
      },
    });
    expect(result.status).toBe("clerk_appraisal_conflicting");
    expect(result.hoa).toBeNull();
  });

  it.each([
    ["LOT 25 HIBERNIA FOREST UNIT 2", "HIBERNIA FOREST"],
    ["LOT 15 BLK 5 MAGNOLIA TERRACE", "MAGNOLIA TERRACE"],
    ["WEKIVA 8/38 LOT 57", "WEKIVA"],
    ["22/1-5 CYPRESS LAKES PHASE 1", "CYPRESS LAKES"],
    ["5-29 VERMONT HEIGHTS LOT 4", "VERMONT HEIGHTS"],
    ["LOT 82 SANDS POINTE S/D PB 3 P", "SANDS POINTE"],
    ["ARBOR GREENS PHASE 1 UNIT 1 PB 25", "ARBOR GREENS"],
    ["LOT 8 BLK 8 LABEUNA ESTATES", "LABEUNA ESTATES"],
    ["000017 ACRES LOT 41 TIMBERLANE", "TIMBERLANE"],
    ["000017 AC LOT 8 LEANING OAKS", "LEANING OAKS"],
    ["00005 ORANGE BLOSSOM PARK", "ORANGE BLOSSOM PARK"],
    ["LAKE PLEASANT COVE 68/143 LOT", "LAKE PLEASANT COVE"],
    ["ERROL ESTATE UNIT 7 8/133 LOT", "ERROL ESTATE"],
  ])("extracts a community name from legal subdivision text: %s", (subdivision, expected) => {
    expect(extractCommunityNameFromSubdivision(subdivision)).toBe(expected);
  });

  it("does not extract a community name from section-township-range or metes text", () => {
    expect(extractCommunityNameFromSubdivision("SEC 28 TWP 17 RGE 23")).toBeNull();
    expect(extractCommunityNameFromSubdivision("COM NE COR RUN W 1980 FT S 150")).toBeNull();
    expect(extractCommunityNameFromSubdivision("000020 ACRES LOT D BEING PART")).toBeNull();
  });

  it("matches an HOA from a lot-block legal description", () => {
    const result = findHoaCompanies("LOT 25 HIBERNIA FOREST UNIT 2", [
      {
        ...hoaCompany,
        documentNumber: "N888888",
        entityName: "HIBERNIA FOREST HOMEOWNERS ASSOCIATION, INC.",
      },
    ]);
    expect(result.status).toBe("matched");
    expect(result.matches[0].documentNumber).toBe("N888888");
  });

  it.each([
    ["LAKE PLEASANT COVE 68/143 LOT", "LAKE PLEASANT COVE"],
    ["ERROL ESTATE UNIT 7 8/133 LOT", "ERROL ESTATE"],
  ])("matches only the unique ACTIVE HOA for Orange plat text: %s", (subdivision, community) => {
    const result = findHoaCompanies(subdivision, [
      {
        ...hoaCompany,
        documentNumber: "N800001",
        entityName: `${community} HOMEOWNERS ASSOCIATION, INC.`,
      },
      {
        ...hoaCompany,
        documentNumber: "N800002",
        entityName: `${community} PROPERTY OWNERS ASSOCIATION, INC.`,
        status: "INACTIVE",
      },
    ]);
    expect(result.status).toBe("matched");
    expect(result.matches[0].documentNumber).toBe("N800001");
  });

  it("matches a unique single-token plat extracted from book/page/lot text", () => {
    const result = findHoaCompanies("WEKIVA 8/38 LOT 57", [
      {
        ...hoaCompany,
        documentNumber: "N777777",
        entityName: "WEKIVA HOMEOWNERS ASSOCIATION, INC.",
      },
    ]);
    expect(result.status).toBe("matched");
    expect(result.matches[0].documentNumber).toBe("N777777");
  });

  it("does not match a unique condo association from non-condo plat text", () => {
    const result = findHoaCompanies("LOT 47 INDIGO UNIT 8 PUD MB 42", [
      {
        ...hoaCompany,
        documentNumber: "N666666",
        entityName: "INDIGO CONDOMINIUM ASSOCIATION, INC.",
      },
    ]);
    expect(result.status).toBe("no_sunbiz_hoa");
  });

  it("matches a unique condo association when the legal text says condo", () => {
    const result = findHoaCompanies("INDIGO CONDO UNIT 8", [
      {
        ...hoaCompany,
        documentNumber: "N666666",
        entityName: "INDIGO CONDOMINIUM ASSOCIATION, INC.",
      },
    ]);
    expect(result.status).toBe("matched");
    expect(result.matches[0].documentNumber).toBe("N666666");
  });

  it("gates Sunbiz candidates with ownership_estate_type before name matching", () => {
    expect(normalizeOwnershipEstateType("fee simple")).toBe("FeeSimple");
    expect(normalizeOwnershipEstateType("condo")).toBe("Condominium");
    expect(normalizeOwnershipEstateType("SubsurfaceRights")).toBeNull();
    const condo = {
      ...hoaCompany,
      documentNumber: "N666666",
      entityName: "INDIGO CONDOMINIUM ASSOCIATION, INC.",
    };
    const hoa = {
      ...hoaCompany,
      documentNumber: "N777777",
      entityName: "INDIGO HOMEOWNERS ASSOCIATION, INC.",
    };
    expect(
      findHoaCompanies("LOT 47 INDIGO UNIT 8 PUD MB 42", [condo], {
        ownershipEstateType: "Condominium",
      }).status,
    ).toBe("matched");
    expect(
      findHoaCompanies("Example Subdivision", [hoaCompany], {
        ownershipEstateType: "Condominium",
      }).status,
    ).toBe("no_sunbiz_hoa");
    for (const estate of ["FeeSimple", "Leasehold"]) {
      expect(
        findHoaCompanies("LOT 47 INDIGO UNIT 8 PUD MB 42", [condo], {
          ownershipEstateType: estate,
        }).status,
      ).toBe("no_sunbiz_hoa");
      expect(
        findHoaCompanies("Example Subdivision", [hoaCompany], {
          ownershipEstateType: estate,
        }).status,
      ).toBe("matched");
    }
    expect(
      resolveHoaAndPropertyManagement({
        subdivision: "LOT 47 INDIGO UNIT 8 PUD MB 42",
        companies: [condo],
        ownershipEstateType: "Condominium",
      }).source,
    ).toBe("sunbiz");
    expect(
      findHoaCompanies("LOT 47 INDIGO UNIT 8 PUD MB 42", [condo]).status,
    ).toBe("no_sunbiz_hoa");
    expect(
      findHoaCompanies("INDIGO CONDO UNIT 8", [condo]).status,
    ).toBe("matched");
    expect(homeownersAssociationType(condo, "Condominium")).toBe("Condominium");
    expect(homeownersAssociationType(hoa, "FeeSimple")).toBe("Homeowners");
    expect(homeownersAssociationType(hoa, "Cooperative")).toBe("Cooperative");
    expect(homeownersAssociationType(hoa, "Timeshare")).toBe("Timeshare");
    expect(homeownersAssociationType(hoa, null)).toBe("Homeowners");
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

  it("looks up the registered-agent company in the full ACTIVE Sunbiz pool", () => {
    const onlyHoaIndex = [hoaCompany];
    const fullActive = [hoaCompany, managerCompany];
    expect(findPropertyManagementCompany(hoaCompany, onlyHoaIndex).status).toBe(
      "agent_not_in_sunbiz",
    );
    const resolution = resolveHoaAndPropertyManagement({
      subdivision: "Example Subdivision",
      companies: onlyHoaIndex,
      pmCompanies: fullActive,
    });
    expect(resolution.status).toBe("matched");
    expect(resolution.propertyManagement.sunbiz_document_number).toBe("L654321");
    const personAgent = resolveHoaAndPropertyManagement({
      subdivision: "Example Subdivision",
      companies: [{ ...hoaCompany, registeredAgent: { name: "JANE DOE", type: "P" } }],
      pmCompanies: fullActive,
    });
    expect(personAgent.status).toBe("no_agent_company");
    expect(personAgent.propertyManagement).toBeNull();
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

  it("preserves filled HOA and PM stamps when a rematch misses", () => {
    const prior = {
      parcel_identifier: "1605480000",
      hoa_cid: "bafy-prior-hoa",
      hoa_name: "PRIOR HOMEOWNERS ASSOCIATION, INC.",
      homeowners_association_type: "Homeowners",
      hoa_sunbiz_document_number: "N000001",
      hoa_ctmh_project_number: "PRIOR001",
      property_manager_cid: "bafy-prior-pm",
      property_manager_name: "PRIOR PROPERTY MANAGEMENT LLC",
      property_manager_sunbiz_document_number: "L000001",
    };
    const resolution = resolveHoaAndPropertyManagement({
      subdivision: "LOT 82 UNKNOWN SUBDIVISION PB 3 P",
      companies: [hoaCompany, managerCompany],
    });
    expect(resolution.status).toBe("no_sunbiz_hoa");

    const stamped = stampPropertyCids(prior, resolution);
    expect(stamped).toMatchObject(prior);
    expect(stamped.hoa_pm_status).toBe(
      "no_sunbiz_hoa_prior_hoa_pm_preserved",
    );
  });

  it("keeps null stamps on a miss when no prior stamp exists", () => {
    const resolution = resolveHoaAndPropertyManagement({
      subdivision: "LOT 82 UNKNOWN SUBDIVISION PB 3 P",
      companies: [hoaCompany, managerCompany],
    });
    const stamped = stampPropertyCids({ parcel_identifier: "1605480000" }, resolution);
    expect(stamped.hoa_cid).toBeNull();
    expect(stamped.hoa_name).toBeNull();
    expect(stamped.hoa_sunbiz_document_number).toBeNull();
    expect(stamped.property_manager_cid).toBeNull();
    expect(stamped.hoa_pm_status).toBe("no_sunbiz_hoa");
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

    const stamped = stampPropertyCids(
      {
        parcel_identifier: "1605480000",
        hoa_cid: "bafy-old-hoa",
        hoa_name: "OLD ASSOCIATION",
        hoa_sunbiz_document_number: "N000001",
        property_manager_cid: "bafy-old-pm",
        property_manager_name: "OLD MANAGER",
        property_manager_sunbiz_document_number: "L000001",
      },
      resolution,
    );
    expect(stamped.hoa_cid).toBe(resolution.hoa.cid);
    expect(stamped.hoa_name).toBe(resolution.hoa.homeowners_association_name);
    expect(stamped.homeowners_association_type).toBe("Homeowners");
    expect(stamped.property_manager_cid).toBe(resolution.propertyManagement.cid);
    expect(stamped.property_manager_name).toBe(resolution.propertyManagement.name);
    expect(stamped.hoa_sunbiz_document_number).toBe("N123456");
    expect(stamped.property_manager_sunbiz_document_number).toBe("L654321");
    expect(stamped.hoa_pm_status).toBe("matched");
  });
});

describe("hoa-pm query-table enrich", () => {
  it("applies a clerk-recorded name to an exact parcel fallback", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "hoa-pm-clerk-"));
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
          parcel_identifier: "164634-0000",
          subdivision: null,
        },
      ],
    });
    await writeFile(
      inputCoverage,
      `${JSON.stringify({ county: "duval", datasets: [] })}\n`,
    );
    const clerkRecord = {
      recordedName: "Example Subdivision",
      normalizedName: "EXAMPLE SUBDIVISION",
      sourceProfileId: "duval-official-records-pilot-v1",
      sourceUrl: "https://or.duvalclerk.com/",
      instruments: [
        {
          instrumentType: "plat",
          instrumentNumber: "2026123456",
          evidenceReference: "duval-or:2026123456",
        },
      ],
    };
    const summary = await enrichQueryTableWithHoaPm({
      countyKey: "duval",
      inputParquet,
      inputCoverage,
      companies: [hoaCompany, managerCompany],
      clerkOfficialRecords: {
        byParcel: new Map([
          [
            "164634-0000",
            [
              {
                parcelIdentifier: "164634-0000",
                ...clerkRecord,
                instrumentType: "plat",
                nameKind: "plat_name",
                instrumentNumber: "2026123456",
                evidenceReference: "duval-or:2026123456",
              },
            ],
          ],
        ]),
        summary: {
          sourceProfileId: "duval-official-records-pilot-v1",
          extractId: "duval-bounded-pilot-1",
          recordCount: 1,
          parcelCount: 1,
        },
      },
      outputParquet,
      outputCoverage: path.join(directory, "output", "dataset-coverage.json"),
      manifestPath: path.join(directory, "output", "manifest.json"),
    });
    expect(summary.clerkOfficialRecords).toMatchObject({
      recordCount: 1,
      parcelCount: 1,
    });
    const reader = await ParquetReader.openFile(outputParquet);
    try {
      expect(await reader.getCursor().next()).toMatchObject({
        hoa_name: hoaCompany.entityName,
        hoa_sunbiz_document_number: "N123456",
        hoa_pm_status: "matched",
      });
    } finally {
      await reader.close();
    }
  });

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
      expect(Object.keys(reader.schema.fields)).toEqual(
        expect.arrayContaining([
          "homeowners_association_amount",
          "homeowners_association_fee_frequency",
          "homeowners_association_year",
        ]),
      );
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
      expect(rows[0].homeowners_association_type).toBe("Homeowners");
      expect(rows[1].homeowners_association_type).toBeNull();
    } finally {
      await reader.close();
    }
  });

  it("skips CTMH for FeeSimple and still caches separately per estate", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "hoa-pm-estate-"));
    temporaryDirectories.push(directory);
    const inputParquet = path.join(directory, "input.parquet");
    const inputCoverage = path.join(directory, "input-coverage.json");
    const outputParquet = path.join(directory, "output", "query-table.parquet");
    const condo = {
      ...hoaCompany,
      documentNumber: "N666666",
      entityName: "EXAMPLE SUBDIVISION CONDOMINIUM ASSOCIATION INC",
    };
    const ctmhRecords = {
      condominium: [
        {
          kind: "condominium",
          projectNumber: "PRCACHE1",
          fileNumber: "1",
          name: "EXAMPLE SUBDIVISION CONDOMINIUM",
          county: "Pinellas",
          managingEntityNumber: "MA1",
          managingEntityName: "EXAMPLE SUBDIVISION CONDOMINIUM ASSOCIATION INC",
          matchKeys: new Set(["EXAMPLE SUBDIVISION", "EXAMPLE SUBDIVISION CONDOMINIUM"]),
        },
      ],
      cooperative: [],
      timeshare: [],
    };
    await writeQueryTableParquet({
      parquetPath: inputParquet,
      schemaFields: {
        ...portableInputSchema,
        ownership_estate_type: { type: "UTF8", optional: true },
      },
      rows: [
        {
          property_id: "property-condo",
          parcel_identifier: "1",
          subdivision: "Example Subdivision",
          ownership_estate_type: "Condominium",
        },
        {
          property_id: "property-fee",
          parcel_identifier: "2",
          subdivision: "Example Subdivision",
          ownership_estate_type: "FeeSimple",
        },
      ],
    });
    await writeFile(
      inputCoverage,
      `${JSON.stringify({ county: "pinellas", datasets: [] })}\n`,
    );

    await enrichQueryTableWithHoaPm({
      countyKey: "pinellas",
      inputParquet,
      inputCoverage,
      companies: [condo, hoaCompany, managerCompany],
      ctmhRecords,
      outputParquet,
      outputCoverage: path.join(directory, "output", "dataset-coverage.json"),
      manifestPath: path.join(directory, "output", "manifest.json"),
    });

    const reader = await ParquetReader.openFile(outputParquet);
    try {
      const cursor = reader.getCursor();
      const rows = [];
      let row = await cursor.next();
      while (row) {
        rows.push(row);
        row = await cursor.next();
      }
      expect(rows.map((row) => row.homeowners_association_type)).toEqual([
        "Condominium",
        "Homeowners",
      ]);
      expect(rows.map((row) => row.hoa_sunbiz_document_number)).toEqual([
        "N666666",
        "N123456",
      ]);
      expect(rows.map((row) => row.hoa_ctmh_project_number)).toEqual([
        "PRCACHE1",
        null,
      ]);
    } finally {
      await reader.close();
    }
  });
});
