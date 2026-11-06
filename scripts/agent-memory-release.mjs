#!/usr/bin/env node
// Releases the agent-memory Model extension and installs it into soofi-safavi's
// Persist, through the Model and Persist HTTP APIs with the environment's shared
// x-api-key. No AWS. Run each step yourself, in order; every write prints what it
// does first, and each step only continues from verified read-back.
//
//   node scripts/agent-memory-release.mjs check   --composition <model>/configurations/agent-memory/composition.json
//   node scripts/agent-memory-release.mjs submit  --composition <...>/composition.json
//   node scripts/agent-memory-release.mjs approve --change-set <id> --reference <approved PR URL>
//   node scripts/agent-memory-release.mjs publish --change-set <id>
//   node scripts/agent-memory-release.mjs install [--release <id>]   (default: current)
//
// Environment: PRISM_API_KEY (or ~/.config/prism/soofi-safavi.key), MODEL_ACCOUNT_ID
// (the Model account the extension belongs to), PRISM_DOMAIN (default
// soofi-safavi.account.prismteam.ai). The key is never printed.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const VOCABULARY = "agent-memory";
const DOMAIN = process.env.PRISM_DOMAIN || "soofi-safavi.account.prismteam.ai";
// PRISM_BASE_URL only points the script at a local stand-in for testing.
const BASE = (process.env.PRISM_BASE_URL || `https://${DOMAIN}`).replace(/\/+$/, "");
const MODEL = `${BASE}/model/v1/accounts`;
const PERSIST = `${BASE}/persist`;
const POLL_MS = Number(process.env.AGENT_MEMORY_RELEASE_POLL_MS ?? 5_000);
const POLL_LIMIT = 120;

function key() {
  const value = process.env.PRISM_API_KEY || (() => {
    try {
      return readFileSync(join(homedir(), ".config/prism/soofi-safavi.key"), "utf8").trim();
    } catch {
      return "";
    }
  })();
  if (!value) throw new Error("Set PRISM_API_KEY or save the soofi-safavi key to ~/.config/prism/soofi-safavi.key");
  return value;
}

function account() {
  const value = process.env.MODEL_ACCOUNT_ID;
  if (!value) throw new Error("Set MODEL_ACCOUNT_ID to the Model account that owns the agent-memory extension");
  return value;
}

async function call(method, url, { body, headers = {}, ok = [200, 201, 202] } = {}) {
  const response = await fetch(url, {
    method,
    headers: { "x-api-key": key(), ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  if (!ok.includes(response.status)) {
    throw new Error(`${method} ${url.replace(/^https?:\/\/[^/]+/, "")} → HTTP ${response.status}: ${JSON.stringify(json).slice(0, 1500)}`);
  }
  return { status: response.status, etag: response.headers.get("etag") ?? json?.etag, json };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function args() {
  const out = {};
  const list = process.argv.slice(3);
  for (let i = 0; i < list.length; i += 2) out[list[i].replace(/^--/, "")] = list[i + 1];
  return out;
}

function composition(path) {
  if (!path) throw new Error("Pass --composition <path to prismteam-ai/model configurations/agent-memory/composition.json>");
  const bytes = readFileSync(path);
  const document = JSON.parse(bytes.toString("utf8"));
  const labels = document.definitions.map((item) => item.definitionId);
  const base = document.manifest.imports.find((item) => item.alias === "base");
  return { bytes, digest: `sha256:${sha256(bytes)}`, labels, base };
}

async function check({ composition: path }) {
  const { labels, base, digest } = composition(path);
  console.log(`Composition ${digest}: ${labels.length} definitions, base ${base.releaseId}`);
  const lexicon = (await call("GET", `${PERSIST}/lexicon?include=document`)).json.data;
  console.log(`Persist lexicon: source ${lexicon.source}, sha256 ${lexicon.sha256}`);
  console.log(`Installed extensions: ${(lexicon.extensions ?? []).map((item) => item.name).join(", ") || "(none)"}`);
  const installed = new Set([...(lexicon.document?.vertices ?? []), ...(lexicon.document?.edges ?? [])].map((item) => item.type));
  const clashes = labels.filter((label) => installed.has(label));
  const problems = [];
  if (lexicon.source !== "api") problems.push("Persist's lexicon is not API-managed (legacy-ssm): extensions are refused with 409");
  if (!installed.has("email")) problems.push("Persist's lexicon has no base `email` label, which email_started_agent_thread needs");
  if ((lexicon.extensions ?? []).some((item) => item.name === VOCABULARY)) problems.push(`An extension named ${VOCABULARY} is already installed`);
  if (clashes.length > 0) problems.push(`Labels already defined in Persist: ${clashes.join(", ")}`);
  const release = await call("GET", `${MODEL}/model/vocabularies/model-shared-base/releases/${base.releaseId}`, { ok: [200, 404] });
  if (release.status === 404) problems.push(`Model has no shared-base release ${base.releaseId}`);
  else if (release.json.releaseDigest !== base.releaseDigest) problems.push(`Shared-base digest differs: Model ${release.json.releaseDigest}, composition ${base.releaseDigest}`);
  if (process.env.MODEL_ACCOUNT_ID) {
    const vocabulary = await call("GET", `${MODEL}/${account()}/vocabularies/${VOCABULARY}`, { ok: [200, 404] });
    console.log(`Model vocabulary ${account()}/${VOCABULARY}: ${vocabulary.status === 404 ? "not created yet" : "exists"}`);
  }
  if (problems.length > 0) {
    console.log("\nNot ready:");
    for (const problem of problems) console.log(`- ${problem}`);
    process.exitCode = 1;
  } else {
    console.log("\nReady: no label clashes, base email present, shared-base pin matches.");
  }
}

async function submit({ composition: path }) {
  const { bytes, digest } = composition(path);
  const accountId = account();
  const vocabulary = await call("POST", `${MODEL}/${accountId}/vocabularies`, {
    headers: { "Idempotency-Key": `${VOCABULARY}-vocabulary-v1` },
    body: { vocabularyId: VOCABULARY, displayName: "Agent memory", description: "Conversations of soofi-xyz-team-kit agents: threads, turns, messages and tool calls." },
    ok: [200, 201, 409],
  });
  console.log(`Vocabulary ${VOCABULARY}: ${vocabulary.status === 201 ? "created" : vocabulary.status === 409 ? "already exists" : "replayed"}`);

  const artifactId = "composition";
  const changeSet = (
    await call("POST", `${MODEL}/${accountId}/change-sets`, {
      headers: { "Idempotency-Key": `${VOCABULARY}-${digest.slice(7, 23)}` },
      body: {
        vocabularyId: VOCABULARY,
        sourceDigest: digest,
        artifacts: [{ artifactId, fileName: "composition.json", relativePath: "configurations/agent-memory/composition.json", mediaType: "application/json", digest, byteLength: bytes.length }],
        composition: { documentArtifactId: artifactId },
      },
    })
  ).json;
  console.log(`Change set ${changeSet.changeSetId} (${changeSet.status}), candidate ${changeSet.candidateDigest}`);

  const upload = (await call("POST", `${MODEL}/${accountId}/change-sets/${changeSet.changeSetId}/artifacts/${artifactId}/upload`)).json;
  const put = await fetch(upload.url, { method: "PUT", headers: upload.requiredHeaders, body: bytes });
  if (!put.ok) throw new Error(`Artifact upload failed: HTTP ${put.status} ${(await put.text()).slice(0, 300)}`);
  console.log(`Uploaded ${bytes.length} bytes`);

  const run = (await call("POST", `${MODEL}/${accountId}/change-sets/${changeSet.changeSetId}/validations`, { body: {} })).json;
  let status = run;
  for (let i = 0; i < POLL_LIMIT && ["QUEUED", "RUNNING"].includes(status.status); i += 1) {
    await sleep(POLL_MS);
    status = (await call("GET", `${MODEL}/${accountId}/validation-runs/${run.validationRunId}`)).json;
  }
  const results = (await call("GET", `${MODEL}/${accountId}/validation-runs/${run.validationRunId}/results`)).json;
  const errors = (results.findings ?? []).filter((finding) => finding.severity === "ERROR");
  console.log(`Validation ${run.validationRunId}: ${status.status}, ${results.findings?.length ?? 0} finding(s), ${errors.length} error(s)`);
  for (const finding of (results.findings ?? []).slice(0, 20)) console.log(`  ${finding.severity} ${finding.code}: ${finding.message ?? ""}`);
  if (status.status !== "SUCCEEDED" || errors.length > 0) throw new Error("Validation did not succeed; fix the composition through the Model PR and submit again");

  const current = await call("GET", `${MODEL}/${accountId}/change-sets/${changeSet.changeSetId}`);
  const review = await call("POST", `${MODEL}/${accountId}/change-sets/${changeSet.changeSetId}/reviews`, {
    headers: { "If-Match": current.etag },
    body: { candidateDigest: current.json.candidateDigest, sourceDigest: current.json.sourceDigest, title: "agent-memory extension (prismteam-ai/model#62)" },
  });
  console.log(`Review requested: ${review.json.status}. Next, after the Model PR is approved:`);
  console.log(`  node scripts/agent-memory-release.mjs approve --change-set ${changeSet.changeSetId} --reference <approved PR URL>`);
}

async function approve({ "change-set": changeSetId, reference }) {
  if (!changeSetId || !/^https:\/\/github\.com\/prismteam-ai\/model\/pull\/\d+/.test(reference ?? "")) {
    throw new Error("Pass --change-set <id> and --reference <https://github.com/prismteam-ai/model/pull/N of the approved PR>");
  }
  const accountId = account();
  const current = await call("GET", `${MODEL}/${accountId}/change-sets/${changeSetId}`);
  if (current.json.status !== "IN_REVIEW") throw new Error(`Change set is ${current.json.status}, not IN_REVIEW`);
  const decision = await call("POST", `${MODEL}/${accountId}/change-sets/${changeSetId}/decisions`, {
    headers: { "If-Match": current.etag },
    body: { candidateDigest: current.json.candidateDigest, sourceDigest: current.json.sourceDigest, decision: "APPROVE", rationale: "Approved in the Model pull request", providerReference: reference },
  });
  console.log(`Decision ${decision.json.reviewDecisionId}: ${decision.json.status}. Next:`);
  console.log(`  node scripts/agent-memory-release.mjs publish --change-set ${changeSetId}`);
}

async function publish({ "change-set": changeSetId }) {
  if (!changeSetId) throw new Error("Pass --change-set <id>");
  const accountId = account();
  const current = await call("GET", `${MODEL}/${accountId}/change-sets/${changeSetId}`);
  const run = (await call("POST", `${MODEL}/${accountId}/change-sets/${changeSetId}/publications`, { headers: { "If-Match": current.etag }, body: { candidateDigest: current.json.candidateDigest } })).json;
  let status = run;
  for (let i = 0; i < POLL_LIMIT && ["QUEUED", "RUNNING"].includes(status.status); i += 1) {
    await sleep(POLL_MS);
    status = (await call("GET", `${MODEL}/${accountId}/publication-runs/${run.publicationRunId}`)).json;
  }
  if (!["COMMITTED", "RECONCILED"].includes(status.status)) throw new Error(`Publication ${run.publicationRunId} ended ${status.status}: ${status.failureReason ?? ""}`);
  const release = (await call("GET", `${MODEL}/${accountId}/vocabularies/${VOCABULARY}/releases/${status.releaseId}`)).json;
  const lexicon = (await call("GET", `${MODEL}/${accountId}/vocabularies/${VOCABULARY}/releases/${status.releaseId}/runtime/persist-lexicon`)).json;
  if (lexicon.releaseDigest !== release.releaseDigest) throw new Error("Release and Persist lexicon digests differ");
  console.log(`Published ${status.releaseId} (${release.releaseDigest}); Persist lexicon ${lexicon.documentDigest}, profile ${lexicon.profileVersion}. Next:`);
  console.log(`  node scripts/agent-memory-release.mjs install --release ${status.releaseId}`);
}

async function install({ release = "current" }) {
  const accountId = account();
  const lexicon = (await call("GET", `${MODEL}/${accountId}/vocabularies/${VOCABULARY}/releases/${release}/runtime/persist-lexicon`)).json;
  const document = { vertices: lexicon.document.vertices, edges: lexicon.document.edges };
  const active = (await call("GET", `${PERSIST}/lexicon`)).json.data;
  console.log(`Installing ${lexicon.releaseId} (${lexicon.documentDigest}) as Persist extension ${VOCABULARY} over merged lexicon ${active.sha256}`);
  const result = (await call("PUT", `${PERSIST}/lexicon/extensions/${VOCABULARY}`, { headers: { "If-Match": active.sha256 }, body: document })).json.data;
  console.log(`Persist: changed ${result.changed}, merged sha256 ${result.sha256}`);
  const readBack = (await call("GET", `${PERSIST}/lexicon/extensions/${VOCABULARY}`)).json.data;
  const expected = new Set([...document.vertices, ...document.edges].map((item) => item.type));
  const got = new Set([...(readBack.document.vertices ?? []), ...(readBack.document.edges ?? [])].map((item) => item.type));
  const missing = [...expected].filter((label) => !got.has(label));
  if (missing.length > 0) throw new Error(`Read-back is missing: ${missing.join(", ")}`);
  console.log(`Read back ${got.size} labels (${[...got].sort().join(", ")}). Readers pick it up within Persist's 300-second cache.`);
}

const commands = { check, submit, approve, publish, install };
const command = commands[process.argv[2]];
if (!command) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 17).join("\n"));
} else {
  command(args()).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
