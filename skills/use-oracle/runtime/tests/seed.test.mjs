import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

import { parseCsvRecords, renderSeedCsv, encodeCsvCell, renderCsv } from "../src/core/csv.mjs";
import {
  SEED_COLUMNS,
  isValidStrap,
  buildPrintUrl,
  classifyGeometry,
  toSeedRow,
  dedupeByStrap,
  buildSeed,
} from "../src/counties/pinellas/seed.mjs";

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "pinellas-replay");

describe("core csv helpers", () => {
  it("round-trips quoted JSON and address text through the CSV parser", () => {
    const row = {
      parcel_id: "162805389030000430",
      situs_address: "3400 RUGBY CT, PALM HARBOR FL 34684",
      multiValueQueryString: `{"is_print":["1"],"s":["162805389030000430"]}`,
    };
    const parsed = parseCsvRecords(renderSeedCsv(row));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].parcel_id).toBe(row.parcel_id);
    expect(parsed[0].situs_address).toBe(row.situs_address);
    expect(JSON.parse(parsed[0].multiValueQueryString)).toEqual({
      is_print: ["1"],
      s: ["162805389030000430"],
    });
  });

  it("quotes commas and escapes quotes in CSV cells", () => {
    expect(encodeCsvCell("3400 RUGBY CT, PALM HARBOR FL 34684")).toBe('"3400 RUGBY CT, PALM HARBOR FL 34684"');
    expect(encodeCsvCell('a"b')).toBe('"a""b"');
    expect(encodeCsvCell("plain")).toBe("plain");
  });

  it("renders many rows with one stable header", () => {
    const csv = renderCsv(["a", "b"], [{ a: "1", b: "x,y" }, { a: "2", b: "z" }]);
    const parsed = parseCsvRecords(csv);
    expect(parsed).toEqual([{ a: "1", b: "x,y" }, { a: "2", b: "z" }]);
  });
});

describe("Pinellas seed builder", () => {
  it("accepts only 18-digit STRAP values", () => {
    expect(isValidStrap("162805389030000430")).toBe(true);
    expect(isValidStrap("16280538903000043")).toBe(false);
    expect(isValidStrap("1628053890300004300")).toBe(false);
    expect(isValidStrap("16-28-05-38903-000-0430")).toBe(false);
    expect(isValidStrap("")).toBe(false);
  });

  it("builds a print URL with the is_print and s query params", () => {
    const url = buildPrintUrl("162805389030000430");
    expect(url).toBe("https://www.pcpao.gov/property/detail/print?is_print=1&s=162805389030000430");
  });

  it("classifies simple, complex, and multi-ring geometries", () => {
    expect(
      classifyGeometry({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }).geometryType,
    ).toBe("simple-polygon");
    const longRing = Array.from({ length: 25 }, (_, index) => [index, 0]);
    expect(classifyGeometry({ type: "Polygon", coordinates: [longRing] }).geometryType).toBe("complex-polygon");
    expect(
      classifyGeometry({
        type: "Polygon",
        coordinates: [
          [[0, 0], [1, 0], [0, 1], [0, 0]],
          [[0.2, 0.2], [0.3, 0.2], [0.2, 0.3], [0.2, 0.2]],
        ],
      }).geometryType,
    ).toBe("multi-polygon");
    expect(classifyGeometry(null).geometryType).toBe("empty");
  });

  it("deduplicates by STRAP and refuses a non-STRAP parcel_id", () => {
    const first = { parcel_id: "162805389030000430" };
    const duplicate = { parcel_id: "162805389030000430" };
    const second = { parcel_id: "163131676080040070" };
    expect(dedupeByStrap([first, duplicate, second])).toHaveLength(2);
    expect(() => dedupeByStrap([{ parcel_id: "05-28-16-38903-000-0430" }])).toThrow(/non-STRAP/);
  });

  it("builds the Pinellas replay seed row from the GIS feature fixture, matching seed.csv", async () => {
    const feature = JSON.parse(await readFile(path.join(FIXTURE_DIR, "gis-feature.json"), "utf8"));
    const row = toSeedRow(feature, "single-family", "2026-01-01T00:00:00.000Z");

    expect(row.parcel_id).toBe("162805389030000430");
    expect(row.source_identifier).toBe("162805389030000430");
    expect(row.situs_address).toBe("3400 RUGBY CT, PALM HARBOR FL 34684");
    expect(row.url).toBe("https://www.pcpao.gov/property/detail/print");
    expect(row.url).not.toContain("?");
    expect(JSON.parse(row.multiValueQueryString)).toEqual({ is_print: ["1"], s: ["162805389030000430"] });
    expect(row.county).toBe("Pinellas");
    expect(row.county_fips).toBe("12103");
    expect(row.geometry_type).toBe("simple-polygon");
    expect(SEED_COLUMNS).toContain("parcel_id");

    const fixtureSeedRows = parseCsvRecords(await readFile(path.join(FIXTURE_DIR, "seed.csv"), "utf8"));
    expect(fixtureSeedRows).toHaveLength(1);
    for (const column of SEED_COLUMNS) {
      expect(row[column]).toBe(fixtureSeedRows[0][column]);
    }
  });

  it("buildSeed(options) renders a CSV file matching the fixture seed row", async () => {
    const feature = JSON.parse(await readFile(path.join(FIXTURE_DIR, "gis-feature.json"), "utf8"));
    const { rows, csv } = await buildSeed({
      features: [feature],
      useGroup: "single-family",
      snapshotAt: "2026-01-01T00:00:00.000Z",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].parcel_id).toBe("162805389030000430");
    const parsedBack = parseCsvRecords(csv);
    expect(parsedBack).toHaveLength(1);
    expect(parsedBack[0].parcel_id).toBe("162805389030000430");
  });
});
