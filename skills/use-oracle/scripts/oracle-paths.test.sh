#!/usr/bin/env bash
# Behavioral test for oracle-paths.sh: proves path resolution is independent
# of the caller's current working directory. Invoked by
# scripts/validate-plugin.sh (and therefore CI) — not a manual-only script.
set -euo pipefail

repo_root() {
  # -P (physical) resolution here matches oracle-paths.sh's own `pwd -P`, so
  # the comparison below is meaningful even when $TMPDIR sits behind a
  # top-level symlink (e.g. macOS's /var -> /private/var).
  local script_dir
  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
  cd -- "${script_dir}/../../.." && pwd -P
}

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

tmp_dir=""
cleanup() {
  [[ -n "${tmp_dir}" ]] && rm -rf -- "${tmp_dir}"
}
trap cleanup EXIT

main() {
  local root script
  root="$(repo_root)"
  script="${root}/skills/use-oracle/scripts/oracle-paths.sh"
  local expected_runtime="${root}/skills/use-oracle/runtime"

  bash -n "${script}"

  tmp_dir="$(mktemp -d)"

  # 1. Sourced from a temporary, unrelated working directory.
  local sourced_root sourced_runtime
  sourced_root="$(cd "${tmp_dir}" && source "${script}" && printf '%s' "${SOOFI_PLUGIN_ROOT}")"
  sourced_runtime="$(cd "${tmp_dir}" && source "${script}" && printf '%s' "${SOOFI_ORACLE_RUNTIME}")"

  [[ "${sourced_root}" == "${root}" ]] || fail "sourced SOOFI_PLUGIN_ROOT=${sourced_root}, expected ${root}"
  [[ "${sourced_runtime}" == "${expected_runtime}" ]] || fail "sourced SOOFI_ORACLE_RUNTIME=${sourced_runtime}, expected ${expected_runtime}"

  # 2. Executed directly (not sourced) via an absolute path, from the same
  #    unrelated working directory.
  local direct_output
  direct_output="$(cd "${tmp_dir}" && "${script}")"
  grep -qF "SOOFI_PLUGIN_ROOT=${root}" <<<"${direct_output}" || fail "direct exec did not print the expected plugin root:\n${direct_output}"
  grep -qF "SOOFI_ORACLE_RUNTIME=${expected_runtime}" <<<"${direct_output}" || fail "direct exec did not print the expected runtime root:\n${direct_output}"

  # 3. Executed through this repo's symlinked Codex plugin tree
  #    (plugins/soofi-xyz-team-kit/skills -> ../../skills), from the same
  #    unrelated working directory. Resolution must still land on the
  #    canonical root, not a path under plugins/.
  local symlinked_script symlinked_output
  symlinked_script="${root}/plugins/soofi-xyz-team-kit/skills/use-oracle/scripts/oracle-paths.sh"
  if [[ -f "${symlinked_script}" ]]; then
    symlinked_output="$(cd "${tmp_dir}" && "${symlinked_script}")"
    grep -qF "SOOFI_PLUGIN_ROOT=${root}" <<<"${symlinked_output}" || fail "symlinked-tree exec did not resolve the canonical plugin root:\n${symlinked_output}"
    grep -qF "SOOFI_ORACLE_RUNTIME=${expected_runtime}" <<<"${symlinked_output}" || fail "symlinked-tree exec did not resolve the canonical runtime root:\n${symlinked_output}"
  fi

  echo "oracle-paths.sh path resolution: PASS (sourced, direct exec, and symlinked-plugin-tree exec from an unrelated cwd)"
}

main "$@"
