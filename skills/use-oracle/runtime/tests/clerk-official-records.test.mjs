import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadClerkOfficialRecords,
  recordedCommunityEvidenceForParcel,
} from "../src/enrichment/clerk-official-records.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(records, manifestOverrides = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "clerk-or-"));
  temporaryDirectories.push(directory);
  const recordsPath = path.join(directory, "records.jsonl");
  const sourceManifestPath = path.join(directory, "manifest.json");
  const body = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  await writeFile(recordsPath, body);
  await writeFile(
    sourceManifestPath,
    `${JSON.stringify({
      schemaVersion: "elephant.clerk-recorded-community-names.v1",
      county: "duval",
      sourceProfileId: "duval-official-records-pilot-v1",
      sourceUrl: "https://or.duvalclerk.com/",
      extractId: "duval-bounded-pilot-1",
      sourceRetrievedAt: "2026-09-14T18:00:00.000Z",
      authoritative: true,
      linkMethod: "parcel_identifier",
      nameSource: "recorded_plat_or_declaration_name",
      recordCount: records.length,
      recordsSha256: createHash("sha256").update(body).digest("hex"),
      ...manifestOverrides,
    })}\n`,
  );
  return { recordsPath, sourceManifestPath };
}

const plat = {
  parcel_identifier: "164634-0000",
  recorded_name: "Example Community",
  instrument_type: "plat",
  name_kind: "plat_name",
  instrument_number: "2026123456",
  evidence_reference: "duval-or:2026123456",
};

describe("clerk official-records names", () => {
  it("returns one exact recorded community name for a parcel", async () => {
    const input = await fixture([
      plat,
      {
        ...plat,
        instrument_type: "declaration",
        name_kind: "declaration_name",
        instrument_number: "2026123457",
        evidence_reference: "duval-or:2026123457",
      },
    ]);
    const records = await loadClerkOfficialRecords({
      countyKey: "duval",
      ...input,
    });
    const result = recordedCommunityEvidenceForParcel(
      records,
      "164634-0000",
    );
    expect(result.status).toBe("matched");
    expect(result.evidence.normalizedName).toBe("EXAMPLE COMMUNITY");
    expect(result.evidence.instruments).toHaveLength(2);
    expect(
      recordedCommunityEvidenceForParcel(records, "1646340000").status,
    ).toBe("no_record");
  });

  it("fails closed when a parcel has different recorded names", async () => {
    const input = await fixture([
      plat,
      {
        ...plat,
        recorded_name: "Different Community",
        instrument_number: "2026123458",
      },
    ]);
    const records = await loadClerkOfficialRecords({
      countyKey: "duval",
      ...input,
    });
    expect(
      recordedCommunityEvidenceForParcel(records, "164634-0000"),
    ).toMatchObject({
      status: "not_unique",
      evidence: null,
    });
  });

  it("rejects party names and non-plat/declaration instruments", async () => {
    for (const override of [
      { name_kind: "party_name" },
      { instrument_type: "deed", name_kind: "plat_name" },
    ]) {
      const input = await fixture([{ ...plat, ...override }]);
      await expect(
        loadClerkOfficialRecords({ countyKey: "duval", ...input }),
      ).rejects.toThrow(/plat|declaration|party/i);
    }
  });

  it("rejects an unapproved source profile", async () => {
    const input = await fixture([plat], {
      sourceProfileId: "self-asserted-profile",
    });
    await expect(
      loadClerkOfficialRecords({ countyKey: "duval", ...input }),
    ).rejects.toThrow(/not approved/i);
  });
});
