import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  cidDigest,
  type Decision,
  parsePublishRequest,
  type PublishIO,
  type PublishState,
  runPublish,
  sameCid,
} from "../services/lib/publish-flow.ts";
import { COUNTY, createSandbox, JOB, type Sandbox } from "./services-helpers.ts";

const IDENTITY = { binary: "elephant-cli", version: "2.0.0-fake", commit: "abcdef1" };

function harness(decide: (state: PublishState, calls: () => Promise<string[]>) => Promise<Decision>, sandbox: Sandbox) {
  let state: PublishState = { phase: "validating-group" };
  const phases: string[] = [];
  const io: PublishIO = {
    run: async (_name, action) => action(),
    setState: (patch) => {
      state = { ...state, ...patch };
      if (patch.phase) phases.push(patch.phase);
    },
    awaitDecision: () =>
      decide(state, async () => (await sandbox.calls()).map((call) => call.command)),
  };
  return { io, phases, state: () => state };
}

describe("PublishGroup sequence", () => {
  let sandbox: Sandbox;
  let request: ReturnType<typeof parsePublishRequest>;

  beforeEach(async () => {
    sandbox = await createSandbox();
    const groupDir = path.join(sandbox.dataDir, "groups", COUNTY, JOB, "county");
    await mkdir(groupDir, { recursive: true });
    await writeFile(path.join(groupDir, "P-1.zip"), "zip-1");
    await writeFile(path.join(groupDir, "P-2.zip"), "zip-2");
    request = parsePublishRequest(
      {
        county: COUNTY,
        jobId: JOB,
        group: "county",
        groupDir: `groups/${COUNTY}/${JOB}/county`,
        atlasPage: path.join(sandbox.root, "atlas", "counties", "GA", `${COUNTY}.json`),
        state: "ga",
        fips: "13067",
      },
      `${COUNTY}-county-${JOB}`,
    );
  });
  afterEach(async () => {
    await sandbox.cleanup();
  });

  it("validates, hashes, validates the CAR and exports tables before approval, and uploads nothing before approve", async () => {
    const { io, phases, state } = harness(async (current, calls) => {
      expect(current.phase).toBe("awaiting-approval");
      expect(await calls()).toEqual(["validate", "hash", "validate", "export-tables"]);
      return { approved: true, approvedBy: "reviewer", groupDigest: current.groupDigest!, at: "2026-11-25T00:00:00Z" };
    }, sandbox);
    const result = await runPublish(io, request, IDENTITY);
    expect(result.status).toBe("uploaded");
    expect((await sandbox.calls()).map((call) => call.command)).toEqual([
      "validate",
      "hash",
      "validate",
      "export-tables",
      "upload",
      "upload",
    ]);
    expect(phases).toEqual([
      "validating-group",
      "hashing",
      "validating-car",
      "exporting-tables",
      "awaiting-approval",
      "uploading",
      "uploaded",
    ]);
    expect(state().uploads?.car.verified).toBe(true);
    const page = JSON.parse(await readFile(request.atlasPage, "utf8"));
    expect(page.county).toBe(COUNTY);
    const exportCall = (await sandbox.calls()).find((call) => call.command === "export-tables")!;
    expect(exportCall.args).toEqual(
      expect.arrayContaining(["--atlas-page", request.atlasPage, "--county", COUNTY, "--state", "GA", "--fips", "13067"]),
    );
  });

  it("never uploads when rejected", async () => {
    const { io, phases } = harness(async () => ({ approved: false, reason: "privacy review", at: "t" }), sandbox);
    const result = await runPublish(io, request, IDENTITY);
    expect(result).toMatchObject({ status: "rejected", reason: "privacy review" });
    expect((await sandbox.calls()).map((call) => call.command)).not.toContain("upload");
    expect(phases.at(-1)).toBe("rejected");
  });

  it("fails closed when the approved digest differs from the validated group", async () => {
    const { io, state } = harness(
      async () => ({ approved: true, approvedBy: "reviewer", groupDigest: "0".repeat(64), at: "t" }),
      sandbox,
    );
    await expect(runPublish(io, request, IDENTITY)).rejects.toThrow("approval failed");
    expect(state().phase).toBe("failed");
    expect((await sandbox.calls()).map((call) => call.command)).not.toContain("upload");
  });

  it("fails before hashing when the group does not validate", async () => {
    await writeFile(path.join(request.groupDir, "INVALID"), "x");
    const { io, state } = harness(async () => {
      throw new Error("must not reach approval");
    }, sandbox);
    await expect(runPublish(io, request, IDENTITY)).rejects.toThrow("validate-group failed");
    expect(state().phase).toBe("failed");
    expect((await sandbox.calls()).map((call) => call.command)).toEqual(["validate"]);
  });

  it("validates the request and the workflow key", () => {
    const base = {
      county: COUNTY,
      jobId: JOB,
      group: "county",
      groupDir: `groups/${COUNTY}/${JOB}/county`,
      atlasPage: `/atlas/counties/GA/${COUNTY}.json`,
      state: "GA",
      fips: "13067",
    };
    expect(() => parsePublishRequest(base, "wrong-key")).toThrow("key must be");
    expect(() => parsePublishRequest({ ...base, fips: "1306" })).toThrow("fips");
    expect(() => parsePublishRequest({ ...base, atlasPage: "counties/GA/x.json" })).toThrow("atlasPage");
    expect(() => parsePublishRequest({ ...base, groupDir: "../outside" })).toThrow("groupDir");
    expect(() => parsePublishRequest({ ...base, group: "County Group" })).toThrow("group");
    expect(() => parsePublishRequest({ ...base, group: "seed" })).toThrow("never published as its own group");
  });

  it("compares CIDs by multihash digest across codecs", () => {
    // Same sha2-256 digest under raw (0x55) and dag-json (0x0129) codecs.
    const raw = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";
    const digest = cidDigest(raw)!;
    expect(digest).toMatch(/^1220[a-f0-9]{64}$/);
    const bytes = Buffer.concat([Buffer.from([0x01, 0xa9, 0x02]), Buffer.from(digest, "hex")]);
    const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
    let bits = 0;
    let value = 0;
    let text = "b";
    for (const byte of bytes) {
      value = (value << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        text += alphabet[(value >> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) text += alphabet[(value << (5 - bits)) & 31];
    expect(sameCid(raw, text)).toBe(true);
    expect(sameCid(raw, "bafkreiaaaa")).toBe(false);
  });
});
