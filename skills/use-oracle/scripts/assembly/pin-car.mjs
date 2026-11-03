// Pin a large CountyIndex CAR on Filebase over Kubo RPC, piece by piece (as Atlas's
// transfer-roots.mjs does): each shard's subtree as its own CAR (pin-roots=false, PAR at a
// time), then the root block with pin-roots=true, then pin/ls. Shards go first because Filebase
// can hang on importing a block whose links it does not hold yet. Every import must report
// exactly the blocks sent. DONE_FILE records finished shards so a restart skips them.
// Run with a large heap: the CAR index alone is millions of entries.
// Usage: FILEBASE_ACCESS_KEY=… FILEBASE_SECRET_KEY=… FILEBASE_BUCKET=… DONE_FILE=shards.done \
//          node --max-old-space-size=24576 pin-car.mjs <archive.car> <cli-node_modules> [parallel]
// The final pinned import can outlast the connection on very large archives; confirm with
// pin-root-check.sh or pin/ls, which reports the pin once Filebase finishes.
const [carPath, NM, parArg] = process.argv.slice(2);
const PAR = Number(parArg || 6);
const load = (p) => import(`${NM}/${p}/src/index.js`).catch(() => import(`${NM}/${p}/dist/src/index.js`));
const { CarIndexedReader } = await import(`${NM}/@ipld/car/src/indexed-reader.js`).catch(() => import(`${NM}/@ipld/car/dist/src/indexed-reader.js`));
const { CarWriter } = await import(`${NM}/@ipld/car/src/writer.js`).catch(() => import(`${NM}/@ipld/car/dist/src/writer.js`));
const dj = await load('@ipld/dag-json');

const { FILEBASE_ACCESS_KEY: a, FILEBASE_SECRET_KEY: s, FILEBASE_BUCKET: b } = process.env;
if (!a || !s || !b) { console.error('FILEBASE_ACCESS_KEY, FILEBASE_SECRET_KEY and FILEBASE_BUCKET are required'); process.exit(2); }
const TOKEN = Buffer.from(`${a}:${s}:${b}`).toString('base64');
const RPC = 'https://rpc.filebase.io/api/v0';
const log = (m) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);

// curl, not fetch: Node's fetch gives up after 300 s without response headers, and Filebase can
// take longer than that to answer a dag/import. The token goes through a mode-600 header file.
import { execFile } from 'node:child_process';
import fsx from 'node:fs';
import pathx from 'node:path';
import { promisify } from 'node:util';
const runx = promisify(execFile);
const HDIR = fsx.mkdtempSync('/tmp/pc-'); const HDR = pathx.join(HDIR, 'h');
fsx.writeFileSync(HDR, `Authorization: Bearer ${TOKEN}\n`, { mode: 0o600 });
process.on('exit', () => fsx.rmSync(HDIR, { recursive: true, force: true }));
let seq = 0;
async function rpc(path, body, timeoutMs = 30 * 60_000) {
  const args = ['-sS', '--fail-with-body', '-m', String(Math.round(timeoutMs / 1000)), '-X', 'POST', '-H', `@${HDR}`];
  if (body) args.push('-F', `file=@${body};filename=import.car`);
  try {
    const { stdout } = await runx('curl', [...args, `${RPC}/${path}`], { maxBuffer: 64 << 20 });
    return stdout.split('\n').filter((l) => l.trim().startsWith('{')).map((l) => JSON.parse(l));
  } catch (e) { throw new Error(`${path.split('?')[0]}: ${(e.stderr || e.stdout || e.message).toString().slice(0, 200)}`); }
}

const reader = await CarIndexedReader.fromFile(carPath);
const [root] = await reader.getRoots();
const isLink = (v) => v && typeof v === 'object' && v.asCID === v;
function links(v, out) {
  if (isLink(v)) out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => links(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => links(x, out));
  return out;
}
// Every block reachable from `start` (dag-json blocks link onward; other codecs are leaves).
async function subtree(start) {
  const seen = new Map(); const stack = [start];
  while (stack.length) {
    const cid = stack.pop(); const k = cid.toString();
    if (seen.has(k)) continue;
    const blk = await reader.get(cid);
    if (!blk) throw new Error(`block ${k} missing from CAR`);
    seen.set(k, blk);
    if (cid.code === 0x0129) stack.push(...links(dj.decode(blk.bytes), []));
  }
  return [...seen.values()];
}
async function carFile(rootCid, blocks) {
  const file = pathx.join(HDIR, `b${seq++}.car`);
  const { writer, out } = CarWriter.create([rootCid]);
  const ws = fsx.createWriteStream(file);
  const done = (async () => { for await (const c of out) if (!ws.write(c)) await new Promise((r) => ws.once('drain', r)); ws.end(); await new Promise((r) => ws.once('finish', r)); })();
  for (const blk of blocks) await writer.put(blk);
  await writer.close(); await done;
  return file;
}
async function importCar(rootCid, blocks, pin) {
  const form = await carFile(rootCid, blocks);
  try { for (let attempt = 1; ; attempt++) {
    try {
      const lines = await rpc(`dag/import?pin-roots=${pin}&stats=true`, form);
      const stats = lines.find((l) => l.Stats)?.Stats;
      if (!stats || stats.BlockCount !== blocks.length) throw new Error(`stored ${stats?.BlockCount ?? 'no'} blocks, sent ${blocks.length}`);
      if (pin) { const r = lines.find((l) => l.Root); if (!r || r.Root.PinErrorMsg) throw new Error(`root not pinned: ${JSON.stringify(r)}`); }
      return stats.BlockCount;
    } catch (e) {
      if (attempt >= 4) throw e;
      log(`retry ${attempt} ${rootCid}: ${e.message}`); await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  } } finally { fsx.rmSync(form, { force: true }); }
}

const rootBlock = await reader.get(root);
const index = dj.decode(rootBlock.bytes);
log(`archive ${root}: ${index.shards.length} shards`);
// Shards first: each shard subtree is a complete DAG. Filebase hangs on an import whose links it lacks.
const DONE = process.env.DONE_FILE;
const already = new Set(DONE && fsx.existsSync(DONE) ? fsx.readFileSync(DONE, 'utf8').split('\n').filter(Boolean) : []);
if (already.size) log(`resuming: ${already.size} shards already imported`);
let next = 0, blocksSent = 1, shardsDone = already.size;
async function worker() {
  for (;;) {
    const i = next++; if (i >= index.shards.length) return;
    if (already.has(index.shards[i].toString())) continue;
    let blocks = await subtree(index.shards[i]);
    const n = await importCar(index.shards[i], blocks, false); blocks = null; blocksSent += n;
    if (DONE) fsx.appendFileSync(DONE, `${index.shards[i]}\n`);
    if (++shardsDone % 10 === 0 || shardsDone === index.shards.length) log(`shards ${shardsDone}/${index.shards.length}, blocks ${blocksSent}`);
  }
}
await Promise.all(Array.from({ length: PAR }, worker));
await importCar(root, [rootBlock], true);
const pins = await rpc(`pin/ls?arg=${root}&type=recursive`, undefined, 120_000);
log(`pinned ${root} recursive=${JSON.stringify(pins).includes('recursive')} blocks_sent=${blocksSent}`);
await reader.close();
console.log(JSON.stringify({ root: root.toString(), shards: index.shards.length, blocks: blocksSent, bucket: b }));
