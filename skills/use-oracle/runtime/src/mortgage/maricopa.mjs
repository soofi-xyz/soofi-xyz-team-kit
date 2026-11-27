/**
 * Maricopa County, AZ Recorder deed-of-trust index.
 *
 * Verified 2026-11-26 (no auth, no terms):
 *   GET https://publicapi.recorder.maricopa.gov/documents/search
 *       ?documentCode=DT&beginDate=YYYY-MM-DD&endDate=YYYY-MM-DD&pageNumber=N&pageSize=200
 * pageSize is at most 200, but 2026 dates answer HTTP 500 above 50 (checked 2026-11-27), so the default is 50; pageNumber is 1-based, there is no offset cap; page until
 * `searchResults` is empty. `totalResults` is unreliable above 500. Names are empty in
 * search rows; GET /documents/{recordingNumber} returns them (one flat list, no roles).
 * There is no APN, legal description or amount.
 *
 * @module src/mortgage/maricopa
 */

export const MARICOPA_API = "https://publicapi.recorder.maricopa.gov";

/**
 * @param {string} yyyymmdd - YYYYMMDD.
 * @returns {string} YYYY-MM-DD.
 */
const iso = (yyyymmdd) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

/**
 * @param {string | undefined} value - M-DD-YYYY.
 * @returns {string | null} ISO date.
 */
function mdy(value) {
  const match = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(value ?? "");
  return match ? `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}` : null;
}

/**
 * @param {Record<string, any>} row - Search row.
 * @param {string[] | null} names - Names from the detail call, when fetched.
 * @param {string} capturedAt - ISO timestamp.
 * @returns {Record<string, unknown>} Mortgage index record.
 */
export function normalizeMaricopaRow(row, names, capturedAt) {
  const number = `${row.recordingNumber}${row.recordingSuffix ?? ""}`;
  return {
    schemaVersion: "elephant.mortgage-index.v1",
    county: "maricopa",
    state: "AZ",
    requestIdentifier: `maricopa-or:${number}`,
    instrumentNumber: number,
    recordDate: mdy(row.recordingDate),
    book: row.docketBook ? String(row.docketBook) : null,
    page: row.pageMap ? String(row.pageMap) : null,
    docTypeCode: "DT",
    docType: row.documentCode ?? null,
    // The detail call lists borrowers and lender together, without roles.
    names: names ?? [],
    grantors: [],
    grantees: [],
    legalDescriptions: [],
    source: {
      vendor: "maricopa-recorder-api",
      detailUrl: `${MARICOPA_API}/documents/${row.recordingNumber}`,
      namesFetched: Array.isArray(names),
      capturedAt,
    },
  };
}

/**
 * @param {{ fetchImpl?: typeof fetch, withNames?: boolean, pageSize?: number, pageDelayMs?: number, timeoutMs?: number, now?: () => Date }} [options]
 * @returns {(from: string, to: string) => Promise<{ records: Record<string, unknown>[], complete: boolean, expected: null }>}
 *   Window fetcher for the shared windowed harvest.
 */
export function maricopaFetcher(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pageSize = Math.min(options.pageSize ?? 50, 200);
  const pageDelayMs = options.pageDelayMs ?? 500;
  const now = options.now ?? (() => new Date());
  const get = async (url) => {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
    });
    if (!response.ok) throw Object.assign(new Error(`Maricopa ${url} returned HTTP ${response.status}`), { status: response.status });
    return response.json();
  };
  const singleRecords = async (from, to, offset, count) => {
    const out = [];
    let skipped = 0;
    for (let k = offset + 1; k <= offset + count; k += 1) {
      if (pageDelayMs > 0) await new Promise((r) => setTimeout(r, pageDelayMs));
      const params = new URLSearchParams({ documentCode: "DT", beginDate: iso(from), endDate: iso(to), pageNumber: String(k), pageSize: "1" });
      try {
        const body = await get(`${MARICOPA_API}/documents/search?${params}`);
        const one = Array.isArray(body.searchResults) ? body.searchResults : [];
        if (one.length === 0) break;
        out.push(...one);
      } catch (error) {
        if (error.status !== 500) throw error;
        skipped += 1;
        console.error(JSON.stringify({ event: "maricopa_record_skipped", from, to, position: k, error: error.message }));
      }
    }
    // Keep the page full-length when records were skipped so paging continues past them.
    return out.concat(Array(skipped).fill(null));
  };
  return async (from, to) => {
    const rows = [];
    for (let pageNumber = 1; ; pageNumber += 1) {
      if (pageNumber > 1 && pageDelayMs > 0) await new Promise((r) => setTimeout(r, pageDelayMs));
      const params = new URLSearchParams({
        documentCode: "DT",
        beginDate: iso(from),
        endDate: iso(to),
        pageNumber: String(pageNumber),
        pageSize: String(pageSize),
      });
      let page;
      try {
        const body = await get(`${MARICOPA_API}/documents/search?${params}`);
        page = Array.isArray(body.searchResults) ? body.searchResults : [];
      } catch (error) {
        // One bad record makes every page that holds it answer HTTP 500. Re-read this page one
        // record at a time and skip only the record that still fails, logging it as a gap.
        if (error.status !== 500) throw error;
        page = await singleRecords(from, to, (pageNumber - 1) * pageSize, pageSize);
      }
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    const capturedAt = now().toISOString();
    const records = [];
    for (const row of rows) {
      if (row === null) continue; // a skipped bad record
      let names = null;
      if (options.withNames) {
        if (pageDelayMs > 0) await new Promise((r) => setTimeout(r, pageDelayMs));
        const detail = await get(`${MARICOPA_API}/documents/${row.recordingNumber}`);
        names = Array.isArray(detail.names) ? detail.names : [];
      }
      records.push(normalizeMaricopaRow(row, names, capturedAt));
    }
    return { records, complete: true, expected: null };
  };
}
