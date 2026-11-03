#!/usr/bin/env bash
# Regenerate the published Hardee golden property and require byte-identical CIDs.
# Atlas PR #85 (FL/hardee, county group) registered archive root baguqeeraajj2izgpmn2szwkyjxekjbslk55qqxxst6ickadkwnipuhcsiwlq.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="${1:-${TMPDIR:-/tmp}/florida-nal}"
mkdir -p "$BASE/_parity"
CACHE="$BASE/_parity/hardee.zip"
WORK="$(mktemp -d "$BASE/_parity/run.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
URL='https://floridarevenue.com/property/dataportal/Documents/PTO%20Data%20Portal/Tax%20Roll%20Data%20Files/NAL/2026F/Hardee%2035%20Final%20NAL%202026.zip'
PARCEL='0434250350000120004'
EXPECT_PROPERTY='baguqeeram7a7iehq3zr3ekwcqmd3icwbt47a6lv2meansp5tonb4cprnqn5a'
EXPECT_COUNTY='baguqeerawfcufno66mbtmkhsu4jqv67dqzpcnuzyx5mxmqlfforry3mtivaq'
EXPECT_ROOT='baguqeeraajj2izgpmn2szwkyjxekjbslk55qqxxst6ickadkwnipuhcsiwlq'
[ -s "$CACHE" ] || curl -fsS -m 600 -o "$CACHE.tmp.$$" "$URL" && mv -f "$CACHE.tmp.$$" "$CACHE" 2>/dev/null || true
rm -rf "$WORK/csv" "$WORK/out" "$WORK/hashed" && unzip -q -o "$CACHE" -d "$WORK/csv"
node "$HERE/nal-to-lexicon.mjs" --csv "$(ls "$WORK"/csv/*.csv | head -1)" --county Hardee --source-url "$URL" --out "$WORK/out" --parcel "$PARCEL" >/dev/null
root=$(elephant-cli hash "$WORK/out" --output-zip "$WORK/hashed" --output-csv "$WORK/hash.csv" --output-car "$WORK/hardee.car" 2>&1 | sed -nE 's/.*root ([a-z0-9]+)\).*/\1/p')
grep -q "^$EXPECT_PROPERTY,.*,$EXPECT_COUNTY," "$WORK/hash.csv" && [ "$root" = "$EXPECT_ROOT" ] \
  && echo "parity: OK (Hardee golden record reproduced; archive root $root)" \
  || { echo "parity: FAILED (got root $root, expected $EXPECT_ROOT)" >&2; exit 1; }
