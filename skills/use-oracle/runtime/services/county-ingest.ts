/**
 * CountyIngest (workflow, key `<county>-<jobId>[-rN]`) streams the seed:
 * it indexes the seed once, runs one IngestChunk child per `chunkSize` rows
 * (keys `<CountyIngest key>-c<N>`), then starts PermitFeed
 * (`<CountyIngest key>-permits`). It never enqueues the whole county.
 *
 * IngestChunk (workflow) dispatches `Parcel.process` in bounded windows: the
 * next window is admitted only when the previous one completes.
 */
import * as restate from "@restatedev/restate-sdk";
import { RestatePromise, TerminalError } from "@restatedev/restate-sdk";

import { parcel } from "./parcel.ts";
import { permitFeed } from "./permits.ts";
import {
  loadCapturePlugin,
  resolvePrepareConfig,
  resolveSourceRequest,
  resolveTransformConfig,
} from "./lib/county-config.ts";
import { FLOW_MECHANISMS } from "./lib/parcel-steps.ts";
import { readSeedRange, scanSeed, type SeedRow } from "./lib/seed.ts";
import { assertCounty, assertJobId, resolveUnderData } from "./lib/storage.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

type IngestRequest = {
  county: string;
  jobId: string;
  seedPath: string;
  chunkSize?: number;
  window?: number;
  startPermits?: boolean;
  permitWindow?: number;
};

type SeedSlice = { path: string; sha256: string; headerText: string; start: number; end: number };

type ChunkRequest = {
  county: string;
  jobId: string;
  window?: number;
  rows?: SeedRow[];
  seed?: SeedSlice;
};

type ChunkResult = { dispatched: number; counts: Record<string, number> };

function positiveInt(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > max) {
    throw new TerminalError(`expected an integer between 1 and ${max}, got ${String(value)}`);
  }
  return value as number;
}

function checkIds(county: unknown, jobId: unknown): void {
  try {
    assertCounty(county);
    assertJobId(jobId);
  } catch (error) {
    throw new TerminalError((error as Error).message);
  }
}

/** Seed row → Parcel.process payload; canonical fields cannot be overridden by CSV columns. */
function parcelPayload(row: SeedRow, county: string, jobId: string) {
  const { parcel_id, source_identifier, situs_address, ...rest } = row;
  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (typeof value === "string" && key !== "county" && key !== "jobId") extra[key] = value;
  }
  return { county, jobId, parcel_id, source_identifier, situs_address, extra };
}

async function assertCountyRunnable(county: string, header: string[]): Promise<void> {
  const transform = await resolveTransformConfig(county);
  if (!transform) {
    throw new TerminalError(
      `no transform for ${county}: add counties/${county}/transform-v2.zip or scripts, or set TRANSFORM_ZIP_<COUNTY>`,
    );
  }
  const plugin = await loadCapturePlugin(county);
  if (plugin) return;
  const hasUrlColumn = header.includes("source_url") || header.includes("url");
  const probe = resolveSourceRequest(county, { parcel_id: "probe" });
  const prepare = await resolvePrepareConfig(county);
  if (!hasUrlColumn && !probe && !FLOW_MECHANISMS.has(prepare.mechanism)) {
    throw new TerminalError(
      `no capture route for ${county}: add src/counties/${county}/capture.mjs, a prepare flow, a source_url seed column, or PREPARE_URL_TEMPLATE_<COUNTY>`,
    );
  }
}

export const ingestChunk = restate.workflow({
  name: "IngestChunk",
  options: { workflowRetention: 14 * DAY },
  handlers: {
    run: async (ctx: restate.WorkflowContext, req: ChunkRequest): Promise<ChunkResult> => {
      checkIds(req?.county, req?.jobId);
      const window = positiveInt(req.window, 25, 500);
      let rows: SeedRow[];
      if (Array.isArray(req.rows)) {
        rows = req.rows;
      } else if (req.seed) {
        const seed = req.seed;
        rows = await ctx.run("read-seed-slice", async () => {
          const absolute = resolveUnderData(seed.path);
          return readSeedRange(absolute, seed.headerText, seed.start, seed.end);
        });
      } else {
        throw new TerminalError("IngestChunk needs rows or a seed slice");
      }
      for (const row of rows) {
        if (!row || typeof row.parcel_id !== "string" || !row.parcel_id.trim()) {
          throw new TerminalError("every row needs parcel_id");
        }
      }
      ctx.set("rows", rows.length);
      const counts: Record<string, number> = {};
      let dispatched = 0;
      for (let start = 0; start < rows.length; start += window) {
        const slice = rows.slice(start, start + window);
        const results = await RestatePromise.all(
          slice.map((row) =>
            ctx.serviceClient(parcel).process(parcelPayload(row, req.county, req.jobId)),
          ),
        );
        for (const result of results) {
          const status = (result as { status?: string }).status ?? "unknown";
          counts[status] = (counts[status] ?? 0) + 1;
        }
        dispatched += slice.length;
        ctx.set("done", dispatched);
        ctx.set("counts", counts);
      }
      return { dispatched, counts };
    },
    status: async (ctx: restate.WorkflowSharedContext) => ({
      rows: (await ctx.get<number>("rows")) ?? null,
      done: (await ctx.get<number>("done")) ?? 0,
      counts: (await ctx.get<Record<string, number>>("counts")) ?? {},
    }),
  },
});

export const countyIngest = restate.workflow({
  name: "CountyIngest",
  options: {
    workflowRetention: 14 * DAY,
    // Indexing a multi-hundred-MB seed is one long ctx.run step.
    inactivityTimeout: 15 * MINUTE,
    abortTimeout: 30 * MINUTE,
  },
  handlers: {
    run: async (ctx: restate.WorkflowContext, req: IngestRequest) => {
      checkIds(req?.county, req?.jobId);
      const base = `${req.county}-${req.jobId}`;
      if (ctx.key !== base && !new RegExp(`^${base.replace(/[.]/g, "\\.")}-r[1-9][0-9]*$`).test(ctx.key)) {
        throw new TerminalError(`workflow key must be ${base} or ${base}-r<N>`);
      }
      const chunkSize = positiveInt(req.chunkSize, 10_000, 50_000);
      const window = positiveInt(req.window, 25, 500);
      const permitWindow = positiveInt(req.permitWindow, window, 500);
      if (typeof req.seedPath !== "string" || !req.seedPath) {
        throw new TerminalError("seedPath is required (DATA_DIR-relative, e.g. seeds/<county>.csv)");
      }
      let seedAbsolute: string;
      try {
        seedAbsolute = resolveUnderData(req.seedPath);
      } catch (error) {
        throw new TerminalError((error as Error).message);
      }
      ctx.set("phase", "indexing");
      const index = await ctx.run("index-seed", async () => {
        try {
          const scanned = await scanSeed(seedAbsolute, chunkSize);
          await assertCountyRunnable(req.county, scanned.header);
          return scanned;
        } catch (error) {
          if (error instanceof TerminalError) throw error;
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            throw new TerminalError(`seed not found: ${req.seedPath}`);
          }
          if ((error as Error).message.includes("parcel_id")) {
            throw new TerminalError((error as Error).message);
          }
          throw error;
        }
      });
      ctx.set("seed", { path: req.seedPath, sha256: index.sha256, rows: index.rows });
      ctx.set("chunks", index.chunks.length);
      ctx.set("chunksDone", 0);
      ctx.set("phase", "appraisal");
      const totals: Record<string, number> = {};
      for (const chunk of index.chunks) {
        // Child keys derive from the PARENT key, so a redrive (-rN) gets fresh chunks.
        const result = await ctx.workflowClient(ingestChunk, `${ctx.key}-c${chunk.index}`).run({
          county: req.county,
          jobId: req.jobId,
          window,
          seed: {
            path: req.seedPath,
            sha256: index.sha256,
            headerText: index.headerText,
            start: chunk.start,
            end: chunk.end,
          },
        });
        for (const [status, count] of Object.entries(result.counts)) {
          totals[status] = (totals[status] ?? 0) + count;
        }
        ctx.set("chunksDone", chunk.index + 1);
        ctx.set("counts", totals);
      }
      const startPermits = req.startPermits !== false;
      if (startPermits) {
        // Bounded permit feeder; never one send per parcel from Parcel.process.
        ctx.workflowSendClient(permitFeed, `${ctx.key}-permits`).run({
          county: req.county,
          jobId: req.jobId,
          window: permitWindow,
        });
      }
      ctx.set("phase", startPermits ? "permits-started" : "appraisal-done");
      return {
        county: req.county,
        jobId: req.jobId,
        seedRows: index.rows,
        chunks: index.chunks.length,
        counts: totals,
        permitFeed: startPermits ? `${ctx.key}-permits` : null,
        next: `node bin/reconcile-county.mjs --county ${req.county} --job ${req.jobId}`,
      };
    },
    status: async (ctx: restate.WorkflowSharedContext) => ({
      phase: (await ctx.get<string>("phase")) ?? "not-started",
      seed: (await ctx.get<Record<string, unknown>>("seed")) ?? null,
      chunks: (await ctx.get<number>("chunks")) ?? null,
      chunksDone: (await ctx.get<number>("chunksDone")) ?? 0,
      counts: (await ctx.get<Record<string, number>>("counts")) ?? {},
    }),
  },
});
