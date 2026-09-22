import { readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const LOCK_FILENAME = "elephant-reconciliation.lock";

export function processLockPath(lockDir = os.tmpdir()) {
  return path.join(lockDir, LOCK_FILENAME);
}

function defaultProcessIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function acquireProcessLock(options = {}) {
  const lockDir = options.lockDir ?? os.tmpdir();
  const pid = options.pid ?? process.pid;
  const processIsAlive = options.processIsAlive ?? defaultProcessIsAlive;
  const lockPath = processLockPath(lockDir);
  const body = `${JSON.stringify(
    {
      pid,
      startedAt: options.startedAt ?? new Date().toISOString(),
      county: options.county ?? null,
      operation: options.operation ?? null,
    },
    null,
    2,
  )}\n`;

  try {
    await writeFile(lockPath, body, { flag: "wx" });
    return { lockPath, pid };
  } catch (error) {
    if (!error || error.code !== "EEXIST") throw error;
  }

  let existing = null;
  try {
    existing = JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    existing = null;
  }
  const existingPid = Number.isInteger(existing?.pid) ? existing.pid : null;
  if (
    existingPid !== null &&
    existingPid !== pid &&
    processIsAlive(existingPid)
  ) {
    throw new Error(
      `Another reconciliation process is running (pid ${existingPid}, county ${existing?.county ?? "unknown"}, operation ${existing?.operation ?? "unknown"})`,
    );
  }
  await writeFile(lockPath, body);
  return { lockPath, pid, replacedStale: true };
}

export async function releaseProcessLock(
  lockDir = os.tmpdir(),
  pid = process.pid,
) {
  const lockPath = processLockPath(lockDir);
  try {
    const existing = JSON.parse(await readFile(lockPath, "utf8"));
    if (existing.pid !== pid) return;
    await unlink(lockPath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
}

export async function withProcessLock(options, operation) {
  const held = await acquireProcessLock(options);
  try {
    return await operation();
  } finally {
    await releaseProcessLock(options.lockDir, held.pid);
  }
}
