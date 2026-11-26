import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { requireMortgageProfile } from "../src/counties/mortgage-profiles.mjs";
import {
  buildResultsPath,
  harvestPublicsearchMortgages,
  listDays,
  parseRejectedFrame,
  planWindows,
  splitWindow,
  normalizePublicsearchDocument,
  ocrHints,
  parseFulfilledFrame,
  parseRequestFrame,
} from "../src/mortgage/publicsearch.mjs";

const temporaryDirectories = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

/** A document shaped like a real FETCH_DOCUMENTS_FULFILLED/v6 entry, with fake parties. */
function fakeDoc(id, docTypeCode = "DT") {
  return {
    docId: id,
    id,
    documentNumber: `2026${String(id).padStart(8, "0")}`,
    instrumentNumber: `2026${String(id).padStart(8, "0")}`,
    docType: docTypeCode === "DT" ? "DEED OF TRUST" : "WARRANTY DEED",
    docTypeCode,
    recordedDate: "11/10/2026",
    recordedTime: "8:17 AM",
    instrumentDate: "11/05/2026",
    bookVolumePage: "--/--/--",
    pageCount: 19,
    consideration: "$0.00",
    imageId: 900000 + id,
    parties: [
      { type: "grantee", name: "EXAMPLE MORTGAGE INC", isDirect: false },
      { type: "grantee", name: "MORTGAGE ELECTRONIC REGISTRATION SYSTEMS INC", isDirect: false },
      { type: "grantor", name: "DOE JANE", isDirect: true },
      { type: "grantee", overflowMsg: "" },
    ],
    legals: [
      {
        legalType: "Subdivision",
        developmentName: "EXAMPLE LAKES",
        lot: "6",
        block: "D",
        township: "ROWLETT",
        description: "Subdivision- Name: EXAMPLE LAKES Lot: 6 Block: D CITY: ROWLETT",
      },
      { legalType: "subdivision", overflowMsg: "" },
    ],
    ocrText:
      "2026 - 202600000001 Page 1 of 19 After Recording Return To: EXAMPLE MORTGAGE, INC. Loan Number: 1002271476 [Space Above This Line",
  };
}

function frame(type, correlationId, payload) {
  return JSON.stringify({ type, correlationId, payload });
}

const dallas = requireMortgageProfile("dallas");

describe("publicsearch parsing", () => {
  it("normalizes a Deed of Trust into the mortgage index shape", () => {
    const record = normalizePublicsearchDocument(fakeDoc(1), dallas, "2026-11-26T00:00:00.000Z");
    expect(record).toMatchObject({
      requestIdentifier: "dallas-or:202600000001",
      instrumentNumber: "202600000001",
      recordDate: "2026-11-10",
      instrumentDate: "2026-11-05",
      docTypeCode: "DT",
      grantors: ["DOE JANE"],
      grantees: ["EXAMPLE MORTGAGE INC", "MORTGAGE ELECTRONIC REGISTRATION SYSTEMS INC"],
      consideration: null,
      loanNumber: "1002271476",
      pageCount: 19,
      book: null,
      legals: [{ subdivision: "EXAMPLE LAKES", lot: "6", block: "D", township: "ROWLETT", type: "Subdivision" }],
      source: { vendor: "publicsearch", docId: 1, detailUrl: "https://dallas.tx.publicsearch.us/doc/1" },
    });
  });

  it("reads loan number and principal hints from OCR text", () => {
    expect(ocrHints("Loan No. ABC-12345 ... Dollars (U.S. $322,942.00)")).toEqual({
      loanNumber: "ABC-12345",
      principalAmount: 322942,
    });
    expect(ocrHints(undefined)).toEqual({ loanNumber: null, principalAmount: null });
  });

  it("parses request and fulfilled frames and ignores others", () => {
    const sent = JSON.stringify({
      type: "@kofile/FETCH_DOCUMENTS/v4",
      correlationId: "c1",
      payload: { query: { recordedDateRange: "20261110,20261110", offset: "0" } },
    });
    expect(parseRequestFrame(sent)).toEqual({
      correlationId: "c1",
      query: { recordedDateRange: "20261110,20261110", offset: "0" },
    });
    const received = frame("@kofile/FETCH_DOCUMENTS_FULFILLED/v6", "c1", {
      data: { byOrder: [2, 1], byHash: { 1: fakeDoc(1), 2: fakeDoc(2) }, meta: { numRecords: 2 } },
    });
    const parsed = parseFulfilledFrame(received);
    expect(parsed.numRecords).toBe(2);
    expect(parsed.docs.map((d) => d.docId)).toEqual([2, 1]);
    expect(parseFulfilledFrame("{\"type\":\"department-dates\"}")).toBeNull();
    expect(parseFulfilledFrame("not json")).toBeNull();
  });

  it("builds window paths, lists days, splits and plans windows", () => {
    expect(buildResultsPath({ from: "20260101", to: "20261231", docTypes: ["DT"], offset: 250, limit: 250 })).toBe(
      "/results?department=RP&docTypes=DT&recordedDateRange=20260101%2C20261231&searchType=advancedSearch&limit=250&offset=250",
    );
    expect(splitWindow("20260101", "20260104")).toEqual([["20260101", "20260102"], ["20260103", "20260104"]]);
    expect(splitWindow("20260101", "20260101")).toBeNull();
    const plan = planWindows(
      [{ label: "1800", hits: 45 }, { label: "1964", hits: 0 }, { label: "2025", hits: 44591 }, { label: "2026", hits: 9000 }],
      "18000101",
      "20261116",
    );
    expect(plan[0]).toEqual(["18000101", "18001231"]);
    expect(plan.filter(([a]) => a.startsWith("2025"))).toHaveLength(12);
    expect(plan).toContainEqual(["20250201", "20250228"]);
    expect(plan.at(-1)).toEqual(["20260101", "20261116"]);
    expect(parseRejectedFrame(JSON.stringify({ type: "@kofile/FETCH_DOCUMENTS_REJECTED/v1", correlationId: "c9", payload: { errors: "Error with search query" } }))).toEqual({ correlationId: "c9", error: "Error with search query" });
    expect(listDays("20261230", "20270102")).toEqual(["20261230", "20261231", "20270101", "20270102"]);
    expect(() => listDays("20261110", "20261101")).toThrow(/before/);
  });
});

describe("harvestPublicsearchMortgages", () => {
  async function outputDir() {
    const d = await mkdtemp(path.join(tmpdir(), "publicsearch-"));
    temporaryDirectories.push(d);
    return d;
  }

  /**
   * Fake portal: docs keyed by recorded day (YYYYMMDD). Answers any window and offset
   * like the real one, including per-year statistics and the offset cap.
   */
  function fakeSession(byDay, overrides = {}) {
    const calls = [];
    return {
      calls,
      async runQuery(pathWithQuery, expect) {
        calls.push(pathWithQuery);
        const limit = Number(new URL(`https://x${pathWithQuery}`).searchParams.get("limit"));
        if (expect.offset >= (overrides.cap ?? 10_000)) throw new Error("Portal rejected: Error with search query");
        const all = Object.keys(byDay)
          .filter((day) => day >= expect.from && day <= expect.to)
          .sort()
          .flatMap((day) => byDay[day]);
        const years = {};
        for (const day of Object.keys(byDay)) years[day.slice(0, 4)] = (years[day.slice(0, 4)] ?? 0) + byDay[day].length;
        return {
          numRecords: overrides.numRecords?.[`${expect.from}-${expect.to}`] ?? all.length,
          yearStats: Object.entries(years).map(([label, hits]) => ({ label, hits })),
          docs: all.slice(expect.offset, expect.offset + limit),
        };
      },
    };
  }

  let nextId = 1;
  const docs = (n) => Array.from({ length: n }, () => fakeDoc(nextId++));

  it("pages through year windows, writes JSONL and ready markers, then skips on resume", async () => {
    const out = await outputDir();
    const byDay = { "20251110": docs(3), "20261110": docs(4), "20261111": docs(1) };
    const session = fakeSession(byDay);
    const result = await harvestPublicsearchMortgages({
      profile: dallas, jobId: "tx-1", from: "18000101", to: "20261126",
      outputDir: out, pageSize: 2, delayMs: 0, session,
    });
    expect(result).toMatchObject({ portalTotal: 8, windows: 2, readyWindows: 2, failedWindows: 0, records: 8 });
    const lines = (await readFile(path.join(out, "dallas/tx-1/windows/20260101-20261126.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(5);
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
    expect(manifest.complete).toBe(true);

    const again = fakeSession(byDay);
    const second = await harvestPublicsearchMortgages({
      profile: dallas, jobId: "tx-1", from: "18000101", to: "20261126",
      outputDir: out, pageSize: 2, delayMs: 0, session: again,
    });
    expect(second.records).toBe(8);
    expect(again.calls).toHaveLength(1);
  });

  it("halves a window that exceeds the offset cap until it fits", async () => {
    const out = await outputDir();
    const byDay = { "20260301": docs(3), "20260302": docs(3), "20260303": docs(3), "20260304": docs(3) };
    const session = fakeSession(byDay, { cap: 7 });
    const result = await harvestPublicsearchMortgages({
      profile: dallas, jobId: "tx-split", from: "20260301", to: "20260304",
      outputDir: out, pageSize: 2, delayMs: 0, windowCap: 7, session,
    });
    expect(result).toMatchObject({ portalTotal: 12, readyWindows: 2, failedWindows: 0, records: 12 });
    expect(session.calls.every((call) => !/offset=(7|8|9|1\d)\b/.test(call))).toBe(true);
  });

  it("fails a window closed when rows do not match the portal count", async () => {
    const out = await outputDir();
    const session = fakeSession(
      { "20261110": docs(2) },
      { numRecords: { "20260101-20261126": 3 } },
    );
    const result = await harvestPublicsearchMortgages({
      profile: dallas, jobId: "tx-2", from: "20260101", to: "20261126",
      outputDir: out, delayMs: 0, session,
    });
    expect(result).toMatchObject({ readyWindows: 0, failedWindows: 1, records: 0 });
    const failed = JSON.parse(await readFile(path.join(out, "dallas/tx-2/windows/20260101-20261126.failed.json"), "utf8"));
    expect(failed.error).toMatch(/wrote 2 rows but the portal reports 3/);
    expect(JSON.parse(await readFile(result.manifestPath, "utf8")).complete).toBe(false);
  });

  it("re-harvests a window whose file no longer matches its ready marker", async () => {
    const out = await outputDir();
    const byDay = { "20261110": docs(1) };
    const run = (session) =>
      harvestPublicsearchMortgages({
        profile: dallas, jobId: "tx-3", from: "20260101", to: "20261126",
        outputDir: out, delayMs: 0, session,
      });
    await run(fakeSession(byDay));
    await writeFile(path.join(out, "dallas/tx-3/windows/20260101-20261126.jsonl"), "tampered\n");
    const session = fakeSession(byDay);
    await run(session);
    expect(session.calls).toHaveLength(2);
  });
  it("keeps older records that share a document number (keyed by docId)", async () => {
    const out = await outputDir();
    const a = fakeDoc(nextId++);
    const b = { ...fakeDoc(nextId++), documentNumber: a.documentNumber, instrumentNumber: a.instrumentNumber };
    const session = fakeSession({ "18540601": [a, b] });
    const result = await harvestPublicsearchMortgages({
      profile: dallas, jobId: "tx-dupe", from: "18000101", to: "20261126",
      outputDir: out, delayMs: 0, session,
    });
    expect(result).toMatchObject({ portalTotal: 2, readyWindows: 1, records: 2, failedWindows: 0 });
  });

  it("resets the session and retries a search that hung", async () => {
    const out = await outputDir();
    const inner = fakeSession({ "20261110": docs(3) });
    let failuresLeft = 2;
    let resets = 0;
    const session = {
      reset: async () => { resets += 1; },
      runQuery: async (p, e) => {
        if (e.offset === 0 && e.from === "20260101" && failuresLeft-- > 0) {
          throw new Error("Attempted to use detached Frame");
        }
        return inner.runQuery(p, e);
      },
    };
    const result = await harvestPublicsearchMortgages({
      profile: dallas, jobId: "tx-retry", from: "20260101", to: "20261126",
      outputDir: out, delayMs: 0, session,
    });
    expect(result).toMatchObject({ readyWindows: 1, failedWindows: 0, records: 3 });
    expect(resets).toBe(2);
  });

  it("does not retry a rejected search", async () => {
    const out = await outputDir();
    let calls = 0;
    const session = {
      reset: async () => {},
      runQuery: async () => { calls += 1; throw new Error("Portal rejected /results: Error with search query"); },
    };
    await expect(
      harvestPublicsearchMortgages({
        profile: dallas, jobId: "tx-rej", from: "20260101", to: "20261126",
        outputDir: out, delayMs: 0, session,
      }),
    ).rejects.toThrow(/Portal rejected/);
    expect(calls).toBe(1);
  });
});
