// Shared paths for the Prism scripts. Plugin paths come from this file's location, never the caller's cwd.
// Generated runs go to $PRISM_RUNS_DIR, default ~/.prism-assets/runs, so nothing is written into the plugin tree.

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const pipelineRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const pluginRoot = resolve(pipelineRoot, "../..");
export const artDirection = resolve(pipelineRoot, "art-direction");
export const prismHome = process.env.PRISM_HOME ? resolve(process.env.PRISM_HOME) : resolve(homedir(), ".prism-assets");
export const runsRoot = process.env.PRISM_RUNS_DIR ? resolve(process.env.PRISM_RUNS_DIR) : resolve(prismHome, "runs");

export const pipelineFile = (path) => resolve(pipelineRoot, path);
export const skillFile = (name) => resolve(pipelineRoot, "..", name, "SKILL.md");
export const runPath = (path) => (isAbsolute(path) ? path : resolve(runsRoot, path));

// First match wins per key; variables already in the environment always win.
export async function loadEnv() {
  const files = [process.env.PRISM_ENV_FILE, resolve(prismHome, ".env"), resolve(pluginRoot, ".env")].filter(Boolean);
  for (const file of files) {
    const text = await readFile(file, "utf8").catch(() => "");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      const eq = trimmed.indexOf("=");
      if (!trimmed || trimmed.startsWith("#") || eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (value && process.env[key] === undefined) process.env[key] = value;
    }
  }
}
