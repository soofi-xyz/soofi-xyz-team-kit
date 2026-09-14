import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { upsertFilebaseName } from "../src/core/filebase.mjs";
import {
  acquireOverlayPublisherLock,
  assertOverlayIpnsNotRewind,
  assertOverlayOnlyIpnsLabels,
  assertThisRunReceiptCid,
  isHoaPmOverlayIpnsLabel,
  isOfficialQueryTableIpnsLabel,
  overlayPublisherLockPath,
  releaseOverlayPublisherLock,
} from "../src/core/hoa-pm-overlay-publisher.mjs";

describe("HOA/PM overlay publisher guards", () => {
  it("classifies overlay vs official query-table names", () => {
    expect(isHoaPmOverlayIpnsLabel("oracle-query-table-duval-hoa-pm")).toBe(true);
    expect(
      isHoaPmOverlayIpnsLabel("oracle-dataset-coverage-duval-hoa-pm"),
    ).toBe(true);
    expect(isOfficialQueryTableIpnsLabel("oracle-query-table-duval")).toBe(true);
    expect(isOfficialQueryTableIpnsLabel("oracle-query-table-duval-hoa-pm")).toBe(
      false,
    );
  });

  it("refuses official county IPNS names", () => {
    expect(() =>
      assertOverlayOnlyIpnsLabels({
        queryTableIpnsLabel: "oracle-query-table-duval",
        coverageIpnsLabel: "oracle-dataset-coverage-duval-hoa-pm",
      }),
    ).toThrow(/official county name/);
  });

  it("refuses a replay CID that is not this run's receipt", () => {
    expect(() =>
      assertThisRunReceiptCid({
        label: "oracle-query-table-duval-hoa-pm",
        targetCid: "QmOld",
        thisRunCid: "QmThisRun",
      }),
    ).toThrow(/byte-bound CID QmThisRun/);
  });

  it("aborts when the live overlay pointer is newer than this receipt", () => {
    expect(() =>
      assertOverlayIpnsNotRewind({
        label: "oracle-query-table-duval-hoa-pm",
        liveCid: "QmNewer",
        targetCid: "QmOlder",
        thisReceiptApprovedAt: "2026-09-13T00:00:00.000Z",
        liveUpdatedAt: "2026-09-14T12:00:00.000Z",
      }),
    ).toThrow(/Refuse overlay IPNS rewind/);
  });

  it("allows a forward overlay move when this receipt is newer than live", () => {
    expect(() =>
      assertOverlayIpnsNotRewind({
        label: "oracle-query-table-duval-hoa-pm",
        liveCid: "QmOlder",
        targetCid: "QmNewer",
        thisReceiptApprovedAt: "2026-09-14T12:00:00.000Z",
        liveUpdatedAt: "2026-09-13T00:00:00.000Z",
      }),
    ).not.toThrow();
  });

  it("refuses a second live overlay publisher while the lock holder is alive", async () => {
    const lockDir = await mkdtemp(path.join(tmpdir(), "overlay-publisher-"));
    try {
      await acquireOverlayPublisherLock({
        lockDir,
        county: "duval",
        command: "hoa-pm-publish",
        pid: 4242,
        processIsAlive: () => true,
      });
      await expect(
        acquireOverlayPublisherLock({
          lockDir,
          county: "clay",
          command: "hoa-pm-overlay-sync",
          pid: 4343,
          processIsAlive: (candidate) => candidate === 4242,
        }),
      ).rejects.toThrow(/another overlay publish\/sync process is running \(pid 4242/);
    } finally {
      await releaseOverlayPublisherLock(lockDir, 4242);
      await rm(lockDir, { recursive: true, force: true });
    }
  });

  it("replaces a leftover dead-pid lock", async () => {
    const lockDir = await mkdtemp(path.join(tmpdir(), "overlay-publisher-stale-"));
    try {
      await writeFile(
        overlayPublisherLockPath(lockDir),
        `${JSON.stringify({ pid: 111, county: "duval", command: "stale-shell" }, null, 2)}\n`,
      );
      const held = await acquireOverlayPublisherLock({
        lockDir,
        county: "duval",
        command: "hoa-pm-publish",
        pid: 222,
        processIsAlive: () => false,
      });
      expect(held.replacedStale).toBe(true);
      const body = JSON.parse(await readFile(held.lockPath, "utf8"));
      expect(body.pid).toBe(222);
      await releaseOverlayPublisherLock(lockDir, 222);
    } finally {
      await rm(lockDir, { recursive: true, force: true });
    }
  });

  it("aborts an overlay Filebase name move that would rewind a newer live CID", async () => {
    const fetchImpl = async (url, init = {}) => {
      if ((init.method ?? "GET") !== "GET") {
        throw new Error(`unexpected ${init.method} ${url}`);
      }
      return {
        ok: true,
        json: async () => [
          {
            label: "oracle-query-table-duval-hoa-pm",
            cid: "QmNewerApproved",
            network_key: "k51duval",
            updated_at: "2026-09-14T17:00:00.000Z",
          },
        ],
      };
    };
    await expect(
      upsertFilebaseName(
        "token",
        "oracle-query-table-duval-hoa-pm",
        "QmOlderReplay",
        fetchImpl,
        {
          createIfMissing: false,
          overlayPreMove: {
            thisRunCid: "QmOlderReplay",
            thisReceiptApprovedAt: "2026-09-13T00:00:00.000Z",
          },
        },
      ),
    ).rejects.toThrow(/Refuse overlay IPNS rewind/);
  });
});
