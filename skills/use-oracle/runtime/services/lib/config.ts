/**
 * Runtime configuration read from the services process environment.
 *
 * Paths resolve from this file's location, never from the caller's cwd.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RUNTIME_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/** Absolute data root. Relative `DATA_DIR` values resolve against the runtime dir. */
export function dataRoot(): string {
  const configured = process.env.DATA_DIR?.trim();
  return configured
    ? path.resolve(RUNTIME_DIR, configured)
    : path.join(RUNTIME_DIR, "data");
}

/** Elephant CLI binary (v2 preferred). */
export function elephantCliBinary(): string {
  return process.env.ELEPHANT_CLI?.trim() || "elephant-cli";
}

/** `palm-beach` → `PALM_BEACH`: the county/stage suffix rule for env names. */
export function envPart(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** County-scoped env value first (`NAME_<COUNTY>`), then the bare `NAME`. */
export function countyEnv(name: string, county: string): string | undefined {
  const scoped = process.env[`${name}_${envPart(county)}`];
  if (scoped !== undefined && scoped.trim() !== "") return scoped.trim();
  const bare = process.env[name];
  return bare !== undefined && bare.trim() !== "" ? bare.trim() : undefined;
}

/** Env value that must be county-scoped (never falls back to a bare name). */
export function countyOnlyEnv(name: string, county: string): string | undefined {
  const scoped = process.env[`${name}_${envPart(county)}`];
  return scoped !== undefined && scoped.trim() !== "" ? scoped.trim() : undefined;
}

export function envFlag(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value ?? "");
}

export function envInt(name: string, fallback: number, env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
