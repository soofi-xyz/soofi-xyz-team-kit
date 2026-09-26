import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

import { parseCsvRecords } from "../src/core/csv.mjs";
import {
  SEED_COLUMNS,
  NAL_SOURCE_FIELDS,
  EXCLUDED_PII_FIELDS,
  PIN_BBOX,
  toText,
  isValidDorParcelId,
  toUndashedTenDigit,
  toCanonicalReDisplay,
  toCojDetailUrl,
  assertSafeSourceFields,
  toSeedRow,
  mergeDuplicateParcels,
  classifyDorUseBand,
  hasInRangePinGeometry,
  assertSeedReconciliation,
  buildSeed,
} from "../src/counties/duval/seed.mjs";

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "duval-replay");

const BASE_NAL = Object.freeze({
  PARCEL_ID: "0969250000R",
  CO_NO: "16",
  ASMNT_YR: "2025",
  DOR_UC: "01",
  PA_UC: "0100",
  JV: "210000",
  AV_NSD: "195000",
  TV_NSD: "170000",
  LND_VAL: "60000",
  LND_SQFOOT: "7200",
  ACT_YR_BLT: "1998",
  EFF_YR_BLT: "1998",
  TOT_LVG_AREA: "1800",
  NO_BULDNG: "1",
  NO_RES_UNTS: "1",
  NO_OWN_NM: "1",
  PHY_ADDR1: "4200 RIVERSIDE AVE",
  PHY_ADDR2: "",
  PHY_CITY: "JACKSONVILLE",
  PHY_ZIPCD: "32205",
  NBRHD_CD: "081",
  MKT_AR: "07",
  CENSUS_BK: "12031001100",
  SALE_PRC1: "285000",
  SALE_YR1: "2021",
  SALE_MO1: "6",
  QUAL_CD1: "Q",
});

const BASE_PIN = Object.freeze({
  latitude: 30.31,
  longitude: -81.72,
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-81.721, 30.309],
        [-81.719, 30.309],
        [-81.719, 30.311],
        [-81.721, 30.311],
        [-81.721, 30.309],
      ],
    ],
  },
});

describe("Duval parcel-id normalization", () => {
  it("accepts only canonical 10-digit + R DOR parcel ids", () => {
    expect(isValidDorParcelId("0969250000R")).toBe(true);
    expect(isValidDorParcelId("0969250000")).toBe(false);
    expect(isValidDorParcelId("096925-0000R")).toBe(false);
    expect(isValidDorParcelId("")).toBe(false);
  });

  it("strips the trailing R for the seed parcel_id", () => {
    expect(toUndashedTenDigit("0969250000R")).toBe("0969250000");
    expect(() => toUndashedTenDigit("bogus")).toThrow(/canonical DOR parcel id/);
  });

  it("builds the dashed RE # display form", () => {
    expect(toCanonicalReDisplay("0969250000R")).toBe("096925-0000");
  });

  it("builds the COJ detail URL with the RE query param", () => {
    expect(toCojDetailUrl("0969250000R")).toBe(
      "https://paopropertysearch.coj.net/Basic/Detail.aspx?RE=0969250000R",
    );
  });

  it("coerces nullish/whitespace scalars to empty text", () => {
    expect(toText(null)).toBe("");
    expect(toText(undefined)).toBe("");
    expect(toText("  hi  ")).toBe("hi");
    expect(toText(42)).toBe("42");
  });
});

describe("assertSafeSourceFields (PII guard)", () => {
  it("passes the real NAL_SOURCE_FIELDS list", () => {
    expect(() => assertSafeSourceFields(NAL_SOURCE_FIELDS)).not.toThrow();
  });

  it("fails closed on any excluded PII column", () => {
    for (const field of EXCLUDED_PII_FIELDS) {
      expect(() => assertSafeSourceFields([field])).toThrow(/PII field is prohibited/);
    }
  });

  it("fails closed on a duplicate field", () => {
    expect(() => assertSafeSourceFields(["JV", "JV"])).toThrow(/Duplicate source field/);
  });
});

describe("toSeedRow", () => {
  it("builds a seed row from a joined NAL/PIN record, matching the fixture seed row", async () => {
    const row = toSeedRow({
      nal: BASE_NAL,
      pin: BASE_PIN,
      sdfSaleCount: 1,
      sourceRevision: "fixture-2026-01-01",
      snapshotAt: "2026-01-01T00:00:00.000Z",
      sourceObjectIds: "1",
    });

    expect(row.parcel_id).toBe("0969250000");
    expect(row.source_identifier).toBe("0969250000R");
    expect(row.url).toBe("https://paopropertysearch.coj.net/Basic/Detail.aspx");
    expect(row.url).not.toContain("?");
    expect(JSON.parse(row.multiValueQueryString)).toEqual({ RE: ["0969250000R"] });
    expect(row.address).toBe("4200 RIVERSIDE AVE, JACKSONVILLE FL 32205");
    expect(row.county).toBe("Duval");
    expect(row.county_fips).toBe("12031");
    expect(row.latitude).toBe("30.31");
    expect(row.longitude).toBe("-81.72");
    expect(JSON.parse(row.parcel_polygon)).toEqual(BASE_PIN.geometry);
    expect(row.source_JV).toBe("210000");
    expect(SEED_COLUMNS).toContain("parcel_id");
    for (const field of EXCLUDED_PII_FIELDS) {
      expect(SEED_COLUMNS.some((column) => column.toLowerCase().includes(field.toLowerCase()))).toBe(false);
    }

    const fixtureSeedRows = parseCsvRecords(await readFile(path.join(FIXTURE_DIR, "seed.csv"), "utf8"));
    expect(fixtureSeedRows).toHaveLength(1);
    for (const column of SEED_COLUMNS) {
      expect(row[column]).toBe(fixtureSeedRows[0][column]);
    }
  });
});

describe("mergeDuplicateParcels", () => {
  it("keeps one row per unique PARCEL_ID untouched when there are no duplicates", () => {
    const rows = mergeDuplicateParcels([{ nal: BASE_NAL, pin: BASE_PIN, sdfSaleCount: 1 }], {
      sourceRevision: "rev",
      snapshotAt: "2026-01-01T00:00:00.000Z",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].source_record_count).toBe("1");
    expect(rows[0].source_features_json).toBe("");
  });

  it("folds a multi-PIN parcel into one row: highest-JV NAL wins, geometries merge", () => {
    const lowerJv = { ...BASE_NAL, JV: "150000" };
    const secondPin = {
      latitude: 30.312,
      longitude: -81.718,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-81.7185, 30.3115],
            [-81.7175, 30.3115],
            [-81.7175, 30.3125],
            [-81.7185, 30.3125],
            [-81.7185, 30.3115],
          ],
        ],
      },
    };
    const rows = mergeDuplicateParcels(
      [
        { nal: BASE_NAL, pin: BASE_PIN, sdfSaleCount: 1 },
        { nal: lowerJv, pin: secondPin, sdfSaleCount: 0 },
      ],
      { sourceRevision: "rev", snapshotAt: "2026-01-01T00:00:00.000Z" },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].source_JV).toBe("210000");
    expect(rows[0].source_record_count).toBe("2");
    const geometry = JSON.parse(rows[0].parcel_polygon);
    expect(geometry.type).toBe("MultiPolygon");
    expect(geometry.coordinates).toHaveLength(2);
    expect(JSON.parse(rows[0].source_features_json)).toHaveLength(2);
  });
});

describe("classifyDorUseBand", () => {
  it("classifies published DOR_UC bands", () => {
    expect(classifyDorUseBand("00")).toBe("vacant_residential");
    expect(classifyDorUseBand("01")).toBe("single_family");
    expect(classifyDorUseBand("04")).toBe("condo");
    expect(classifyDorUseBand("11")).toBe("commercial");
    expect(classifyDorUseBand("41")).toBe("industrial");
    expect(classifyDorUseBand("bogus")).toBe("other");
  });
});

describe("hasInRangePinGeometry", () => {
  it("accepts a centroid inside the published PIN bbox and rejects outside/missing", () => {
    expect(hasInRangePinGeometry({ latitude: "30.31", longitude: "-81.72" })).toBe(true);
    expect(hasInRangePinGeometry({ latitude: String(PIN_BBOX.maxLat + 1), longitude: "-81.72" })).toBe(false);
    expect(hasInRangePinGeometry({ latitude: "", longitude: "" })).toBe(false);
  });
});

describe("assertSeedReconciliation", () => {
  it("passes when every counter reconciles", () => {
    expect(() =>
      assertSeedReconciliation({
        rowsWritten: 2,
        uniqueParcelIds: 2,
        expectedSeedRowCount: 2,
        unkeyedSourceRecords: 0,
        invalidRecordCount: 0,
        consolidatedRows: 0,
        duplicateGroups: 0,
      }),
    ).not.toThrow();
  });

  it("fails closed on any mismatched counter", () => {
    const good = {
      rowsWritten: 2,
      uniqueParcelIds: 2,
      expectedSeedRowCount: 2,
      unkeyedSourceRecords: 0,
      invalidRecordCount: 0,
      consolidatedRows: 0,
      duplicateGroups: 0,
    };
    expect(() => assertSeedReconciliation({ ...good, rowsWritten: 3 })).toThrow(/rowsWritten/);
    expect(() => assertSeedReconciliation({ ...good, uniqueParcelIds: 1 })).toThrow(/uniqueParcelIds/);
    expect(() => assertSeedReconciliation({ ...good, unkeyedSourceRecords: 1 })).toThrow(/unkeyedSourceRecords/);
    expect(() => assertSeedReconciliation({ ...good, consolidatedRows: 1 })).toThrow(/consolidatedRows/);
  });
});

describe("buildSeed(options)", () => {
  it("renders a CSV file matching the fixture seed row from already-joined records", async () => {
    const { rows, csv } = await buildSeed({
      records: [{ nal: BASE_NAL, pin: BASE_PIN, sdfSaleCount: 1 }],
      sourceRevision: "fixture-2026-01-01",
      snapshotAt: "2026-01-01T00:00:00.000Z",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].parcel_id).toBe("0969250000");
    const parsedBack = parseCsvRecords(csv);
    expect(parsedBack).toHaveLength(1);
    expect(parsedBack[0].parcel_id).toBe("0969250000");
  });

  it("never requests duckdb or unzip and never touches the network", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("buildSeed must never call fetch()");
    };
    try {
      await expect(
        buildSeed({
          records: [{ nal: BASE_NAL, pin: BASE_PIN, sdfSaleCount: 1 }],
          sourceRevision: "rev",
          snapshotAt: "2026-01-01T00:00:00.000Z",
        }),
      ).resolves.toBeTruthy();
    } finally {
      globalThis.fetch = originalFetch;
    }
    await expect(import("duckdb")).rejects.toThrow();
  });
});
