/**
 * Mecklenburg County, NC Register of Deeds (Aumentum Recorder, meckrod.manatron.com).
 *
 * Verified 2026-11-26 (the operator approved accepting the site disclaimer):
 *   1. GET / and post back ctl00$cph1$lnkAccept (disclaimer).
 *   2. GET /RealEstate/SearchEntry.aspx, post back with the Date Filed pickers' client
 *      state ("|0|01YYYY-M-D-0-0-0-0||"), the DEED OF TRUST and MORTGAGE doc-type boxes
 *      and SearchButtons1$btnSearch -> SearchResults.aspx, 20 rows per page with
 *      "( N records found" in the header.
 *   3. Page with the OptionsBar1$ItemList drop-down postback.
 * Rows carry instrument, book-page, date, doc type, first borrower [R], first lender [E]
 * (with a "(+)" more-names flag), legal description and the internal global_id.
 * Index covers March 1990 onward; earlier years are image-only (meckrodhistorical.com).
 *
 * @module src/mortgage/mecklenburg
 */

import { CookieJar } from "./acclaim.mjs";
import { formInputs } from "./harris.mjs";

export const MECKLENBURG_BASE = "https://meckrod.manatron.com";
/** Default mortgage instrument labels; older (pre-conversion) records use the PRE ... D/T types. */
export const MECKLENBURG_MORTGAGE_LABELS = Object.freeze([
  "DEED OF TRUST",
  "MORTGAGE",
  "CORRECTED DEED OF TRUST",
  "SUPPLEMENTAL DEED OF TRUST",
  "CORRECTED MORTGAGE",
  "MORTGAGE OF DEED",
  // Pre-conversion (early 1990s) records: 1991-06-20 has 69 PRE D/T and 3 PRE COR D/T, 0 DEED OF TRUST.
  "PRE D/T",
  "PRE ADD D/T",
  "PRE AMD D/T",
  "PRE COR D/T",
  "PRE SUPL D/T",
]);
let DOC_TYPE_LABELS = [...MECKLENBURG_MORTGAGE_LABELS];

/**
 * @param {string} value - HTML.
 * @returns {string} Text.
 */
function text(value) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Infragistics WebDatePicker client state for a day.
 *
 * @param {string} yyyymmdd - YYYYMMDD.
 * @returns {string} Client state.
 */
export function pickerState(yyyymmdd) {
  return `|0|01${Number(yyyymmdd.slice(0, 4))}-${Number(yyyymmdd.slice(4, 6))}-${Number(yyyymmdd.slice(6, 8))}-0-0-0-0||`;
}

/**
 * Find the doc-type checkboxes for the given labels.
 *
 * @param {string} html - SearchEntry page.
 * @returns {{ name: string, value: string }[]} Checkbox names and submit values.
 */
export function docTypeBoxes(html) {
  const boxes = [];
  for (const match of html.matchAll(/<input([^>]*dclDocType[^>]*)\/?>\s*<label for="([^"]+)"[^>]*>([^<]*)</g)) {
    const attrs = match[1];
    const name = /name="([^"]+)"/.exec(attrs)?.[1];
    const value = /value="([^"]*)"/.exec(attrs)?.[1] ?? "on";
    if (name && DOC_TYPE_LABELS.includes(text(match[3]))) boxes.push({ name, value: text(value) });
  }
  return boxes;
}

/**
 * @param {string} html - SearchResults page.
 * @returns {number | null} Portal record count.
 */
export function recordCount(html) {
  const match =
    /_TotalRows"[^>]*>\s*([\d,]+)\s*</.exec(html) ?? /\(\s*([\d,]+)\s+records? found/.exec(html);
  return match ? Number(match[1].replace(/,/g, "")) : /No records found|0 records/i.test(html) ? 0 : null;
}

/**
 * Parse one results page.
 *
 * @param {string} html - SearchResults page.
 * @param {string} capturedAt - ISO timestamp.
 * @returns {Record<string, unknown>[]} Mortgage index records.
 */
export function parseMecklenburgResults(html, capturedAt) {
  const records = [];
  for (const row of html.split(/<tr[\s>]/).slice(1)) {
    if (!/global_id=/.test(row) || !/type=dtl/.test(row)) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 24) continue;
    const date = /(\d{2})\/(\d{2})\/(\d{4})/.exec(text(cells[8]));
    const instrument = text(cells[5]);
    const more = /Other Names Indicator/.test(cells[13] + cells[16]);
    records.push({
      schemaVersion: "elephant.mortgage-index.v1",
      county: "mecklenburg",
      state: "NC",
      requestIdentifier: `mecklenburg-or:${instrument}`,
      instrumentNumber: instrument,
      recordDate: date ? `${date[3]}-${date[1]}-${date[2]}` : null,
      book: text(cells[6]) || null,
      page: text(cells[7]) || null,
      docType: text(cells[9]) || null,
      docTypeCode: text(cells[10]) || null,
      grantors: [text(cells[13]).replace(/\(\+\)$/, "").trim()].filter(Boolean),
      grantees: [text(cells[16]).replace(/\(\+\)$/, "").trim()].filter(Boolean),
      moreParties: more,
      legalDescriptions: [text(cells[18])].filter(Boolean),
      source: {
        vendor: "aumentum-recorder",
        globalId: text(cells[23]) || /global_id=([A-Z0-9]+)/.exec(row)?.[1] || null,
        detailUrl: `${MECKLENBURG_BASE}/RealEstate/SearchResults.aspx?global_id=${/global_id=([A-Z0-9]+)/.exec(row)?.[1]}&type=dtl`,
        capturedAt,
      },
    });
  }
  return records;
}

/**
 * Browser-driven fetcher: the Infragistics search form depends on client-side state that
 * plain HTTP postbacks do not reproduce, so the search runs in real Chrome using the
 * page's own controls, and results pages are parsed from the rendered HTML.
 *
 * @param {{ chromePath: string, headless?: boolean, docTypeLabels?: string[], pageDelayMs?: number, timeoutMs?: number, now?: () => Date }} options
 * @returns {Promise<{ fetchWindow: (from: string, to: string) => Promise<{ records: Record<string, unknown>[], complete: boolean, expected: number | null }>, close: () => Promise<void> }>}
 *   Window fetcher and a close function.
 */
export async function openMecklenburgSession(options) {
  if (options.docTypeLabels?.length) DOC_TYPE_LABELS = [...options.docTypeLabels];
  const { default: puppeteer } = await import("puppeteer-core");
  const timeoutMs = options.timeoutMs ?? 120_000;
  const pageDelayMs = options.pageDelayMs ?? 1_500;
  const now = options.now ?? (() => new Date());
  let browser = null;
  let page = null;

  async function start() {
    if (browser) await browser.close().catch(() => {});
    browser = await puppeteer.launch({
      executablePath: options.chromePath,
      headless: options.headless ?? false,
      args: ["--window-size=1365,900"],
      defaultViewport: { width: 1365, height: 900 },
    });
    page = await browser.newPage();
    page.setDefaultTimeout(timeoutMs);
    await page.goto(`${MECKLENBURG_BASE}/`, { waitUntil: "networkidle2" });
    const accept = await page.$('a[href*="lnkAccept"]');
    if (accept) {
      await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), accept.click()]);
    }
  }

  async function fetchWindow(from, to) {
    if (!browser?.connected || !page || page.isClosed()) await start();
    await page.goto(`${MECKLENBURG_BASE}/RealEstate/SearchEntry.aspx`, { waitUntil: "networkidle2" });
    if (!(await page.$('input[name$="dclDocType$53"]'))) {
      await start();
      await page.goto(`${MECKLENBURG_BASE}/RealEstate/SearchEntry.aspx`, { waitUntil: "networkidle2" });
    }
    const ok = await page.evaluate(
      (fromDay, toDay, labels) => {
        const day = (v) => new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8));
        const controls = /** @type {any} */ (window).ig_controls;
        controls.cphNoMargin_f_ddcDateFiledFrom.set_value(day(fromDay));
        controls.cphNoMargin_f_ddcDateFiledTo.set_value(day(toDay));
        let ticked = 0;
        for (const box of document.querySelectorAll('input[name*="dclDocType"]')) {
          const label = document.querySelector(`label[for="${box.id}"]`)?.textContent?.trim();
          box.checked = labels.includes(label);
          if (box.checked) ticked += 1;
        }
        return ticked;
      },
      from,
      to,
      DOC_TYPE_LABELS,
    );
    if (ok !== DOC_TYPE_LABELS.length) throw new Error(`Mecklenburg doc-type boxes ticked: ${ok}`);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2" }),
      page.click('input[name$="SearchButtons1$btnSearch"]'),
    ]);
    let html = await page.content();
    const expected = recordCount(html);
    if (expected === null) throw new Error("Mecklenburg results page has no record count");
    const capturedAt = now().toISOString();
    const records = parseMecklenburgResults(html, capturedAt);
    const pages = Math.ceil(expected / 20);
    for (let n = 2; n <= pages; n += 1) {
      if (pageDelayMs > 0) await new Promise((r) => setTimeout(r, pageDelayMs));
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2" }),
        page.select('select[name$="OptionsBar1$ItemList"]', String(n)),
      ]);
      html = await page.content();
      records.push(...parseMecklenburgResults(html, capturedAt));
    }
    return { records, complete: true, expected };
  }

  return { fetchWindow, close: async () => browser?.close().catch(() => {}) };
}
