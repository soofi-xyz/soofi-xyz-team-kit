/**
 * The `Parcel.process` step sequence, written against a small IO interface so
 * the same code runs inside Restate (`ctx.run` + `CountyLedger` calls) and in
 * unit tests (a recording fake).
 *
 * capture → transform → validate → write ready marker → record to ledger →
 * eligibility. Per-parcel conditions (dead, invalid, failed) are RECORDED and
 * returned, never thrown: a throw would reject the sibling parcels awaited in
 * the same chunk window. Only invalid requests throw a TerminalError.
 */
import { TerminalError } from "@restatedev/restate-sdk";

import { cliIdentity } from "./cli.ts";
import { resolveTransformConfig } from "./county-config.ts";
import type { LedgerRecordInput } from "./ledger-state.ts";
import { countyGate } from "./limits.ts";
import {
  captureParcel,
  markDead,
  markFailed,
  markInvalid,
  markReady,
  type ParcelRequest,
  transformParcel,
  validateParcel,
  writeEligibility,
} from "./parcel-steps.ts";
import { assertCounty, assertJobId, paths } from "./storage.ts";

export type StepIO = {
  run<T>(name: string, action: () => Promise<T>): Promise<T>;
  record(input: LedgerRecordInput): Promise<void>;
};

export type ParcelOutcome =
  | { parcel_id: string; status: "ready"; eligible: boolean; transformedHash: string }
  | { parcel_id: string; status: "dead" | "invalid" | "failed"; reason: string };

/** Normalize the `Parcel.process` payload or throw TerminalError. */
export function parseParcelRequest(value: unknown): ParcelRequest {
  if (!value || typeof value !== "object") throw new TerminalError("Parcel.process payload must be an object");
  const input = value as Record<string, unknown>;
  try {
    assertCounty(input.county);
    assertJobId(input.jobId);
  } catch (error) {
    throw new TerminalError((error as Error).message);
  }
  const parcelId = typeof input.parcel_id === "string" ? input.parcel_id.trim() : "";
  if (!parcelId) throw new TerminalError("parcel_id is required");
  const text = (key: string) =>
    typeof input[key] === "string" && (input[key] as string).trim() ? (input[key] as string).trim() : undefined;
  const extra: Record<string, string> = {};
  if (input.extra && typeof input.extra === "object" && !Array.isArray(input.extra)) {
    for (const [key, child] of Object.entries(input.extra as Record<string, unknown>)) {
      if (typeof child === "string" && child.trim()) extra[key] = child.trim();
    }
  }
  return {
    county: input.county,
    jobId: input.jobId,
    parcel_id: parcelId,
    source_identifier: text("source_identifier"),
    situs_address: text("situs_address"),
    extra,
  };
}

export async function processParcel(io: StepIO, req: ParcelRequest): Promise<ParcelOutcome> {
  const dir = paths.parcelDir(req.county, req.jobId, req.parcel_id);
  const parcel_id = req.parcel_id;
  await io.record({ parcel_id, stage: "capture", status: "pending" });

  // 1. Raw capture (plug-in or elephant-cli prepare), gated per county.
  const captured = await io.run("capture", () =>
    countyGate("prepare", req.county, 4)(() => captureParcel(req, dir)),
  );
  if (captured.status !== "captured") {
    const status = captured.status;
    await io.run(`record-${status}`, () =>
      status === "dead" ? markDead(req, dir, captured.reason) : markFailed(req, dir, captured.reason),
    );
    await io.record({ parcel_id, stage: "capture", status, reason: captured.reason });
    return { parcel_id, status, reason: captured.reason };
  }

  // 2. Transform from the stored capture; skipped when capture hash + version match.
  const transformed = await io.run("transform", async () => {
    const config = await resolveTransformConfig(req.county);
    if (!config) return { status: "failed" as const, reason: "no-transform-configured" };
    return countyGate("transform", req.county, 8)(() =>
      transformParcel(req, dir, captured.captureHash, config),
    );
  });
  if (transformed.status !== "transformed") {
    await io.run("record-failed", () => markFailed(req, dir, transformed.reason));
    await io.record({ parcel_id, stage: "transform", status: "failed", reason: transformed.reason });
    return { parcel_id, status: "failed", reason: transformed.reason };
  }

  // 3. Validate, fail closed.
  const validation = await io.run("validate", () =>
    validateParcel(dir, transformed.transformedHash, transformed.transformVersion),
  );
  if (!validation.valid) {
    const reason = `validation-failed: ${validation.errorCount} finding(s)`;
    await io.run("record-invalid", () => markInvalid(req, dir, validation));
    await io.record({ parcel_id, stage: "validate", status: "invalid", reason });
    return { parcel_id, status: "invalid", reason };
  }

  // 4. Ready marker (validated hash + version + CLI identity).
  await io.run("mark-ready", async () => {
    const marker = await markReady(
      req,
      dir,
      {
        captureHash: captured.captureHash,
        transformVersion: transformed.transformVersion,
        transformedHash: transformed.transformedHash,
      },
      await cliIdentity(),
    );
    return marker.transformedHash;
  });

  // 5. Ledger.
  await io.record({
    parcel_id,
    stage: "ready",
    status: "ready",
    artifactHash: transformed.transformedHash,
    transformVersion: transformed.transformVersion,
  });

  // 6. Eligibility from the transformed output. No permit dispatch here:
  //    PermitFeed walks eligibility in its own bounded windows.
  const eligibility = await io.run("eligibility", async () => {
    const written = await writeEligibility(req, dir);
    return { eligible: written.eligible };
  });
  return {
    parcel_id,
    status: "ready",
    eligible: eligibility.eligible,
    transformedHash: transformed.transformedHash,
  };
}
