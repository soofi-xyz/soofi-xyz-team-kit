/**
 * PublishGroup (workflow, key `<county>-<group>-<jobId>`): validate group →
 * hash → validate CAR → export-tables, then waits on the durable promise
 * `approval` (resolved by `approve` or `reject`), then uploads the CAR and the
 * tables with readback. It stops before the Atlas PR.
 */
import * as restate from "@restatedev/restate-sdk";
import { TerminalError } from "@restatedev/restate-sdk";

import {
  type Decision,
  parsePublishRequest,
  type PublishIO,
  type PublishState,
  runPublish,
} from "./lib/publish-flow.ts";
import { envInt } from "./lib/config.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export const publishGroup = restate.workflow({
  name: "PublishGroup",
  options: {
    workflowRetention: 30 * DAY,
    // hash, export and upload of a county group can each take a long time.
    inactivityTimeout: envInt("PUBLISH_INACTIVITY_TIMEOUT_MS", 60 * MINUTE),
    abortTimeout: envInt("PUBLISH_ABORT_TIMEOUT_MS", 6 * 60 * MINUTE),
  },
  handlers: {
    run: async (ctx: restate.WorkflowContext, payload: unknown) => {
      const req = parsePublishRequest(payload, ctx.key);
      let state: PublishState = { phase: "validating-group" };
      const io: PublishIO = {
        run: (name, action) => ctx.run(name, action),
        setState: (patch) => {
          state = { ...state, ...patch };
          ctx.set("state", state);
        },
        awaitDecision: () => ctx.promise<Decision>("approval").get(),
      };
      return runPublish(io, req);
    },

    approve: async (ctx: restate.WorkflowSharedContext, input: { approvedBy: string; groupDigest?: string }) => {
      const approvedBy = typeof input?.approvedBy === "string" ? input.approvedBy.trim() : "";
      if (!approvedBy) throw new TerminalError("approvedBy is required; approval is never implied");
      const state = await ctx.get<PublishState>("state");
      if (state?.phase !== "awaiting-approval") {
        throw new TerminalError(`PublishGroup is not awaiting approval (phase ${state?.phase ?? "not-started"})`);
      }
      if (input.groupDigest && input.groupDigest !== state.groupDigest) {
        throw new TerminalError("groupDigest does not match the validated group");
      }
      await ctx.promise<Decision>("approval").resolve({
        approved: true,
        approvedBy,
        groupDigest: state.groupDigest ?? null,
        at: new Date(await ctx.date.now()).toISOString(),
      });
      return { approved: true, groupDigest: state.groupDigest };
    },

    reject: async (ctx: restate.WorkflowSharedContext, input: { reason: string }) => {
      const reason = typeof input?.reason === "string" ? input.reason.trim() : "";
      if (!reason) throw new TerminalError("reason is required");
      const state = await ctx.get<PublishState>("state");
      if (state?.phase !== "awaiting-approval") {
        throw new TerminalError(`PublishGroup is not awaiting approval (phase ${state?.phase ?? "not-started"})`);
      }
      await ctx.promise<Decision>("approval").resolve({
        approved: false,
        reason,
        at: new Date(await ctx.date.now()).toISOString(),
      });
      return { approved: false };
    },

    status: async (ctx: restate.WorkflowSharedContext) =>
      (await ctx.get<PublishState>("state")) ?? { phase: "not-started" },
  },
});
