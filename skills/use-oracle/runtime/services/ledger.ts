/**
 * CountyLedger — virtual object keyed `<county>-<jobId>`: the single writer of
 * per-parcel status for one run. Status ∈ pending | ready | dead | invalid |
 * failed; permit link results are recorded under `stage: "permits"`.
 *
 * State keys: `p:<parcel_id>` (appraisal entry), `permit:<parcel_id>`
 * (permit-link entry), `counts`, `permitCounts`, `tombstones`, `updatedAt`.
 * State is loaded lazily, so one county-sized object stays cheap per call.
 * Reconcile reads the same keys through the Restate admin SQL query API.
 */
import * as restate from "@restatedev/restate-sdk";
import { TerminalError } from "@restatedev/restate-sdk";

import {
  addCounts,
  applyRecord,
  emptyCounts,
  entryKey,
  type LedgerEntry,
  LedgerInputError,
  type LedgerRecordInput,
  type LedgerStatus,
  LEDGER_STATUSES,
  parseRecordInput,
  PERMIT_STAGE,
  type StatusCounts,
  summarize,
} from "./lib/ledger-state.ts";

const lazy = { state: { preload: false } } as const;

async function record(ctx: restate.ObjectContext, payload: LedgerRecordInput) {
  let input: LedgerRecordInput;
  try {
    input = parseRecordInput(payload);
  } catch (error) {
    if (error instanceof LedgerInputError) throw new TerminalError(error.message);
    throw error;
  }
  const key = entryKey(input.stage, input.parcel_id);
  const previous = (await ctx.get<LedgerEntry>(key)) ?? null;
  const now = new Date(await ctx.date.now()).toISOString();
  const applied = applyRecord(previous, input, now);
  if (!applied.changed) return { changed: false, entry: applied.next };
  ctx.set(key, applied.next);
  const countsKey = input.stage === PERMIT_STAGE ? "permitCounts" : "counts";
  if (Object.keys(applied.countsDelta).length) {
    const counts = (await ctx.get<StatusCounts>(countsKey)) ?? emptyCounts();
    ctx.set(countsKey, addCounts(counts, applied.countsDelta));
  }
  if (applied.tombstoneDelta) {
    ctx.set("tombstones", ((await ctx.get<number>("tombstones")) ?? 0) + applied.tombstoneDelta);
  }
  ctx.set("updatedAt", now);
  return { changed: true, entry: applied.next };
}

export const countyLedger = restate.object({
  name: "CountyLedger",
  options: { ...lazy },
  handlers: {
    record: restate.handlers.object.exclusive({ ...lazy }, record),

    get: restate.handlers.object.shared(
      { ...lazy },
      async (ctx: restate.ObjectSharedContext, input: { parcel_id: string }) => {
        if (!input || typeof input.parcel_id !== "string" || !input.parcel_id) {
          throw new TerminalError("parcel_id is required");
        }
        return {
          parcel: (await ctx.get<LedgerEntry>(entryKey("ready", input.parcel_id))) ?? null,
          permits: (await ctx.get<LedgerEntry>(entryKey(PERMIT_STAGE, input.parcel_id))) ?? null,
        };
      },
    ),

    summary: restate.handlers.object.shared({ ...lazy }, async (ctx: restate.ObjectSharedContext) =>
      summarize(
        ctx.key,
        (await ctx.get<StatusCounts>("counts")) ?? null,
        (await ctx.get<StatusCounts>("permitCounts")) ?? null,
        (await ctx.get<number>("tombstones")) ?? null,
        (await ctx.get<string>("updatedAt")) ?? null,
      ),
    ),

    /**
     * Page through appraisal entries in parcel_id order. `cursor` is the last
     * parcel_id of the previous page; `stage: "permits"` lists permit entries.
     */
    list: restate.handlers.object.shared(
      { ...lazy },
      async (
        ctx: restate.ObjectSharedContext,
        input?: { status?: LedgerStatus; cursor?: string; limit?: number; stage?: "permits" },
      ) => {
        const status = input?.status;
        if (status !== undefined && !(LEDGER_STATUSES as readonly string[]).includes(status)) {
          throw new TerminalError(`status must be one of ${LEDGER_STATUSES.join(", ")}`);
        }
        const limit = Math.min(Math.max(Math.trunc(input?.limit ?? 500), 1), 5000);
        const prefix = input?.stage === PERMIT_STAGE ? "permit:" : "p:";
        const keys = (await ctx.stateKeys())
          .filter((key) => key.startsWith(prefix))
          .map((key) => key.slice(prefix.length))
          .sort();
        const entries: LedgerEntry[] = [];
        let index = input?.cursor ? keys.findIndex((id) => id > input.cursor!) : 0;
        if (index < 0) index = keys.length;
        let last: string | null = null;
        for (; index < keys.length && entries.length < limit; index += 1) {
          const parcelId = keys[index]!;
          last = parcelId;
          const entry = await ctx.get<LedgerEntry>(`${prefix}${parcelId}`);
          if (entry && (!status || entry.status === status)) entries.push(entry);
        }
        return { entries, cursor: index < keys.length ? last : null };
      },
    ),
  },
});

export type CountyLedger = typeof countyLedger;
