/**
 * Parcel — stateless per-parcel service: capture → transform → validate →
 * ready marker → CountyLedger → eligibility, every side effect inside a
 * journaled `ctx.run`. See lib/parcel-flow.ts for the step contract.
 */
import * as restate from "@restatedev/restate-sdk";

import { countyLedger } from "./ledger.ts";
import { parseParcelRequest, processParcel, type StepIO } from "./lib/parcel-flow.ts";
import { envInt } from "./lib/config.ts";
import { IDEMPOTENCY_RETENTION_MS } from "./lib/flow-control.ts";

const MINUTE = 60_000;

export const parcel = restate.service({
  name: "Parcel",
  options: {
    // Heavy captures and transforms can exceed the 1 min / 10 min defaults.
    inactivityTimeout: envInt("PARCEL_INACTIVITY_TIMEOUT_MS", 15 * MINUTE),
    abortTimeout: envInt("PARCEL_ABORT_TIMEOUT_MS", 45 * MINUTE),
    // Enqueue keys (`<county>-<jobId>-<parcel_id>`) stay deduplicated for 14
    // days after completion instead of Restate's 24 h default. Set here, not
    // only through the admin API: re-registering resets admin-set values.
    idempotencyRetention: IDEMPOTENCY_RETENTION_MS,
  },
  handlers: {
    process: async (ctx: restate.Context, payload: unknown) => {
      const req = parseParcelRequest(payload);
      const ledger = ctx.objectClient(countyLedger, `${req.county}-${req.jobId}`);
      const io: StepIO = {
        run: (name, action) => ctx.run(name, action),
        record: async (input) => {
          await ledger.record(input);
        },
      };
      return processParcel(io, req);
    },
  },
});

export type Parcel = typeof parcel;
