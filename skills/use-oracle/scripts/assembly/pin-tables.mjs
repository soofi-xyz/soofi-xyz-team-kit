// Pin an export-tables directory on Filebase: add every Parquet part with the CLI's exact add
// parameters through curl (no client-side response timeout), require the recorded CID back,
// then (unless --parts-only) import tables.car with pin-roots=true. That pinned import also
// pins the county archive it links to, so pin the archive first.
// Usage: FILEBASE_*=… node pin-tables.mjs <tables-dir> <cli-node_modules> [--parts-only] [parallel]
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
const run = promisify(execFile);
const [dir, NM, ...rest] = process.argv.slice(2);
const partsOnly = rest.includes('--parts-only');
const PAR = Number(rest.find((x) => /^\d+$/.test(x)) || 4);
const { CarReader } = await import(`${NM}/@ipld/car/src/reader.js`).catch(() => import(`${NM}/@ipld/car/dist/src/reader.js`));
const dj = await import(`${NM}/@ipld/dag-json/src/index.js`).catch(() => import(`${NM}/@ipld/dag-json/dist/src/index.js`));
const { FILEBASE_ACCESS_KEY: a, FILEBASE_SECRET_KEY: s, FILEBASE_BUCKET: b } = process.env;
if (!a || !s || !b) { console.error('FILEBASE_* required'); process.exit(2); }
const TOKEN = Buffer.from(`${a}:${s}:${b}`).toString('base64');
const RPC = 'https://rpc.filebase.io/api/v0';
const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

async function curlPost(url, file, name) {
  // The token goes through a header file descriptor so it never appears in the process list.
  const hdr = path.join(fs.mkdtempSync('/tmp/pt-'), 'h'); fs.writeFileSync(hdr, `Authorization: Bearer ${TOKEN}\n`, { mode: 0o600 });
  try {
    const { stdout } = await run('curl', ['-sS', '--fail-with-body', '-m', '3600', '-X', 'POST', '-H', `@${hdr}`, '-F', `file=@${file};filename=${name}`, url], { maxBuffer: 64 << 20 });
    return stdout.split('\n').filter((l) => l.trim().startsWith('{')).map((l) => JSON.parse(l));
  } finally { fs.rmSync(path.dirname(hdr), { recursive: true, force: true }); }
}

const reader = await CarReader.fromBytes(fs.readFileSync(path.join(dir, 'tables.car')));
const [root] = await reader.getRoots();
const index = dj.decode((await reader.get(root)).bytes);
const parts = Object.entries(index.tables).flatMap(([t, e]) => (e.parts || []).map((p, i) => ({
  t, i, cid: p.cid.toString(), bytes: Number(p.bytes), file: path.join(dir, t, `part-${String(i).padStart(5, '0')}.parquet`) })));
log(`tables root ${root}: ${parts.length} parts, ${(parts.reduce((x, p) => x + p.bytes, 0) / 1e6).toFixed(0)} MB`);
let next = 0, ok = 0;
async function worker() {
  for (;;) {
    const p = parts[next++]; if (!p) return;
    for (let attempt = 1; ; attempt++) {
      try {
        const lines = await curlPost(`${RPC}/add?pin=true&cid-version=1&raw-leaves=true&chunker=size-262144`, p.file, path.basename(p.file));
        const h = lines.find((l) => l.Hash)?.Hash;
        if (h !== p.cid) throw new Error(`add returned ${h} but index records ${p.cid}`);
        ok++; log(`part ${ok}/${parts.length} ${p.t}/${p.i} ok`); break;
      } catch (e) { if (attempt >= 4) throw e; log(`retry ${attempt} ${p.t}/${p.i}: ${e.message.slice(0, 200)}`); await new Promise((r) => setTimeout(r, 5000 * attempt)); }
    }
  }
}
await Promise.all(Array.from({ length: PAR }, worker));
if (!partsOnly) {
  const lines = await curlPost(`${RPC}/dag/import?pin-roots=true&stats=true`, path.join(dir, 'tables.car'), 'tables.car');
  const r = lines.find((l) => l.Root);
  if (!r || r.Root.PinErrorMsg) throw new Error(`tables root not pinned: ${JSON.stringify(lines)}`);
  log(`tables root ${root} pinned`);
}
console.log(JSON.stringify({ root: root.toString(), parts: parts.length, partsOk: ok, rootPinned: !partsOnly }));
