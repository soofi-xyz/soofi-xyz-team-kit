#!/usr/bin/env node
// Florida DOR NAL roll -> Elephant lexicon property folders (Seed + County data groups).
// Usage: node nal-to-lexicon.mjs --csv <NAL.csv> --county <Name> --out <dir>
//        (--source-url <DOR NAL zip URL> | --co-no <NN> --year <YYYY>)
//        [--limit N] [--parcel PARCEL_ID] [--shards N]
// With --shards N, property folders go to <out>/shard-NN/ so shards can be validated in parallel.
// Every record's provenance is the official DOR NAL download for that county and year.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const SEED_SCHEMA = 'bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu';
const COUNTY_SCHEMA = 'bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return a;
}, []));
for (const k of ['csv', 'county', 'out']) if (!args[k]) { console.error(`missing --${k}`); process.exit(2); }

const url = args['source-url'] || `https://floridarevenue.com/property/dataportal/Documents/PTO%20Data%20Portal/Tax%20Roll%20Data%20Files/NAL/${args.year}F/${encodeURIComponent(args.county).replace(/%2D/g, '-')}%20${args['co-no']}%20Final%20NAL%20${args.year}.zip`;
const SRC = { method: 'GET', url };
const limit = args.limit ? Number(args.limit) : Infinity;
const shards = args.shards ? Number(args.shards) : 0;
let written = 0;

function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur); return out;
}
const int = (v) => { const s = String(v ?? '').trim(); if (!/^-?\d+(\.\d+)?$/.test(s)) return null; return Math.round(Number(s)); };
const year = (v) => { const n = int(v); return n && n >= 1700 && n <= 2100 ? n : null; };
const area = (v) => { const n = int(v); return n && n >= 10 ? String(n) : null; };
const txt = (v) => { const s = String(v ?? '').trim(); return s ? s : null; };

function propertyType(r) {
  const uc = String(r.DOR_UC || '').padStart(3, '0');
  if (uc === '004' || uc === '005') return 'Unit';
  if (uc === '002') return 'ManufacturedHome';
  if ((int(r.NO_BULDNG) || 0) > 0 || (int(r.TOT_LVG_AREA) || 0) > 0) return 'Building';
  return 'LandParcel';
}

function folderName(pid) { return pid.replace(/[^A-Za-z0-9._-]/g, '_'); }

function writeProperty(r, root) {
  const pid = r.PARCEL_ID.trim();
  const shardDir = shards ? path.join(root, `shard-${String(written % shards).padStart(2, '0')}`) : root;
  const dir = path.join(shardDir, folderName(pid));
  fs.mkdirSync(dir, { recursive: true });
  const base = { request_identifier: pid, source_http_request: SRC };
  const addrParts = [txt(r.PHY_ADDR1), txt(r.PHY_ADDR2), txt(r.PHY_CITY)].filter(Boolean);
  const unnormalized = addrParts.length ? `${addrParts.join(' ')} FL ${txt(r.PHY_ZIPCD) || ''}`.trim() : null;
  const files = {
    'parcel.json': { parcel_identifier: pid, ...base },
    'address.json': { county_name: args.county, ...base, unnormalized_address: unnormalized },
    'property.json': {
      livable_floor_area: area(r.TOT_LVG_AREA),
      parcel_identifier: pid,
      property_effective_built_year: year(r.EFF_YR_BLT),
      property_legal_description_text: txt(r.S_LEGAL),
      property_structure_built_year: year(r.ACT_YR_BLT),
      property_type: propertyType(r),
      ...base,
      total_area: area(r.LND_SQFOOT),
    },
    'lot.json': {
      driveway_condition: null, driveway_material: null, fence_height: null, fence_length: null,
      fencing_type: null, landscaping_features: null, lot_area_sqft: int(r.LND_SQFOOT) || null,
      lot_condition_issues: null, lot_length_feet: null, lot_type: null, lot_width_feet: null,
      ...base, view: null,
    },
    'tax.json': {
      monthly_tax_amount: null, period_end_date: null, period_start_date: null,
      property_assessed_value_amount: int(r.AV_SD), property_building_amount: null,
      property_land_amount: int(r.LND_VAL), property_market_value_amount: int(r.JV),
      property_taxable_value_amount: int(r.TV_NSD), ...base, tax_year: int(r.ASMNT_YR),
    },
    'relationship_address_has_parcel.json': { from: { '/': './address.json' }, to: { '/': './parcel.json' } },
    'relationship_property_has_address.json': { from: { '/': './property.json' }, to: { '/': './address.json' } },
    'relationship_property_has_lot.json': { from: { '/': './property.json' }, to: { '/': './lot.json' } },
    'relationship_property_has_tax_1.json': { from: { '/': './property.json' }, to: { '/': './tax.json' } },
    [`${SEED_SCHEMA}.json`]: { label: 'Seed', relationships: { address_has_parcel: { '/': './relationship_address_has_parcel.json' } } },
    [`${COUNTY_SCHEMA}.json`]: { label: 'County', relationships: {
      property_has_address: { '/': './relationship_property_has_address.json' },
      property_has_lot: { '/': './relationship_property_has_lot.json' },
      property_has_tax: [{ '/': './relationship_property_has_tax_1.json' }],
    } },
  };
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), JSON.stringify(body));
}

const rl = readline.createInterface({ input: fs.createReadStream(args.csv, { encoding: 'latin1' }), crlfDelay: Infinity });
let header = null; let n = 0; let skipped = 0; const seen = new Set();
fs.mkdirSync(args.out, { recursive: true });
for await (const line of rl) {
  if (!header) { header = parseCsvLine(line); continue; }
  if (!line.trim()) continue;
  const cols = parseCsvLine(line);
  const r = Object.fromEntries(header.map((h, i) => [h, cols[i]]));
  const pid = (r.PARCEL_ID || '').trim();
  if (!pid || seen.has(pid)) { skipped++; continue; }
  if (args.parcel && pid !== args.parcel) continue;
  seen.add(pid);
  writeProperty(r, args.out);
  written++;
  if (++n >= limit) break;
}
console.log(JSON.stringify({ county: args.county, written: n, skipped, shards, source: url }));
