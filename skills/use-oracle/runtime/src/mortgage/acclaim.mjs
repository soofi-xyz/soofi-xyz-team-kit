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
class CookieJar {
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
