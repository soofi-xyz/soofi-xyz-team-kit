#!/usr/bin/env bash
# Copies Enact's agent definition schema into enact/schema/ so T1
# (scripts/test-enact-packaging.py) validates against the contract Enact enforces.
#
#   scripts/sync-enact-schema.sh [sync|check] [<enact checkout>]
#
# The source is prismteam-ai/enact origin/main:schemas/agent-definition.schema.json, read from a
# local checkout (default: $ENACT_REPO, then ../prism-enact next to this repository). Without a
# checkout, it is fetched with `gh api` (needs read access to prismteam-ai/enact).
set -euo pipefail

command="${1:-sync}"
case "${command}" in
  sync|check) ;;
  *) echo "usage: scripts/sync-enact-schema.sh [sync|check] [<enact checkout>]" >&2; exit 2 ;;
esac

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
target="${root}/enact/schema/agent-definition.schema.json"
source_path="schemas/agent-definition.schema.json"
repo="${2:-${ENACT_REPO:-${root}/../prism-enact}}"

tmp="$(mktemp)"
trap 'rm -f "${tmp}"' EXIT
if [[ -d "${repo}/.git" || -f "${repo}/.git" ]]; then
  git -C "${repo}" fetch --quiet origin main
  git -C "${repo}" show "origin/main:${source_path}" > "${tmp}"
  revision="$(git -C "${repo}" rev-parse origin/main)"
else
  gh api -H "Accept: application/vnd.github.raw" "repos/prismteam-ai/enact/contents/${source_path}?ref=main" > "${tmp}"
  revision="$(gh api repos/prismteam-ai/enact/commits/main --jq .sha)"
fi

if [[ "${command}" == "check" ]]; then
  if cmp -s "${tmp}" "${target}"; then
    echo "enact/schema is current with prismteam-ai/enact ${revision}"
    exit 0
  fi
  echo "enact/schema/agent-definition.schema.json differs from prismteam-ai/enact ${revision}; run scripts/sync-enact-schema.sh sync" >&2
  exit 1
fi

mkdir -p "$(dirname "${target}")"
cp "${tmp}" "${target}"
printf '%s\n' "${revision}" > "${root}/enact/schema/SOURCE_REVISION"
echo "synced enact/schema from prismteam-ai/enact ${revision}"
