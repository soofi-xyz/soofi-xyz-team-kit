// Terra extraction pipeline with the MERS pass. Reads documents from S3, extracts the loan
// fields with gpt-6.1-terra (low reasoning), and when the MERS MIN fails its Luhn checksum
// re-reads it from a high-resolution page 1. Writes validated records to S3.
//
// Env: COUNTY, STATE (e.g. TX), YEAR, LIMIT (optional), CONC (default 4), MODEL (default terra),
//      BUCKET (default the mortgage bucket), OUT_PREFIX (default "extracted").
// For production over millions of docs, build a Bedrock batch manifest from the same prompts
// (see HANDOVER-POST-DOWNLOAD.md) instead of these live calls; this runner is for testing and
// moderate volumes / per-shard EC2 runs.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MAIN_PROMPT, MERS_PROMPT, cleanMin, luhnValidMin, normalizeExtraction } from "../src/mortgage/extract.mjs";
const ex = promisify(execFile);
const env = { ...process.env, AWS_PROFILE: process.env.AWS_PROFILE || "elephant", AWS_REGION: process.env.AWS_REGION || "us-east-2" };
const B = process.env.BUCKET || "elephant-mortgage-documents-904370092316";
const COUNTY = process.env.COUNTY, STATE = process.env.STATE, YEAR = process.env.YEAR;
const MODEL = process.env.MODEL || "us.openai.gpt-6.1-terra";
const CONC = Number(process.env.CONC || 4), LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;
const OUT = process.env.OUT_PREFIX || "extracted";
if (!COUNTY || !STATE || !YEAR) { console.error("set COUNTY, STATE, YEAR"); process.exit(1); }

async function converse(messages) {
  const dir = await mkdtemp(path.join(tmpdir(), "cv"));
  try {
    const mf = path.join(dir, "m.json"); await writeFile(mf, JSON.stringify(messages));
    for (let a = 1; a <= 4; a++) {
      try {
        const out = (await ex("aws", ["bedrock-runtime", "converse", "--model-id", MODEL, "--messages", `file://${mf}`, "--inference-config", '{"maxTokens":2500}', "--additional-model-request-fields", '{"reasoning":{"effort":"low"}}', "--output", "json"], { env, maxBuffer: 1e7 })).stdout;
        const j = JSON.parse(out); const txt = (j.output.message.content.find((c) => c.text) || {}).text || "";
        return JSON.parse(txt.replace(/^```json?|```$/g, "").trim());
      } catch (e) { if (a === 4) throw e; await new Promise((r) => setTimeout(r, 1500 * a)); }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const img = async (key, maxpx) => {
  const dir = await mkdtemp(path.join(tmpdir(), "im"));
  const f = path.join(dir, "p.png");
  await ex("aws", ["s3", "cp", `s3://${B}/${key}`, f, "--quiet"], { env });
  if (maxpx) await ex("sips", ["-Z", String(maxpx), f, "--out", f], {});
  const bytes = (await readFile(f)).toString("base64");
  await rm(dir, { recursive: true, force: true });
  return { image: { format: "png", source: { bytes } } };
};

async function extractOne(inst) {
  // already done?
  const outKey = `${OUT}/${STATE}/${COUNTY}/${YEAR}/${inst}.json`;
  try { await ex("aws", ["s3api", "head-object", "--bucket", B, "--key", outKey], { env }); return "skip"; } catch {}
  const base = `documents/${STATE}/${COUNTY}/${YEAR}/${inst}`;
  // main read: pages 1-3 at 1000px
  const imgs = [];
  for (const n of ["0001", "0002", "0003"]) { try { imgs.push(await img(`${base}/page-${n}.png`, 1000)); } catch {} }
  if (!imgs.length) throw new Error("no pages");
  const raw = await converse([{ role: "user", content: [...imgs, { text: MAIN_PROMPT }] }]);
  // MERS pass: if the MIN is missing or fails its checksum, re-read page 1 at full resolution
  if (!luhnValidMin(cleanMin(raw.mers_min))) {
    try {
      const hi = await img(`${base}/page-0001.png`, 2200);
      const m = await converse([{ role: "user", content: [hi, { text: MERS_PROMPT }] }]);
      if (luhnValidMin(cleanMin(m.mers_min))) raw.mers_min = cleanMin(m.mers_min);
    } catch {}
  }
  const record = normalizeExtraction(raw);
  record.instrument_number = inst; record.county = COUNTY; record.state = STATE; record.year = Number(YEAR);
  record.extracted_at = new Date().toISOString(); record.model = MODEL;
  const dir = await mkdtemp(path.join(tmpdir(), "ou")); const f = path.join(dir, "o.json");
  await writeFile(f, JSON.stringify(record, null, 2));
  await ex("aws", ["s3", "cp", f, `s3://${B}/${outKey}`, "--quiet", "--content-type", "application/json"], { env });
  await rm(dir, { recursive: true, force: true });
  return record.needs_review ? "review" : "ok";
}

// list instruments for the county-year
const list = (await ex("aws", ["s3", "ls", `s3://${B}/documents/${STATE}/${COUNTY}/${YEAR}/`], { env, maxBuffer: 1e8 })).stdout
  .split("\n").map((l) => l.trim().split(/\s+/).pop()).filter((x) => x && x.endsWith("/")).map((x) => x.replace(/\/$/, "")).slice(0, LIMIT);
let done = 0, ok = 0, review = 0, skip = 0, err = 0; const t0 = Date.now();
const q = [...list];
await Promise.all(Array.from({ length: CONC }, async () => {
  while (q.length) {
    const inst = q.shift();
    try { const r = await extractOne(inst); if (r === "ok") ok++; else if (r === "review") review++; else skip++; }
    catch { err++; }
    done++;
    if (done % 25 === 0) process.stdout.write(`${done}/${list.length} ok=${ok} review=${review} skip=${skip} err=${err} secs=${((Date.now() - t0) / 1000) | 0}\n`);
  }
}));
console.log(`DONE ${done} ok=${ok} review=${review} skip=${skip} err=${err} secs=${((Date.now() - t0) / 1000) | 0}`);
