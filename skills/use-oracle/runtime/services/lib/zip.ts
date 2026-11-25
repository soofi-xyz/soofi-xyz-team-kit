/**
 * Read-only helpers over transformed lexicon ZIPs (`data/*.json`), plus the
 * per-group filter used when assembling one-group publication directories.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";

import AdmZip from "adm-zip";

import { promote, temporaryPathFor } from "./storage.ts";

type Json = Record<string, unknown>;

/** `Property Improvement` → `property-improvement`. */
export function groupSlug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function readEntries(zipPath: string): Map<string, Buffer> {
  const zip = new AdmZip(zipPath);
  const entries = new Map<string, Buffer>();
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    entries.set(entry.entryName, entry.getData());
  }
  return entries;
}

function parseJson(buffer: Buffer | undefined): Json | null {
  if (!buffer) return null;
  try {
    const value = JSON.parse(buffer.toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
  } catch {
    return null;
  }
}

function isGroupRoot(value: Json | null): value is Json & { label: string } {
  return (
    !!value &&
    typeof value.label === "string" &&
    !!value.relationships &&
    typeof value.relationships === "object"
  );
}

/** Data-group root labels in a transformed ZIP. */
export function listDataGroups(zipPath: string): string[] {
  const labels = new Set<string>();
  for (const [, buffer] of readEntries(zipPath)) {
    const json = parseJson(buffer);
    if (isGroupRoot(json)) labels.add(json.label.trim());
  }
  return [...labels].sort();
}

/** One JSON file from the ZIP by basename (e.g. `property.json`), or null. */
export function readZipJson(zipPath: string, basename: string): Json | null {
  for (const [name, buffer] of readEntries(zipPath)) {
    if (path.posix.basename(name) === basename) return parseJson(buffer);
  }
  return null;
}

function collectLinks(value: unknown, into: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectLinks(item, into);
    return;
  }
  if (value && typeof value === "object") {
    const object = value as Json;
    const link = object["/"];
    if (typeof link === "string" && Object.keys(object).length === 1) {
      into.push(link);
      return;
    }
    for (const child of Object.values(object)) collectLinks(child, into);
  }
}

/**
 * Write `dest` with only the group root(s) matching `group`, the Seed root,
 * and every file reachable from them through relative IPLD links. Returns the
 * kept labels and file count; zero files means the ZIP has no such group.
 */
export async function filterZipToGroup(
  src: string,
  dest: string,
  group: string,
): Promise<{ labels: string[]; files: number }> {
  const entries = readEntries(src);
  const keep = new Set<string>();
  const labels: string[] = [];
  const queue: string[] = [];
  for (const [name, buffer] of entries) {
    const json = parseJson(buffer);
    if (isGroupRoot(json) && groupSlug(json.label) === group) {
      labels.push(json.label);
      queue.push(name);
    }
  }
  if (labels.length === 0) return { labels: [], files: 0 };
  // Every archive carries the Seed root: hash derives the property CID from it.
  for (const [name, buffer] of entries) {
    const json = parseJson(buffer);
    if (isGroupRoot(json) && groupSlug(json.label) === "seed" && group !== "seed") {
      labels.push(json.label);
      queue.push(name);
    }
  }
  while (queue.length) {
    const name = queue.shift()!;
    if (keep.has(name)) continue;
    keep.add(name);
    const links: string[] = [];
    collectLinks(parseJson(entries.get(name)), links);
    for (const link of links) {
      if (!link.startsWith("./") && !link.startsWith("../")) continue; // CID link
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), link));
      if (entries.has(target) && !keep.has(target)) queue.push(target);
    }
  }
  if (keep.size === 0) return { labels: [], files: 0 };
  const zip = new AdmZip();
  for (const name of [...keep].sort()) zip.addFile(name, entries.get(name)!);
  await mkdir(path.dirname(dest), { recursive: true });
  const temporary = temporaryPathFor(dest);
  zip.writeZip(temporary);
  await promote(temporary, dest);
  return { labels: labels.sort(), files: keep.size };
}

/** The capture's source request (`property_seed.json` or `parcel.json`), if any. */
export function captureSourceRequest(zipPath: string): { method: string; url: string } | null {
  for (const name of ["property_seed.json", "parcel.json"]) {
    const json = readZipJson(zipPath, name);
    const request = json?.source_http_request as { method?: unknown; url?: unknown } | undefined;
    if (request && typeof request.url === "string" && request.url) {
      return { method: typeof request.method === "string" ? request.method : "GET", url: request.url };
    }
  }
  return null;
}

/**
 * Merge `secondary` into `primary` (both transformed ZIPs). A file present in
 * both keeps the primary copy, so groups share one entity file.
 */
export async function mergeTransformedZips(
  primary: string,
  secondary: string,
  dest: string,
): Promise<{ added: string[]; keptPrimary: string[] }> {
  const base = readEntries(primary);
  const extra = readEntries(secondary);
  const added: string[] = [];
  const keptPrimary: string[] = [];
  for (const [name, buffer] of extra) {
    const existing = base.get(name);
    if (!existing) {
      base.set(name, buffer);
      added.push(name);
    } else if (!existing.equals(buffer)) {
      keptPrimary.push(name);
    }
  }
  const zip = new AdmZip();
  for (const name of [...base.keys()].sort()) zip.addFile(name, base.get(name)!);
  await mkdir(path.dirname(dest), { recursive: true });
  const temporary = temporaryPathFor(dest);
  zip.writeZip(temporary);
  await promote(temporary, dest);
  return { added: added.sort(), keptPrimary: keptPrimary.sort() };
}
