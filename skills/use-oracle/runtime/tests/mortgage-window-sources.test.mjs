import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { calendarWindows, harvestWindows } from "../src/mortgage/windowed-harvest.mjs";
import {
  hillsboroughFetcher,
  normalizeHillsboroughRow,
  usDate,
} from "../src/mortgage/hillsborough.mjs";
import { maricopaFetcher } from "../src/mortgage/maricopa.mjs";
import { formInputs, harrisFetcher, parseHarrisResults } from "../src/mortgage/harris.mjs";
import {
  docTypeBoxes,
  parseMecklenburgResults,
  pickerState,
  recordCount,
} from "../src/mortgage/mecklenburg.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const harrisHtml = await readFile(path.join(here, "fixtures/mortgage/harris-results.html"), "utf8");
const temporaryDirectories = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function outputDir() {
  const d = await mkdtemp(path.join(tmpdir(), "windows-"));
  temporaryDirectories.push(d);
  return d;
}
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

describe("harvestWindows", () => {
  it("cuts calendar windows by day, month and year", () => {
    expect(calendarWindows("20261130", "20261202", "day")).toHaveLength(3);
    expect(calendarWindows("20261115", "20270110", "month")).toEqual([
      ["20261115", "20261130"],
      ["20261201", "20261231"],
      ["20270101", "20270110"],
    ]);
    expect(calendarWindows("20251201", "20260105", "year")).toEqual([
      ["20251201", "20251231"],
      ["20260101", "20260105"],
    ]);
  });

  it("splits truncated windows, checks counts, and skips ready windows on resume", async () => {
    const out = await outputDir();
    const calls = [];
    const fetchWindow = async (from, to) => {
      calls.push(`${from}-${to}`);
      if (from !== to) return { records: [], complete: false };
      return { records: [{ id: `${from}-a` }, { id: `${from}-b` }], complete: true, expected: 2 };
    };
    const run = () =>
      harvestWindows({
        county: "x", jobId: "j", outputDir: out, windows: [["20260101", "20260104"]],
        fetchWindow, keyOf: (r) => r.id, delayMs: 0,
      });
    const first = await run();
    expect(first).toMatchObject({ readyWindows: 4, failedWindows: 0, records: 8 });
    const before = calls.length;
    const second = await run();
    // The 4-day parent is re-asked (it is never ready itself), then its day windows are skipped.
    expect(second).toMatchObject({ readyWindows: 4, records: 8 });
    expect(calls.length - before).toBe(3);
  });

  it("fails a window closed on a count mismatch and retries thrown errors", async () => {
    const out = await outputDir();
    let attempts = 0;
    const result = await harvestWindows({
      county: "x", jobId: "j2", outputDir: out, windows: [["20260101", "20260101"], ["20260102", "20260102"]],
      fetchWindow: async (from) => {
        if (from === "20260101") return { records: [{ id: 1 }], complete: true, expected: 2 };
        attempts += 1;
        if (attempts < 3) throw new Error("socket hang up");
        return { records: [{ id: 2 }], complete: true };
      },
      keyOf: (r) => String(r.id), delayMs: 0,
    });
    expect(result).toMatchObject({ readyWindows: 1, failedWindows: 1, records: 1 });
    expect(attempts).toBe(3);
  });
});

describe("hillsborough", () => {
  const row = {
    Instrument: 2026428615,
    PartiesOne: ["DOE JANE"],
    PartiesTwo: ["MERSN", "EXAMPLE HOME LOANS LLC"],
    RecordDate: 1793638206,
    DocType: "(MTG) MORTGAGE",
    BookType: null, BookNum: null, PageNum: null,
    Legal: "L 21 B 103 EXAMPLE SECT",
    SalesPrice: null,
    ID: "KEY=", PageCount: 25, UUID: "U1",
  };

  it("normalizes a search row", () => {
    expect(normalizeHillsboroughRow(row, "t")).toMatchObject({
      requestIdentifier: "hillsborough-or:2026428615",
      recordDate: "2026-11-02",
      docTypeCode: "MTG",
      grantors: ["DOE JANE"],
      grantees: ["MERSN", "EXAMPLE HOME LOANS LLC"],
      legalDescriptions: ["L 21 B 103 EXAMPLE SECT"],
      pageCount: 25,
    });
    expect(usDate("20261102")).toBe("11/02/2026");
  });

  it("posts the mortgage doc types and treats truncated or cut answers as incomplete", async () => {
    const bodies = [];
    const answers = [
      json({ Success: true, Truncated: null, ResultList: [row] }),
      json({ Success: true, Truncated: 5000, ResultList: [] }),
      new Response('{"Success":true,"ResultList":[{"Instrument":1', { status: 200 }),
    ];
    const fetchImpl = async (url, init) => { bodies.push(JSON.parse(init.body)); return answers.shift(); };
    const fetcher = hillsboroughFetcher({ fetchImpl });
    expect(await fetcher("20261102", "20261102")).toMatchObject({ complete: true, records: [{ instrumentNumber: "2026428615" }] });
    expect((await fetcher("20260101", "20261231")).complete).toBe(false);
    expect((await fetcher("19640101", "19641231")).complete).toBe(false);
    expect(bodies[0]).toMatchObject({ RecordDateBegin: "11/02/2026", RecordDateEnd: "11/02/2026" });
    expect(bodies[0].DocType).toContain("(MTG) MORTGAGE");
  });
});

describe("maricopa", () => {
  it("pages until a short page and fetches names when asked", async () => {
    const urls = [];
    const make = (n, offset) => Array.from({ length: n }, (_, i) => ({
      recordingNumber: 20260630000 + offset + i, recordingSuffix: "", recordingDate: "11-02-2026",
      documentCode: "DEED TRST", docketBook: "", pageMap: "", names: "",
    }));
    const fetchImpl = async (url) => {
      urls.push(url);
      const u = new URL(url);
      if (u.pathname === "/documents/search") {
        const page = Number(u.searchParams.get("pageNumber"));
        return json({ searchResults: page === 1 ? make(2, 0) : page === 2 ? make(1, 2) : [] });
      }
      return json({ names: ["DOE JANE", "EXAMPLE CREDIT UNION"] });
    };
    const result = await maricopaFetcher({ fetchImpl, pageSize: 2, pageDelayMs: 0, withNames: true })("20261102", "20261102");
    expect(result.complete).toBe(true);
    expect(result.records).toHaveLength(3);
    expect(result.records[0]).toMatchObject({
      requestIdentifier: "maricopa-or:20260630000",
      recordDate: "2026-11-02",
      names: ["DOE JANE", "EXAMPLE CREDIT UNION"],
    });
    expect(urls[0]).toContain("documentCode=DT&beginDate=2026-11-02&endDate=2026-11-02&pageNumber=1&pageSize=2");
    expect(urls.filter((u) => u.includes("/documents/2026"))).toHaveLength(3);
  });
});

describe("harris", () => {
  it("parses result rows with roles and legal description", () => {
    const rows = parseHarrisResults(harrisHtml, "t");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      requestIdentifier: "harris-or:RP-2026-442388",
      recordDate: "2026-11-02",
      docTypeCode: "D/T",
      docType: "DEED OF TRUST",
      grantors: ["DOE PERSON", "DOE PERSON"],
      grantees: ["EXAMPLE MORTGAGE LLC"],
      trustees: ["DOE PERSON"],
      legalDescriptions: ["EXAMPLE ESTATES"],
      pageCount: 16,
    });
    expect(formInputs(harrisHtml)).toMatchObject({ __VIEWSTATE: "VS1", __EVENTVALIDATION: "EV1" });
  });

  it("searches, follows the redirect, and pages with Next until a short page", async () => {
    const posts = [];
    const fetchImpl = async (url, init = {}) => {
      if (init.method === "POST") {
        const body = new URLSearchParams(init.body);
        posts.push(Object.fromEntries(body));
        if (url.endsWith("/RP.aspx")) {
          return new Response("", { status: 302, headers: { location: "RP_R.aspx?ID=TOKEN", "set-cookie": "ASP.NET_SessionId=s1; path=/" } });
        }
        return new Response("<html>no rows</html>", { status: 200 });
      }
      if (url.endsWith("/RP.aspx")) {
        return new Response('<input type="hidden" name="__VIEWSTATE" value="V0" /><input type="hidden" name="__EVENTVALIDATION" value="E0" />', { status: 200 });
      }
      return new Response(harrisHtml, { status: 200 });
    };
    const result = await harrisFetcher({ fetchImpl, pageDelayMs: 0 })("20261102", "20261102");
    expect(result).toMatchObject({ complete: true });
    expect(result.records).toHaveLength(2);
    expect(posts[0]).toMatchObject({
      __VIEWSTATE: "V0",
      "ctl00$ContentPlaceHolder1$txtFrom": "11/02/2026",
      "ctl00$ContentPlaceHolder1$txtInstrument": "D/T",
      "ctl00$ContentPlaceHolder1$btnSearch": "Search",
    });
    expect(posts).toHaveLength(1);
  });

  it("marks a multi-day window with the too-many warning as incomplete", async () => {
    const fetchImpl = async (url, init = {}) => {
      if (init.method === "POST") return new Response("", { status: 302, headers: { location: "RP_R.aspx?ID=T" } });
      if (url.endsWith("/RP.aspx")) return new Response("<input type=\"hidden\" name=\"__VIEWSTATE\" value=\"V\" />");
      return new Response(`Your search criteria returned too many records. ${harrisHtml}`);
    };
    expect((await harrisFetcher({ fetchImpl, pageDelayMs: 0 })("20261101", "20261130")).complete).toBe(false);
  });
});

describe("mecklenburg", () => {
  const cell = (v) => `<td class="x">${v}</td>`;
  const row = (n) => `<tr>${[
    "1", "<div>View</div>", "<input type=\"checkbox\">",
    `<a href="./SearchResults.aspx?global_id=OPR${n}&amp;type=dtl"> ${n}</a>`,
    `<span> ${n}</span>`, ` ${n}`, "40817", " 186", "11/02/2026", "DEED OF TRUST", "D/T",
    "<span>[R]</span> <span>DOE JANE</span>", "R", "DOE JANE", "", "E",
    'EXAMPLE MORTGAGE LLC<b title="Other Names Indicator"> (+)</b>', "",
    "LT 6 EXAMPLE SUBDIVISION", "", "", "V", "Y", `OPR${n}`,
  ].map(cell).join("")}</tr>`;

  it("parses result rows, the record count and the picker state", () => {
    const html = `<span id="x_SearchCriteriaTop_Label8">(</span><span id="x_SearchCriteriaTop_TotalRows">127</span><span> records found as of </span><table>${row(2026116381)}${row(2026116377)}</table>`;
    expect(recordCount(html)).toBe(127);
    const rows = parseMecklenburgResults(html, "t");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      requestIdentifier: "mecklenburg-or:2026116381",
      recordDate: "2026-11-02",
      book: "40817",
      page: "186",
      docTypeCode: "D/T",
      grantors: ["DOE JANE"],
      grantees: ["EXAMPLE MORTGAGE LLC"],
      moreParties: true,
      legalDescriptions: ["LT 6 EXAMPLE SUBDIVISION"],
      source: { globalId: "OPR2026116381" },
    });
    expect(pickerState("20261102")).toBe("|0|012026-11-2-0-0-0-0||");
  });

  it("finds the deed of trust and mortgage boxes with their submit values", () => {
    const html = '<input id="b_53" type="checkbox" name="ctl00$f$dclDocType$53" value="D/T" /><label for="b_53">DEED OF TRUST</label>' +
      '<input id="b_54" type="checkbox" name="ctl00$f$dclDocType$54" value="DEED" /><label for="b_54">DEED</label>' +
      '<input id="b_86" type="checkbox" name="ctl00$f$dclDocType$86" value="MTG" /><label for="b_86">MORTGAGE</label>';
    expect(docTypeBoxes(html)).toEqual([
      { name: "ctl00$f$dclDocType$53", value: "D/T" },
      { name: "ctl00$f$dclDocType$86", value: "MTG" },
    ]);
  });
});

describe("acclaim doc-type listing", () => {
  const profile = { county: "duval", state: "FL", requestIdentifierPrefix: "duval-or", baseUrl: "https://or.example" };
  const gridRow = (date, n) => ({
    TransactionItemId: n, InstrumentNumber: String(2026000000 + n), RecordDate: `${date} 08:00:00`,
    DocTypeDescription: "MORTGAGE", BookType: "OR", BookPage: "21492/1360", NumberOfPages: 9,
    DirectName: "DOE JANE", IndirectName: "EXAMPLE BANK N A", Consideration: "$255,000.00",
    DocLegalDescription: "L 1 EXAMPLE",
  });
  const fake = (searchHtml, data) => async (url, init) => {
    if (url.includes("/search/Disclaimer")) return new Response("", { status: 302, headers: { location: "/search/SearchTypeDocType", "set-cookie": "s=1; path=/" } });
    if (url.includes("/search/SearchTypeDocType")) return new Response(searchHtml, { status: 200 });
    return json({ Data: data, Total: data.length });
  };

  it("lists a window and normalizes rows", async () => {
    const { acclaimDocTypeFetcher } = await import("../src/mortgage/acclaim.mjs");
    const result = await acclaimDocTypeFetcher({ baseUrl: profile.baseUrl, docTypeIds: [110], profile, fetchImpl: fake("<html>ok</html>", [gridRow("2026/11/02", 1)]) })("20261102", "20261102");
    expect(result).toMatchObject({ complete: true, expected: 1 });
    expect(result.records[0]).toMatchObject({ requestIdentifier: "duval-or:2026000001", recordDate: "2026-11-02", consideration: 255000, grantees: ["EXAMPLE BANK N A"] });
  });

  it("treats the max-limit message and stale rows as truncated", async () => {
    const { acclaimDocTypeFetcher } = await import("../src/mortgage/acclaim.mjs");
    const over = await acclaimDocTypeFetcher({ baseUrl: profile.baseUrl, docTypeIds: [110], profile, fetchImpl: fake("ShowError(' The number of results exceeded the maximum limit')", [gridRow("2026/11/02", 1)]) })("20250101", "20251231");
    expect(over.complete).toBe(false);
    const stale = await acclaimDocTypeFetcher({ baseUrl: profile.baseUrl, docTypeIds: [110], profile, fetchImpl: fake("<html>ok</html>", [gridRow("2026/11/02", 1)]) })("20250101", "20250131");
    expect(stale.complete).toBe(false);
  });
});
