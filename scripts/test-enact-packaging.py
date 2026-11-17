#!/usr/bin/env python3
"""T1: validate the generated Enact agent packages under enact/<agent>/.

Run `node scripts/sync-enact-agents.mjs sync` first; skill copies are gitignored and only exist
after a sync.

Each package must:
  - validate, as {manifest, files}, against enact/schema/agent-definition.schema.json (copied from
    prismteam-ai/enact by scripts/sync-enact-schema.sh) with manifest.name equal to its directory;
  - hold at most 1 MiB of files with a non-blank instructions.md;
  - have a SKILL.md in every skills/<name>/ directory;
  - have no path that is also a folder of another path;
  - declare (enact/overrides/<agent>.json requires_mcp) only MCP servers on the allow-list
    (enact/config.json mcp_allow_list: Enact's own and the built-in browser).

Agents in enact/config.json must_pass_waves fail the run; every other agent is report-only
unless --strict is given.

  python3 scripts/test-enact-packaging.py [--strict] [--agent NAME ...] [--json]
  python3 scripts/test-enact-packaging.py --self-test
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENACT = ROOT / "enact"
MAX_BYTES = 1024 * 1024


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def read_package(pkg: Path) -> tuple[dict, dict[str, str]]:
    manifest = load_json(pkg / "agent.json")
    files: dict[str, str] = {}
    for path in sorted(p for p in pkg.rglob("*") if p.is_file()):
        rel = path.relative_to(pkg).as_posix()
        if rel == "agent.json":
            continue
        files[rel] = path.read_text(encoding="utf-8")
    return manifest, files


def check_package(
    name: str,
    manifest: dict,
    files: dict[str, str],
    validator,
    requires_mcp: list[str],
    allow_list: list[str],
    expected_skills: list[str] | None = None,
) -> list[str]:
    problems: list[str] = []
    for error in sorted(validator.iter_errors({"manifest": manifest, "files": files}), key=lambda e: list(e.absolute_path)):
        where = "/".join(str(p) for p in error.absolute_path) or "(document)"
        problems.append(f"schema: {where}: {error.message[:200]}")
    if manifest.get("name") != name:
        problems.append(f"manifest.name {manifest.get('name')!r} does not match directory {name!r}")
    if not files.get("instructions.md", "").strip():
        problems.append("instructions.md is missing or blank")
    total = sum(len(text.encode("utf-8")) for text in files.values())
    if total > MAX_BYTES:
        problems.append(f"files hold {total} bytes, over 1 MiB ({MAX_BYTES})")
    skill_dirs = sorted({p.split("/")[1] for p in files if p.startswith("skills/") and p.count("/") >= 2})
    for skill in skill_dirs:
        if f"skills/{skill}/SKILL.md" not in files:
            problems.append(f"skills/{skill}/ has no SKILL.md")
    for skill in expected_skills or []:
        if skill not in skill_dirs:
            problems.append(f"skills/{skill}/ missing; run node scripts/sync-enact-agents.mjs sync")
    paths = set(files)
    for path in sorted(paths):
        parts = path.split("/")
        for i in range(1, len(parts)):
            if "/".join(parts[:i]) in paths:
                problems.append(f"path clash: {'/'.join(parts[:i])} is a file and a folder of {path}")
    outside = sorted(set(requires_mcp) - set(allow_list))
    if outside:
        problems.append(f"requires_mcp {outside} outside the allow-list {sorted(allow_list)} (remote-mcp)")
    return problems


def make_validator():
    try:
        from jsonschema import Draft202012Validator
    except ImportError:  # pragma: no cover - CI installs jsonschema
        sys.exit("jsonschema is required: pip install -r skills/validate-transform-configuration/scripts/requirements-silvally.txt")
    schema = load_json(ENACT / "schema" / "agent-definition.schema.json")
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def run(args) -> int:
    config = load_json(ENACT / "config.json")
    inventory_path = ENACT / "inventory.json"
    if not inventory_path.is_file():
        sys.exit("enact/inventory.json is missing; run node scripts/sync-enact-agents.mjs sync")
    inventory = load_json(inventory_path)
    validator = make_validator()
    allow = config["mcp_allow_list"]
    must = set(config.get("must_pass_waves", []))

    rows = []
    for name, info in sorted(inventory["agents"].items()):
        if info["wave"] == "stays-local":
            continue
        if args.agent and name not in args.agent:
            continue
        pkg = ENACT / name
        if not (pkg / "agent.json").is_file():
            problems = ["package missing; run node scripts/sync-enact-agents.mjs sync"]
            total = 0
        else:
            manifest, files = read_package(pkg)
            problems = check_package(name, manifest, files, validator, info.get("requires_mcp", []), allow, info.get("skills", []))
            total = sum(len(t.encode("utf-8")) for t in files.values())
        gating = args.strict or info["wave"] in must
        rows.append({"agent": name, "wave": info["wave"], "bytes": total, "pass": not problems, "gating": gating, "problems": problems})

    if args.json:
        print(json.dumps(rows, indent=2))
    else:
        print(f"{'agent':<13} {'wave':<5} {'bytes':>9}  result")
        for r in rows:
            mark = "PASS" if r["pass"] else ("FAIL" if r["gating"] else "fail (report-only)")
            print(f"{r['agent']:<13} {r['wave']:<5} {r['bytes']:>9}  {mark}")
            for p in r["problems"][:8]:
                print(f"    - {p}")
            if len(r["problems"]) > 8:
                print(f"    - … {len(r['problems']) - 8} more")
        passed = sum(r["pass"] for r in rows)
        print(f"\nT1: {passed}/{len(rows)} packages pass; must-pass waves {sorted(must)}"
              + ("; strict" if args.strict else ""))
    failing = [r["agent"] for r in rows if r["gating"] and not r["pass"]]
    if failing:
        print(f"T1 FAILED for gating agents: {', '.join(failing)}", file=sys.stderr)
        return 1
    return 0


def self_test() -> int:
    """Regression tests: donphan fails on its declared MCP, and each rule catches its case."""
    config = load_json(ENACT / "config.json")
    validator = make_validator()
    allow = config["mcp_allow_list"]
    failures = []

    def expect(label: str, problems: list[str], needle: str | None):
        ok = (not problems) if needle is None else any(needle in p for p in problems)
        if not ok:
            failures.append(f"{label}: expected {'no problems' if needle is None else needle!r}, got {problems}")

    base_manifest = {
        "name": "sample",
        "version": "1.0.0",
        "description": "Sample agent.",
        "model": "sonnet",
        "limits": {"max_turns": 10, "max_cost_usd": 1},
        "channels": ["direct"],
        "repositories": [],
        "hosts": [],
    }
    base_files = {"instructions.md": "Do one thing.\n", "skills/a/SKILL.md": "---\nname: a\ndescription: a\n---\n"}

    expect("valid sample", check_package("sample", base_manifest, base_files, validator, [], allow), None)
    expect("browser allowed", check_package("sample", base_manifest, base_files, validator, ["browser"], allow), None)
    expect("remote MCP", check_package("sample", base_manifest, base_files, validator, ["elephant"], allow), "remote-mcp")
    expect("over 1 MiB", check_package("sample", base_manifest, {**base_files, "skills/a/big.md": "x" * 250_000, "skills/a/b2.md": "x" * 250_000, "skills/a/b3.md": "x" * 250_000, "skills/a/b4.md": "x" * 250_000, "skills/a/b5.md": "x" * 100_000}, validator, [], allow), "over 1 MiB")
    expect("missing SKILL.md", check_package("sample", base_manifest, {**base_files, "skills/b/README.md": "x"}, validator, [], allow), "skills/b/ has no SKILL.md")
    expect("path clash", check_package("sample", base_manifest, {**base_files, "skills/a/x": "1", "skills/a/x/y": "2"}, validator, [], allow), "path clash")
    expect("bad model", check_package("sample", {**base_manifest, "model": "gpt-5.5-high"}, base_files, validator, [], allow), "schema: manifest/model")
    expect("long description", check_package("sample", {**base_manifest, "description": "x" * 501}, base_files, validator, [], allow), "schema: manifest/description")
    expect("name mismatch", check_package("other", base_manifest, base_files, validator, [], allow), "does not match directory")

    # The real donphan package must fail: it declares the elephant MCP server.
    inventory = load_json(ENACT / "inventory.json")
    donphan = inventory["agents"].get("donphan")
    if donphan is None or "elephant" not in donphan.get("requires_mcp", []):
        failures.append("donphan: inventory must declare requires_mcp elephant (enact/overrides/donphan.json)")
    elif not (ENACT / "donphan" / "agent.json").is_file():
        failures.append("donphan: package missing; run node scripts/sync-enact-agents.mjs sync")
    else:
        manifest, files = read_package(ENACT / "donphan")
        expect("donphan", check_package("donphan", manifest, files, validator, donphan["requires_mcp"], allow, donphan["skills"]), "requires_mcp ['elephant']")
        if "remote-mcp" not in donphan.get("blocked_by", []):
            failures.append("donphan: inventory blocked_by must include remote-mcp")

    if failures:
        for f in failures:
            print(f"FAIL {f}", file=sys.stderr)
        return 1
    print("test-enact-packaging self-test passed (donphan fails on requires_mcp elephant)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--strict", action="store_true", help="every agent must pass, not only must-pass waves")
    parser.add_argument("--agent", action="append", help="check only this agent (repeatable)")
    parser.add_argument("--json", action="store_true", help="print results as JSON")
    parser.add_argument("--self-test", action="store_true", help="run the regression tests")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
