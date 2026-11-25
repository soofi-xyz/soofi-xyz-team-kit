/**
 * Lexicon `source_http_request` handling, preserved end to end.
 *
 * The lexicon URL pattern allows no query string, so a request is stored as
 * a base URL plus `multiValueQueryString` (and `json` or `body` with a
 * `content-type` header for POST). Normalizing moves any query string out of
 * the URL; nothing is dropped, so every parcel keeps its own request.
 */

export type SourceRequest = {
  method: string;
  url: string;
  multiValueQueryString?: Record<string, string[]>;
  headers?: Record<string, string>;
  json?: unknown;
  body?: string;
};

const METHODS = new Set(["GET", "POST", "PUT", "PATCH"]);

function parseJsonField(value: unknown, field: string): unknown {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${field} must be JSON`);
  }
}

function queryValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  return [String(value)];
}

/** Normalize a raw request (object or seed-row fields) or throw on bad input. */
export function normalizeSourceRequest(raw: Record<string, unknown>): SourceRequest {
  const method = String(raw.method ?? "GET").toUpperCase();
  if (!METHODS.has(method)) throw new Error(`unsupported request method ${method}`);
  if (typeof raw.url !== "string" || !raw.url) throw new Error("request url is required");
  const parsed = new URL(raw.url);
  const query: Record<string, string[]> = {};
  const given = parseJsonField(raw.multiValueQueryString, "multiValueQueryString");
  if (given !== undefined) {
    if (!given || typeof given !== "object" || Array.isArray(given)) {
      throw new Error("multiValueQueryString must be an object");
    }
    for (const [key, value] of Object.entries(given as Record<string, unknown>)) {
      query[key] = queryValues(value);
    }
  }
  for (const [key, value] of parsed.searchParams) {
    (query[key] ??= []).push(value);
  }
  const request: SourceRequest = {
    method,
    url: parsed.origin + (parsed.pathname === "/" ? "" : parsed.pathname),
  };
  if (Object.keys(query).length) request.multiValueQueryString = query;
  const json = parseJsonField(raw.json, "json");
  const body = raw.body === undefined || raw.body === null || raw.body === "" ? undefined : String(raw.body);
  if (json !== undefined && body !== undefined) throw new Error("a request carries json or body, not both");
  const headers: Record<string, string> = {};
  const givenHeaders = parseJsonField(raw.headers, "headers");
  if (givenHeaders && typeof givenHeaders === "object" && !Array.isArray(givenHeaders)) {
    for (const [key, value] of Object.entries(givenHeaders as Record<string, unknown>)) {
      if (value !== null && value !== undefined) headers[key.toLowerCase()] = String(value);
    }
  }
  if (typeof raw.content_type === "string" && raw.content_type) headers["content-type"] = raw.content_type;
  if (json !== undefined) {
    request.json = json;
    headers["content-type"] ??= "application/json";
  }
  if (body !== undefined) request.body = body;
  if (Object.keys(headers).length) request.headers = headers;
  return request;
}

/** Seed-CSV columns for the CLI's seed-mode transform (only the ones in use). */
export function seedCsvColumns(request: SourceRequest): Record<string, string> {
  const columns: Record<string, string> = { method: request.method, url: request.url };
  if (request.multiValueQueryString) {
    columns.multiValueQueryString = JSON.stringify(request.multiValueQueryString);
  }
  if (request.headers) columns.headers = JSON.stringify(request.headers);
  if (request.json !== undefined) columns.json = JSON.stringify(request.json);
  if (request.body !== undefined) columns.body = request.body;
  return columns;
}
