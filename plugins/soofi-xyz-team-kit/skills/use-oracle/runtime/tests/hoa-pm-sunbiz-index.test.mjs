import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildHoaPmSunbizIndex } from "../src/enrichment/hoa-pm-sunbiz-index.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function fixedWidthRecord({
  documentNumber,
  entityName,
  status = "A",
  agentName = "",
  agentType = "",
}) {
  const chars = Array(1_450).fill(" ");
  const write = (start, length, value) => {
    const text = String(value).slice(0, length).padEnd(length, " ");
    chars.splice(start - 1, length, ...text);
  };
  write(1, 12, documentNumber);
  write(13, 192, entityName);
  write(205, 1, status);
  write(206, 15, "FLAL");
  write(545, 42, agentName);
  write(587, 1, agentType);
  return chars.join("");
}

describe("HOA/PM statewide Sunbiz index", () => {
  it("keeps matching active HOAs and their registered-agent companies", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "hoa-pm-index-"));
    temporaryDirectories.push(directory);
    const sourceDir = path.join(directory, "source");
    const outputDir = path.join(directory, "output");
    const subdivisionsPath = path.join(directory, "subdivisions.json");
    await mkdir(sourceDir);
    await writeFile(
      path.join(sourceDir, "cordata0.txt"),
      [
        fixedWidthRecord({
          documentNumber: "N00000000001",
          entityName: "EXAMPLE SUBDIVISION HOMEOWNERS ASSOCIATION INC",
          agentName: "GOOD PROPERTY MANAGEMENT LLC",
          agentType: "C",
        }),
        fixedWidthRecord({
          documentNumber: "L00000000002",
          entityName: "GOOD PROPERTY MANAGEMENT LLC",
        }),
        fixedWidthRecord({
          documentNumber: "L00000000003",
          entityName: "UNRELATED COMPANY LLC",
        }),
        fixedWidthRecord({
          documentNumber: "N00000000004",
          entityName: "EXAMPLE SUBDIVISION HOA INC",
          status: "I",
        }),
      ].join("\n"),
    );
    await writeFile(
      subdivisionsPath,
      `${JSON.stringify(["Example Subdivision"])}\n`,
    );

    const manifest = await buildHoaPmSunbizIndex({
      sourceDir,
      subdivisionsPath,
      outputDir,
      quarter: "2026Q3",
      chunkRecordLimit: 1,
    });

    expect(manifest).toMatchObject({
      subdivisionCount: 1,
      sourceRecordsRead: 4,
      invalidRecordCount: 0,
      hoaCompanyCount: 1,
      agentCompanyNameCount: 1,
      matchedRecordCount: 2,
      completeSourceScan: true,
    });
    const records = [];
    for (const chunk of manifest.chunks) {
      records.push(
        ...(await readFile(path.join(outputDir, chunk.relativePath), "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line)),
      );
    }
    expect(records.map((record) => record.entity.documentNumber)).toEqual([
      "L00000000002",
      "N00000000001",
    ]);
  });
});
