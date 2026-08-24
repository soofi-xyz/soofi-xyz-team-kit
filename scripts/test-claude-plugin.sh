#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Automated behavioral tests for the Claude Code plugin feature.
#
# Validates quickstart items V1-V5 + V7.
# All tests are expected to FAIL until the scripts under test are implemented.
# ---------------------------------------------------------------------------

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SYNC_SCRIPT="${REPO_ROOT}/scripts/sync-claude-agents.sh"
INSTALLER_SCRIPT="${REPO_ROOT}/scripts/local-claude-code-plugin.sh"

# ── Temp dir + cleanup ─────────────────────────────────────────────────────
TMPDIR_ROOT="$(mktemp -d)"
trap 'rm -rf -- "${TMPDIR_ROOT}"' EXIT

# ── Counters ───────────────────────────────────────────────────────────────
PASS_COUNT=0
FAIL_COUNT=0

pass() {
  local name="$1"
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "  PASS  $name"
}

fail() {
  local name="$1"
  local reason="${2:-}"
  FAIL_COUNT=$((FAIL_COUNT + 1))
  if [[ -n "$reason" ]]; then
    echo "  FAIL  $name -- $reason"
  else
    echo "  FAIL  $name"
  fi
}

# ── Helpers ────────────────────────────────────────────────────────────────

# Write a minimal agent markdown file with frontmatter.
write_agent() {
  local dir="$1" name="$2" model="$3"
  local extra="${4:-}"
  {
    echo "---"
    echo "name: ${name}"
    echo "description: test agent"
    echo "model: ${model}"
    [[ -n "$extra" ]] && echo "$extra"
    echo "---"
    echo "Test body."
  } > "${dir}/${name}.md"
}

# Check that a script exists and is executable; return 0/1.
script_available() {
  local script="$1"
  [[ -x "$script" ]]
}

###########################################################################
# SYNC TESTS (V1 – V3)
###########################################################################
echo
echo "=== Sync tests (V1-V3) ==="

# Prepare temp source and target dirs
SYNC_SRC="${TMPDIR_ROOT}/agents"
SYNC_TGT="${TMPDIR_ROOT}/agents-claude"
mkdir -p "$SYNC_SRC"

# Populate synthetic agents for V1 model-mapping tests
write_agent "$SYNC_SRC" "test-opus"          "gpt-5.5-high"
write_agent "$SYNC_SRC" "test-sonnet-medium" "gpt-5.5-medium"
write_agent "$SYNC_SRC" "test-sonnet-high"   "gpt-5.4-high"
write_agent "$SYNC_SRC" "test-inherit"       "unknown-model"

# Agent for readonly test
{
  echo "---"
  echo "name: test-readonly"
  echo "description: test readonly agent"
  echo "model: gpt-5.5-medium"
  echo "readonly: true"
  echo "---"
  echo "Test body."
} > "${SYNC_SRC}/test-readonly.md"

# Agent for field pass-through test
write_agent "$SYNC_SRC" "test-passthrough" "gpt-5.5-medium" "temperature: 0.7"

# ── V1 - Model mapping ────────────────────────────────────────────────────

run_sync() {
  local mode="${1:-sync}"
  SYNC_SOURCE_DIR="$SYNC_SRC" SYNC_TARGET_DIR="$SYNC_TGT" "$SYNC_SCRIPT" "$mode" 2>&1
}

if ! script_available "$SYNC_SCRIPT"; then
  fail "V1-model-opus"          "script not found: $SYNC_SCRIPT"
  fail "V1-model-sonnet-medium" "script not found: $SYNC_SCRIPT"
  fail "V1-model-sonnet-high"   "script not found: $SYNC_SCRIPT"
  fail "V1-model-inherit"       "script not found: $SYNC_SCRIPT"
  fail "V1-readonly"            "script not found: $SYNC_SCRIPT"
  fail "V1-passthrough"         "script not found: $SYNC_SCRIPT"
  fail "V1-generated-header"    "script not found: $SYNC_SCRIPT"
  fail "V1-check-synced"        "script not found: $SYNC_SCRIPT"
  fail "V2-stale-cleanup"       "script not found: $SYNC_SCRIPT"
  fail "V3-check-detects-drift" "script not found: $SYNC_SCRIPT"
else
  # Run sync
  if ! run_sync sync; then
    fail "V1-model-opus"          "sync exited non-zero"
    fail "V1-model-sonnet-medium" "sync exited non-zero"
    fail "V1-model-sonnet-high"   "sync exited non-zero"
    fail "V1-model-inherit"       "sync exited non-zero"
    fail "V1-readonly"            "sync exited non-zero"
    fail "V1-passthrough"         "sync exited non-zero"
    fail "V1-generated-header"    "sync exited non-zero"
    fail "V1-check-synced"        "sync exited non-zero"
    fail "V2-stale-cleanup"       "sync exited non-zero"
    fail "V3-check-detects-drift" "sync exited non-zero"
  else
    # ── V1 - Model mapping checks ─────────────────────────────────────────
    check_model() {
      local test_name="$1" file="$2" expected="$3"
      if [[ ! -f "$file" ]]; then
        fail "$test_name" "output file not found: $file"
        return
      fi
      if grep -q "model: ${expected}" "$file"; then
        pass "$test_name"
      else
        fail "$test_name" "expected 'model: ${expected}' in $(basename "$file")"
      fi
    }

    check_model "V1-model-opus"          "${SYNC_TGT}/test-opus.md"          "opus"
    check_model "V1-model-sonnet-medium" "${SYNC_TGT}/test-sonnet-medium.md" "sonnet"
    check_model "V1-model-sonnet-high"   "${SYNC_TGT}/test-sonnet-high.md"   "sonnet"
    check_model "V1-model-inherit"       "${SYNC_TGT}/test-inherit.md"       "inherit"

    # ── V1 - Readonly translation ──────────────────────────────────────────
    RO_FILE="${SYNC_TGT}/test-readonly.md"
    if [[ ! -f "$RO_FILE" ]]; then
      fail "V1-readonly" "output file not found: $RO_FILE"
    else
      ro_ok=true
      if ! grep -q "permissionMode: plan" "$RO_FILE"; then
        fail "V1-readonly" "missing 'permissionMode: plan'"
        ro_ok=false
      fi
      if ! grep -q "tools: Read, Glob, Grep, Bash" "$RO_FILE"; then
        [[ "$ro_ok" == true ]] && fail "V1-readonly" "missing 'tools: Read, Glob, Grep, Bash'"
        ro_ok=false
      fi
      # Check that 'readonly' does not appear as a frontmatter field (between --- markers).
      # The filename in the generated header comment may contain 'readonly' — that is OK.
      # Extract frontmatter lines (between first and second ---), excluding the closing ---
      ro_frontmatter="$(awk 'NR==1{next} /^---$/{exit} {print}' "$RO_FILE")"
      if echo "$ro_frontmatter" | grep -q "^readonly:"; then
        [[ "$ro_ok" == true ]] && fail "V1-readonly" "output frontmatter still contains 'readonly:'"
        ro_ok=false
      fi
      [[ "$ro_ok" == true ]] && pass "V1-readonly"
    fi

    # ── V1 - Field pass-through ────────────────────────────────────────────
    PT_FILE="${SYNC_TGT}/test-passthrough.md"
    if [[ ! -f "$PT_FILE" ]]; then
      fail "V1-passthrough" "output file not found: $PT_FILE"
    elif grep -q "temperature: 0.7" "$PT_FILE"; then
      pass "V1-passthrough"
    else
      fail "V1-passthrough" "expected 'temperature: 0.7' in output"
    fi

    # ── V1 - Generated header ─────────────────────────────────────────────
    header_ok=true
    for out_file in "${SYNC_TGT}"/*.md; do
      [[ -f "$out_file" ]] || continue
      if ! grep -q '<!-- Generated from agents/' "$out_file"; then
        header_ok=false
        break
      fi
    done
    if [[ "$header_ok" == true ]]; then
      pass "V1-generated-header"
    else
      fail "V1-generated-header" "missing '<!-- Generated from agents/' comment in output"
    fi

    # ── V1 - Check mode after sync ────────────────────────────────────────
    if run_sync check; then
      pass "V1-check-synced"
    else
      fail "V1-check-synced" "check exited non-zero after clean sync"
    fi

    # ── V2 - Stale cleanup ────────────────────────────────────────────────
    STALE_FILE="${SYNC_TGT}/stale-leftover.md"
    echo "stale content" > "$STALE_FILE"
    if run_sync sync && [[ ! -f "$STALE_FILE" ]]; then
      pass "V2-stale-cleanup"
    else
      fail "V2-stale-cleanup" "stale file was not removed after sync"
    fi

    # ── V3 - Check detects drift ──────────────────────────────────────────
    # Overwrite one output with garbage, then run check — expect non-zero.
    DRIFT_FILE="${SYNC_TGT}/test-opus.md"
    if [[ -f "$DRIFT_FILE" ]]; then
      echo "GARBAGE" > "$DRIFT_FILE"
      if run_sync check; then
        fail "V3-check-detects-drift" "check should have exited non-zero after drift"
      else
        pass "V3-check-detects-drift"
      fi
    else
      fail "V3-check-detects-drift" "output file not found for drift test"
    fi
  fi
fi

###########################################################################
# INSTALLER TESTS (V5)
###########################################################################
echo
echo "=== Installer tests (V5) ==="

INSTALL_ROOT="${TMPDIR_ROOT}/claude-plugins"

if ! script_available "$INSTALLER_SCRIPT"; then
  fail "V5-install-remove-cycle" "script not found: $INSTALLER_SCRIPT"
  fail "V5-safety-check"         "script not found: $INSTALLER_SCRIPT"
else
  # ── V5 - Install / remove cycle ─────────────────────────────────────────
  mkdir -p "$INSTALL_ROOT"
  install_ok=true
  if ! CLAUDE_PLUGIN_ROOT="$INSTALL_ROOT" "$INSTALLER_SCRIPT" install 2>&1; then
    fail "V5-install-remove-cycle" "install exited non-zero"
    install_ok=false
  fi

  if [[ "$install_ok" == true ]]; then
    # Check expected artefacts exist somewhere under INSTALL_ROOT
    found_plugin_json=false
    found_agents_claude=false
    found_skills=false
    found_mcp=false
    found_local_name=false

    # The installer may nest under a subdirectory; search recursively.
    while IFS= read -r -d '' f; do
      case "$f" in
        */.claude-plugin/plugin.json) found_plugin_json=true ;;
      esac
    done < <(find "$INSTALL_ROOT" -name "plugin.json" -path "*/.claude-plugin/*" -print0 2>/dev/null)

    [[ -d "$(find "$INSTALL_ROOT" -type d -name "agents-claude" 2>/dev/null | head -1)" ]] && found_agents_claude=true
    [[ -d "$(find "$INSTALL_ROOT" -type d -name "skills" 2>/dev/null | head -1)" ]] && found_skills=true

    while IFS= read -r -d '' f; do
      found_mcp=true
    done < <(find "$INSTALL_ROOT" -name "mcp-claude.json" -print0 2>/dev/null)

    # Check manifest name contains -local
    if [[ "$found_plugin_json" == true ]]; then
      pj="$(find "$INSTALL_ROOT" -name "plugin.json" -path "*/.claude-plugin/*" | head -1)"
      if grep -q '"-local"' "$pj" || grep -q -- '-local' "$pj"; then
        found_local_name=true
      fi
    fi

    if $found_plugin_json && $found_agents_claude && $found_skills && $found_mcp && $found_local_name; then
      # Now test remove
      if CLAUDE_PLUGIN_ROOT="$INSTALL_ROOT" "$INSTALLER_SCRIPT" remove 2>&1; then
        # Verify the installed artefacts are gone
        remaining="$(find "$INSTALL_ROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
        if [[ "$remaining" == "0" ]]; then
          pass "V5-install-remove-cycle"
        else
          fail "V5-install-remove-cycle" "directories remain after remove"
        fi
      else
        fail "V5-install-remove-cycle" "remove exited non-zero"
      fi
    else
      local_parts=""
      $found_plugin_json   || local_parts="${local_parts} .claude-plugin/plugin.json"
      $found_agents_claude || local_parts="${local_parts} agents-claude/"
      $found_skills        || local_parts="${local_parts} skills/"
      $found_mcp           || local_parts="${local_parts} mcp-claude.json"
      $found_local_name    || local_parts="${local_parts} name-contains-local"
      fail "V5-install-remove-cycle" "missing artefacts:${local_parts}"
    fi
  fi

  # ── V5 - Safety check ──────────────────────────────────────────────────
  # The safety check prevents path traversal via LOCAL_PLUGIN_NAME escaping
  # the plugin root (e.g., ../../etc). Set plugin root to temp dir and
  # try to escape it with a traversal name.
  SAFE_ROOT="${TMPDIR_ROOT}/safe-plugins"
  mkdir -p "$SAFE_ROOT"
  if CLAUDE_PLUGIN_ROOT="$SAFE_ROOT" LOCAL_PLUGIN_NAME="../../escape-attempt" "$INSTALLER_SCRIPT" install 2>&1; then
    fail "V5-safety-check" "install should have rejected path traversal outside plugin root"
    rm -rf "$SAFE_ROOT" 2>/dev/null || true
  else
    pass "V5-safety-check"
  fi
fi

###########################################################################
# VERSION TEST (V7)
###########################################################################
echo
echo "=== Version test (V7) ==="

CURSOR_PLUGIN_JSON="${REPO_ROOT}/.cursor-plugin/plugin.json"
CLAUDE_PLUGIN_JSON="${REPO_ROOT}/.claude-plugin/plugin.json"
CLAUDE_MARKETPLACE_JSON="${REPO_ROOT}/.claude-plugin/marketplace.json"

v7_ok=true
v7_reason=""

if [[ ! -f "$CURSOR_PLUGIN_JSON" ]]; then
  v7_ok=false
  v7_reason="missing ${CURSOR_PLUGIN_JSON}"
elif [[ ! -f "$CLAUDE_PLUGIN_JSON" ]]; then
  v7_ok=false
  v7_reason="missing ${CLAUDE_PLUGIN_JSON}"
elif [[ ! -f "$CLAUDE_MARKETPLACE_JSON" ]]; then
  v7_ok=false
  v7_reason="missing ${CLAUDE_MARKETPLACE_JSON}"
else
  # Extract versions using python for reliable JSON parsing.
  python_bin="python3"
  command -v python3 >/dev/null 2>&1 || python_bin="python"

  cursor_ver="$("$python_bin" -c "import json,sys; print(json.load(open(sys.argv[1]))['version'])" "$CURSOR_PLUGIN_JSON")"
  claude_ver="$("$python_bin" -c "import json,sys; print(json.load(open(sys.argv[1]))['version'])" "$CLAUDE_PLUGIN_JSON")"
  marketplace_ver="$("$python_bin" -c "import json,sys; print(json.load(open(sys.argv[1]))['metadata']['version'])" "$CLAUDE_MARKETPLACE_JSON")"

  if [[ "$cursor_ver" != "$claude_ver" ]]; then
    v7_ok=false
    v7_reason="claude plugin.json version ($claude_ver) != cursor plugin.json version ($cursor_ver)"
  elif [[ "$cursor_ver" != "$marketplace_ver" ]]; then
    v7_ok=false
    v7_reason="marketplace.json version ($marketplace_ver) != cursor plugin.json version ($cursor_ver)"
  fi
fi

if [[ "$v7_ok" == true ]]; then
  pass "V7-version-consistency"
else
  fail "V7-version-consistency" "$v7_reason"
fi

###########################################################################
# SUMMARY
###########################################################################
echo
TOTAL=$((PASS_COUNT + FAIL_COUNT))
echo "── ${PASS_COUNT} passed, ${FAIL_COUNT} failed (${TOTAL} total) ──"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi
