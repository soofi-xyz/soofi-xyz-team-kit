// Unpack a county CAR (from `elephant-cli hash --output-car`) back into property folders that
// `elephant-cli hash` accepts: one folder per property, one file per block, CID links rewritten
// to relative file links. Re-hashing the folders reproduces the same block CIDs.
// Usage: node car-to-folders.mjs <in.car> <outDir> <cli node_modules dir> [expected-cids.csv]
import fs from 'node:fs';
import path from 'node:path';

const [carPath, outDir, NM, expectOut] = process.argv.slice(2);
const load = async (p) => import(`${NM}/${p}/src/index.js`).catch(() => import(`${NM}/${p}/dist/src/index.js`));
const { CarIndexedReader } = await import(`${NM}/@ipld/car/src/indexed-reader.js`).catch(() => import(`${NM}/@ipld/car/dist/src/indexed-reader.js`));
const dagJson = await load('@ipld/dag-json');

const reader = await CarIndexedReader.fromFile(carPath);
const [root] = await reader.getRoots();
const get = async (cid) => dagJson.decode((await reader.get(cid)).bytes);
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
  const body = rewrite(await get(cid), links);
  fs.writeFileSync(path.join(dir, name ?? `${key}.json`), JSON.stringify(body));
  for (const l of links) await writeTree(l, dir, undefined, done);
}

const index = await get(root);
const expect = [];
let n = 0;
for (const shardLink of index.shards) {
  const shard = await get(shardLink);
  for (const p of shard.properties) {
    const pcid = p.property_cid.toString();
    const dir = path.join(outDir, pcid);
    fs.mkdirSync(dir, { recursive: true });
    const done = new Set();
    for (const [schemaCid, dataCid] of Object.entries(p.data_groups)) {
      await writeTree(dataCid, dir, `${schemaCid}.json`, done);
      expect.push(`${pcid},${schemaCid},${dataCid.toString()}`);
    }
    n++;
  }
}
if (expectOut) fs.appendFileSync(expectOut, expect.join('\n') + '\n');
await reader.close();
console.log(JSON.stringify({ car: path.basename(carPath), root: root.toString(), properties: n }));
