#!/usr/bin/env bash
# Import a small root CAR with pin-roots=true (connection may drop on long recursive pins),
# then confirm with pin/ls. Reads FILEBASE_* from ~/.config/elephant/filebase.env (mode 600).
# Usage: pin-root-check.sh <root.car> <root-cid>
set -uo pipefail
set -a; . ~/.config/elephant/filebase.env; set +a
H=$(mktemp); trap 'rm -f $H' EXIT; chmod 600 $H
printf 'Authorization: Bearer %s\n' "$(printf '%s:%s:%s' "$FILEBASE_ACCESS_KEY" "$FILEBASE_SECRET_KEY" "$FILEBASE_BUCKET" | base64)" > $H
curl -sS -m 3600 -X POST -H @$H -F "file=@$1;filename=root.car" "https://rpc.filebase.io/api/v0/dag/import?pin-roots=true&stats=true" | head -c 600; echo
for i in $(seq 1 60); do
  r=$(curl -sS -m 120 -X POST -H @$H "https://rpc.filebase.io/api/v0/pin/ls?arg=$2&type=recursive" 2>&1)
  echo "$r" | grep -q '"recursive"' && { echo "PINNED $2"; exit 0; }
  sleep 30
done
echo "NOT PINNED $2: $r"; exit 1
