#!/usr/bin/env bash
# Copies Enact's agent definition schema into enact/schema/ so T1
# (scripts/test-enact-packaging.py) validates against the contract Enact enforces.
#
#   scripts/sync-enact-schema.sh [sync|check|next|check-next] [<enact checkout>]
#
# sync/check: enact/schema/agent-definition.schema.json is prismteam-ai/enact
#   origin/main:schemas/agent-definition.schema.json (the "current" contract).
# next/check-next: enact/schema/next/agent-definition.schema.json is main's schema with the
#   additions of the open pull request branches below merged in (the "next" contract), plus
#   schemas/skill-definition.schema.json from the skill library branch. Source commits are
#   recorded in enact/schema/next/SOURCE_REVISIONS. A branch that changes a part of the schema
#   another branch also changes, differently, stops the merge.
#
# The source is read from a local checkout (default: $ENACT_REPO, then ../prism-enact next to
# this repository). Without a checkout, sync/check fetch with `gh api` (needs read access to
# prismteam-ai/enact); next/check-next need a checkout.
set -euo pipefail

command="${1:-sync}"
case "${command}" in
  sync|check|next|check-next) ;;
  *) echo "usage: scripts/sync-enact-schema.sh [sync|check|next|check-next] [<enact checkout>]" >&2; exit 2 ;;
esac

# The open Enact pull requests whose manifest fields the "next" contract carries.
next_branches=(
  feat/shared-skill-library   # enact#27 library_skills
  feat/remote-mcp-servers     # enact#25 mcp_servers
  feat/agent-secrets          # enact#26 secrets
  feat/browser-sandbox-preview # enact#23 browser.sandbox_localhost
)

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source_path="schemas/agent-definition.schema.json"
repo="${2:-${ENACT_REPO:-${root}/../prism-enact}}"
have_checkout=false
if [[ -d "${repo}/.git" || -f "${repo}/.git" ]]; then
  have_checkout=true
fi

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

compare_or_write() { # <generated dir> <target dir> <label>
  local generated="$1" target="$2" label="$3" file
  if [[ "${command}" == check* ]]; then
    for file in "${generated}"/*; do
      if ! cmp -s "${file}" "${target}/$(basename "${file}")"; then
        local fix=sync
        [[ "${command}" == "check-next" ]] && fix=next
        echo "${target#"${root}/"}/$(basename "${file}") differs from ${label}; run scripts/sync-enact-schema.sh ${fix}" >&2
        exit 1
      fi
    done
    echo "${target#"${root}/"} is current with ${label}"
    exit 0
  fi
  mkdir -p "${target}"
  cp "${generated}"/* "${target}/"
  echo "synced ${target#"${root}/"} from ${label}"
}

if [[ "${command}" == "sync" || "${command}" == "check" ]]; then
  mkdir -p "${work}/out"
  if ${have_checkout}; then
    git -C "${repo}" fetch --quiet origin main
    git -C "${repo}" show "origin/main:${source_path}" > "${work}/out/agent-definition.schema.json"
    revision="$(git -C "${repo}" rev-parse origin/main)"
  else
    gh api -H "Accept: application/vnd.github.raw" "repos/prismteam-ai/enact/contents/${source_path}?ref=main" > "${work}/out/agent-definition.schema.json"
    revision="$(gh api repos/prismteam-ai/enact/commits/main --jq .sha)"
  fi
  printf '%s\n' "${revision}" > "${work}/out/SOURCE_REVISION"
  if [[ "${command}" == "check" ]]; then
    # SOURCE_REVISION moves with every Enact commit; only the schema must match.
    rm "${work}/out/SOURCE_REVISION"
  fi
  compare_or_write "${work}/out" "${root}/enact/schema" "prismteam-ai/enact ${revision}"
fi

# next / check-next
if ! ${have_checkout}; then
  echo "scripts/sync-enact-schema.sh ${command} needs a prismteam-ai/enact checkout (\$ENACT_REPO or ../prism-enact)" >&2
  exit 2
fi
git -C "${repo}" fetch --quiet origin main "${next_branches[@]}"
mkdir -p "${work}/src" "${work}/out"
git -C "${repo}" show "origin/main:${source_path}" > "${work}/src/main.json"
revisions="main $(git -C "${repo}" rev-parse origin/main)"
for i in "${!next_branches[@]}"; do
  branch="${next_branches[$i]}"
  git -C "${repo}" show "origin/${branch}:${source_path}" > "${work}/src/${i}.json"
  revisions+=$'\n'"${branch} $(git -C "${repo}" rev-parse "origin/${branch}")"
done
git -C "${repo}" show "origin/${next_branches[0]}:schemas/skill-definition.schema.json" > "${work}/out/skill-definition.schema.json"
printf '%s\n' "${revisions}" > "${work}/out/SOURCE_REVISIONS"

# Three-way merge of each branch's schema onto main's: keys a branch adds are added, keys it
# changes are taken, and two branches changing one key differently is a conflict.
node - "${work}/src" "${#next_branches[@]}" "${work}/out/agent-definition.schema.json" <<'NODE'
const fs = require("node:fs");
const [dir, count, out] = process.argv.slice(2);
const read = (f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
function merge(base, ours, theirs, where) {
  if (same(ours, theirs) || same(base, theirs)) return ours;
  if (same(base, ours)) return theirs;
  if (isObj(base) && isObj(ours) && isObj(theirs)) {
    const result = {};
    for (const k of [...new Set([...Object.keys(ours), ...Object.keys(theirs)])]) {
      const v = merge(base[k], ours[k], theirs[k], `${where}/${k}`);
      if (v !== undefined) result[k] = v;
    }
    return result;
  }
  throw new Error(`conflicting changes at ${where || "/"}`);
}
const base = read("main.json");
let merged = base;
for (let i = 0; i < Number(count); i++) merged = merge(base, merged, read(`${i}.json`), "");
merged.description = `${merged.description} This copy is the "next" contract: prismteam-ai/enact main plus the open pieces in SOURCE_REVISIONS.`;
fs.writeFileSync(out, JSON.stringify(merged, null, 2) + "\n");
NODE

if [[ "${command}" == "check-next" ]]; then
  rm "${work}/out/SOURCE_REVISIONS"
fi
compare_or_write "${work}/out" "${root}/enact/schema/next" "prismteam-ai/enact main + ${next_branches[*]}"
