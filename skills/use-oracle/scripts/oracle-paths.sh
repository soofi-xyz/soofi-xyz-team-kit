#!/usr/bin/env bash
# Shared path helper for use-oracle stage scripts.
#
# Derives SOOFI_PLUGIN_ROOT (this plugin's repository root) and
# SOOFI_ORACLE_RUNTIME (skills/use-oracle/runtime under that root) from this
# script's own on-disk location via BASH_SOURCE, never from the caller's
# current working directory, $0, or any alias/symlink invocation path. This
# guarantees the same result no matter which directory a stage script is
# invoked from.
#
# Usage:
#   source skills/use-oracle/scripts/oracle-paths.sh   # exports both vars
#   skills/use-oracle/scripts/oracle-paths.sh          # prints KEY=value lines
#
# Do not replace the BASH_SOURCE[0] resolution below with $0, $PWD, or any
# other caller-supplied path signal — that would reintroduce the
# cwd-dependent bug this helper exists to remove.

oracle_paths_main() {
  local source_path dir plugin_root runtime_root

  source_path="${BASH_SOURCE[0]:-$0}"
  dir="$(cd -- "$(dirname -- "${source_path}")" >/dev/null 2>&1 && pwd -P)" || return 1
  # dir == <plugin-root>/skills/use-oracle/scripts
  plugin_root="$(cd -- "${dir}/../../.." >/dev/null 2>&1 && pwd -P)" || return 1
  runtime_root="${plugin_root}/skills/use-oracle/runtime"

  if [[ ! -f "${plugin_root}/.cursor-plugin/plugin.json" ]]; then
    echo "oracle-paths.sh: resolved SOOFI_PLUGIN_ROOT (${plugin_root}) is missing .cursor-plugin/plugin.json; refusing to export unverified paths" >&2
    return 1
  fi

  if [[ ! -d "${runtime_root}" ]]; then
    echo "oracle-paths.sh: resolved SOOFI_ORACLE_RUNTIME (${runtime_root}) does not exist" >&2
    return 1
  fi

  SOOFI_PLUGIN_ROOT="${plugin_root}"
  SOOFI_ORACLE_RUNTIME="${runtime_root}"
  export SOOFI_PLUGIN_ROOT
  export SOOFI_ORACLE_RUNTIME
}

oracle_paths_main
oracle_paths_status=$?
unset -f oracle_paths_main

if [[ "${BASH_SOURCE[0]:-$0}" == "${0}" ]]; then
  if [[ "${oracle_paths_status}" -eq 0 ]]; then
    printf 'SOOFI_PLUGIN_ROOT=%s\n' "${SOOFI_PLUGIN_ROOT}"
    printf 'SOOFI_ORACLE_RUNTIME=%s\n' "${SOOFI_ORACLE_RUNTIME}"
  fi
  exit "${oracle_paths_status}"
fi
unset oracle_paths_status
