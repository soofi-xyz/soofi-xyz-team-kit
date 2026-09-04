#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: s3-prefix-count.sh --s3-uri s3://bucket/prefix [--window-minutes 60]

Prints JSON with total object count, recent object count, latest LastModified,
and total bytes for an S3 prefix.
USAGE
}

WINDOW_MINUTES=60
S3_URI=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --s3-uri)
      S3_URI="${2:-}"
      shift 2
      ;;
    --window-minutes)
      WINDOW_MINUTES="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$S3_URI" ]]; then
  usage >&2
  exit 2
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required" >&2
  exit 127
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 127
fi

if ! [[ "$S3_URI" =~ ^s3://([^/]+)/?(.*)$ ]]; then
  echo "Invalid S3 URI: $S3_URI" >&2
  exit 2
fi

BUCKET="${BASH_REMATCH[1]}"
PREFIX="${BASH_REMATCH[2]}"
CUTOFF="$(date -u -d "${WINDOW_MINUTES} minutes ago" +%Y-%m-%dT%H:%M:%S)"

aws s3api list-objects-v2 \
  --bucket "$BUCKET" \
  --prefix "$PREFIX" \
  --output json \
  | jq --arg s3Uri "$S3_URI" --arg cutoff "$CUTOFF" --argjson windowMinutes "$WINDOW_MINUTES" '
      (.Contents // []) as $objects
      | {
          s3Uri: $s3Uri,
          windowMinutes: $windowMinutes,
          count: ($objects | length),
          recentCount: ($objects | map(select(.LastModified >= $cutoff)) | length),
          latestLastModified: ($objects | map(.LastModified) | max),
          totalBytes: ($objects | map(.Size // 0) | add // 0)
        }
    '
