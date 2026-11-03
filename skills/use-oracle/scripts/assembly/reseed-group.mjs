// Put one contributor's data-group archive onto another contributor's Seed records, so both
// groups share property CIDs and join in Atlas and the MCP.
//
// For each property in <in.car>: read its Seed address_has_parcel.to.request_identifier, look
// that id up in <seed-map.csv> (request_identifier,property_cid from car-index.mjs over the base
// archive), copy the base Seed tree from <seed-props>/<property_cid>/ unchanged, and write the
// non-Seed data-group trees from <in.car> unchanged. Hashing the output reproduces every non-Seed
// data CID of <in.car>; only property_cid and the Seed change.
//
// Usage: node reseed-group.mjs <in.car> <out-dir> <cli-node_modules> <seed-map.csv> <seed-props> \
//          <expected.csv> <unmatched.txt>
// <seed-props> is the base archive unpacked with car-to-folders.mjs.
// Prints {car, properties, written, unmatched}. Unmatched and duplicate ids are skipped and listed.
import fs from 'node:fs';
import path from 'node:path';

const [carPath, outDir, NM, mapPath, seedProps, expectOut, unmatchedOut] = process.argv.slice(2);
if (!unmatchedOut) {
  console.error('usage: reseed-group.mjs <in.car> <out-dir> <cli-node_modules> <seed-map.csv> <seed-props> <expected.csv> <unmatched.txt>');
  process.exit(2);
}
const SEED = 'bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu';
const load = (p) => import(`${NM}/${p}/src/index.js`).catch(() => import(`${NM}/${p}/dist/src/index.js`));
const { CarIndexedReader } = await import(`${NM}/@ipld/car/src/indexed-reader.js`).catch(() => import(`${NM}/@ipld/car/dist/src/indexed-reader.js`));
const dj = await load('@ipld/dag-json');

const map = new Map(fs.readFileSync(mapPath, 'utf8').trim().split('\n').map((l) => l.split(',')));
const reader = await CarIndexedReader.fromFile(carPath);
const [root] = await reader.getRoots();
const get = async (cid) => dj.decode((await reader.get(cid)).bytes);
const isLink = (v) => v && typeof v === 'object' && v.asCID === v;

function rewrite(v, links) {
  if (isLink(v)) { links.push(v); return { '/': `./${v.toString()}.json` }; }
  if (Array.isArray(v)) return v.map((x) => rewrite(x, links));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewrite(x, links)]));
  return v;
}
async function writeTree(cid, dir, name, done) {
  const key = cid.toString();
  if (done.has(key)) return;
  done.add(key);
  const links = [];
  fs.writeFileSync(path.join(dir, name ?? `${key}.json`), JSON.stringify(rewrite(await get(cid), links)));
  for (const l of links) await writeTree(l, dir, undefined, done);
}
// The Seed root file plus every ./<cid>.json it reaches, copied byte for byte.
function copySeed(srcDir, dstDir) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = fs.readFileSync(path.join(srcDir, file), 'utf8');
    fs.writeFileSync(path.join(dstDir, file), text);
    for (const m of text.matchAll(/"\.\/([a-z0-9]+\.json)"/g)) visit(m[1]);
  };
  visit(`${SEED}.json`);
}
async function seedRequestId(seedCid) {
  const seed = await get(seedCid);
  let rel = seed.relationships.address_has_parcel; if (isLink(rel)) rel = await get(rel);
  let to = rel.to; if (isLink(to)) to = await get(to);
  return to.request_identifier;
}

const index = await get(root);
const expect = [], unmatched = [];
let n = 0, written = 0;
for (const shardLink of index.shards) {
  for (const p of (await get(shardLink)).properties) {
    n++;
    const reqId = await seedRequestId(p.data_groups[SEED]);
    const pcid = map.get(reqId);
    if (!pcid) { unmatched.push(`${reqId},${p.property_cid},no_match`); continue; }
    const dir = path.join(outDir, pcid);
    if (fs.existsSync(dir)) { unmatched.push(`${reqId},${p.property_cid},duplicate`); continue; }
    fs.mkdirSync(dir, { recursive: true });
    copySeed(path.join(seedProps, pcid), dir);
    expect.push(`${pcid},${SEED},${pcid}`);
    const done = new Set();
    for (const [schema, dataCid] of Object.entries(p.data_groups)) {
      if (schema === SEED) continue;
      await writeTree(dataCid, dir, `${schema}.json`, done);
      expect.push(`${pcid},${schema},${dataCid.toString()}`);
    }
    written++;
  }
}
if (expect.length) fs.appendFileSync(expectOut, expect.join('\n') + '\n');
if (unmatched.length) fs.appendFileSync(unmatchedOut, unmatched.join('\n') + '\n');
await reader.close();
console.log(JSON.stringify({ car: path.basename(carPath), properties: n, written, unmatched: unmatched.length }));
