import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resetCliIdentity } from "../services/lib/cli.ts";
import { resetGates } from "../services/lib/limits.ts";

const FAKE_CLI = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "services",
  "fake-elephant-cli.mjs",
);

export const COUNTY = "testcounty";
export const JOB = "job-1";

const MANAGED_ENV = [
  "DATA_DIR",
  "ELEPHANT_CLI",
  "ELEPHANT_CLI_COMMIT",
  "FAKE_CLI_LOG",
  "FAKE_INVALID",
  "FAKE_TRANSFORM_FAIL",
  "FAKE_USAGE_TYPE",
  "FAKE_DATA_GROUP",
  "FAKE_NO_SEED",
  "TRANSFORM_ZIP_TESTCOUNTY",
  "TRANSFORM_SEED_TESTCOUNTY",
  "PREPARE_URL_TEMPLATE_TESTCOUNTY",
  "CAPTURE_MODULE_TESTCOUNTY",
  "PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES_TESTCOUNTY",
  "PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES",
];

export type Sandbox = {
  root: string;
  dataDir: string;
  transformZip: string;
  calls(): Promise<Array<{ command: string; args: string[] }>>;
  clearCalls(): Promise<void>;
  cleanup(): Promise<void>;
};

/** Temp DATA_DIR + fake Elephant CLI + transform package, wired through env. */
export async function createSandbox(): Promise<Sandbox> {
  const saved = Object.fromEntries(MANAGED_ENV.map((name) => [name, process.env[name]]));
  const root = await mkdtemp(path.join(tmpdir(), "oracle-services-"));
  const dataDir = path.join(root, "data");
  await mkdir(path.join(dataDir, "seeds"), { recursive: true });
  const wrapper = path.join(root, "elephant-cli");
  await writeFile(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_CLI}" "$@"\n`);
  await chmod(wrapper, 0o755);
  const transformZip = path.join(root, "transform-v2.zip");
  await writeFile(transformZip, "handler-v1");
  const log = path.join(root, "cli.log");
  process.env.DATA_DIR = dataDir;
  process.env.ELEPHANT_CLI = wrapper;
  process.env.FAKE_CLI_LOG = log;
  process.env.TRANSFORM_ZIP_TESTCOUNTY = transformZip;
  process.env.PREPARE_URL_TEMPLATE_TESTCOUNTY = "https://appraiser.example.gov/parcel/{parcel_id}";
  for (const name of [
    "ELEPHANT_CLI_COMMIT",
    "FAKE_INVALID",
    "FAKE_TRANSFORM_FAIL",
    "FAKE_USAGE_TYPE",
    "FAKE_DATA_GROUP",
    "FAKE_NO_SEED",
    "TRANSFORM_SEED_TESTCOUNTY",
    "CAPTURE_MODULE_TESTCOUNTY",
    "PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES_TESTCOUNTY",
    "PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES",
  ]) {
    delete process.env[name];
  }
  resetGates();
  resetCliIdentity();
  return {
    root,
    dataDir,
    transformZip,
    async calls() {
      const text = await readFile(log, "utf8").catch(() => "");
      return text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
    async clearCalls() {
      await rm(log, { force: true });
    },
    async cleanup() {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      resetGates();
      resetCliIdentity();
      await rm(root, { recursive: true, force: true });
    },
  };
}
