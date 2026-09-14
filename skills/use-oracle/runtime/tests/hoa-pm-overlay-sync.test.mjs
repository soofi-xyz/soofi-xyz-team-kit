import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeQueryTableParquet } from "../src/core/query-table.mjs";
import { syncHoaPmOverlay } from "../src/enrichment/hoa-pm-overlay-sync.mjs";

const require = createRequire(import.meta.url);
const { ParquetReader } = require("@dsnp/parquetjs");
const temporaryDirectories = [];
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const schemaFields = {
  elephant_token: { type: "UTF8", optional: true },
  elephant_uuid: { type: "UTF8", optional: true },
  parcel_identifier: { type: "UTF8", optional: true },
  subdivision: { type: "UTF8", optional: true },
  hoa_flag: { type: "BOOLEAN", optional: true },
  hoa_cid: { type: "UTF8", optional: true },
  property_manager_cid: { type: "UTF8", optional: true },
  hoa_pm_status: { type: "UTF8", optional: true },
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function writeFixture(name, rows) {
  const directory = await mkdtemp(path.join(tmpdir(), "hoa-pm-overlay-sync-"));
  temporaryDirectories.push(directory);
  const parquetPath = path.join(directory, `${name}.parquet`);
  await writeQueryTableParquet({ parquetPath, schemaFields, rows });
  return { directory, parquetPath };
}

async function readRows(parquetPath) {
  const reader = await ParquetReader.openFile(parquetPath);
  const rows = [];
  try {
    const cursor = reader.getCursor();
    for (let row = await cursor.next(); row; row = await cursor.next()) rows.push(row);
  } finally {
    await reader.close();
  }
  return rows;
}

describe("HOA/PM overlay subdivision sync", () => {
  it("matches prefixed and bare tokens, fills blanks, and preserves filled values and HOA flags", async () => {
    const overlay = await writeFixture("overlay", [
      {
        elephant_token: `address:v1:${HASH_A}`,
        parcel_identifier: "A-1",
        subdivision: " ",
        hoa_flag: false,
      },
      {
        elephant_token: HASH_B,
        parcel_identifier: "B-1",
        subdivision: "KEEP OVERLAY",
        hoa_flag: true,
      },
    ]);
    const official = await writeFixture("official", [
      {
        elephant_token: HASH_A,
        parcel_identifier: "A-1",
        subdivision: "OFFICIAL A",
        hoa_flag: true,
      },
      {
        elephant_token: `address:v1:${HASH_B}`,
        parcel_identifier: "B-1",
        subdivision: "OFFICIAL B",
        hoa_flag: false,
      },
    ]);
    const outputDir = path.join(overlay.directory, "output");

    const result = await syncHoaPmOverlay({
      county: "clay",
      overlayParquet: overlay.parquetPath,
      officialParquet: official.parquetPath,
      outputDir,
    });

    expect(result).toMatchObject({
      overlayIn: 2,
      officialMatched: 2,
      subdivisionFilled: 1,
      rowsAdded: 0,
      stillEmpty: 0,
    });
    expect(await readRows(result.outputParquet)).toEqual([
      expect.objectContaining({ subdivision: "OFFICIAL A", hoa_flag: false }),
      expect.objectContaining({ subdivision: "KEEP OVERLAY", hoa_flag: true }),
    ]);
  });

  it("adds CSV-only official rows on token and clears HOA/PM enrichment fields", async () => {
    const overlay = await writeFixture("overlay", [
      { elephant_token: HASH_A, parcel_identifier: "A-1", subdivision: "A" },
    ]);
    const official = await writeFixture("official", [
      { elephant_token: HASH_A, parcel_identifier: "A-1", subdivision: "A" },
      {
        elephant_token: HASH_C,
        parcel_identifier: "C-1",
        subdivision: "OFFICIAL C",
        hoa_cid: "should-not-copy",
        property_manager_cid: "should-not-copy",
        hoa_pm_status: "matched",
      },
    ]);
    const parcelCsv = path.join(overlay.directory, "parcels.csv");
    await writeFile(parcelCsv, `elephant_token\naddress:v1:${HASH_C}\n`);

    const result = await syncHoaPmOverlay({
      county: "duval",
      overlayParquet: overlay.parquetPath,
      officialParquet: official.parquetPath,
      outputDir: path.join(overlay.directory, "output"),
      parcelCsv,
    });

    expect(result).toMatchObject({ overlayIn: 1, rowsAdded: 1, outputRows: 2 });
    const rows = await readRows(result.outputParquet);
    expect(rows[1]).toMatchObject({
      elephant_token: HASH_C,
      parcel_identifier: "C-1",
      subdivision: "OFFICIAL C",
    });
    expect(rows[1].hoa_cid).toBeNull();
    expect(rows[1].property_manager_cid).toBeNull();
    expect(rows[1].hoa_pm_status).toBeNull();
    expect(JSON.parse(await readFile(result.manifestPath, "utf8"))).toMatchObject({
      rowsAdded: 1,
    });
  });

  it("falls back from token to UUID and then parcel identifier", async () => {
    const overlay = await writeFixture("overlay", [
      { elephant_uuid: "UUID-1", parcel_identifier: "P-1" },
      { parcel_identifier: "P-2" },
    ]);
    const official = await writeFixture("official", [
      { elephant_uuid: "uuid-1", parcel_identifier: "OTHER", subdivision: "BY UUID" },
      { parcel_identifier: "P-2", subdivision: "BY PARCEL" },
    ]);

    const result = await syncHoaPmOverlay({
      county: "lee",
      overlayParquet: overlay.parquetPath,
      officialParquet: official.parquetPath,
      outputDir: path.join(overlay.directory, "output"),
    });

    expect(result).toMatchObject({ officialMatched: 2, subdivisionFilled: 2 });
    expect((await readRows(result.outputParquet)).map((row) => row.subdivision)).toEqual([
      "BY UUID",
      "BY PARCEL",
    ]);
  });
});
