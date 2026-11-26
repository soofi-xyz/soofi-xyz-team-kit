/**
 * Harris County, TX County Clerk real property deed-of-trust index.
 *
 * Verified 2026-11-26 (search needs no login or disclaimer):
 *   1. GET  /applications/websearch/RP.aspx  -> cookies + ASP.NET hidden fields
 *   2. POST the form with txtFrom/txtTo (MM/DD/YYYY), txtInstrument=D/T, btnSearch
 *      -> 302 to RP_R.aspx?ID=<token>, 200 rows per page
 *   3. POST back to RP_R.aspx?ID=... with all hidden inputs + BtnNext=Next until a
 *      page has fewer than 200 rows.
 * Rows carry file number, file date, type, vol/page, page count, film code, grantor /
 * grantee / trustee names and the legal description. Multi-day ranges can show "too
 * many records"; single-day windows do not.
 *
 * @module src/mortgage/harris
 */

import { CookieJar } from "./acclaim.mjs";

export const HARRIS_BASE = "https://www.cclerk.hctx.net/applications/websearch";
const P = "ctl00$ContentPlaceHolder1$";
const TEXT_FIELDS = [
  "txtFileNo", "txtFilmCd", "txtOR", "txtEE", "txtNameTee", "txtDesc", "txtVolNo", "txtPageNo",
  "txtSection", "txtLot", "txtBlock", "txtUnit", "txtAbstract", "txtOutLot", "txtTract",
  "txtReserve", "txtComment",
];
const TOO_MANY = /returned too many records/i;

/**
 * @param {string} value - HTML text.
 * @returns {string} Decoded, trimmed text.
 */
function text(value) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Collect every non-button input of a WebForms page.
 *
 * @param {string} html - Page HTML.
 * @returns {Record<string, string>} name -> value.
 */
export function formInputs(html) {
  /** @type {Record<string, string>} */
  const fields = {};
  for (const match of html.matchAll(/<input[^>]*>/g)) {
    const tag = match[0];
    const name = /name="([^"]+)"/.exec(tag)?.[1];
    if (!name) continue;
    const type = /type="([^"]+)"/.exec(tag)?.[1] ?? "text";
    if (["submit", "image", "button"].includes(type)) continue;
    // A browser posts only the selected radio option and ticked checkboxes.
    if ((type === "radio" || type === "checkbox") && !/\bchecked\b/.test(tag)) continue;
    fields[name] = text(/value="([^"]*)"/.exec(tag)?.[1] ?? (type === "checkbox" ? "on" : ""));
  }
  for (const match of html.matchAll(/<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const options = [...match[2].matchAll(/<option([^>]*)>/g)].map((m) => m[1]);
    const chosen = options.find((attrs) => /\bselected\b/.test(attrs)) ?? options[0];
    fields[match[1]] = text(/value="([^"]*)"/.exec(chosen ?? "")?.[1] ?? "");
  }
  return fields;
}

/**
 * @param {string} yyyymmdd - YYYYMMDD.
 * @returns {string} MM/DD/YYYY.
 */
const us = (yyyymmdd) => `${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(6, 8)}/${yyyymmdd.slice(0, 4)}`;

/**
 * Parse the rows of one RP_R.aspx results page.
 *
 * @param {string} html - Results page.
 * @param {string} capturedAt - ISO timestamp.
 * @returns {Record<string, unknown>[]} Mortgage index records.
 */
export function parseHarrisResults(html, capturedAt) {
  const starts = [...html.matchAll(/ListView1_ctrl(\d+)_lblFileNo"/g)];
  const records = [];
  for (let i = 0; i < starts.length; i += 1) {
    const segment = html.slice(starts[i].index, starts[i + 1]?.index ?? html.length);
    const span = (id) => {
      const match = new RegExp(`_${id}"[^>]*>([\\s\\S]*?)</`).exec(segment);
      return match ? text(match[1]) : "";
    };
    const fileNo = span("lblFileNo");
    const parties = { Grantor: [], Grantee: [], Trustee: [] };
    for (const m of segment.matchAll(/<b>(Grantor|Grantee|Trustee)<\/b>:[\s\S]*?_lblNames">([^<]*)</g)) {
      parties[m[1]].push(text(m[2]));
    }
    const fileDate = /(\d{2})\/(\d{2})\/(\d{4})/.exec(span("lblFileDate"));
    const legal = {
      subdivision: span("lblSubDivAdd") || null,
      section: span("lblSection") || null,
      lot: span("lblLot") || null,
      block: span("lblBlock") || null,
      unit: span("lblUnit") || null,
      abstract: span("lblAbstract") || null,
      tract: span("lblTract") || null,
      reserve: span("lblReserve") || null,
      misc: span("lblMisc") || null,
      comment: span("lblComment") || null,
    };
    const docType = text(/lnkdetailtest"[^>]*>([^<]*)</.exec(segment)?.[1] ?? "");
    const pages = Number.parseInt(span("lblPgs"), 10);
    const film = /hfFilmCode"[^>]*value="([^"]*)"/.exec(segment)?.[1] ?? null;
    records.push({
      schemaVersion: "elephant.mortgage-index.v1",
      county: "harris",
      state: "TX",
      requestIdentifier: `harris-or:${fileNo}`,
      instrumentNumber: fileNo,
      recordDate: fileDate ? `${fileDate[3]}-${fileDate[1]}-${fileDate[2]}` : null,
      volume: span("lblVolNo") || null,
      page: span("lblPageNo") || null,
      pageCount: Number.isFinite(pages) ? pages : null,
      docTypeCode: docType || null,
      docType: docType === "D/T" ? "DEED OF TRUST" : docType || null,
      grantors: parties.Grantor,
      grantees: parties.Grantee,
      trustees: parties.Trustee,
      legalDescriptions: [
        [legal.subdivision, legal.section && `Sec: ${legal.section}`, legal.lot && `Lot: ${legal.lot}`, legal.block && `Block: ${legal.block}`, legal.unit && `Unit: ${legal.unit}`, legal.abstract && `Abstract: ${legal.abstract}`, legal.tract && `Tract: ${legal.tract}`, legal.reserve && `Reserve: ${legal.reserve}`]
          .filter(Boolean)
          .join(" "),
      ].filter(Boolean),
      legals: [legal],
      source: { vendor: "harris-cclerk-rp", filmCode: film || null, capturedAt },
    });
  }
  return records;
}

/**
 * @param {{ fetchImpl?: typeof fetch, pageDelayMs?: number, timeoutMs?: number, now?: () => Date }} [options]
 * @returns {(from: string, to: string) => Promise<{ records: Record<string, unknown>[], complete: boolean, expected: null }>}
 *   Window fetcher for the shared windowed harvest.
 */
export function harrisFetcher(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pageDelayMs = options.pageDelayMs ?? 1_500;
  const now = options.now ?? (() => new Date());
  return async (from, to) => {
    const jar = new CookieJar();
    const request = async (url, init = {}) => {
      const response = await fetchImpl(url, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
        headers: { "user-agent": "Mozilla/5.0", cookie: jar.header(), ...(init.headers ?? {}) },
      });
      jar.store(response.headers);
      if (response.status >= 400) throw new Error(`Harris ${url} returned HTTP ${response.status}`);
      return response;
    };
    const post = (url, fields) =>
      request(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
      });

    const searchUrl = `${HARRIS_BASE}/RP.aspx`;
    const form = formInputs(await (await request(searchUrl)).text());
    for (const field of TEXT_FIELDS) form[P + field] = "";
    Object.assign(form, {
      __EVENTTARGET: "",
      __EVENTARGUMENT: "",
      [`${P}txtFrom`]: us(from),
      [`${P}txtTo`]: us(to),
      [`${P}txtInstrument`]: "D/T",
      [`${P}btnSearch`]: "Search",
    });
    const searched = await post(searchUrl, form);
    const location = searched.headers.get("location");
    let html;
    let resultsUrl;
    if (location) {
      resultsUrl = new URL(location, searchUrl).toString();
      html = await (await request(resultsUrl)).text();
    } else {
      html = await searched.text();
      if (!/lblFileNo/.test(html)) return { records: [], complete: !TOO_MANY.test(html), expected: null };
      resultsUrl = searchUrl;
    }
    const multiDay = from !== to;
    if (multiDay && TOO_MANY.test(html)) return { records: [], complete: false, expected: null };

    const capturedAt = now().toISOString();
    const records = parseHarrisResults(html, capturedAt);
    let page = records.length;
    while (page >= 200) {
      if (pageDelayMs > 0) await new Promise((r) => setTimeout(r, pageDelayMs));
      const fields = { ...formInputs(html), __EVENTTARGET: "", __EVENTARGUMENT: "", [`${P}BtnNext`]: "Next" };
      const next = await post(resultsUrl, fields);
      const nextLocation = next.headers.get("location");
      html = nextLocation ? await (await request(new URL(nextLocation, resultsUrl).toString())).text() : await next.text();
      const rows = parseHarrisResults(html, capturedAt);
      records.push(...rows);
      page = rows.length;
    }
    return { records, complete: true, expected: null };
  };
}
