import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolvePermitAdapterOptions } from "../services/lib/county-config.ts";
import { resolveIdentityKeys, resolveServicesHosts } from "../services/lib/endpoint.ts";
import { parseRecordInput } from "../services/lib/ledger-state.ts";
import { harvestOneParcel, permitLedgerRecord } from "../services/lib/permit-steps.ts";
import { atomicWriteJson, paths } from "../services/lib/storage.ts";
import { createSandbox, type Sandbox } from "./services-helpers.ts";

const COUNTY = "duval";
const JOB = "permits-1";

function bulkRecord(parcel: string, sourceRecordId: string, jurisdictionKey: string) {
  return {
    schemaVersion: "elephant.normalized-permit-record.v1",
    property_improvement_id: sourceRecordId.padEnd(32, "0").slice(0, 32).replace(/[^a-f0-9]/g, "a"),
    property_id: null,
    parcel_identifier: parcel,
    permit_number: sourceRecordId,
    improvement_type: "ROOF",
    improvement_status: "ISSUED",
    improvement_action: "REPLACE",
    permit_issue_date: "2026-01-02",
    application_received_date: null,
    final_inspection_date: null,
    permit_close_date: null,
    completion_date: null,
    expiration_date: null,
    opened_date: null,
    source_system: "synthetic_bulk",
    county_name: "Duval",
    project_description: null,
    description: "Synthetic re-roof",
    estimated_job_value: null,
    fee: null,
    countyKey: COUNTY,
    jurisdictionKey,
    sourceRecordId,
    sourceUrl: "https://permits.example.gov/record",
    requestedParcelIdentifier: parcel,
    requestedPropertyId: null,
    workAddress: null,
    isRoofPermit: true,
    contractors: [],
    inspections: [],
    relatedRecords: [],
    sourcePayload: {},
  };
}

async function readyParcel(parcelId: string, seed: Record<string, string>) {
  const dir = paths.parcelDir(COUNTY, JOB, parcelId);
  await atomicWriteJson(path.join(dir, "ready.json"), { parcel_id: parcelId });
  await atomicWriteJson(path.join(dir, "eligibility.json"), {
    parcel_id: parcelId,
    eligible: true,
    usageType: null,
    policyFingerprint: "x",
    policyMode: "all",
    routing: {
      parcel_identifier: parcelId,
      source_identifier: null,
      situs_address: seed.situs_address ?? null,
      city: seed.city ?? null,
      seed: { parcel_id: parcelId, ...seed },
    },
  });
}

describe("PermitHarvest routing, options and bulk snapshots", () => {
  let sandbox: Sandbox;
  beforeEach(async () => {
    sandbox = await createSandbox();
  });
  afterEach(async () => {
    await sandbox.cleanup();
  });

  it("routes through the county hook, reads linked bulk snapshots, and records blocked sources apart from dead", async () => {
    const hook = path.join(sandbox.root, "permit-routing.mjs");
    await writeFile(
      hook,
      `export function resolveJurisdiction({ seedRow }) {
  return seedRow.tax_district === "JB" ? "jacksonville-beach" : null;
}
`,
    );
    process.env.PERMIT_ROUTING_MODULE_DUVAL = hook;
    const bulkDir = path.join(sandbox.dataDir, "bulk", "duval");
    await atomicWriteJson(path.join(bulkDir, "jacksonville-beach", "summary.json"), {
      jurisdictionKey: "jacksonville-beach",
      routeKey: "primary",
      snapshotSha256: "a".repeat(64),
    });
    await writeFile(
      path.join(bulkDir, "jacksonville-beach", "linked-permits.jsonl"),
      `${JSON.stringify(bulkRecord("096925-0000", "JB-1", "jacksonville-beach"))}\n`,
    );
    process.env.PERMIT_BULK_DIR_DUVAL = "bulk/duval";

    // City says Jacksonville; the tax-district hook routes it to Jacksonville Beach,
    // whose blocked portal is covered by the linked bulk snapshot.
    await readyParcel("0969250000", { city: "Jacksonville", tax_district: "JB" });
    const routed = await harvestOneParcel({ county: COUNTY, jobId: JOB, parcel_id: "0969250000" });
    expect(routed).toMatchObject({
      harvestStatus: "done",
      jurisdictionKey: "jacksonville-beach",
      permitCount: 1,
      linkedCount: 1,
      unlinkedCount: 0,
    });
    const raw = JSON.parse(
      await readFile(path.join(sandbox.dataDir, routed.artifacts.raw!), "utf8"),
    );
    expect(raw.mode).toBe("bulk-linked");
    expect(permitLedgerRecord(routed)).toMatchObject({ status: "ready", reason: null });

    // No hook key, city routing, no snapshot for this parcel: a blocked source.
    delete process.env.PERMIT_BULK_DIR_DUVAL;
    await readyParcel("1111110000", { city: "Jacksonville Beach" });
    const blocked = await harvestOneParcel({ county: COUNTY, jobId: JOB, parcel_id: "1111110000" });
    expect(blocked).toMatchObject({ harvestStatus: "blocked", jurisdictionKey: "jacksonville-beach" });
    const record = permitLedgerRecord(blocked);
    expect(record).toMatchObject({ stage: "permits", status: "blocked" });
    expect(parseRecordInput(record).status).toBe("blocked");
    expect(() =>
      parseRecordInput({ parcel_id: "1", stage: "capture", status: "blocked", reason: "x" }),
    ).toThrow("permits-stage");
  });

  it("passes county-configured adapter options through", () => {
    process.env.PERMIT_BULK_DIR_DUVAL = "artifacts/permits/duval/snap/bulk";
    process.env.PERMIT_TIMEOUT_MS_DUVAL = "45000";
    process.env.PERMIT_ADAPTER_OPTIONS_DUVAL = '{"headless":false,"nested":{"x":1}}';
    process.env.CHROME_EXECUTABLE_PATH = "/usr/bin/chromium";
    const options = resolvePermitAdapterOptions("duval", { countyKey: "duval", countyName: "Duval" });
    expect(options).toEqual({
      countyKey: "duval",
      countyName: "Duval",
      headless: false,
      timeoutMs: 45000,
      chromiumExecutablePath: "/usr/bin/chromium",
      bulkLinkedDir: path.join(sandbox.dataDir, "artifacts/permits/duval/snap/bulk"),
      bulkSnapshotDir: path.join(sandbox.dataDir, "artifacts/permits/duval/snap/bulk"),
    });
  });
});

describe("services endpoint binding", () => {
  it("binds loopback plus the Docker bridge gateway by default, never all interfaces", () => {
    const interfaces = {
      lo: [{ address: "127.0.0.1", family: "IPv4" }],
      eth0: [{ address: "10.0.0.5", family: "IPv4" }],
      docker0: [
        { address: "172.17.0.1", family: "IPv4" },
        { address: "fe80::1", family: "IPv6" },
      ],
    } as unknown as Parameters<typeof resolveServicesHosts>[1];
    const noIp = () => null;
    expect(resolveServicesHosts(undefined, interfaces, noIp)).toEqual(["127.0.0.1", "172.17.0.1"]);
    expect(resolveServicesHosts("auto", {}, noIp)).toEqual(["127.0.0.1"]);
    // docker0 without carrier is missing from os.networkInterfaces(): read `ip -j`.
    const ipJson = () =>
      JSON.stringify([{ ifname: "docker0", addr_info: [{ family: "inet", local: "172.17.0.1" }, { family: "inet6", local: "fe80::1" }] }]);
    expect(resolveServicesHosts(undefined, {}, ipJson)).toEqual(["127.0.0.1", "172.17.0.1"]);
    expect(resolveServicesHosts("127.0.0.1, 127.0.0.1", interfaces, noIp)).toEqual(["127.0.0.1"]);
    expect(resolveServicesHosts("0.0.0.0", interfaces, noIp)).toEqual(["0.0.0.0"]);
    expect(resolveIdentityKeys(" publickeyv1_a, ,publickeyv1_b ")).toEqual(["publickeyv1_a", "publickeyv1_b"]);
  });
});
