/**
 * Mortgage (Deed of Trust) index harvest for Neumo / Kofile "publicsearch.us"
 * county clerk portals (Texas: Bexar, Collin, Dallas, Denton, Tarrant, ...).
 *
 * Verified 2026-11-26 in a real browser:
 *   - The site sits behind a Cloudflare non-interactive JS check; plain HTTP gets 403.
 *   - All search data travels over a same-origin WebSocket (`wss://<host>/ws`) as
 *     `@kofile/FETCH_DOCUMENTS/v4` requests and `@kofile/FETCH_DOCUMENTS_FULFILLED/v6`
 *     responses. The response carries, per document: docTypeCode (`DT` = Deed of Trust),
 *     parties, legals (lot/block/subdivision), page count, image ids and an OCR snippet.
 *   - An advanced search by `docTypes=DT` and `recordedDateRange` lists every Deed of
 *     Trust in the window (week of 2026-11-10: Dallas 537, Tarrant 642, Collin 393,
 *     Denton 361, Bexar 648).
 *
 * The runner opens the county site in real Chrome (the approved browser profile in
 * skills/use-oracle/reference/source-access.md: no challenge solving, no spoofing),
 * drives the site's own search one recorded day at a time, and reads results from the
 * WebSocket frames through the DevTools protocol. A day is ready only when the rows
 * written equal the portal's own `numRecords` for that day (fail closed).
 *
 * @module src/mortgage/publicsearch
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { atomicWriteJson, readJson } from "../permits/storage.mjs";
import { sha256Hex } from "./ipfs-pin.mjs";

export const PUBLICSEARCH_INDEX_SCHEMA = "elephant.mortgage-index.v1";
const FULFILLED = "@kofile/FETCH_DOCUMENTS_FULFILLED/";
const REQUEST = "@kofile/FETCH_DOCUMENTS/";
const REJECTED = "@kofile/FETCH_DOCUMENTS_REJECTED/";
/** The portal rejects any offset >= 10,000 ("Error with search query"). */
export const MAX_WINDOW_RECORDS = 10_000;

/**
 * @param {string} yyyymmdd - Date as YYYYMMDD.
 * @returns {Date} UTC date.
 */
function parseDay(yyyymmdd) {
  if (!/^\d{8}$/.test(yyyymmdd)) throw new Error(`Invalid date ${yyyymmdd}; expected YYYYMMDD`);
  const date = new Date(
    Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8)),
  );
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date ${yyyymmdd}`);
  return date;
}

/**
 * List recorded days from `from` to `to`, inclusive.
 *
 * @param {string} from - YYYYMMDD.
 * @param {string} to - YYYYMMDD.
 * @returns {string[]} Days as YYYYMMDD.
 */
export function listDays(from, to) {
  const start = parseDay(from);
  const end = parseDay(to);
  if (end < start) throw new Error(`--to ${to} is before --from ${from}`);
  const days = [];
  for (let day = start; day <= end; day = new Date(day.getTime() + 86_400_000)) {
    days.push(day.toISOString().slice(0, 10).replace(/-/g, ""));
  }
  return days;
}

/**
 * Build the in-app results path for one page of Deeds of Trust in a recorded-date window.
 *
 * @param {{ from: string, to: string, docTypes: readonly string[], offset: number, limit: number }} query
 * @returns {string} Path with query string.
 */
export function buildResultsPath(query) {
  const params = new URLSearchParams({
    department: "RP",
    docTypes: query.docTypes.join(","),
    recordedDateRange: `${query.from},${query.to}`,
    searchType: "advancedSearch",
    limit: String(query.limit),
    offset: String(query.offset),
  });
  return `/results?${params.toString()}`;
}

/**
 * Split [from, to] into two halves by day; a single day cannot be split.
 *
 * @param {string} from - YYYYMMDD.
 * @param {string} to - YYYYMMDD.
 * @returns {[string, string][] | null} Two windows, or null for a single day.
 */
export function splitWindow(from, to) {
  const days = listDays(from, to);
  if (days.length < 2) return null;
  const middle = Math.floor(days.length / 2);
  return [
    [days[0], days[middle - 1]],
    [days[middle], days[days.length - 1]],
  ];
}

/**
 * Plan initial windows from the portal's per-year counts: one window per year with
 * hits, or one per month when the year alone exceeds the offset cap.
 *
 * @param {{ label: string, hits: number }[]} yearStats - `meta.statistics["recorded-years"]`.
 * @param {string} from - YYYYMMDD lower bound.
 * @param {string} to - YYYYMMDD upper bound.
 * @param {number} [cap] - Records a window may hold.
 * @returns {[string, string][]} Windows in date order.
 */
export function planWindows(yearStats, from, to, cap = MAX_WINDOW_RECORDS) {
  const windows = [];
  const years = yearStats
    .filter((stat) => /^\d{4}$/.test(stat.label) && stat.hits > 0)
    .map((stat) => ({ year: Number(stat.label), hits: stat.hits }))
    .sort((a, b) => a.year - b.year);
  const clamp = (a, b) => {
    const lo = a < from ? from : a;
    const hi = b > to ? to : b;
    return lo <= hi ? [lo, hi] : null;
  };
  for (const { year, hits } of years) {
    if (hits < cap) {
      const window = clamp(`${year}0101`, `${year}1231`);
      if (window) windows.push(window);
      continue;
    }
    for (let month = 1; month <= 12; month += 1) {
      const mm = String(month).padStart(2, "0");
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const window = clamp(`${year}${mm}01`, `${year}${mm}${String(last).padStart(2, "0")}`);
      if (window) windows.push(window);
    }
  }
  return windows;
}

/**
 * @param {string | undefined} value - M/D/YYYY.
 * @returns {string | null} ISO date.
 */
function isoDate(value) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((value ?? "").trim());
  if (!match) return null;
  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

/**
 * @param {string | undefined} value - "$1,234.00".
 * @returns {number | null} Amount, or null for blank/zero (Texas indexes $0.00).
 */
function amount(value) {
  const cleaned = (value ?? "").replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const number = Number(cleaned);
  return number > 0 ? number : null;
}

/**
 * Pull a loan number and a principal amount out of the OCR snippet when present.
 *
 * @param {string | undefined} text - OCR text.
 * @returns {{ loanNumber: string | null, principalAmount: number | null }} Hints.
 */
export function ocrHints(text) {
  const source = text ?? "";
  const loanNumber = /Loan\s*(?:Number|No\.?|#)\s*:?\s*([A-Z0-9-]{5,})/i.exec(source)?.[1] ?? null;
  const principal = /(?:principal (?:sum|amount) of|Dollars \(U\.S\. \$)\s*\$?\s*([\d,]+\.\d{2})/i.exec(
    source,
  )?.[1];
  return { loanNumber, principalAmount: principal ? Number(principal.replace(/,/g, "")) : null };
}

/**
 * Normalize one publicsearch document into the mortgage index shape.
 *
 * @param {Record<string, any>} doc - Entry of `payload.data.byHash`.
 * @param {{ county: string, state: string, host: string, requestIdentifierPrefix: string }} profile
 * @param {string} capturedAt - ISO timestamp.
 * @returns {Record<string, unknown>} Index record.
 */
export function normalizePublicsearchDocument(doc, profile, capturedAt) {
  const parties = Array.isArray(doc.parties) ? doc.parties : [];
  const names = (type) =>
    parties.filter((party) => party.type === type && party.name).map((party) => party.name);
  const legals = (Array.isArray(doc.legals) ? doc.legals : []).filter((legal) => legal.description);
  const instrument = String(doc.documentNumber ?? doc.instrumentNumber ?? "").trim();
  const [book, volume, page] = String(doc.bookVolumePage ?? "")
    .split("/")
    .map((part) => (part && part !== "--" ? part : null));
  const hints = ocrHints(doc.ocrText);
  return {
    schemaVersion: PUBLICSEARCH_INDEX_SCHEMA,
    county: profile.county,
    state: profile.state,
    requestIdentifier: `${profile.requestIdentifierPrefix}:${instrument}`,
    instrumentNumber: instrument,
    recordDate: isoDate(doc.recordedDate),
    recordTime: doc.recordedTime ?? null,
    instrumentDate: isoDate(doc.instrumentDate),
    book: book ?? null,
    volume: volume ?? null,
    page: page ?? null,
    pageCount: Number.isInteger(doc.pageCount) ? doc.pageCount : null,
    docTypeCode: doc.docTypeCode ?? null,
    docType: doc.docType ?? null,
    grantors: names("grantor"),
    grantees: names("grantee"),
    consideration: amount(doc.consideration),
    loanNumber: hints.loanNumber,
    principalAmountHint: hints.principalAmount,
    legalDescriptions: legals.map((legal) => legal.description),
    legals: legals.map((legal) => ({
      type: legal.legalType ?? null,
      subdivision: legal.developmentName ?? null,
      lot: legal.lot ?? null,
      block: legal.block ?? null,
      township: legal.township ?? null,
    })),
    source: {
      vendor: "publicsearch",
      docId: doc.docId ?? doc.id ?? null,
      imageId: doc.imageId ?? null,
      detailUrl: `https://${profile.host}/doc/${doc.docId ?? doc.id}`,
      capturedAt,
    },
  };
}

/**
 * Parse a FETCH_DOCUMENTS_FULFILLED frame.
 *
 * @param {string} frame - WebSocket text frame.
 * @returns {{ correlationId: string | null, numRecords: number, yearStats: { label: string, hits: number }[], docs: Record<string, any>[] } | null}
 *   Parsed result, or null when the frame is not a fulfilled search.
 */
export function parseFulfilledFrame(frame) {
  let message;
  try {
    message = JSON.parse(frame);
  } catch {
    return null;
  }
  if (typeof message?.type !== "string" || !message.type.startsWith(FULFILLED)) return null;
  const data = message.payload?.data ?? {};
  const order = Array.isArray(data.byOrder) ? data.byOrder : [];
  const byHash = data.byHash ?? {};
  const meta = message.payload?.meta ?? data.meta ?? {};
  return {
    correlationId: message.correlationId ?? null,
    numRecords: Number(meta.numRecords ?? NaN),
    yearStats: Array.isArray(meta.statistics?.["recorded-years"])
      ? meta.statistics["recorded-years"]
      : [],
    docs: order.map((id) => byHash[id]).filter(Boolean),
  };
}

/**
 * Parse a FETCH_DOCUMENTS_REJECTED frame.
 *
 * @param {string} frame - WebSocket text frame.
 * @returns {{ correlationId: string | null, error: string } | null} Rejection.
 */
export function parseRejectedFrame(frame) {
  let message;
  try {
    message = JSON.parse(frame);
  } catch {
    return null;
  }
  if (typeof message?.type !== "string" || !message.type.startsWith(REJECTED)) return null;
  return {
    correlationId: message.correlationId ?? null,
    error: String(message.payload?.errors ?? "search rejected"),
  };
}

/**
 * Parse a FETCH_DOCUMENTS request frame.
 *
 * @param {string} frame - WebSocket text frame.
 * @returns {{ correlationId: string, query: Record<string, string> } | null} Request.
 */
export function parseRequestFrame(frame) {
  let message;
  try {
    message = JSON.parse(frame);
  } catch {
    return null;
  }
  if (typeof message?.type !== "string" || !message.type.startsWith(REQUEST)) return null;
  return { correlationId: message.correlationId, query: message.payload?.query ?? {} };
}

/**
 * Open a county portal in Chrome and return a function that runs one results page.
 *
 * @param {{ host: string, chromePath: string, headless?: boolean, timeoutMs?: number }} options
 * @returns {Promise<{ runQuery: (pathWithQuery: string, expect: { from: string, to: string, offset: number }) => Promise<{ numRecords: number, yearStats: { label: string, hits: number }[], docs: Record<string, any>[] }>, reset: () => Promise<void>, close: () => Promise<void> }>}
 *   Browser-backed query runner.
 */
export async function openPublicsearchSession(options) {
  const { default: puppeteer } = await import("puppeteer-core");
  const timeoutMs = options.timeoutMs ?? 60_000;
  const launch = () =>
    puppeteer.launch({
      executablePath: options.chromePath,
      headless: options.headless ?? false,
      args: ["--window-size=1365,900"],
      defaultViewport: { width: 1365, height: 900 },
    });
  let browser = await launch();
  /** @type {Map<string, Record<string, string>>} */
  const requests = new Map();
  /** @type {Array<(frame: string) => void>} */
  const listeners = [];

  let page = null;
  let cdp = null;
  /**
   * Open (or reopen) the portal page and wire the WebSocket listeners. Called on start
   * and whenever the page reloaded itself (Cloudflare re-check) or a search hung.
   */
  async function reset() {
    if (page) await page.close().catch(() => {});
    requests.clear();
    if (!browser.connected) {
      // Chrome itself went away (crashed or was closed): start a new one.
      await browser.close().catch(() => {});
      browser = await launch();
    }
    page = await browser.newPage();
    page.setDefaultTimeout(timeoutMs);
    cdp = await page.createCDPSession();
    await cdp.send("Network.enable");
    cdp.on("Network.webSocketFrameSent", (event) => {
      const request = parseRequestFrame(event.response.payloadData);
      if (request) requests.set(request.correlationId, request.query);
    });
    cdp.on("Network.webSocketFrameReceived", (event) => {
      for (const listener of [...listeners]) listener(event.response.payloadData);
    });
    await page.goto(`https://${options.host}/`, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => Boolean(globalThis.socket), { timeout: timeoutMs });
  }
  await reset();

  async function runQuery(pathWithQuery, expect) {
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.splice(listeners.indexOf(listener), 1);
        reject(new Error(`No search response for ${pathWithQuery} within ${timeoutMs} ms`));
      }, timeoutMs);
      const matches = (correlationId) => {
        const query = requests.get(correlationId ?? "");
        return (
          query &&
          query.recordedDateRange === `${expect.from},${expect.to}` &&
          String(query.offset ?? "0") === String(expect.offset)
        );
      };
      const listener = (frame) => {
        const rejected = parseRejectedFrame(frame);
        if (rejected && matches(rejected.correlationId)) {
          clearTimeout(timer);
          listeners.splice(listeners.indexOf(listener), 1);
          reject(new Error(`Portal rejected ${pathWithQuery}: ${rejected.error}`));
          return;
        }
        const parsed = parseFulfilledFrame(frame);
        if (!parsed || !matches(parsed.correlationId)) return;
        clearTimeout(timer);
        listeners.splice(listeners.indexOf(listener), 1);
        resolve(parsed);
      };
      listeners.push(listener);
    });
    try {
      await page.evaluate((target) => {
        history.pushState({}, "", target);
        dispatchEvent(new PopStateEvent("popstate"));
      }, pathWithQuery);
    } catch (error) {
      result.catch(() => {});
      throw error;
    }
    return result;
  }

  return { runQuery, reset, close: () => browser.close().catch(() => {}) };
}

/**
 * Harvest every Deed of Trust recorded in [from, to] for one publicsearch county.
 *
 * A first one-row search reads the portal's per-year counts; the range is then cut into
 * windows (a year, or months for busy years) and any window over the 10,000-offset cap
 * is halved until it fits. Each window is written as
 * `<output>/<county>/<jobId>/windows/<from>-<to>.jsonl` with a ready marker whose row
 * count equals the portal's numRecords (fail closed), and is skipped on resume.
 *
 * @param {{
 *   profile: { county: string, state: string, host: string, requestIdentifierPrefix: string, mortgageDocTypeCodes: readonly string[] },
 *   jobId: string,
 *   from: string,
 *   to: string,
 *   outputDir: string,
 *   pageSize?: number,
 *   delayMs?: number,
 *   windowCap?: number,
 *   attempts?: number,
 *   session: { reset?: () => Promise<void>, runQuery: (pathWithQuery: string, expect: { from: string, to: string, offset: number }) => Promise<{ numRecords: number, yearStats?: { label: string, hits: number }[], docs: Record<string, any>[] }> },
 *   now?: () => Date,
 *   onProgress?: (event: Record<string, unknown>) => void,
 * }} input - Run inputs.
 * @returns {Promise<{ manifestPath: string, portalTotal: number, windows: number, readyWindows: number, failedWindows: number, records: number }>}
 *   Summary.
 */
export async function harvestPublicsearchMortgages(input) {
  if (!/^[A-Za-z0-9_.-]+$/.test(input.jobId)) throw new Error(`Invalid job id: ${input.jobId}`);
  listDays(input.from, input.from);
  listDays(input.to, input.to);
  if (input.to < input.from) throw new Error(`--to ${input.to} is before --from ${input.from}`);
  const now = input.now ?? (() => new Date());
  const pageSize = input.pageSize ?? 250;
  const delayMs = input.delayMs ?? 1_500;
  const cap = input.windowCap ?? MAX_WINDOW_RECORDS;
  const { profile } = input;
  const docTypes = profile.mortgageDocTypeCodes;
  const runDir = path.join(input.outputDir, profile.county, input.jobId);
  const windowsDir = path.join(runDir, "windows");
  await mkdir(windowsDir, { recursive: true });

  const attempts = input.attempts ?? 4;
  let requested = 0;
  const query = async (from, to, offset, limit) => {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (requested > 0 && delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs * attempt));
      }
      requested += 1;
      try {
        const result = await input.session.runQuery(
          buildResultsPath({ from, to, docTypes, offset, limit }),
          { from, to, offset },
        );
        if (!Number.isFinite(result.numRecords)) {
          throw new Error(`Portal returned no record count for ${from}-${to} offset ${offset}`);
        }
        return result;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        // A rejected query (e.g. past the offset cap) will not succeed on retry.
        if (/Portal rejected/.test(message)) throw error;
        input.onProgress?.({ event: "publicsearch_retry", window: `${from}-${to}`, offset, attempt, error: message });
        if (attempt < attempts && input.session.reset) {
          await input.session.reset().catch((resetError) =>
            input.onProgress?.({ event: "publicsearch_reset_failed", error: String(resetError) }),
          );
        }
      }
    }
    throw lastError;
  };

  const overview = await query(input.from, input.to, 0, 1);
  const portalTotal = overview.numRecords;
  const pending = planWindows(overview.yearStats ?? [], input.from, input.to, cap);
  if (pending.length === 0 && portalTotal > 0) pending.push([input.from, input.to]);
  input.onProgress?.({
    event: "publicsearch_plan",
    county: profile.county,
    portalTotal,
    windows: pending.length,
  });

  let windows = 0;
  let readyWindows = 0;
  let failedWindows = 0;
  let records = 0;

  while (pending.length > 0) {
    const [from, to] = pending.shift();
    const key = `${from}-${to}`;
    const dataPath = path.join(windowsDir, `${key}.jsonl`);
    const readyPath = path.join(windowsDir, `${key}.ready.json`);
    try {
      const ready = await readJson(readyPath);
      if (sha256Hex(await readFile(dataPath)) === ready.sha256) {
        windows += 1;
        readyWindows += 1;
        records += ready.rows;
        input.onProgress?.({ event: "publicsearch_window_skip", window: key, rows: ready.rows });
        continue;
      }
    } catch {
      // not ready yet
    }

    try {
      const first = await query(from, to, 0, pageSize);
      if (first.numRecords >= cap) {
        const halves = splitWindow(from, to);
        if (!halves) {
          throw new Error(`Day ${from} holds ${first.numRecords} records, over the ${cap} offset cap`);
        }
        pending.unshift(...halves);
        input.onProgress?.({ event: "publicsearch_window_split", window: key, numRecords: first.numRecords });
        continue;
      }
      windows += 1;
      const numRecords = first.numRecords;
      /** @type {Map<string, Record<string, unknown>>} */
      const rows = new Map();
      const take = (docs) => {
        const capturedAt = now().toISOString();
        for (const doc of docs) {
          if (!docTypes.includes(doc.docTypeCode)) continue;
          const record = normalizePublicsearchDocument(doc, profile, capturedAt);
          // Older records can share a document number; the portal docId is unique.
          rows.set(String(record.source.docId ?? record.instrumentNumber), record);
        }
      };
      take(first.docs);
      for (let offset = pageSize; offset < numRecords; offset += pageSize) {
        const page = await query(from, to, offset, pageSize);
        take(page.docs);
        if (page.docs.length < pageSize) break;
      }
      if (rows.size !== numRecords) {
        throw new Error(`Window ${key}: wrote ${rows.size} rows but the portal reports ${numRecords}`);
      }
      const body = [...rows.values()].map((row) => JSON.stringify(row)).join("\n") + (rows.size ? "\n" : "");
      await writeFile(`${dataPath}.tmp`, body);
      await rename(`${dataPath}.tmp`, dataPath);
      await atomicWriteJson(readyPath, {
        county: profile.county,
        from,
        to,
        rows: rows.size,
        portalNumRecords: numRecords,
        sha256: sha256Hex(Buffer.from(body)),
        readyAt: now().toISOString(),
      });
      readyWindows += 1;
      records += rows.size;
      input.onProgress?.({ event: "publicsearch_window_ready", county: profile.county, window: key, rows: rows.size, records });
    } catch (error) {
      windows += 1;
      failedWindows += 1;
      const message = error instanceof Error ? error.message : String(error);
      await atomicWriteJson(path.join(windowsDir, `${key}.failed.json`), {
        from,
        to,
        error: message,
        failedAt: now().toISOString(),
      });
      input.onProgress?.({ event: "publicsearch_window_failed", county: profile.county, window: key, error: message });
    }
  }

  const manifestPath = path.join(runDir, "manifest.json");
  await atomicWriteJson(manifestPath, {
    county: profile.county,
    jobId: input.jobId,
    from: input.from,
    to: input.to,
    portalTotal,
    windows,
    readyWindows,
    failedWindows,
    records,
    complete: failedWindows === 0 && records === portalTotal,
    completedAt: now().toISOString(),
  });
  return { manifestPath, portalTotal, windows, readyWindows, failedWindows, records };
}
