import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { documentPrefix, readIndexRecords, storeDocuments } from "../src/mortgage/documents.mjs";

const dirs = [];
afterEach(async () => Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))));

class PutObjectCommand { constructor(input) { this.input = input; this.kind = "put"; } }
class GetObjectCommand { constructor(input) { this.input = input; this.kind = "get"; } }

/** In-memory S3 that understands the two commands used. */
function fakeS3() {
  const objects = new Map();
  return {
    objects,
    async send(command) {
      if (command.kind === "put") {
        objects.set(command.input.Key, command.input.Body);
        return {};
      }
      if (!objects.has(command.input.Key)) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
      const body = objects.get(command.input.Key);
      return { Body: { transformToString: async () => String(body) } };
    },
  };
}

const record = (n, date) => ({
  requestIdentifier: `duval-or:${n}`, county: "duval", state: "FL", instrumentNumber: String(n), recordDate: date, docType: "MORTGAGE",
});

describe("mortgage documents", () => {
  it("builds S3 keys per state, county and instrument", () => {
    expect(documentPrefix({ state: "TX", county: "harris", instrumentNumber: "RP-2026-1/2" })).toBe("documents/TX/harris/RP-2026-1_2");
  });

  it("reads index windows newest first within a date range", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "docs-"));
    dirs.push(dir);
    await writeFile(path.join(dir, "a.jsonl"), `${JSON.stringify(record(1, "2026-11-01"))}\n${JSON.stringify(record(2, "2025-01-01"))}\n`);
    await writeFile(path.join(dir, "b.jsonl"), `${JSON.stringify(record(3, "2026-11-02"))}\n`);
    const rows = await readIndexRecords(dir, { from: "2026-01-01" });
    expect(rows.map((r) => r.instrumentNumber)).toEqual(["3", "1"]);
  });

  it("stores the document and index.json, then skips it on resume", async () => {
    const s3 = fakeS3();
    let fetches = 0;
    const fetchDocument = async () => {
      fetches += 1;
      return { bytes: new TextEncoder().encode("%PDF-1.4 fake"), contentType: "application/pdf", sourceUrl: "https://or.example/doc" };
    };
    const run = () => storeDocuments({
      records: [record(7, "2026-11-02")], fetchDocument, s3,
      commands: { PutObjectCommand, GetObjectCommand }, bucket: "b", limit: 10, delayMs: 0,
    });
    expect(await run()).toMatchObject({ stored: 1, skipped: 0, failed: 0 });
    expect([...s3.objects.keys()]).toEqual(["documents/FL/duval/7/document.pdf", "documents/FL/duval/7/index.json"]);
    const index = JSON.parse(s3.objects.get("documents/FL/duval/7/index.json"));
    expect(index).toMatchObject({ requestIdentifier: "duval-or:7", contentType: "application/pdf", bytes: 13 });
    expect(index.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await run()).toMatchObject({ stored: 0, skipped: 1 });
    expect(fetches).toBe(1);
  });

  it("records a failed fetch and keeps going", async () => {
    const s3 = fakeS3();
    const result = await storeDocuments({
      records: [record(1, "2026-11-02"), record(2, "2026-11-02")],
      fetchDocument: async (r) => {
        if (r.instrumentNumber === "1") throw new Error("HTTP 500");
        return { bytes: new Uint8Array([37, 80, 68, 70, 45]), contentType: "application/pdf", sourceUrl: "u" };
      },
      s3, commands: { PutObjectCommand, GetObjectCommand }, bucket: "b", limit: 10, delayMs: 0,
    });
    expect(result).toMatchObject({ stored: 1, failed: 1 });
  });
});
