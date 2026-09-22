import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  acquireProcessLock,
  processLockPath,
  releaseProcessLock,
} from "../src/core/process-lock.mjs";

describe("reconciliation process lock", () => {
  it("refuses a second live writer", async () => {
    const lockDir = await mkdtemp(path.join(tmpdir(), "reconciliation-lock-"));
    try {
      await acquireProcessLock({
        lockDir,
        county: "duval",
        operation: "hoa-pm-overlay-sync",
        pid: 4242,
        processIsAlive: () => true,
      });
      await expect(
        acquireProcessLock({
          lockDir,
          county: "clay",
          operation: "hoa-pm-overlay-sync",
          pid: 4343,
          processIsAlive: (candidate) => candidate === 4242,
        }),
      ).rejects.toThrow(/Another reconciliation process is running/);
    } finally {
      await releaseProcessLock(lockDir, 4242);
      await rm(lockDir, { recursive: true, force: true });
    }
  });

  it("replaces a stale lock", async () => {
    const lockDir = await mkdtemp(path.join(tmpdir(), "reconciliation-stale-"));
    try {
      await writeFile(
        processLockPath(lockDir),
        `${JSON.stringify({ pid: 111, county: "duval" })}\n`,
      );
      const held = await acquireProcessLock({
        lockDir,
        county: "duval",
        operation: "hoa-pm-overlay-sync",
        pid: 222,
        processIsAlive: () => false,
      });
      expect(held.replacedStale).toBe(true);
      expect(JSON.parse(await readFile(held.lockPath, "utf8")).pid).toBe(222);
      await releaseProcessLock(lockDir, 222);
    } finally {
      await rm(lockDir, { recursive: true, force: true });
    }
  });
});
