/**
 * Client for Acclaim (Harris Recording Solutions) Official Records portals,
 * used by Clerk/Recorder offices such as Duval County, FL (or.duvalclerk.com).
 *
 * Flow, verified against Duval on 2026-11-26:
 *   1. POST /search/Disclaimer?st=... with `disclaimer=true` (the operator approved
 *      accepting the public-records disclaimer for this scraper).
 *   2. GET  /Details/GetDocumentByInstrumentNumber/<bookType>/<instrument> to bind
 *      the session to the document, then GET /details/JumpToInstrumentNumber/2/<instrument>
 *      for the detail HTML (index facts plus an encrypted transaction item id).
 *   3. GET  /Image/StartImageRetrieval/<itemId>/0, then
 *      GET  /Image/DocumentPdfAllPages/<itemId> for the whole document as a PDF.
 *
 * The PDF is a scanned image (no text layer); extraction needs OCR first.
 *
 * @module src/mortgage/acclaim
 */

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

/**
 * Decode the handful of HTML entities Acclaim emits in detail values.
 *
 * @param {string} value - Raw HTML text.
 * @returns {string} Decoded text.
 */
function decodeEntities(value) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Turn an HTML fragment into its visible lines.
 *
 * @param {string} fragment - HTML fragment.
 * @returns {string[]} Non-empty trimmed lines.
 */
function fragmentLines(fragment) {
  const withoutHidden = fragment.replace(
    /<div class="expandDown"[\s\S]*?<\/div>/g,
    "",
  );
  const spans = [...withoutHidden.matchAll(/<span>([\s\S]*?)<\/span>/g)].map(
    (match) => decodeEntities(match[1]).replace(/\s+/g, " ").trim(),
  );
  if (spans.length > 0) return spans.filter(Boolean);
  const text = decodeEntities(withoutHidden.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return text ? [text] : [];
}

/**
 * Parse a M/D/YYYY (optionally with a time) date into ISO YYYY-MM-DD.
 *
 * @param {string | undefined} value - Acclaim date text.
 * @returns {string | null} ISO date or null.
 */
export function parseAcclaimDate(value) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(value ?? "");
  if (!match) return null;
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/**
 * Parse "$255,000.00" into 255000.
 *
 * @param {string | undefined} value - Currency text.
 * @returns {number | null} Amount or null.
 */
export function parseAcclaimAmount(value) {
  if (!value) return null;
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/**
 * Parse the Acclaim document-detail HTML into index facts.
 *
 * @param {string} html - Body of /details/JumpToInstrumentNumber/...
 * @returns {{
 *   transactionItemId: string,
 *   instrumentNumber: string,
 *   recordDate: string | null,
 *   bookType: string | null,
 *   book: string | null,
 *   page: string | null,
 *   pageCount: number | null,
 *   docTypeCode: string | null,
 *   docType: string | null,
 *   grantors: string[],
 *   grantees: string[],
 *   consideration: number | null,
 *   executionDate: string | null,
 *   legalDescriptions: string[],
 * }} Parsed facts.
 */
export function parseAcclaimDetails(html) {
  const transactionItemId = /id="hdnTransactionItemId"\s+value='([^']+)'/.exec(
    html,
  )?.[1];
  const instrumentNumber = /id="hdnInstrumentNumber"\s+value="([^"]+)"/.exec(
    html,
  )?.[1];
  if (!transactionItemId || !instrumentNumber) {
    throw new Error(
      "Acclaim detail page has no transaction item id or instrument number (session expired, disclaimer not accepted, or instrument not found)",
    );
  }

  /** @type {Map<string, string[]>} */
  const rows = new Map();
  const rowPattern =
    /<div class="detailLabel"[^>]*>((?:(?!<div)[\s\S])*?)<\/div>\s*<div class="(?:formInput|listDocDetails)"[^>]*>([\s\S]*?)<hr/g;
  for (const match of html.matchAll(rowPattern)) {
    const label = decodeEntities(match[1].replace(/<[^>]*>/g, ""))
      .replace(/\s+/g, " ")
      .replace(/:\s*$/, "")
      .trim();
    if (!rows.has(label)) rows.set(label, fragmentLines(match[2]));
  }
  const first = (label) => rows.get(label)?.[0];

  const bookPage = first("Book / Page") ?? "";
  const [book, page] = bookPage.includes("/") ? bookPage.split("/") : [];
  const docTypeText = first("Doc Type") ?? "";
  const docTypeMatch = /^([A-Z0-9]+)\s*-\s*(.+)$/.exec(docTypeText);
  const pageCount = Number.parseInt(first("Number Of Pages") ?? "", 10);

  return {
    transactionItemId,
    instrumentNumber,
    recordDate: parseAcclaimDate(first("Record Date")),
    bookType: (first("Book Type") ?? "").split(/\s*-\s*/)[0] || null,
    book: book?.trim() || null,
    page: page?.trim() || null,
    pageCount: Number.isFinite(pageCount) ? pageCount : null,
    docTypeCode: docTypeMatch?.[1] ?? null,
    docType: docTypeMatch?.[2]?.trim() ?? (docTypeText || null),
    grantors: rows.get("Grantor") ?? [],
    grantees: rows.get("Grantee") ?? [],
    consideration: parseAcclaimAmount(first("Consideration")),
    executionDate: parseAcclaimDate(first("Execution Date")),
    legalDescriptions: rows.get("DocLegals") ?? [],
  };
}

/**
 * Minimal cookie jar: Acclaim keeps the disclaimer acceptance and document
 * binding in ASP.NET session cookies.
 */
export class CookieJar {
  constructor() {
    /** @type {Map<string, string>} */
    this.cookies = new Map();
  }

  /** @param {Headers} headers - Response headers. */
  store(headers) {
    const values =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : [headers.get("set-cookie")].filter(Boolean);
    for (const value of values) {
      const [pair] = value.split(";");
      const index = pair.indexOf("=");
      if (index > 0) {
        this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1));
      }
    }
  }

  /** @returns {string} Cookie header value. */
  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

/**
 * Create an Acclaim session for one portal.
 *
 * @param {{
 *   baseUrl: string,
 *   bookType?: string,
 *   fetchImpl?: typeof fetch,
 *   userAgent?: string,
 *   timeoutMs?: number,
 *   pdfTimeoutMs?: number,
 * }} options - Portal origin and transport.
 * @returns {{
 *   acceptDisclaimer: () => Promise<void>,
 *   fetchDetails: (instrumentNumber: string) => Promise<{ html: string, url: string, facts: ReturnType<typeof parseAcclaimDetails> }>,
 *   fetchDocumentPdf: (transactionItemId: string) => Promise<{ bytes: Uint8Array, url: string }>,
 * }} Session operations.
 */
export function createAcclaimSession(options) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const bookType = options.bookType ?? "OR";
  const fetchImpl = options.fetchImpl ?? fetch;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const pdfTimeoutMs = options.pdfTimeoutMs ?? 300_000;
  const jar = new CookieJar();
  let disclaimerAccepted = false;

  /**
   * @param {string} path - Path under the portal origin.
   * @param {RequestInit & { timeout?: number }} [init] - Request options.
   * @returns {Promise<Response>} Response (redirects not followed).
   */
  async function request(path, init = {}) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(init.timeout ?? timeoutMs),
      headers: {
        "user-agent": userAgent,
        cookie: jar.header(),
        ...(init.headers ?? {}),
      },
    });
    jar.store(response.headers);
    if (response.status >= 400) {
      throw new Error(`Acclaim ${path} returned HTTP ${response.status}`);
    }
    return response;
  }

  async function acceptDisclaimer() {
    const target = "/search/SearchTypeInstrumentNumber";
    const path = `/search/Disclaimer?st=${target}`;
    await (await request(path)).text();
    const response = await request(path, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "disclaimer=true",
    });
    await response.text();
    if (response.status !== 302 && response.status !== 200) {
      throw new Error(`Acclaim disclaimer returned HTTP ${response.status}`);
    }
    disclaimerAccepted = true;
  }

  async function fetchDetails(instrumentNumber) {
    if (!/^\d+$/.test(instrumentNumber)) {
      throw new Error(`Invalid instrument number: ${instrumentNumber}`);
    }
    if (!disclaimerAccepted) await acceptDisclaimer();
    await (
      await request(
        `/Details/GetDocumentByInstrumentNumber/${bookType}/${instrumentNumber}`,
      )
    ).text();
    const path = `/details/JumpToInstrumentNumber/2/${instrumentNumber}`;
    const html = await (await request(path)).text();
    const facts = parseAcclaimDetails(html);
    if (facts.instrumentNumber !== instrumentNumber) {
      throw new Error(
        `Acclaim returned instrument ${facts.instrumentNumber} for ${instrumentNumber}`,
      );
    }
    return {
      html,
      url: `${baseUrl}/Details/GetDocumentByInstrumentNumber/${bookType}/${instrumentNumber}`,
      facts,
    };
  }

  async function fetchDocumentPdf(transactionItemId) {
    const id = encodeURIComponent(transactionItemId);
    await (await request(`/Image/StartImageRetrieval/${id}/0`)).text();
    const path = `/Image/DocumentPdfAllPages/${id}`;
    const response = await request(path, { timeout: pdfTimeoutMs });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const magic = new TextDecoder().decode(bytes.subarray(0, 5));
    if (magic !== "%PDF-") {
      throw new Error(
        `Acclaim ${path} did not return a PDF (content-type ${response.headers.get("content-type")})`,
      );
    }
    return { bytes, url: `${baseUrl}${path}` };
  }

  return { acceptDisclaimer, fetchDetails, fetchDocumentPdf };
}

/**
 * Normalize one Acclaim GridResults row into the mortgage index shape.
 *
 * @param {Record<string, any>} row - GridResults Data entry.
 * @param {{ county: string, state: string, requestIdentifierPrefix: string, baseUrl: string }} profile
 * @param {string} capturedAt - ISO timestamp.
 * @returns {Record<string, unknown>} Mortgage index record.
 */
export function normalizeAcclaimGridRow(row, profile, capturedAt) {
  const date = /^(\d{4})\/(\d{2})\/(\d{2})/.exec(row.RecordDate ?? "");
  const [book, page] = String(row.BookPage ?? "").split("/");
  const instrument = String(row.InstrumentNumber ?? "").trim();
  return {
    schemaVersion: "elephant.mortgage-index.v1",
    county: profile.county,
    state: profile.state,
    requestIdentifier: `${profile.requestIdentifierPrefix}:${instrument}`,
    instrumentNumber: instrument,
    recordDate: date ? `${date[1]}-${date[2]}-${date[3]}` : null,
    book: book?.trim() || null,
    page: page?.trim() || null,
    bookType: row.BookType ?? null,
    pageCount: Number.isInteger(row.NumberOfPages) ? row.NumberOfPages : null,
    docType: row.DocTypeDescription ?? null,
    // The grid shows the first party on each side; the detail page lists all of them.
    grantors: row.DirectName ? [row.DirectName] : [],
    grantees: row.IndirectName ? [row.IndirectName] : [],
    consideration: parseAcclaimAmount(String(row.Consideration ?? "")),
    legalDescriptions: row.DocLegalDescription ? [row.DocLegalDescription] : [],
    source: {
      vendor: "acclaim",
      transactionItemId: row.TransactionItemId ?? null,
      detailUrl: `${profile.baseUrl}/Details/GetDocumentByInstrumentNumber/${row.BookType ?? "OR"}/${instrument}`,
      capturedAt,
    },
  };
}

/**
 * List every mortgage recorded in a window by document type (Acclaim Doc Type search).
 *
 * Verified 2026-11-26 on Duval: POST /search/SearchTypeDocType with DocTypes=<ids> and
 * the record-date range, then POST /Search/GridResults (Kendo JSON {Data, Total}). Too
 * large a range returns "exceeded the maximum limit" while the grid still serves the
 * previous search, so that message (or any row outside the window) marks the window
 * truncated and it is split.
 *
 * @param {{ baseUrl: string, docTypeIds: readonly (string | number)[], profile: { county: string, state: string, requestIdentifierPrefix: string, baseUrl: string }, fetchImpl?: typeof fetch, now?: () => Date }} options
 * @returns {(from: string, to: string) => Promise<{ records: Record<string, unknown>[], complete: boolean, expected: number | null }>}
 *   Window fetcher for the shared windowed harvest.
 */
export function acclaimDocTypeFetcher(options) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const jar = new CookieJar();
  let accepted = false;
  const call = async (path, body) => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(180_000),
      headers: {
        "user-agent": DEFAULT_USER_AGENT,
        cookie: jar.header(),
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
      },
      body,
    });
    jar.store(response.headers);
    if (response.status >= 400) throw new Error(`Acclaim ${path} returned HTTP ${response.status}`);
    return response;
  };
  const us = (d) => `${d.slice(4, 6)}/${d.slice(6, 8)}/${d.slice(0, 4)}`;
  return async (from, to) => {
    if (!accepted) {
      await call("/search/Disclaimer?st=/search/SearchTypeDocType", "disclaimer=true");
      accepted = true;
    }
    const search = await call(
      "/search/SearchTypeDocType?Length=6",
      new URLSearchParams({
        DocTypes: options.docTypeIds.join(","),
        DocTypesDisplay_input: "",
        DocTypesDisplay: "",
        DateRangeList: " ",
        RecordDateFrom: us(from),
        RecordDateTo: us(to),
        "X-Requested-With": "XMLHttpRequest",
      }).toString(),
    );
    const html = await search.text();
    if (/exceeded the maximum limit/i.test(html)) return { records: [], complete: false, expected: null };
    if (/Disclaimer/i.test(search.headers.get("location") ?? "")) {
      accepted = false;
      throw new Error("Acclaim session lost the disclaimer");
    }
    const grid = await call("/Search/GridResults", "page=1&pageSize=5000&sort=&group=&filter=");
    const body = await grid.json();
    const rows = Array.isArray(body.Data) ? body.Data : [];
    const lo = `${from.slice(0, 4)}/${from.slice(4, 6)}/${from.slice(6, 8)}`;
    const hi = `${to.slice(0, 4)}/${to.slice(4, 6)}/${to.slice(6, 8)}`;
    if (rows.some((row) => String(row.RecordDate).slice(0, 10) < lo || String(row.RecordDate).slice(0, 10) > hi)) {
      // The grid still holds an earlier search: never save it as this window.
      return { records: [], complete: false, expected: null };
    }
    if (rows.length < Number(body.Total)) return { records: [], complete: false, expected: null };
    const capturedAt = now().toISOString();
    return {
      records: rows.map((row) => normalizeAcclaimGridRow(row, options.profile, capturedAt)),
      complete: true,
      expected: Number.isFinite(Number(body.Total)) ? Number(body.Total) : null,
    };
  };
}
