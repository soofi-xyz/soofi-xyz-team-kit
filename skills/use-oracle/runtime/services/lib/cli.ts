/**
 * Elephant CLI runner. Shells out to `ELEPHANT_CLI` (v2 preferred) with
 * `--json`, so stdout is exactly one JSON document and the exit code is the
 * verdict: 0 success, 1 the input failed its checks, 2 the command could not
 * run. Credentials for `upload` reach the CLI through the inherited
 * environment only; they are never logged or returned.
 */
import { spawn } from "node:child_process";

import { elephantCliBinary } from "./config.ts";

export type CliResult = {
  code: number;
  json: Record<string, unknown> | null;
  stdout: string;
  stderr: string;
};

export class CliUnavailableError extends Error {}

export type CliOptions = { cwd?: string; timeoutMs?: number; json?: boolean };

const MAX_CAPTURE = 4 * 1024 * 1024;

function parseJson(stdout: string): Record<string, unknown> | null {
  const text = stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const lastLine = text.split("\n").filter(Boolean).at(-1) ?? "";
    try {
      return JSON.parse(lastLine) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

/** Run the CLI. Throws (retryable) only when the binary cannot start or times out. */
export function runElephantCli(args: string[], options: CliOptions = {}): Promise<CliResult> {
  const binary = elephantCliBinary();
  const argv = options.json === false ? args : ["--json", ...args];
  const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
  return new Promise((resolve, reject) => {
    const child = spawn(binary, argv, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (data: Buffer) => {
      if (stdout.length < MAX_CAPTURE) stdout += data.toString("utf8");
    });
    child.stderr.on("data", (data: Buffer) => {
      if (stderr.length < MAX_CAPTURE) stderr += data.toString("utf8");
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        new CliUnavailableError(
          `elephant CLI could not start (${error.code ?? error.message}); set ELEPHANT_CLI`,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`elephant CLI ${args[0] ?? ""} timed out after ${timeoutMs} ms`));
        return;
      }
      resolve({ code: code ?? 2, json: parseJson(stdout), stdout, stderr });
    });
  });
}

/** One-line error text from a failed CLI result, without echoing stdout dumps. */
export function cliErrorText(result: CliResult): string {
  const fromJson = result.json?.error;
  if (typeof fromJson === "string" && fromJson.trim()) {
    return fromJson.split("\n")[0]!.slice(0, 500);
  }
  const lastStderr = result.stderr.trim().split("\n").filter(Boolean).at(-1);
  return (lastStderr ?? `exit ${result.code}`).slice(0, 500);
}

/**
 * Exit 2 covers both "could not run" and some deterministic input refusals.
 * Only network-shaped failures are worth retrying; the rest fail closed.
 */
export function isTransientCliFailure(message: string): boolean {
  return /could not (download|fetch)|fetch(ing)? schema|network|connection (refused|reset|closed)|timed? ?out|temporar|\bdns\b|HTTP (error )?5\d\d|ECONN|EAI_AGAIN|os error 11[01]/i.test(
    message,
  );
}

export type CliIdentity = { binary: string; version: string | null; commit: string | null };

let identity: Promise<CliIdentity> | null = null;

/** CLI version and build commit, reported with every gate and ready marker. */
export function cliIdentity(): Promise<CliIdentity> {
  identity ??= (async () => {
    const binary = elephantCliBinary();
    try {
      const result = await runElephantCli(["--version"], { json: false, timeoutMs: 30_000 });
      const text = `${result.stdout}\n${result.stderr}`.trim();
      const version = text.match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/)?.[1] ?? null;
      const commit =
        process.env.ELEPHANT_CLI_COMMIT?.trim() ||
        text.match(/\b(?:commit|build|rev)[\s:=]+([0-9a-f]{7,40})\b/i)?.[1] ||
        null;
      return { binary: binary.split("/").at(-1) ?? binary, version, commit };
    } catch {
      identity = null; // do not cache a missing binary
      return { binary: binary.split("/").at(-1) ?? binary, version: null, commit: null };
    }
  })();
  return identity;
}

/** Test hook. */
export function resetCliIdentity(): void {
  identity = null;
}
