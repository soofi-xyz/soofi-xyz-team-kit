#!/usr/bin/env bash
# Report the Claude Code + team-kit setup on this machine: what is installed,
# which agents are available, which MCP servers connect, and the fix for each
# failure. Read-only: it never installs, signs in, or changes settings.
#
# Usage (regular terminal, not inside Claude Code):
#   bash team-kit-check.sh            # full report
#   bash team-kit-check.sh --agents   # also list every agent name
#   bash team-kit-check.sh --test     # also send one test prompt per kit and MCP server
#                                     # (uses a few requests from your Claude plan)
#
# Exit code: 0 when every required check passes, 1 otherwise.
set -uo pipefail

show_agents=0
run_tests=0
for arg in "$@"; do
  case "$arg" in
    --agents) show_agents=1 ;;
    --test) run_tests=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [[ -t 1 ]]; then
  OK=$'\033[32m✔\033[0m'; BAD=$'\033[31m✘\033[0m'; WARN=$'\033[33m!\033[0m'
else
  OK='✔'; BAD='✘'; WARN='!'
fi

echo "Team-kit check — $(date '+%Y-%m-%d %H:%M')"

# Claude Code must be found before anything else can be checked.
if ! command -v claude >/dev/null 2>&1; then
  if [[ -x "$HOME/.local/bin/claude" ]]; then
    echo "$BAD Claude Code is installed at ~/.local/bin/claude but that folder is not on your PATH"
    echo "    Fix (regular terminal):"
    echo "      echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc && source ~/.zshrc"
    echo "    Then run this check again."
  else
    echo "$BAD Claude Code is not installed"
    echo "    Fix (regular terminal): curl -fsSL https://claude.ai/install.sh | bash"
  fi
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1 || ! python3 -c 'import json' >/dev/null 2>&1; then
  echo "$BAD python3 is missing (it ships with the Xcode Command Line Tools on macOS)"
  echo "    Fix (regular terminal): xcode-select --install"
  exit 1
fi

export TKC_OK="$OK" TKC_BAD="$BAD" TKC_WARN="$WARN" TKC_SHOW_AGENTS="$show_agents" TKC_RUN_TESTS="$run_tests"
exec python3 - <<'PY'
import json
import os
import re
import shutil
import subprocess
import urllib.request
from pathlib import Path

OK, BAD, WARN = os.environ["TKC_OK"], os.environ["TKC_BAD"], os.environ["TKC_WARN"]
SHOW_AGENTS = os.environ.get("TKC_SHOW_AGENTS") == "1"
RUN_TESTS = os.environ.get("TKC_RUN_TESTS") == "1"

KITS = [
    {
        "plugin": "soofi-xyz-team-kit",
        "marketplace": "soofi-xyz",
        "source": "soofi-xyz/soofi-xyz-team-kit",
        "latest_url": "https://raw.githubusercontent.com/soofi-xyz/soofi-xyz-team-kit/main/.claude-plugin/marketplace.json",
        "test_agent": "arceus",
    },
]
TERMS_FIX = ("Fix: run `claude` in a regular terminal and answer the 'Updates to Consumer Terms' screen",
             "(pick '2. Accept terms · Help improve our AI models: OFF' for company work), then /exit.")

failures = 0


def run(*args, timeout=120):
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout, p.stderr
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 124, "", str(exc)


def ok(msg):
    print(f"{OK} {msg}")


def warn(msg, *fix):
    print(f"{WARN} {msg}")
    for line in fix:
        print(f"    {line}")


def fail(msg, *fix):
    global failures
    failures += 1
    print(f"{BAD} {msg}")
    for line in fix:
        print(f"    {line}")


def section(title):
    print(f"\n== {title}")


# ---------------------------------------------------------------- Claude Code
section("Claude Code")
_, out, _ = run("claude", "--version", timeout=30)
ok(f"Claude Code {out.strip() or '(version unknown)'} at {shutil.which('claude')}")

rc, out, _ = run("claude", "auth", "status", timeout=30)
try:
    auth = json.loads(out)
except json.JSONDecodeError:
    auth = {}
if auth.get("loggedIn"):
    method = auth.get("authMethod", "?")
    who = auth.get("email")
    plan = auth.get("subscriptionType")
    ok(f"Signed in ({method}{', ' + plan if plan else ''}{', ' + who if who else ''})")
    if who and not who.lower().endswith("@prismteam.ai"):
        warn(f"Signed in as {who}, not a @prismteam.ai account",
             "Sign in with your Prism Google account: inside Claude Code run /logout, then /login.")
    if method not in ("claude.ai", "oauth_token"):
        warn(f"Signed in with {method}, not a Claude subscription",
             "The team uses the Claude Ultra subscription. Inside Claude Code run /logout, then /login,",
             "and pick '1. Claude account with subscription'.")
else:
    fail("Not signed in",
         "Fix: in a regular terminal run `claude`, then type /login inside Claude Code and pick",
         "'1. Claude account with subscription'. Or run `claude auth login` in a regular terminal.")

# ---------------------------------------------------------------- Prerequisites
section("Prerequisites")
if shutil.which("git"):
    gv = re.search(r"\d+(?:\.\d+)+", run("git", "--version", timeout=15)[1])
    ok(f"git {gv.group(0) if gv else '(version unknown)'}")
else:
    fail("git is missing (Claude Code needs it to add plugin marketplaces)",
         "Fix (regular terminal): xcode-select --install")

NODE_FIX = ("Fix (regular terminal): brew install node   (Homebrew not yours, or no admin rights:",
            "`nvm install 22 && nvm alias default 22`; see docs/move-to-claude-code.md step 0.2)")


def node_check(path):
    v = run(path, "-v", timeout=15)[1].strip()
    parts = [int(x) for x in re.findall(r"\d+", v)[:2]] + [0, 0]
    return v, (parts[0], parts[1]) >= (22, 18)


# Pick Node the way mcp.json's elephant launcher does: the newest nvm Node that is 22.18+,
# else /opt/homebrew/bin, /usr/local/bin, then the first `node` on this shell's PATH.
node = next((str(p) for p in sorted((Path.home() / ".nvm" / "versions" / "node").glob("*/bin/node"),
                                     key=lambda p: [int(x) for x in re.findall(r"\d+", p.parent.parent.name)],
                                     reverse=True) if node_check(str(p))[1]), None)
node = node or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.access(p, os.X_OK)), None)
node = node or shutil.which("node")
v, node_ok = node_check(node) if node else ("", False)
node_dir = Path(node).parent if node_ok and node != shutil.which("node") else None
if node_ok and node_dir:
    ok(f"Node {v} at {node}, which the elephant MCP server picks by itself (not the first node on this shell's PATH)")
elif node_ok:
    ok(f"Node {v} (the elephant MCP server needs 22.18+)")
elif node:
    fail(f"Node {v} at {node} is too old for the elephant MCP server (needs 22.18+)" if v
         else f"node at {node} does not run (`node -v` failed); the elephant MCP server needs Node 22.18+", *NODE_FIX)
else:
    fail("No Node 22.18+ found on PATH, in /opt/homebrew/bin or /usr/local/bin, or under ~/.nvm", *NODE_FIX)

# ---------------------------------------------------------------- Plugins
section("Team kit")
rc, out, _ = run("claude", "plugin", "marketplace", "list", "--json", timeout=60)
try:
    marketplaces = {m["name"]: m for m in json.loads(out)}
except (json.JSONDecodeError, KeyError, TypeError):
    marketplaces = {}
rc, out, _ = run("claude", "plugin", "list", "--json", timeout=60)
try:
    plugins = {p["id"]: p for p in json.loads(out)}
except (json.JSONDecodeError, KeyError, TypeError):
    plugins = {}

installed = []
for kit in KITS:
    pid = f"{kit['plugin']}@{kit['marketplace']}"
    if kit["marketplace"] not in marketplaces:
        fail(f"{kit['plugin']}: marketplace '{kit['marketplace']}' is not added",
             f"Fix (regular terminal): claude plugin marketplace add {kit['source']}",
             f"                         claude plugin install {pid}")
        continue
    p = plugins.get(pid)
    if not p:
        fail(f"{kit['plugin']}: not installed",
             f"Fix (regular terminal): claude plugin install {pid}")
        continue
    if not p.get("enabled", False):
        fail(f"{kit['plugin']} {p.get('version')}: installed but disabled",
             f"Fix (regular terminal): claude plugin enable {pid}")
        continue
    line = f"{kit['plugin']} {p.get('version')} installed and enabled (scope: {p.get('scope')})"
    latest = None
    if kit["latest_url"]:
        try:
            with urllib.request.urlopen(kit["latest_url"], timeout=10) as r:
                data = json.load(r)
            latest = next((e.get("version") for e in data.get("plugins", []) if e.get("name") == kit["plugin"]), None)
        except Exception:
            latest = None
    if latest and latest != p.get("version"):
        warn(f"{line}; version {latest} is available",
             f"Fix (regular terminal): claude plugin marketplace update {kit['marketplace']} && claude plugin update {pid}",
             "Then restart Claude Code (or run /reload-plugins inside it).")
    else:
        ok(line)
    installed.append((kit, p))

# ---------------------------------------------------------------- Agents
section("Agents")


def agent_names(install_path):
    root = Path(install_path)
    manifest = root / ".claude-plugin" / "plugin.json"
    files = []
    try:
        listed = json.loads(manifest.read_text()).get("agents")
    except (OSError, json.JSONDecodeError):
        listed = None
    if isinstance(listed, list):
        files = [root / f for f in listed]
    else:
        files = sorted((root / (listed or "agents")).glob("*.md"))
    names = []
    for f in files:
        try:
            m = re.search(r"(?m)^name:\s*['\"]?([\w.-]+)", f.read_text())
        except OSError:
            continue
        names.append(m.group(1) if m else f.stem)
    return names


def skill_count(install_path):
    return len(list((Path(install_path) / "skills").glob("*/SKILL.md")))


if not installed:
    fail("No team-kit agents available (install the kit above first)")
for kit, p in installed:
    names = agent_names(p["installPath"])
    if names:
        example = kit["test_agent"] if kit["test_agent"] in names else names[0]
        ok(f"{kit['plugin']}: {len(names)} agents, {skill_count(p['installPath'])} skills "
           f"(call as {kit['plugin']}:<agent>, e.g. {kit['plugin']}:{example})")
        if SHOW_AGENTS:
            for i in range(0, len(names), 8):
                print("      " + ", ".join(names[i:i + 8]))
    else:
        fail(f"{kit['plugin']}: installed but no agents found in {p['installPath']}",
             f"Fix (regular terminal): claude plugin uninstall {kit['plugin']}@{kit['marketplace']} && "
             f"claude plugin install {kit['plugin']}@{kit['marketplace']}")

# ---------------------------------------------------------------- MCP servers
section("MCP servers")
rc, out, err = run("claude", "mcp", "list", timeout=180)
# Claude Code 2.1.87 prints ✓/✗; older releases print ✔/✘.
STATUS = re.compile(r"^(?P<name>\S+): .* - (?P<status>[✔✓✘✗!⏸⊘].*)$")
CONNECTED = ("✔", "✓")
servers = []
for raw in out.splitlines():
    m = STATUS.match(raw.strip())
    if m:
        servers.append((m.group("name"), m.group("status").strip()))
if not servers:
    if "No MCP servers" in out:
        fail("No MCP servers configured (the team kit ships `elephant`; install the kit above first)")
    else:
        fail("Could not read `claude mcp list`", f"Output: {(out or err).strip()[:300]}")


def mcp_fix(name, status):
    short = name.split(":")[-1]
    if status.startswith("!"):
        return ["Fix: inside Claude Code type /mcp, select the server and choose Authenticate."]
    if status.startswith("⏸"):
        return ["Fix: run `claude` in that project folder and approve the server when asked."]
    if status.startswith("⊘"):
        return ["Fix: inside Claude Code type /mcp, select the server and choose Enable."]
    fix = []
    if short == "elephant" and not node_ok:
        fix += ["The elephant server needs Node 22.18+ on PATH: apply the Prerequisites fix above first."]
    elif short == "elephant":
        cmd = "npx -y --package=github:elephant-xyz/elephant-mcp#main mcp"
        if node_dir:
            cmd = f'PATH="{node_dir}:$PATH" {cmd}'
        fix += ["Node is fine. A 30s timeout or 'Connection closed' hides the server's own error. Quit every",
                "Claude Code window first (each one starts its own copy), then run its command yourself, with",
                "no time limit (regular terminal); a first download can take about 5 minutes:",
                f"  {cmd}",
                "'Starting MCP server with stdio transport' then syncing = it started (embedding, AWS credential",
                "and Atlas sync errors are expected): press Ctrl-C.",
                "npm error ENOTEMPTY under ~/.npm/_npx = two copies installed at once: rm -rf ~/.npm/_npx and run it again.",
                "A stack trace (e.g. MODULE_NOT_FOUND) = it crashes on start: rm -rf ~/.npm/_npx and run it again;",
                "if it still crashes, note the error for your pass-it-on PR and do not reinstall Node",
                "(docs/move-to-claude-code.md, step 5.1). It also needs network access to github.com and npm."]
    fix += [f"Details (regular terminal): claude mcp get {name}   (read the `Issue:` line)",
            "Then run this check again. In an open Claude Code session, /exit and start `claude` again",
            "(/mcp reconnect all can answer 'No MCP servers need reconnecting' while a server is failing)."]
    return fix


for name, status in servers:
    if status.startswith(CONNECTED):
        ok(f"{name}: {status[1:].strip()}")
    else:
        fail(f"{name}: {status}", *mcp_fix(name, status))

# ---------------------------------------------------------------- Test prompts
if RUN_TESTS:
    section("Test prompts (one agent and each MCP server)")
    scratch = Path.home() / ".claude" / "team-kit-check"
    scratch.mkdir(parents=True, exist_ok=True)

    def prompt(text, *extra):
        rc, out, err = run("claude", "-p", text, *extra, timeout=300)
        return rc, (out or err).strip()

    tests = [(f"{kit['plugin']}:{kit['test_agent']}",
              f"Use the {kit['plugin']}:{kit['test_agent']} subagent to reply with exactly: ok", ())
             for kit, _ in installed]
    if any(name.endswith(":elephant") and status.startswith(CONNECTED) for name, status in servers):
        tests.append(("elephant MCP",
                      "Call the listAtlasCounties tool on the elephant MCP server. "
                      "If the call returns counties reply with exactly: ok",
                      ("--allowedTools", "mcp__plugin_soofi-xyz-team-kit_elephant__listAtlasCounties")))
    old_cwd = os.getcwd()
    os.chdir(scratch)
    for label, text, extra in tests:
        rc, out = prompt(text, *extra)
        last = out.splitlines()[-1].strip().strip("`*.").lower() if out else ""
        if "ACTION REQUIRED" in out and "Terms" in out:
            fail(f"{label}: blocked by the updated Consumer Terms", *TERMS_FIX)
        elif rc == 0 and last == "ok":
            ok(f"{label}: answered ok")
        else:
            fail(f"{label}: expected 'ok', got: {out[:200] or f'exit code {rc}'}",
                 "Fix: open `claude`, run the same prompt interactively and read the error;",
                 "for MCP problems type /mcp inside Claude Code.")
    os.chdir(old_cwd)

# ---------------------------------------------------------------- Summary
print()
if failures:
    print(f"{BAD} {failures} problem(s) found. Apply each fix above, then run this check again.")
    print("    Still stuck? Write down what you saw and follow 'Pass it on' in docs/move-to-claude-code.md.")
    raise SystemExit(1)
print(f"{OK} Everything required is installed and connected.")
PY
