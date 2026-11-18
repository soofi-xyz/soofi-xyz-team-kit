#!/usr/bin/env bash
# Copies Enact's agent and skill definition schemas into enact/schema/ so T1
# (scripts/test-enact-packaging.py) validates against the contract Enact enforces.
#
#   scripts/sync-enact-schema.sh [sync|check] [<enact checkout>]
#
# The sources are prismteam-ai/enact origin/main:schemas/agent-definition.schema.json and
# schemas/skill-definition.schema.json, read from a local checkout (default: $ENACT_REPO, then
# ../prism-enact next to this repository). Without a checkout, they are fetched with `gh api`
# (needs read access to prismteam-ai/enact). sync records the commit in enact/schema/SOURCE_REVISION.
set -euo pipefail

command="${1:-sync}"
case "${command}" in
  sync|check) ;;
  *) echo "usage: scripts/sync-enact-schema.sh [sync|check] [<enact checkout>]" >&2; exit 2 ;;
esac

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
target="${root}/enact/schema"
schemas=(agent-definition.schema.json skill-definition.schema.json)
repo="${2:-${ENACT_REPO:-${root}/../prism-enact}}"

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
if [[ -d "${repo}/.git" || -f "${repo}/.git" ]]; then
  git -C "${repo}" fetch --quiet origin main
  revision="$(git -C "${repo}" rev-parse origin/main)"
  for schema in "${schemas[@]}"; do
    git -C "${repo}" show "${revision}:schemas/${schema}" > "${work}/${schema}"
  done
else
  revision="$(gh api repos/prismteam-ai/enact/commits/main --jq .sha)"
  for schema in "${schemas[@]}"; do
    gh api -H "Accept: application/vnd.github.raw" "repos/prismteam-ai/enact/contents/schemas/${schema}?ref=${revision}" > "${work}/${schema}"
  done
fi

if [[ "${command}" == "check" ]]; then
  for schema in "${schemas[@]}"; do
    if ! cmp -s "${work}/${schema}" "${target}/${schema}"; then
      echo "enact/schema/${schema} differs from prismteam-ai/enact ${revision}; run scripts/sync-enact-schema.sh sync" >&2
      exit 1
    fi
  done
  echo "enact/schema is current with prismteam-ai/enact ${revision}"
  exit 0
fi

mkdir -p "${target}"
for schema in "${schemas[@]}"; do
  cp "${work}/${schema}" "${target}/${schema}"
done
printf '%s\n' "${revision}" > "${target}/SOURCE_REVISION"
echo "synced enact/schema from prismteam-ai/enact ${revision}"
