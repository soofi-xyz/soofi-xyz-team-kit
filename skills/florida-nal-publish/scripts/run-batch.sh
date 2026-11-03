#!/usr/bin/env bash
# Build several Florida counties, PARALLEL at a time, splitting cores between them.
#   run-batch.sh --work DIR [--parallel 2] <slug> [<slug> ...]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK=""; PAR=2
while [ $# -gt 0 ]; do case "$1" in --work) WORK="$2"; shift 2;; --parallel) PAR="$2"; shift 2;; *) break;; esac; done
[ -n "$WORK" ] || { echo "usage: run-batch.sh --work DIR [--parallel N] <slug>..." >&2; exit 2; }
SHARDS=$(( ($(getconf _NPROCESSORS_ONLN) - 2) / PAR )); [ "$SHARDS" -lt 1 ] && SHARDS=1
mkdir -p "$WORK/logs"
one() {
  if "$HERE/run-county.sh" "$1" --work "$WORK" --shards "$SHARDS" >"$WORK/logs/$1.log" 2>&1; then
    echo "$(date -u +%H:%M:%S) OK $1 $(tail -1 "$WORK/logs/$1.log" | grep -o '"properties": [0-9]*')"
  else
    echo "$(date -u +%H:%M:%S) FAILED $1 (see $WORK/logs/$1.log)"
  fi
}
for slug in "$@"; do
  while [ "$(jobs -rp | wc -l)" -ge "$PAR" ]; do sleep 5; done
  one "$slug" &
done
wait
