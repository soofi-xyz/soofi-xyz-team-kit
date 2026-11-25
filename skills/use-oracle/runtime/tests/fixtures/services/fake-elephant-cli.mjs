#!/usr/bin/env node
/**
 * Deterministic stand-in for the Elephant CLI used by the services tests.
 * Every invocation is appended to $FAKE_CLI_LOG as one JSON line.
 *
 * Behaviour switches (all optional):
 *  - a seed URL containing "gone"  → prepare exits 2 with HTTP 404
 *  - a seed URL containing "flaky" → prepare exits 2 with connection refused
 *  - FAKE_INVALID=<id,id>          → validate exits 1 for those request ids
 *  - a directory holding INVALID    → validate exits 1 for that directory
 *  - FAKE_TRANSFORM_FAIL=<id,id>   → transform exits 2 for those request ids
 *  - FAKE_USAGE_TYPE               → property_usage_type written by transform
 *  - FAKE_DATA_GROUP               → data-group label (default "County")
 *  - FAKE_NO_SEED=1                → county transform emits no Seed root
 *  - transform without a package    → seed mode (seed.csv → Seed group)
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import AdmZip from "adm-zip";

const args = process.argv.slice(2);
const json = args[0] === "--json";
const argv = json ? args.slice(1) : args;
const [command, ...rest] = argv;

if (process.env.FAKE_CLI_LOG) {
  appendFileSync(process.env.FAKE_CLI_LOG, `${JSON.stringify({ command, args: rest })}\n`);
}

function option(name) {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : undefined;
}

function out(value, code = 0) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exit(code);
}

function fail(message, code = 2) {
  process.stderr.write(`error: ${message}\n`);
  out({ error: message }, code);
}

function list(name) {
  return (process.env[name] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function readEntry(zipPath, name) {
  const entry = new AdmZip(zipPath).getEntries().find((item) => item.entryName.endsWith(name));
  return entry ? JSON.parse(entry.getData().toString("utf8")) : null;
}

const sha = (value) => createHash("sha256").update(value).digest("hex");

if (command === "--version" || args[0] === "--version") {
  process.stdout.write("elephant-cli 2.0.0-fake (commit abcdef1)\n");
  process.exit(0);
}

if (command === "prepare") {
  const seedZip = rest.find((item) => !item.startsWith("--") && item.endsWith(".zip") && item !== option("--output-zip"));
  const seed = readEntry(seedZip, "property_seed.json");
  const url = seed?.source_http_request?.url ?? "";
  if (url.includes("gone")) fail("Prepare failed: HTTP error 404: Not Found");
  if (url.includes("flaky")) fail("Prepare failed: io: Connection refused (os error 111)");
  const zip = new AdmZip(seedZip);
  zip.addFile(`${seed.request_identifier}.html`, Buffer.from(`<html>${seed.request_identifier}</html>`));
  zip.writeZip(option("--output-zip"));
  out({ command: "prepare", mechanism: "fetch", output_zip: option("--output-zip") });
}

if (command === "transform") {
  const input = option("--input-zip");
  const pkg = option("--transform-zip") ?? option("--scripts-zip");
  if (!pkg) {
    // Seed mode: seed.csv → Seed group.
    const entry = new AdmZip(input).getEntries().find((item) => item.entryName === "seed.csv");
    if (!entry) fail("seed.csv is required in the input ZIP when no scripts or handler package is given");
    const [, row] = entry.getData().toString("utf8").trim().split("\n");
    const id = row.split(",")[0];
    const zip = new AdmZip();
    zip.addFile("data/address.json", Buffer.from(JSON.stringify({ request_identifier: id, from: "seed" })));
    zip.addFile("data/parcel.json", Buffer.from(JSON.stringify({ parcel_identifier: id })));
    zip.addFile(
      "data/address_has_parcel.json",
      Buffer.from(JSON.stringify({ from: { "/": "./address.json" }, to: { "/": "./parcel.json" } })),
    );
    zip.addFile(
      "data/root-seed-mode.json",
      Buffer.from(JSON.stringify({ label: "Seed", relationships: { address_has_parcel: { "/": "./address_has_parcel.json" } } })),
    );
    zip.writeZip(option("--output-zip"));
    out({ command: "transform", mode: "seed", output_zip: option("--output-zip") });
  }
  const seed = readEntry(input, "property_seed.json") ?? readEntry(input, "parcel.json");
  const id = seed?.request_identifier ?? seed?.parcel_identifier ?? "unknown";
  if (list("FAKE_TRANSFORM_FAIL").includes(id)) fail(`Transform failed: handler rejected ${id}`);
  const pkgHash = sha(readFileSync(pkg)).slice(0, 12);
  const label = option("--data-group") ?? process.env.FAKE_DATA_GROUP ?? "County";
  const zip = new AdmZip();
  const property = {
    parcel_identifier: id,
    request_identifier: id,
    property_usage_type: process.env.FAKE_USAGE_TYPE ?? "SingleFamily",
    transform_package: pkgHash,
    invalid: list("FAKE_INVALID").includes(id),
  };
  zip.addFile("data/property.json", Buffer.from(JSON.stringify(property)));
  zip.addFile("data/address.json", Buffer.from(JSON.stringify({ request_identifier: id })));
  zip.addFile(
    "data/relationship_property_has_address.json",
    Buffer.from(JSON.stringify({ from: { "/": "./property.json" }, to: { "/": "./address.json" } })),
  );
  const root = { label, relationships: { property_has_address: { "/": "./relationship_property_has_address.json" } } };
  zip.addFile(`data/root-${sha(label).slice(0, 8)}.json`, Buffer.from(JSON.stringify(root)));
  if (!process.env.FAKE_NO_SEED) {
    zip.addFile(
      "data/relationship_seed.json",
      Buffer.from(JSON.stringify({ from: { "/": "./address.json" }, to: { "/": "./property.json" } })),
    );
    zip.addFile(
      "data/root-seed.json",
      Buffer.from(JSON.stringify({ label: "Seed", relationships: { seed: { "/": "./relationship_seed.json" } } })),
    );
  }
  // An unrelated group, so per-group filtering is exercised.
  zip.addFile("data/photo.json", Buffer.from(JSON.stringify({ note: "photo group" })));
  zip.addFile(
    "data/root-photo.json",
    Buffer.from(JSON.stringify({ label: "Photo", relationships: { photo: { "/": "./photo.json" } } })),
  );
  zip.writeZip(option("--output-zip"));
  out({ command: "transform", mode: "handler", output_zip: option("--output-zip") });
}

if (command === "validate") {
  const target = rest.find((item) => !item.startsWith("--") && item !== option("--output-csv"));
  const csv = option("--output-csv");
  const header = "property_cid,data_group_cid,file_path,error_path,error_message,currentValue,timestamp\n";
  if (target.endsWith(".zip")) {
    const property = readEntry(target, "property.json");
    if (property?.invalid) {
      writeFileSync(csv, `${header}x,y,${target},/a,bad value,1,t\nx,y,${target},/b,missing,2,t\n`);
      out({ command: "validate", valid: false, error_count: 2, output_csv: csv }, 1);
    }
  }
  if (existsSync(path.join(target, "INVALID"))) {
    writeFileSync(csv, `${header}x,y,${target},/a,bad value,1,t\n`);
    out({ command: "validate", valid: false, error_count: 1, output_csv: csv }, 1);
  }
  if (csv) {
    mkdirSync(path.dirname(csv), { recursive: true });
    writeFileSync(csv, header);
  }
  out({ command: "validate", valid: true, error_count: 0, output_csv: csv });
}

if (command === "hash") {
  const car = option("--output-car");
  const input = rest[0];
  const root = `bafy${sha(`car:${input}`).slice(0, 40)}`;
  mkdirSync(path.dirname(car), { recursive: true });
  writeFileSync(car, root);
  mkdirSync(option("--output-zip"), { recursive: true });
  writeFileSync(option("--output-csv"), "property_cid,data_group_cid\n");
  out({ command: "hash", ok: true, car: { path: car, blocks: 7, root } });
}

if (command === "export-tables") {
  const output = option("--output");
  const car = rest[0];
  const root = `bafy${sha(`tables:${readFileSync(car, "utf8")}`).slice(0, 40)}`;
  mkdirSync(path.join(output, "property"), { recursive: true });
  writeFileSync(path.join(output, "property", "part-00000.parquet"), "PAR1");
  writeFileSync(path.join(output, "ROOT"), root);
  const summary = { command: "export-tables", root, tables: 1, parts: 1 };
  writeFileSync(option("--output-json"), JSON.stringify(summary));
  const page = option("--atlas-page");
  if (page) {
    mkdirSync(path.dirname(page), { recursive: true });
    const current = existsSync(page) ? JSON.parse(readFileSync(page, "utf8")) : { county: option("--county") };
    current.groups = { ...(current.groups ?? {}), [rest[0]]: { root, tables: root } };
    writeFileSync(page, JSON.stringify(current));
  }
  out(summary);
}

if (command === "upload") {
  const target = rest[0];
  const root = target.endsWith(".car")
    ? readFileSync(target, "utf8")
    : readFileSync(path.join(target, "ROOT"), "utf8");
  const summary = { command: "upload", cid: root, gatewayUrl: `https://gateway.example/ipfs/${root}`, verified: true };
  if (option("--output-json")) writeFileSync(option("--output-json"), JSON.stringify(summary));
  out(summary);
}

fail(`unknown command ${command}`);
