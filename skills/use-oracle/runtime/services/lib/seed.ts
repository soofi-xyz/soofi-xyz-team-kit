/**
 * Seed CSV indexing and slicing.
 *
 * `scanSeed` walks the seed once (RFC 4180 aware: newlines inside quotes do
 * not end a record) and returns the byte range of every chunk. A chunk is
 * then read with one positioned read — O(1) per chunk, never a rescan from
 * row 1. The parent workflow journals only the small index; rows are read by
 * the chunk that dispatches them.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";

import { parseCsvRecords } from "../../src/core/csv.mjs";

export type SeedRow = {
  parcel_id: string;
  source_identifier?: string;
  situs_address?: string;
  [column: string]: string | undefined;
};

export type SeedChunk = { index: number; start: number; end: number; rows: number };

export type SeedIndex = {
  sha256: string;
  bytes: number;
  header: string[];
  headerText: string;
  rows: number;
  chunks: SeedChunk[];
};

const QUOTE = 0x22;
const NEWLINE = 0x0a;
const BLANK_BYTES = new Set([0x2c, 0x0d, QUOTE, 0x20, 0x09]);

/** Index a seed file into `chunkSize`-row byte ranges. */
export async function scanSeed(filePath: string, chunkSize: number): Promise<SeedIndex> {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error("chunkSize must be a positive integer");
  }
  const hash = createHash("sha256");
  let offset = 0;
  let inQuotes = false;
  let recordStart = 0;
  let recordBlank = true;
  let headerEnd = -1;
  const headerBytes: number[] = [];
  let rows = 0;
  const chunks: SeedChunk[] = [];
  let current: SeedChunk | null = null;

  const endRecord = (endExclusive: number) => {
    if (headerEnd < 0) {
      headerEnd = endExclusive;
    } else if (!recordBlank) {
      if (!current || current.rows >= chunkSize) {
        current = { index: chunks.length, start: recordStart, end: endExclusive, rows: 0 };
        chunks.push(current);
      }
      current.rows += 1;
      current.end = endExclusive;
      rows += 1;
    }
    recordStart = endExclusive;
    recordBlank = true;
  };

  for await (const chunk of createReadStream(filePath)) {
    const buffer = chunk as Buffer;
    hash.update(buffer);
    for (let index = 0; index < buffer.length; index += 1) {
      const byte = buffer[index] as number;
      if (headerEnd < 0) headerBytes.push(byte);
      if (byte === QUOTE) inQuotes = !inQuotes;
      if (byte === NEWLINE && !inQuotes) {
        endRecord(offset + index + 1);
        continue;
      }
      if (!BLANK_BYTES.has(byte)) recordBlank = false;
    }
    offset += buffer.length;
  }
  if (recordStart < offset) endRecord(offset);
  const headerText = Buffer.from(headerBytes)
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .replace(/\r?\n$/, "");
  // Parse the header with the shared RFC 4180 parser (one probe row).
  const probe = parseCsvRecords(`${headerText}\nx\n`) as Record<string, string>[];
  const header = Object.keys(probe[0] ?? {}).map((cell) => cell.trim());
  if (!header.includes("parcel_id")) {
    throw new Error("seed header must include a parcel_id column");
  }
  return {
    sha256: hash.digest("hex"),
    bytes: offset,
    header,
    headerText,
    rows,
    chunks,
  };
}

/** Read one chunk's rows by byte range. */
export async function readSeedRange(
  filePath: string,
  headerText: string,
  start: number,
  end: number,
): Promise<SeedRow[]> {
  if (end <= start) return [];
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(end - start);
    let read = 0;
    while (read < buffer.length) {
      const { bytesRead } = await handle.read(buffer, read, buffer.length - read, start + read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    const body = buffer.subarray(0, read).toString("utf8");
    const records = parseCsvRecords(`${headerText}\n${body}`) as Record<string, string>[];
    return records.map(normalizeSeedRow);
  } finally {
    await handle.close();
  }
}

/** Canonical seed row: `parcel_id` required, empty cells dropped. */
export function normalizeSeedRow(record: Record<string, string>): SeedRow {
  const row: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    const trimmed = String(value ?? "").trim();
    if (trimmed !== "") row[key.trim()] = trimmed;
  }
  return row as SeedRow;
}
