/**
 * Filesystem helpers over `DATA_DIR` (claim-check: Restate journals and state
 * hold paths and small JSON only, never file contents).
 *
 * Every write is tmp-file → rename, so an interrupted `ctx.run` never leaves a
 * half-written artifact, and every artifact path derives only from
 * county / jobId / parcel key so re-running any step is safe.
 */
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { dataRoot } from "./config.ts";

export const COUNTY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const JOB_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/;
export const GROUP_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function assertCounty(county: unknown): asserts county is string {
  if (typeof county !== "string" || !COUNTY_PATTERN.test(county)) {
    throw new Error(`county must match ${COUNTY_PATTERN}`);
  }
}

export function assertJobId(jobId: unknown): asserts jobId is string {
  if (
    typeof jobId !== "string" ||
    !JOB_PATTERN.test(jobId) ||
    jobId.includes("..")
  ) {
    throw new Error(`jobId must match ${JOB_PATTERN}`);
  }
}

export function assertGroup(group: unknown): asserts group is string {
  if (typeof group !== "string" || !GROUP_PATTERN.test(group)) {
    throw new Error(`group must match ${GROUP_PATTERN} (e.g. county, property-improvement)`);
  }
}

/** A publishable group: Seed travels inside every archive, never on its own. */
export function assertPublishableGroup(group: unknown): asserts group is string {
  assertGroup(group);
  if (group === "seed") {
    throw new Error("Seed is carried inside every group archive and is never published as its own group");
  }
}

/**
 * Filesystem-safe, collision-safe key for a parcel id. Ids that are already
 * safe stay readable; anything that loses characters gets a short hash suffix
 * so two different ids never share a directory.
 */
export function safeKeyPart(value: string): string {
  const text = String(value);
  const cleaned = text.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "_");
  const needsSuffix =
    cleaned !== text || cleaned.length === 0 || cleaned.length > 96;
  if (!needsSuffix) return cleaned;
  const digest = createHash("sha256").update(text).digest("hex").slice(0, 12);
  return `${cleaned.slice(0, 80) || "id"}-${digest}`;
}

/** Join under DATA_DIR. Rejects absolute input and traversal. */
export function dataPath(...parts: string[]): string {
  const root = dataRoot();
  for (const part of parts) {
    if (path.isAbsolute(part)) {
      throw new Error(`data path parts must be relative: ${part}`);
    }
  }
  const resolved = path.resolve(root, ...parts);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`data path escapes DATA_DIR: ${parts.join("/")}`);
  }
  return resolved;
}

/**
 * Resolve a caller-supplied path that must live under DATA_DIR: either
 * DATA_DIR-relative (`seeds/cobb.csv`) or absolute inside DATA_DIR.
 */
export function resolveUnderData(value: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("path must be a non-empty string");
  }
  if (path.isAbsolute(value)) {
    const root = dataRoot();
    const relative = path.relative(root, path.resolve(value));
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`path must be inside DATA_DIR: ${value}`);
    }
    return path.resolve(value);
  }
  return dataPath(value);
}

export const paths = {
  seed: (county: string) => dataPath("seeds", `${county}.csv`),
  appraisalJob: (county: string, jobId: string) =>
    dataPath("artifacts", "appraisal", county, jobId),
  parcelDir: (county: string, jobId: string, parcelId: string) =>
    dataPath("artifacts", "appraisal", county, jobId, safeKeyPart(parcelId)),
  permitsJob: (county: string, jobId: string) =>
    dataPath("artifacts", "permits", county, jobId),
  permitStatus: (county: string, jobId: string, parcelId: string) =>
    dataPath(
      "artifacts",
      "permits",
      county,
      jobId,
      "status",
      `${safeKeyPart(parcelId)}.json`,
    ),
  run: (county: string, jobId: string) => dataPath("runs", county, jobId),
  group: (county: string, jobId: string, group: string) =>
    dataPath("groups", county, jobId, group),
  publish: (county: string, jobId: string, group: string) =>
    dataPath("publish", county, jobId, group),
};

export async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function removeIfExists(filePath: string): Promise<void> {
  await rm(filePath, { force: true, recursive: true });
}

function temporaryName(filePath: string): string {
  return `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
}

export async function atomicWriteFile(
  filePath: string,
  content: string | Uint8Array,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = temporaryName(filePath);
  await writeFile(temporary, content);
  await rename(temporary, filePath);
}

export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function atomicCopy(source: string, destination: string): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = temporaryName(destination);
  await copyFile(source, temporary);
  await rename(temporary, destination);
}

/** Rename a finished temp output into place (same directory). */
export async function promote(temporary: string, destination: string): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  await rename(temporary, destination);
}

export function temporaryPathFor(filePath: string): string {
  return temporaryName(filePath);
}

export async function readJson<T = unknown>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export async function readJsonIfExists<T = unknown>(filePath: string): Promise<T | null> {
  try {
    return await readJson<T>(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export function sha256Text(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Stable JSON (sorted keys) for fingerprints. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
