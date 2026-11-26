/**
 * PermitFeed (workflow, key `<CountyIngest key>-permits`) walks permit
 * eligibility from the appraisal artifacts and dispatches
 * `PermitHarvest.harvestParcel` in bounded windows. A feed pass rebuilds its
 * eligible index, then hands each `chunkSize` slice to a child pass of the
 * same workflow (key `<PermitFeed key>-c<N>`) so no journal grows unbounded.
 *
 * PermitHarvest (service) routes one parcel through the county permit profile
 * to the existing vendor adapters, writes artifacts plus
 * `status/<parcelKey>.json`, then records the link result in CountyLedger
 * under `stage: "permits"`.
 */
import { readFile } from "node:fs/promises";

import * as restate from "@restatedev/restate-sdk";
import { RestatePromise, TerminalError } from "@restatedev/restate-sdk";

import { countyLedger } from "./ledger.ts";
import { envInt } from "./lib/config.ts";
import {
  buildEligibleIndex,
  harvestOneParcel,
  permitLedgerRecord,
} from "./lib/permit-steps.ts";
import { assertCounty, assertJobId, dataPath } from "./lib/storage.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

type FeedRequest = {
  county: string;
  jobId: string;
  window?: number;
  chunkSize?: number;
  /** Set on child passes only. */
  chunk?: { index: number; path: string; rows: number };
};

function checkIds(county: unknown, jobId: unknown): void {
  try {
    assertCounty(county);
    assertJobId(jobId);
  } catch (error) {
    throw new TerminalError((error as Error).message);
  }
}

function bounded(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > max) {
    throw new TerminalError(`expected an integer between 1 and ${max}`);
  }
  return value as number;
}

export const permitHarvest = restate.service({
  name: "PermitHarvest",
  options: {
    // Detail-heavy parcels can run for many minutes inside one adapter call.
    inactivityTimeout: envInt("PERMIT_INACTIVITY_TIMEOUT_MS", 20 * MINUTE),
    abortTimeout: envInt("PERMIT_ABORT_TIMEOUT_MS", 60 * MINUTE),
  },
  handlers: {
    harvestParcel: async (
      ctx: restate.Context,
      req: { county: string; jobId: string; parcel_id: string },
    ) => {
      checkIds(req?.county, req?.jobId);
      if (typeof req.parcel_id !== "string" || !req.parcel_id.trim()) {
        throw new TerminalError("parcel_id is required");
      }
      const status = await ctx.run("harvest", () =>
        harvestOneParcel({ county: req.county, jobId: req.jobId, parcel_id: req.parcel_id }),
      );
      await ctx
        .objectClient(countyLedger, `${req.county}-${req.jobId}`)
        .record(permitLedgerRecord(status));
      return {
        parcel_id: status.parcel_id,
        harvestStatus: status.harvestStatus,
        permits: status.permitCount,
        linked: status.linkedCount,
        unlinked: status.unlinkedCount,
        reason: status.parcelReason,
      };
    },
  },
});

export const permitFeed = restate.workflow({
  name: "PermitFeed",
  options: {
    workflowRetention: 14 * DAY,
    // The eligibility scan walks every parcel directory in one ctx.run step.
    inactivityTimeout: 15 * MINUTE,
    abortTimeout: 30 * MINUTE,
  },
  handlers: {
    run: async (ctx: restate.WorkflowContext, req: FeedRequest) => {
      checkIds(req?.county, req?.jobId);
      const window = bounded(req.window, 25, 500);
      if (req.chunk) {
        // Child pass: dispatch one eligible slice in bounded windows.
        const chunk = req.chunk;
        const parcelIds = await ctx.run("read-eligible-slice", async () =>
          JSON.parse(await readFile(dataPath(chunk.path), "utf8")) as string[],
        );
        ctx.set("rows", parcelIds.length);
        const counts: Record<string, number> = {};
        let done = 0;
        for (let start = 0; start < parcelIds.length; start += window) {
          const slice = parcelIds.slice(start, start + window);
          const results = await RestatePromise.all(
            slice.map((parcel_id) =>
              ctx.serviceClient(permitHarvest).harvestParcel({
                county: req.county,
                jobId: req.jobId,
                parcel_id,
              }),
            ),
          );
          for (const result of results) {
            counts[result.harvestStatus] = (counts[result.harvestStatus] ?? 0) + 1;
          }
          done += slice.length;
          ctx.set("done", done);
          ctx.set("counts", counts);
        }
        return { dispatched: done, counts };
      }
      const chunkSize = bounded(req.chunkSize, 10_000, 50_000);
      ctx.set("phase", "indexing");
      const index = await ctx.run("eligible-index", async () => {
        const built = await buildEligibleIndex(req.county, req.jobId, ctx.key, chunkSize);
        return { ...built, malformed: built.malformed.slice(0, 50), malformedCount: built.malformed.length };
      });
      ctx.set("eligible", index.eligible);
      ctx.set("chunks", index.chunks.length);
      ctx.set("chunksDone", 0);
      ctx.set("phase", "harvesting");
      const totals: Record<string, number> = {};
      for (const chunk of index.chunks) {
        const result = await ctx
          .workflowClient(permitFeed, `${ctx.key}-c${chunk.index}`)
          .run({ county: req.county, jobId: req.jobId, window, chunk });
        for (const [status, count] of Object.entries((result as { counts?: Record<string, number> }).counts ?? {})) {
          totals[status] = (totals[status] ?? 0) + count;
        }
        ctx.set("chunksDone", chunk.index + 1);
        ctx.set("counts", totals);
      }
      ctx.set("phase", "done");
      return {
        county: req.county,
        jobId: req.jobId,
        eligible: index.eligible,
        scanned: index.scanned,
        refreshedEligibility: index.refreshed,
        malformedEligibility: index.malformedCount,
        policyFingerprint: index.policyFingerprint,
        chunks: index.chunks.length,
        counts: totals,
      };
    },
    status: async (ctx: restate.WorkflowSharedContext) => ({
      phase: (await ctx.get<string>("phase")) ?? null,
      eligible: (await ctx.get<number>("eligible")) ?? null,
      chunks: (await ctx.get<number>("chunks")) ?? null,
      chunksDone: (await ctx.get<number>("chunksDone")) ?? 0,
      rows: (await ctx.get<number>("rows")) ?? null,
      done: (await ctx.get<number>("done")) ?? 0,
      counts: (await ctx.get<Record<string, number>>("counts")) ?? {},
    }),
  },
});
