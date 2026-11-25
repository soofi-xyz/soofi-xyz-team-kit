/**
 * `PublishGroup` sequence for one county data group:
 *
 *   validate group → hash → validate CAR → export-tables (--atlas-page on a
 *   staged copy under data/publish/…/atlas/) → wait for approval (durable
 *   promise) → upload CAR + tables with readback → copy the staged page onto
 *   the given Atlas checkout path (only if that page is unchanged since export).
 *
 * It stops before the Atlas PR: the PR, merge, global IPNS check and MCP sync
 * stay a human/agent step per `use-oracle`. Publication reads only the
 * validated group directory, never Restate state, and approval is bound to the
 * immutable group digest computed before validation.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { TerminalError } from "@restatedev/restate-sdk";

import { cliErrorText, cliIdentity, type CliIdentity, isTransientCliFailure, runElephantCli } from "./cli.ts";
import {
  assertCounty,
  assertJobId,
  assertPublishableGroup,
  atomicCopy,
  exists,
  paths,
  readJsonIfExists,
  removeIfExists,
  resolveUnderData,
  sha256File,
} from "./storage.ts";

export type PublishRequest = {
  county: string;
  jobId: string;
  group: string;
  groupDir: string;
  atlasPage: string;
  state: string;
  fips: string;
};

export type Decision =
  | { approved: true; approvedBy: string; groupDigest: string | null; at: string }
  | { approved: false; reason: string; at: string };

export type PublishPhase =
  | "validating-group"
  | "hashing"
  | "validating-car"
  | "exporting-tables"
  | "awaiting-approval"
  | "uploading"
  | "applying-atlas-page"
  | "uploaded"
  | "rejected"
  | "failed";

export type PublishState = {
  phase: PublishPhase;
  groupDigest?: string;
  groupFiles?: number;
  car?: { path: string; root: string | null; blocks: number | null };
  tables?: { path: string; root: string | null; exportJson: string };
  atlasPage?: {
    target: string;
    staged: string;
    baseSha256: string | null;
    stagedSha256: string | null;
    applied: boolean;
  };
  uploads?: { car: UploadSummary; tables: UploadSummary };
  decision?: Decision;
  cli?: { version: string | null; commit: string | null };
  error?: string;
};

export type UploadSummary = {
  cid: string | null;
  gatewayUrl: string | null;
  verified: boolean;
  summary: string;
};

export type PublishIO = {
  run<T>(name: string, action: () => Promise<T>): Promise<T>;
  setState(patch: Partial<PublishState>): void;
  awaitDecision(): Promise<Decision>;
};

/** Normalize the request or throw TerminalError. */
export function parsePublishRequest(value: unknown, key?: string): PublishRequest {
  if (!value || typeof value !== "object") throw new TerminalError("PublishGroup.run payload must be an object");
  const input = value as Record<string, unknown>;
  try {
    assertCounty(input.county);
    assertJobId(input.jobId);
    assertPublishableGroup(input.group);
  } catch (error) {
    throw new TerminalError((error as Error).message);
  }
  const state = typeof input.state === "string" ? input.state.trim().toUpperCase() : "";
  const fips = typeof input.fips === "string" ? input.fips.trim() : "";
  if (!/^[A-Z]{2}$/.test(state)) throw new TerminalError("state must be a two-letter code");
  if (!/^\d{5}$/.test(fips)) throw new TerminalError("fips must be a five-digit county FIPS code");
  const atlasPage = typeof input.atlasPage === "string" ? input.atlasPage.trim() : "";
  if (!path.isAbsolute(atlasPage) || !atlasPage.endsWith(`/counties/${state}/${input.county}.json`)) {
    throw new TerminalError("atlasPage must be the absolute path <atlas>/counties/<STATE>/<county>.json");
  }
  const groupDir = typeof input.groupDir === "string" ? input.groupDir : "";
  let resolvedGroupDir: string;
  try {
    resolvedGroupDir = resolveUnderData(groupDir);
  } catch (error) {
    throw new TerminalError(`groupDir: ${(error as Error).message}`);
  }
  const request: PublishRequest = {
    county: input.county,
    jobId: input.jobId,
    group: input.group,
    groupDir: resolvedGroupDir,
    atlasPage,
    state,
    fips,
  };
  const expectedKey = `${request.county}-${request.group}-${request.jobId}`;
  if (key !== undefined && key !== expectedKey) {
    throw new TerminalError(`PublishGroup key must be ${expectedKey}`);
  }
  return request;
}

/** Immutable digest of the group directory: sorted (name, size, sha256). */
export async function digestGroupDir(groupDir: string): Promise<{ digest: string; files: number }> {
  const hash = createHash("sha256");
  let files = 0;
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolute = path.join(dir, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(absolute, relative);
      } else if (entry.isFile()) {
        const size = (await stat(absolute)).size;
        hash.update(`${relative}\u0000${size}\u0000${await sha256File(absolute)}\n`);
        files += 1;
      }
    }
  };
  await walk(groupDir, "");
  return { digest: hash.digest("hex"), files };
}

const SECRETISH = /token|secret|password|authorization|access[_-]?key|api[_-]?key/i;

function summarizeUpload(json: Record<string, unknown> | null): UploadSummary {
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = json?.[key];
      if (typeof value === "string" && value) return value;
    }
    return null;
  };
  const safe = Object.fromEntries(
    Object.entries(json ?? {}).filter(([key, value]) => !SECRETISH.test(key) && typeof value !== "object"),
  );
  const verifiedField = json?.verified ?? json?.ok ?? json?.readback;
  return {
    cid: pick("cid", "root", "root_cid", "rootCid"),
    gatewayUrl: pick("gatewayUrl", "gateway_url", "url"),
    verified: verifiedField === undefined ? true : verifiedField === true,
    summary: JSON.stringify(safe).slice(0, 2000),
  };
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

function readVarint(bytes: Uint8Array, offset: number): [number, number] {
  let value = 0;
  let shift = 0;
  let index = offset;
  while (index < bytes.length) {
    const byte = bytes[index]!;
    value += (byte & 0x7f) * 2 ** shift;
    index += 1;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return [value, index];
}

/**
 * Multihash digest of a base32 CIDv1 (`b…`), so CIDs are compared by digest
 * across codecs. Returns null for anything else.
 */
export function cidDigest(cid: string | null): string | null {
  if (!cid || !cid.startsWith("b")) return null;
  const text = cid.slice(1).toLowerCase();
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of text) {
    const value = BASE32.indexOf(character);
    if (value < 0) return null;
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const array = Uint8Array.from(bytes);
  const [version, afterVersion] = readVarint(array, 0);
  if (version !== 1) return null;
  const [, afterCodec] = readVarint(array, afterVersion);
  return Buffer.from(array.subarray(afterCodec)).toString("hex");
}

export function sameCid(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  const a = cidDigest(left);
  const b = cidDigest(right);
  return a !== null && a === b;
}

async function gateFailure(io: PublishIO, gateName: string, message: string): Promise<never> {
  io.setState({ phase: "failed", error: `${gateName}: ${message}` });
  throw new TerminalError(`${gateName} failed: ${message}`);
}

export async function runPublish(io: PublishIO, req: PublishRequest, identity?: CliIdentity) {
  const outDir = paths.publish(req.county, req.jobId, req.group);
  const carPath = path.join(outDir, `${req.county}-${req.group}.car`);
  const tablesDir = path.join(outDir, "tables");
  const tablesJson = path.join(outDir, "tables-export.json");
  const stagedAtlasPage = path.join(outDir, "atlas", "counties", req.state, `${req.county}.json`);
  const cli = identity ?? (await io.run("cli-identity", () => cliIdentity()));
  io.setState({ phase: "validating-group", cli: { version: cli.version, commit: cli.commit } });

  const group = await io.run("group-digest", () => digestGroupDir(req.groupDir));
  if (group.files === 0) await gateFailure(io, "group", "group directory is empty");
  io.setState({ groupDigest: group.digest, groupFiles: group.files });

  // 1. Validate the group directory.
  const groupValid = await io.run("validate-group", async () => {
    await mkdir(outDir, { recursive: true });
    const result = await runElephantCli(
      ["validate", req.groupDir, "--output-csv", path.join(outDir, "group-validate.csv")],
      { timeoutMs: 6 * 60 * 60 * 1000 },
    );
    if (result.code === 2 && isTransientCliFailure(cliErrorText(result))) {
      throw new Error(`validate could not run: ${cliErrorText(result)}`);
    }
    return { ok: result.code === 0, error: cliErrorText(result) };
  });
  if (!groupValid.ok) await gateFailure(io, "validate-group", groupValid.error);

  // 2. Hash → one CAR per county/data group.
  io.setState({ phase: "hashing" });
  const hashed = await io.run("hash", async () => {
    await removeIfExists(path.join(outDir, "hashed"));
    await removeIfExists(carPath);
    const result = await runElephantCli(
      [
        "hash",
        req.groupDir,
        "--output-zip",
        path.join(outDir, "hashed"),
        "--output-csv",
        path.join(outDir, "hash.csv"),
        "--output-car",
        carPath,
      ],
      { timeoutMs: 6 * 60 * 60 * 1000 },
    );
    if (result.code === 2 && isTransientCliFailure(cliErrorText(result))) {
      throw new Error(`hash could not run: ${cliErrorText(result)}`);
    }
    const car = (result.json?.car ?? {}) as { root?: string; blocks?: number };
    return {
      ok: result.code === 0 && result.json?.ok !== false,
      error: cliErrorText(result),
      root: car.root ?? null,
      blocks: typeof car.blocks === "number" ? car.blocks : null,
    };
  });
  if (!hashed.ok || !hashed.root) await gateFailure(io, "hash", hashed.error);
  io.setState({ car: { path: carPath, root: hashed.root, blocks: hashed.blocks } });

  // 3. Validate the CAR.
  io.setState({ phase: "validating-car" });
  const carValid = await io.run("validate-car", async () => {
    const result = await runElephantCli(
      ["validate", carPath, "--output-csv", path.join(outDir, "car-validate.csv")],
      { timeoutMs: 6 * 60 * 60 * 1000 },
    );
    if (result.code === 2 && isTransientCliFailure(cliErrorText(result))) {
      throw new Error(`validate could not run: ${cliErrorText(result)}`);
    }
    return { ok: result.code === 0, error: cliErrorText(result) };
  });
  if (!carValid.ok) await gateFailure(io, "validate-car", carValid.error);

  // 4. Export tables and write the Atlas county-page entry into a STAGED copy
  //    of the page under the publish dir. The real Atlas checkout is untouched
  //    until approval and upload readback (step 7).
  io.setState({ phase: "exporting-tables" });
  const exported = await io.run("export-tables", async () => {
    await removeIfExists(tablesDir);
    await removeIfExists(stagedAtlasPage);
    const base = (await exists(req.atlasPage)) ? await sha256File(req.atlasPage) : null;
    if (base) await atomicCopy(req.atlasPage, stagedAtlasPage);
    else await mkdir(path.dirname(stagedAtlasPage), { recursive: true });
    const result = await runElephantCli(
      [
        "export-tables",
        carPath,
        "--output",
        tablesDir,
        "--output-json",
        tablesJson,
        "--atlas-page",
        stagedAtlasPage,
        "--county",
        req.county,
        "--state",
        req.state,
        "--fips",
        req.fips,
      ],
      { timeoutMs: 6 * 60 * 60 * 1000 },
    );
    if (result.code === 2 && isTransientCliFailure(cliErrorText(result))) {
      throw new Error(`export-tables could not run: ${cliErrorText(result)}`);
    }
    const summary = result.json ?? (await readJsonIfExists<Record<string, unknown>>(tablesJson)) ?? {};
    return {
      ok: result.code === 0,
      error: cliErrorText(result),
      root: typeof summary.root === "string" ? summary.root : null,
      atlasBase: base,
      atlasStaged: (await exists(stagedAtlasPage)) ? await sha256File(stagedAtlasPage) : null,
    };
  });
  if (!exported.ok) await gateFailure(io, "export-tables", exported.error);
  io.setState({
    tables: { path: tablesDir, root: exported.root, exportJson: tablesJson },
    atlasPage: {
      target: req.atlasPage,
      staged: stagedAtlasPage,
      baseSha256: exported.atlasBase,
      stagedSha256: exported.atlasStaged,
      applied: false,
    },
    phase: "awaiting-approval",
  });

  // 5. Durable approval gate: nothing is uploaded before approve().
  const decision = await io.awaitDecision();
  io.setState({ decision });
  if (!decision.approved) {
    io.setState({ phase: "rejected" });
    return { status: "rejected" as const, reason: decision.reason, groupDigest: group.digest };
  }
  if (decision.groupDigest && decision.groupDigest !== group.digest) {
    await gateFailure(io, "approval", "approved digest does not match the validated group");
  }

  // 6. Upload with readback (the CLI reads the upload back through a gateway).
  io.setState({ phase: "uploading" });
  const uploadCar = await io.run("upload-car", async () => {
    const result = await runElephantCli(
      ["upload", carPath, "--output-json", path.join(outDir, "upload-car.json")],
      { timeoutMs: 6 * 60 * 60 * 1000 },
    );
    if (result.code !== 0) throw new Error(`upload CAR failed: ${cliErrorText(result)}`);
    return summarizeUpload(result.json);
  });
  if (!uploadCar.verified || (uploadCar.cid && !sameCid(uploadCar.cid, hashed.root))) {
    await gateFailure(io, "upload-car", `readback did not match archive root ${hashed.root}`);
  }
  const uploadTables = await io.run("upload-tables", async () => {
    const result = await runElephantCli(
      ["upload", tablesDir, "--output-json", path.join(outDir, "upload-tables.json")],
      { timeoutMs: 6 * 60 * 60 * 1000 },
    );
    if (result.code !== 0) throw new Error(`upload tables failed: ${cliErrorText(result)}`);
    return summarizeUpload(result.json);
  });
  if (!uploadTables.verified || (uploadTables.cid && exported.root && !sameCid(uploadTables.cid, exported.root))) {
    await gateFailure(io, "upload-tables", `readback did not match tables root ${exported.root}`);
  }
  // 7. Apply the staged Atlas page to the real checkout, only after approval
  //    and verified readback, and only if the checkout page is unchanged since
  //    export (otherwise rerun so the entry is computed on the current page).
  io.setState({ phase: "applying-atlas-page", uploads: { car: uploadCar, tables: uploadTables } });
  const applied = await io.run("apply-atlas-page", async () => {
    const current = (await exists(req.atlasPage)) ? await sha256File(req.atlasPage) : null;
    if (current !== exported.atlasBase) {
      return { ok: false, error: "the Atlas checkout page changed after export-tables; rerun PublishGroup" };
    }
    if (!(await exists(stagedAtlasPage))) return { ok: false, error: "export-tables wrote no Atlas page" };
    await atomicCopy(stagedAtlasPage, req.atlasPage);
    return { ok: true, error: "", sha256: await sha256File(req.atlasPage) };
  });
  if (!applied.ok) await gateFailure(io, "apply-atlas-page", applied.error);
  io.setState({
    phase: "uploaded",
    atlasPage: {
      target: req.atlasPage,
      staged: stagedAtlasPage,
      baseSha256: exported.atlasBase,
      stagedSha256: exported.atlasStaged,
      applied: true,
    },
  });
  return {
    status: "uploaded" as const,
    groupDigest: group.digest,
    carRoot: hashed.root,
    blocks: hashed.blocks,
    tablesRoot: exported.root,
    uploads: { car: uploadCar, tables: uploadTables },
    atlasPage: req.atlasPage,
    next: "open one Atlas PR touching only the county page (use-oracle)",
  };
}
