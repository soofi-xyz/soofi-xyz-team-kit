/**
 * RFC 4180 CSV helpers shared by every county seed/export pipeline.
 *
 * Adapted from `oracle-node@ff68b0b6` `scripts/run-pinellas-local-ingest.mjs`
 * (`parseCsvRecords`, `encodeCsvCell`) and `scripts/build-pinellas-pilot-seed.mjs`
 * (`renderCsvRow`), generalized to be county-agnostic.
 *
 * @module core/csv
 */

/**
 * Quote one CSV cell using RFC 4180 when it contains a comma, quote, or newline.
 *
 * @param {string} value - Cell text.
 * @returns {string} Encoded cell.
 */
export function encodeCsvCell(value) {
  const text = value ?? "";
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * Parse RFC 4180 CSV text into row objects keyed by the header row.
 *
 * @param {string} text - Complete CSV document, header row first.
 * @returns {Record<string, string>[]} Parsed records.
 */
export function parseCsvRecords(text) {
  /** @type {string[][]} */
  const table = [];
  /** @type {string[]} */
  let row = [];
  let cell = "";
  let inQuotes = false;
  const source = text.endsWith("\n") ? text : `${text}\n`;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"') {
      inQuotes = true;
      continue;
    }
    if (character === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (character === "\n") {
      row.push(cell);
      table.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (character !== "\r") cell += character;
  }
  if (table.length === 0) return [];
  const [header, ...dataRows] = table;
  return dataRows
    .filter((columns) => columns.some((value) => value.length > 0))
    .map((columns) => {
      /** @type {Record<string, string>} */
      const record = {};
      header.forEach((key, index) => {
        record[key] = columns[index] ?? "";
      });
      return record;
    });
}

/**
 * Render one seed row as a complete CSV document (header + one data row),
 * using the row's own key order.
 *
 * @param {Record<string, string>} row - Seed record.
 * @returns {string} Header plus one data row, each newline-terminated.
 */
export function renderSeedCsv(row) {
  const columns = Object.keys(row);
  const header = columns.map(encodeCsvCell).join(",");
  const line = columns.map((column) => encodeCsvCell(row[column] ?? "")).join(",");
  return `${header}\n${line}\n`;
}

/**
 * Render many rows sharing one stable column order into a complete CSV document.
 *
 * @param {readonly string[]} columns - Stable column order.
 * @param {readonly Record<string, string>[]} rows - Data rows.
 * @returns {string} Header plus one line per row.
 */
export function renderCsv(columns, rows) {
  const header = columns.map(encodeCsvCell).join(",");
  const lines = rows.map((row) =>
    columns.map((column) => encodeCsvCell(row[column] ?? "")).join(","),
  );
  return `${[header, ...lines].join("\n")}\n`;
}
