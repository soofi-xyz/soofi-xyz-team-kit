// List an archive's properties as CSV: property_cid,request_identifier,parcel_identifier.
// request_identifier and parcel_identifier come from the Seed's address_has_parcel.to record.
// Use it to compare contributors (overlap by property CID vs by source id) and to build the
// seed map for reseed-group.mjs: `cut -d, -f2,1` gives request_identifier,property_cid.
// Usage: node car-index.mjs <archive.car> <cli-node_modules> > index.csv
const [carPath, NM] = process.argv.slice(2);
if (!NM) { console.error('usage: car-index.mjs <archive.car> <cli-node_modules>'); process.exit(2); }
const SEED = 'bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu';
const load = (p) => import(`${NM}/${p}/src/index.js`).catch(() => import(`${NM}/${p}/dist/src/index.js`));
const { CarIndexedReader } = await import(`${NM}/@ipld/car/src/indexed-reader.js`).catch(() => import(`${NM}/@ipld/car/dist/src/indexed-reader.js`));
const dj = await load('@ipld/dag-json');

const reader = await CarIndexedReader.fromFile(carPath);
const [root] = await reader.getRoots();
const get = async (cid) => dj.decode((await reader.get(cid)).bytes);
const isLink = (v) => v && typeof v === 'object' && v.asCID === v;
const out = ['property_cid,request_identifier,parcel_identifier'];
for (const shardLink of (await get(root)).shards) {
  for (const p of (await get(shardLink)).properties) {
    let rel = (await get(p.data_groups[SEED])).relationships.address_has_parcel;
    if (isLink(rel)) rel = await get(rel);
    let to = rel.to; if (isLink(to)) to = await get(to);
    out.push(`${p.property_cid},${to.request_identifier ?? ''},${to.parcel_identifier ?? ''}`);
  }
}
process.stdout.write(out.join('\n') + '\n');
await reader.close();
