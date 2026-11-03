#!/usr/bin/env bash
# Build one Florida county's Atlas `county` archive from the DOR NAL roll.
#
#   run-county.sh <slug> [--work DIR] [--shards N] [--limit N] [--atlas DIR] [--car-validate] [--keep]
#
# Steps: download NAL -> generate lexicon property folders (sharded) -> parity check
# against the published Hardee golden record -> validate shards in parallel ->
# hash all properties into one CAR -> export-tables (+ Atlas page when --atlas is given).
# Pinning (elephant-cli upload) and the Atlas PR are separate steps; see SKILL.md.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SLUG="${1:?usage: run-county.sh <slug> [options]}"; shift
WORK="${TMPDIR:-/tmp}/florida-nal"; SHARDS="$(( $(getconf _NPROCESSORS_ONLN) - 2 ))"; LIMIT=""; ATLAS=""; CAR_VALIDATE=0; KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --work) WORK="$2"; shift 2;;
    --shards) SHARDS="$2"; shift 2;;
    --limit) LIMIT="$2"; shift 2;;
    --atlas) ATLAS="$2"; shift 2;;
    --car-validate) CAR_VALIDATE=1; shift;;
    --keep) KEEP=1; shift;;
    *) echo "unknown option $1" >&2; exit 2;;
  esac
done
[ "$SHARDS" -lt 1 ] && SHARDS=1

read -r COUNTY LEXNAME FIPS URL < <(python3 -I - "$HERE/fl-counties.json" "$SLUG" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
r = next((c for c in d["counties"] if c["slug"] == sys.argv[2]), None)
if not r or not r.get("url"):
    sys.exit(f"county {sys.argv[2]!r} has no NAL source in fl-counties.json")
print(r["county"].replace(" ", "_"), r["lexicon_county_name"].replace(" ", "_"), r["fips"], r["url"])
EOF
)
COUNTY="${COUNTY//_/ }"; LEXNAME="${LEXNAME//_/ }"
D="$WORK/$SLUG"; mkdir -p "$D/src"
log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }
t0=$(date +%s)

# 1. Download once (cached by URL).
if [ ! -s "$D/src/nal.zip" ]; then log "download $URL"; curl -fsS -m 1800 -o "$D/src/nal.zip" "$URL"; fi
rm -rf "$D/src/csv"; unzip -q -o "$D/src/nal.zip" -d "$D/src/csv"
CSV="$(ls "$D"/src/csv/*.csv | head -1)"
SHA=$(shasum -a 256 "$D/src/nal.zip" | cut -d' ' -f1)

# 2. Generate property folders into shards.
rm -rf "$D/props" "$D/all"
log "generate ($COUNTY, $SHARDS shards)"
node "$HERE/nal-to-lexicon.mjs" --csv "$CSV" --county "$LEXNAME" --source-url "$URL" --out "$D/props" --shards "$SHARDS" ${LIMIT:+--limit "$LIMIT"} | tee "$D/generate.json"

# 3. Parity: the generator must reproduce the published Hardee golden record byte for byte.
"$HERE/parity-check.sh" "$WORK"

# 4. Validate shards in parallel against the live lexicon.
log "validate $SHARDS shards in parallel"
pids=()
for s in "$D"/props/shard-*; do
  elephant-cli validate "$s" --output-csv "$s.errors.csv" >"$s.validate.log" 2>&1 & pids+=($!)
done
fail=0; for p in "${pids[@]}"; do wait "$p" || fail=1; done
ERRORS=$(cat "$D"/props/shard-*.errors.csv | grep -vc '^property_cid' || true)
if [ "$fail" -ne 0 ] || [ "$ERRORS" -ne 0 ]; then
  log "validation failed: $ERRORS error rows; see $D/props/shard-*.errors.csv"; exit 1
fi

# 5. Move every property into one directory and hash it into one county CAR.
mkdir -p "$D/all"
python3 -I - "$D/props" "$D/all" <<'EOF'
import os, sys
src, dst = sys.argv[1], sys.argv[2]
for shard in sorted(os.listdir(src)):
    p = os.path.join(src, shard)
    if os.path.isdir(p):
        for name in os.listdir(p):
            os.rename(os.path.join(p, name), os.path.join(dst, name))
EOF
log "hash -> $SLUG-county.car"
elephant-cli hash "$D/all" --output-zip "$D/hashed" --output-csv "$D/hash.csv" --output-car "$D/$SLUG-county.car" 2>&1 \
  | grep -E 'CAR written|Properties processed' | tee "$D/hash.log"

if [ "$CAR_VALIDATE" -eq 1 ]; then
  log "full CAR validation (slow: about 10 properties/second)"
  elephant-cli validate "$D/$SLUG-county.car" --output-csv "$D/car-errors.csv" 2>&1 | grep -E 'errors|passed|failed'
fi

# 6. Tables, plus the Atlas page entry when an Atlas checkout is given.
log "export-tables"
elephant-cli export-tables "$D/$SLUG-county.car" --output "$D/tables" --part-size 1g --output-json "$D/tables-export.json" \
  ${ATLAS:+--atlas-page "$ATLAS/counties/FL/$SLUG.json" --county "$SLUG" --state FL --fips "$FIPS"} 2>&1 | grep -E 'Tables written|Atlas page'

python3 -I - "$D" "$SLUG" "$COUNTY" "$URL" "$SHA" "$(( $(date +%s) - t0 ))" <<'EOF'
import json, re, sys
d, slug, county, url, sha, secs = sys.argv[1:]
gen = json.load(open(f"{d}/generate.json"))
tables = json.load(open(f"{d}/tables-export.json"))
car = re.search(r"root (\S+)\)", open(f"{d}/hash.log").read()).group(1)
out = {"slug": slug, "county": county, "properties": gen["written"], "source_url": url, "source_sha256": sha,
       "car": f"{d}/{slug}-county.car", "archive_root": car, "tables_root": tables["root"],
       "tables_dir": f"{d}/tables", "seconds": int(secs)}
json.dump(out, open(f"{d}/summary.json", "w"), indent=1); print(json.dumps(out))
EOF

# 7. Keep only the CAR, tables and summary unless --keep (about 57 KB/parcel in flight, 5 KB kept).
[ "$KEEP" -eq 1 ] || rm -rf "$D/props" "$D/all" "$D/hashed" "$D/src/csv"
