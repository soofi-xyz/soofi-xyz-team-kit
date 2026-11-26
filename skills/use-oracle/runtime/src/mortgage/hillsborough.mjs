/**
 * Hillsborough County, FL Clerk Official Records mortgage index.
 *
 * Verified 2026-11-26: an open JSON search (no disclaimer, login or bot check)
 *   POST https://publicaccess.hillsclerk.com/Public/ORIUtilities/DocumentSearch/api/Search
 *   {"DocType":[...],"RecordDateBegin":"MM/DD/YYYY","RecordDateEnd":"MM/DD/YYYY"}
 * returns the whole result set in one response ({Success, Truncated, ResultList[]}),
 * back to 1964-08-26. A non-null `Truncated`, or a response cut mid-JSON on large
 * ranges, means the window must be split.
 *
 * @module src/mortgage/hillsborough
 */

export const HILLSBOROUGH_SEARCH_URL =
  "https://publicaccess.hillsclerk.com/Public/ORIUtilities/DocumentSearch/api/Search";

/** Mortgage-family document types, exactly as the clerk's keyword list spells them. */
export const HILLSBOROUGH_MORTGAGE_DOC_TYPES = Object.freeze([
  "(MTG) MORTGAGE",
  "(MTGNDOC) MORTGAGE NO DOC STAMPS",
  "(MTGNT) MORTGAGE EXEMPT TAXES",
  "(MTGNIT) MORTGAGE NO INTANGIBLE TAXES",
  "(MTGREV) MORTGAGE REVERSE",
]);

/**
 * @param {string} yyyymmdd - YYYYMMDD.
 * @returns {string} MM/DD/YYYY.
 */
export function usDate(yyyymmdd) {
  return `${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(6, 8)}/${yyyymmdd.slice(0, 4)}`;
}

/**
 * @param {number | null | undefined} seconds - Unix seconds.
 * @returns {string | null} ISO date in the county's time zone.
 */
function easternDate(seconds) {
  if (!Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * @param {Record<string, any>} row - ResultList entry.
 * @param {string} capturedAt - ISO timestamp.
 * @returns {Record<string, unknown>} Mortgage index record.
 */
export function normalizeHillsboroughRow(row, capturedAt) {
  const code = /^\(([A-Z0-9]+)\)\s*(.*)$/.exec(row.DocType ?? "");
  const instrument = String(row.Instrument);
  return {
    schemaVersion: "elephant.mortgage-index.v1",
    county: "hillsborough",
    state: "FL",
    requestIdentifier: `hillsborough-or:${instrument}`,
    instrumentNumber: instrument,
    recordDate: easternDate(row.RecordDate),
    book: row.BookNum != null ? String(row.BookNum) : null,
    page: row.PageNum != null ? String(row.PageNum) : null,
    bookType: row.BookType ?? null,
    pageCount: Number.isInteger(row.PageCount) ? row.PageCount : null,
    docTypeCode: code?.[1] ?? null,
    docType: code?.[2] ?? row.DocType ?? null,
    grantors: Array.isArray(row.PartiesOne) ? row.PartiesOne : [],
    grantees: Array.isArray(row.PartiesTwo) ? row.PartiesTwo : [],
    consideration: Number.isFinite(row.SalesPrice) && row.SalesPrice > 0 ? row.SalesPrice : null,
    legalDescriptions: row.Legal ? [row.Legal] : [],
    source: {
      vendor: "hillsclerk-ori",
      documentKey: row.ID ?? null,
      uuid: row.UUID ?? null,
      capturedAt,
    },
  };
}

/**
 * Build a window fetcher for the shared windowed harvest.
 *
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, docTypes?: readonly string[], now?: () => Date }} [options]
 * @returns {(from: string, to: string) => Promise<{ records: Record<string, unknown>[], complete: boolean, expected: null }>}
 *   Fetcher.
 */
export function hillsboroughFetcher(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  return async (from, to) => {
    const response = await fetchImpl(HILLSBOROUGH_SEARCH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        DocType: options.docTypes ?? HILLSBOROUGH_MORTGAGE_DOC_TYPES,
        RecordDateBegin: usDate(from),
        RecordDateEnd: usDate(to),
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 180_000),
    });
    if (!response.ok) throw new Error(`Hillsborough search returned HTTP ${response.status}`);
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      // The server cuts very large answers mid-JSON: treat as truncated and split.
      return { records: [], complete: false, expected: null };
    }
    if (!body.Success) throw new Error(`Hillsborough search failed: ${body.ErrorMessage ?? "unknown"}`);
    if (body.Truncated != null) return { records: [], complete: false, expected: null };
    const capturedAt = now().toISOString();
    return {
      records: (body.ResultList ?? []).map((row) => normalizeHillsboroughRow(row, capturedAt)),
      complete: true,
      expected: null,
    };
  };
}
