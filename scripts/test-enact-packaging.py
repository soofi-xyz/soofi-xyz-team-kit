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
  - have its packed file enact/dist/agents/<agent>.json (and each library skill its
    enact/dist/skills/<skill>.json) be exactly the canonical JSON of {manifest, files}, the PUT
    body Build's enact agent/skill kinds take, within the 2 MiB / 4 MiB body limits;
  - declare (enact/overrides/<agent>.json requires_mcp) only MCP servers on the allow-list
    (enact/inventory.json mcp_allow_list: Enact's own and the built-in browser plus
    enact/config.json mcp_allow_list, and with --allow-list-from the servers a live environment
    allows); manifest mcp_servers likewise.

T1 also checks the skill library (enact/library/), as prismteam-ai/enact main enforces it: each
library skill validates against skill-definition.schema.json, holds at most 3 MiB of text in at
most 500 files, at most 5 MiB as canonical JSON encoded once more as a JSON string, a PUT body of
at most 4 MiB, and its version still names its content; each agent pins only versions in
enact/library/index.json, at most 100 and 8 MiB (stored canonical JSON) together, none also
among its own skills/.

T1 also checks every packed file for text prismteam-ai/build refuses in an Enact document of a
configuration bundle: a {{parameter:name}} or {{secret:name}} placeholder (Deploy fills them in
every bundle file, and an Enact document must be saved unchanged) or a literal credential. The
bundle is generated from this repository's main, so such text fails the run for every agent.

Agents in enact/config.json must_pass_waves fail the run; every other agent is report-only
unless --strict is given.

  python3 scripts/test-enact-packaging.py [--strict] [--agent NAME ...] [--json]
                                          [--allow-list-from https://<shared domain>]
  python3 scripts/test-enact-packaging.py --self-test

--allow-list-from reads GET <url>/enact/mcp-servers with x-api-key $ENACT_API_KEY and adds those
server names to the allow-list; without ENACT_API_KEY it says so and goes on with
enact/config.json mcp_allow_list.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENACT = ROOT / "enact"
MIB = 1024 * 1024
MAX_BYTES = MIB
# prismteam-ai/enact main src/skills/definition.ts and src/agents/definition.ts.
LIBRARY = {"skill_bytes": 3 * MIB, "skill_files": 500, "encoded_bytes": 5 * MIB, "pinned_bytes": 8 * MIB, "pins": 100}


def encoded_bytes(text: str) -> int:
    """Bytes of text once encoded as a JSON string (Enact's proxyEncodedBytes: JSON.stringify)."""
    return len(json.dumps(text, ensure_ascii=False).encode("utf-8"))


def canonical_json(value) -> str:
    """Keys sorted at every level, no whitespace: the JSON Enact and the generator digest."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def stable_json(value) -> str:
    """The generator's stableJson: sorted keys, two-space indent, trailing newline."""
    return json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


MAX_FILE_BYTES = 262144
MAX_ASSET_BYTES = 32 * MIB
MAX_ASSETS_BYTES = 128 * MIB


def skill_of(rel: str) -> str | None:
    parts = rel.split("/")
    return parts[1] if len(parts) > 2 and parts[0] == "skills" else None


def read_package(pkg: Path) -> tuple[dict, dict[str, str], dict[str, bytes]]:
    """The agent directory as Enact's document: text files, and assets (enact docs/agent-contract.md,
    "Assets"). A file that is not UTF-8 is an asset; in a skill that has one, so is any text file
    over the 256 KiB file limit (the rule scripts/sync-enact-agents.mjs packs by)."""
    manifest = load_json(pkg / "agent.json")
    raw: dict[str, bytes] = {}
    for path in sorted(p for p in pkg.rglob("*") if p.is_file()):
        rel = path.relative_to(pkg).as_posix()
        if rel != "agent.json":
            raw[rel] = path.read_bytes()
    files: dict[str, str] = {}
    assets: dict[str, bytes] = {}
    for rel, data in raw.items():
        try:
            files[rel] = data.decode("utf-8")
        except UnicodeDecodeError:
            assets[rel] = data
    with_assets = {skill_of(rel) for rel in assets}
    for rel in [r for r, t in files.items() if skill_of(r) in with_assets and len(t.encode("utf-8")) > MAX_FILE_BYTES]:
        assets[rel] = files.pop(rel).encode("utf-8")
    return manifest, files, assets


def asset_refs(assets: dict[str, bytes]) -> dict[str, dict]:
    return {rel: {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)} for rel, data in sorted(assets.items())}


def agent_document(manifest: dict, files: dict[str, str], assets: dict[str, bytes]) -> dict:
    return {"manifest": manifest, "files": files, **({"assets": asset_refs(assets)} if assets else {})}


def check_assets(assets: dict[str, bytes], store: Path | None) -> list[str]:
    """Asset limits, and each asset's bytes in enact/dist/assets/<sha256> for the save to upload."""
    problems = []
    total = sum(len(d) for d in assets.values())
    if total > MAX_ASSETS_BYTES:
        problems.append(f"assets hold {total} bytes, over 128 MiB")
    if len(assets) > 500:
        problems.append(f"{len(assets)} assets, over 500")
    for rel, ref in asset_refs(assets).items():
        if not rel.startswith("skills/"):
            problems.append(f"asset {rel} is outside skills/<name>/")
        if ref["bytes"] > MAX_ASSET_BYTES:
            problems.append(f"asset {rel} is {ref['bytes']} bytes, over 32 MiB")
        if store is not None:
            stored = store / ref["sha256"]
            if not stored.is_file() or stored.read_bytes() != assets[rel]:
                problems.append(f"asset {rel} is not in {stored.relative_to(ROOT)}; run node scripts/sync-enact-agents.mjs sync")
    return problems


def check_package(
    name: str,
    manifest: dict,
    files: dict[str, str],
    validator,
    requires_mcp: list[str],
    allow_list: list[str],
    expected_skills: list[str] | None = None,
    library: dict | None = None,
    assets: dict[str, bytes] | None = None,
) -> list[str]:
    """library: enact/library/index.json "skills", to check library_skills."""
    problems: list[str] = []
    assets = assets or {}
    for error in sorted(validator.iter_errors(agent_document(manifest, files, assets)), key=lambda e: list(e.absolute_path)):
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
    paths = set(files) | set(assets)
    for path in sorted(paths):
        parts = path.split("/")
        for i in range(1, len(parts)):
            if "/".join(parts[:i]) in paths:
                problems.append(f"path clash: {'/'.join(parts[:i])} is a file and a folder of {path}")
    outside = sorted(set(requires_mcp) - set(allow_list))
    if outside:
        problems.append(f"requires_mcp {outside} outside the allow-list {sorted(allow_list)} (remote-mcp)")
    servers_outside = sorted(set(manifest.get("mcp_servers", [])) - set(allow_list) - set(outside))
    if servers_outside:
        problems.append(f"mcp_servers {servers_outside} not on the environment's allow-list (mcp-allow-list)")
    pins = manifest.get("library_skills", [])
    if pins and library is None:
        problems.append("library_skills given but no skill library to check them against")
    if library is not None:
        names = [pin.get("name") for pin in pins]
        for name in sorted({n for n in names if names.count(n) > 1}):
            problems.append(f"library skill {name} pinned twice")
        pinned_bytes = 0
        for pin in pins:
            entry = library.get(pin.get("name"))
            if entry is None:
                problems.append(f"library skill {pin.get('name')} is not in enact/library/index.json")
                continue
            if entry["version"] != pin.get("version"):
                problems.append(f"library skill {pin['name']} pinned at {pin.get('version')}, library holds {entry['version']}")
            pinned_bytes += entry["stored_bytes"]
            if pin["name"] in skill_dirs:
                problems.append(f"name clash: skills/{pin['name']}/ is both an own skill and a library skill")
        if len(pins) > LIBRARY["pins"]:
            problems.append(f"{len(pins)} library skills, over {LIBRARY['pins']}")
        if pinned_bytes > LIBRARY["pinned_bytes"]:
            problems.append(f"pinned library skills hold {pinned_bytes} bytes, over 8 MiB")
    return problems


def check_library_skill(name: str, manifest: dict, files: dict[str, str], entry: dict | None, validator) -> list[str]:
    """One enact/library/<name>/ directory against the library contract and its index entry."""
    problems: list[str] = []
    document = {"manifest": manifest, "files": files}
    for error in sorted(validator.iter_errors(document), key=lambda e: list(e.absolute_path)):
        where = "/".join(str(p) for p in error.absolute_path) or "(document)"
        problems.append(f"schema: {where}: {error.message[:200]}")
    if manifest.get("name") != name:
        problems.append(f"skill.json name {manifest.get('name')!r} does not match directory {name!r}")
    if not files.get("SKILL.md", "").strip():
        problems.append("SKILL.md is missing or blank")
    total = sum(len(t.encode("utf-8")) for t in files.values())
    if total > LIBRARY["skill_bytes"]:
        problems.append(f"files hold {total} bytes, over 3 MiB")
    if len(files) > LIBRARY["skill_files"]:
        problems.append(f"{len(files)} files, over {LIBRARY['skill_files']}")
    elif (encoded := encoded_bytes(canonical_json(document))) > LIBRARY["encoded_bytes"]:
        problems.append(f"the skill is {encoded} bytes as JSON encoded in a request, over 5 MiB")
    paths = set(files)
    for path in sorted(paths):
        parts = path.split("/")
        for i in range(1, len(parts)):
            if "/".join(parts[:i]) in paths:
                problems.append(f"path clash: {'/'.join(parts[:i])} is a file and a folder of {path}")
    content = stable_json({"description": manifest.get("description"), "files": files, "name": name})
    expected = "1.0.0-sha256-" + hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]
    if manifest.get("version") != expected:
        problems.append(f"version {manifest.get('version')} does not name this content ({expected})")
    if entry is None:
        problems.append("not in enact/library/index.json")
    else:
        digest = "sha256:" + hashlib.sha256(canonical_json(document).encode("utf-8")).hexdigest()
        if entry.get("digest") != digest or entry.get("version") != manifest.get("version"):
            problems.append("enact/library/index.json version or digest does not match the directory")
    return problems


def read_library_skill(path: Path) -> tuple[dict, dict[str, str]]:
    manifest = load_json(path / "skill.json")
    files = {
        p.relative_to(path).as_posix(): p.read_text(encoding="utf-8")
        for p in sorted(path.rglob("*"))
        if p.is_file() and p.relative_to(path).as_posix() != "skill.json"
    }
    return manifest, files


MAX_AGENT_BODY = 2 * MIB
MAX_SKILL_BODY = 4 * MIB


def check_packed(path: Path, document: dict, max_body: int) -> list[str]:
    """A packed enact/dist file must be exactly the canonical JSON of its directory's document:
    it parses back to the same {manifest, files}, its bytes are the canonical JSON (so its SHA-256
    is Enact's digest) and it fits the PUT body limit."""
    if not path.is_file():
        return [f"packed file {path.relative_to(ROOT)} missing; run node scripts/sync-enact-agents.mjs sync"]
    raw = path.read_bytes()
    problems = []
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        return [f"packed file {path.relative_to(ROOT)} is not JSON: {error}"]
    if parsed != document:
        problems.append(f"packed file {path.relative_to(ROOT)} does not round-trip to the directory's manifest and files")
    elif raw != canonical_json(document).encode("utf-8"):
        problems.append(f"packed file {path.relative_to(ROOT)} is not the document's canonical JSON")
    if len(raw) > max_body:
        problems.append(f"packed file {path.relative_to(ROOT)} is {len(raw)} bytes, over the {max_body}-byte PUT body limit")
    return problems


# prismteam-ai/build src/configuration/bundle-check.ts.
PLACEHOLDER = re.compile(r"\{\{(?:parameter|secret):[A-Za-z][A-Za-z0-9]*\}\}")
CREDENTIALS = [
    (re.compile(r'arn:aws[a-z-]*:secretsmanager:[^"\s]+'), "a Secrets Manager ARN"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "an AWS access key id"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "a private key"),
]


def refused_text(text: str) -> list[str]:
    """What Build refuses in the text of an Enact document in a configuration bundle."""
    found = [f"the placeholder {match}" for match in sorted(set(PLACEHOLDER.findall(text)))]
    return found + [what for pattern, what in CREDENTIALS if pattern.search(text)]


def check_refused_text(path: Path) -> list[str]:
    """A packed file's text Build refuses, by the file inside it that holds it."""
    raw = path.read_text(encoding="utf-8")
    try:
        files = json.loads(raw).get("files", {})
    except json.JSONDecodeError:
        return []  # check_packed reports it
    label = path.relative_to(ROOT) if path.is_relative_to(ROOT) else path
    by_file = [f"{label} {name}: holds {what}" for name, text in sorted(files.items()) for what in refused_text(text)]
    # The manifest, when no file explains it.
    return by_file or [f"{label}: holds {what}" for what in refused_text(raw)]


def fetch_allow_list(url: str) -> list[str] | None:
    """Server names on a live environment's list (GET <url>/enact/mcp-servers), or None if no key."""
    key = os.environ.get("ENACT_API_KEY")
    if not key:
        print("--allow-list-from: ENACT_API_KEY is not set; using enact/config.json mcp_allow_list only", file=sys.stderr)
        return None
    request = urllib.request.Request(url.rstrip("/") + "/enact/mcp-servers", headers={"x-api-key": key, "accept": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310 - operator-given https URL
        body = json.loads(response.read().decode("utf-8"))
    return sorted(server["name"] for server in body.get("servers", []))


def make_validator(kind: str = "agent"):
    try:
        from jsonschema import Draft202012Validator
    except ImportError:  # pragma: no cover - CI installs jsonschema
        sys.exit("jsonschema is required: pip install -r skills/validate-transform-configuration/scripts/requirements-silvally.txt")
    schema = load_json(ENACT / "schema" / f"{kind}-definition.schema.json")
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def run(args) -> int:
    config = load_json(ENACT / "config.json")
    inventory_path = ENACT / "inventory.json"
    if not inventory_path.is_file():
        sys.exit("enact/inventory.json is missing; run node scripts/sync-enact-agents.mjs sync")
    inventory = load_json(inventory_path)
    validator = make_validator()
    allow = list(inventory["mcp_allow_list"])
    if args.allow_list_from:
        live = fetch_allow_list(args.allow_list_from)
        if live is not None:
            print(f"allow-list from {args.allow_list_from}: {live}")
            allow = sorted(set(allow) | set(live))
    must = set(config.get("must_pass_waves", []))

    library_rows = []
    index_path = ENACT / "library" / "index.json"
    if not index_path.is_file():
        sys.exit("enact/library/index.json is missing; run node scripts/sync-enact-agents.mjs sync")
    library = load_json(index_path)["skills"]
    skill_validator = make_validator("skill")
    for name, entry in sorted(library.items()):
        skill_dir = ENACT / "library" / name
        if not (skill_dir / "skill.json").is_file():
            problems = ["library skill missing; run node scripts/sync-enact-agents.mjs sync"]
        else:
            manifest, files = read_library_skill(skill_dir)
            problems = check_library_skill(name, manifest, files, entry, skill_validator)
            problems += check_packed(ENACT / "dist" / "skills" / f"{name}.json", {"manifest": manifest, "files": files}, MAX_SKILL_BODY)
        library_rows.append({"skill": name, "bytes": entry["bytes"], "pass": not problems, "problems": problems})

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
            manifest, files, assets = read_package(pkg)
            expected = info.get("own_skills", info.get("skills", []))
            problems = check_package(name, manifest, files, validator, info.get("requires_mcp", []), allow, expected, library, assets)
            problems += check_assets(assets, ENACT / "dist" / "assets")
            problems += check_packed(ENACT / "dist" / "agents" / f"{name}.json", agent_document(manifest, files, assets), MAX_AGENT_BODY)
            total = sum(len(t.encode("utf-8")) for t in files.values())
        gating = args.strict or info["wave"] in must
        rows.append({"agent": name, "wave": info["wave"], "bytes": total, "pass": not problems, "gating": gating, "problems": problems})

    text_problems = [p for kind in ("agents", "skills") for path in sorted((ENACT / "dist" / kind).glob("*.json")) for p in check_refused_text(path)]

    if args.json:
        print(json.dumps({"agents": rows, "library": library_rows, "bundle_text": {"pass": not text_problems, "problems": text_problems}}, indent=2))
    else:
        print(f"MCP allow-list {sorted(allow)}")
        if library_rows:
            bad = [r for r in library_rows if not r["pass"]]
            print(f"library: {len(library_rows) - len(bad)}/{len(library_rows)} skills pass")
            for r in bad:
                print(f"  {r['skill']}: FAIL")
                for p in r["problems"][:8]:
                    print(f"    - {p}")
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
        print(f"bundle text: {'PASS' if not text_problems else 'FAIL'}")
        for p in text_problems[:20]:
            print(f"    - {p}")
        if text_problems:
            print("    write placeholder examples as {{parameter:<name>}} and describe a credential instead of showing one")
    failing = [r["agent"] for r in rows if r["gating"] and not r["pass"]]
    failing += [f"library/{r['skill']}" for r in library_rows if not r["pass"]]
    failing += ["bundle text"] if text_problems else []
    if failing:
        print(f"T1 FAILED for gating agents: {', '.join(failing)}", file=sys.stderr)
        return 1
    return 0


def self_test() -> int:
    """Regression tests: an agent on the allow-listed persist MCP passes, and each rule catches its case."""
    config = load_json(ENACT / "config.json")
    validator = make_validator()
    allow = config["mcp_builtin"]
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

    # Library pins, clashes, the 8 MiB total, remote MCP servers, library skills.
    skill_validator = make_validator("skill")
    lib = {"a": {"version": "1.0.0-sha256-0000000000000000", "stored_bytes": 1000}, "big": {"version": "1.0.0-sha256-1111111111111111", "stored_bytes": 5 * MIB}}
    pin_a = {"name": "a", "version": lib["a"]["version"]}
    own_b = {"instructions.md": "Do one thing.\n", "skills/b/SKILL.md": "---\nname: b\ndescription: b\n---\n"}
    full_manifest = {**base_manifest, "library_skills": [pin_a], "secrets": ["PRISM_API_KEY"], "tools": ["browser"], "browser": {"sandbox_localhost": True}}
    expect("full manifest valid", check_package("sample", full_manifest, own_b, validator, [], allow, ["b"], lib), None)
    expect("unknown field", check_package("sample", {**base_manifest, "skills": []}, own_b, validator, [], allow, None, lib), "schema: manifest")
    expect("library clash", check_package("sample", full_manifest, base_files, validator, [], allow, None, lib), "name clash: skills/a/")
    expect("library unknown", check_package("sample", {**base_manifest, "library_skills": [{"name": "zz", "version": "1.0.0"}]}, own_b, validator, [], allow, None, lib), "not in enact/library/index.json")
    expect("library version", check_package("sample", {**base_manifest, "library_skills": [{"name": "a", "version": "1.0.1"}]}, own_b, validator, [], allow, None, lib), "pinned at 1.0.1")
    expect("library 8 MiB", check_package("sample", {**base_manifest, "library_skills": [pin_a, {"name": "big", "version": lib["big"]["version"]}, {"name": "big", "version": lib["big"]["version"]}]}, own_b, validator, [], allow, None, lib), "over 8 MiB")
    expect("mcp server not allowed", check_package("sample", {**base_manifest, "mcp_servers": ["elephant"]}, own_b, validator, ["elephant"], allow, None, lib), "remote-mcp")
    expect("mcp server allowed", check_package("sample", {**base_manifest, "mcp_servers": ["elephant"]}, own_b, validator, ["elephant"], allow + ["elephant"], None, lib), None)
    skill_files = {"SKILL.md": "---\nname: a\ndescription: a\n---\n"}
    good_version = "1.0.0-sha256-" + hashlib.sha256(stable_json({"description": "a", "files": skill_files, "name": "a"}).encode()).hexdigest()[:16]
    skill_manifest = {"name": "a", "version": good_version, "description": "a"}
    entry = {"version": good_version, "digest": "sha256:" + hashlib.sha256(canonical_json({"manifest": skill_manifest, "files": skill_files}).encode()).hexdigest()}
    expect("library skill valid", check_library_skill("a", skill_manifest, skill_files, entry, skill_validator), None)
    expect("library skill changed", check_library_skill("a", skill_manifest, {**skill_files, "x.md": "new"}, entry, skill_validator), "does not name this content")
    escaped = {**skill_files, **{f"r/{i}.md": "\"" * 700_000 for i in range(4)}}
    expect("library skill over 5 MiB encoded", check_library_skill("a", skill_manifest, escaped, entry, skill_validator), "over 5 MiB")
    expect("library skill over 3 MiB", check_library_skill("a", skill_manifest, {**skill_files, **{f"r/{i}.md": "x" * MIB for i in range(4)}}, entry, skill_validator), "over 3 MiB")

    # Assets: binary files under skills/<name>/, within the limits, beside the text files.
    png = {"skills/b/ref.png": b"\x89PNG\r\n\x1a\n\xff"}
    expect("asset valid", check_package("sample", base_manifest, own_b, validator, [], allow, ["b"], lib, png) + check_assets(png, None), None)
    expect("asset outside skills", check_assets({"ref.png": b"\xff"}, None), "outside skills/<name>/")
    expect("asset path clash", check_package("sample", base_manifest, own_b, validator, [], allow, ["b"], lib, {"skills/b/SKILL.md/x.png": b"\xff"}), "path clash")
    expect("assets over 128 MiB", check_assets({f"skills/b/{i}.bin": b"" for i in range(501)}, None), "over 500")
    with tempfile.TemporaryDirectory(dir=ROOT) as tmp:
        expect("asset bytes missing", check_assets(png, Path(tmp)), "is not in")
        pkg = Path(tmp) / "pkg"
        (pkg / "skills" / "b").mkdir(parents=True)
        (pkg / "agent.json").write_text("{}", encoding="utf-8")
        (pkg / "skills" / "b" / "ref.png").write_bytes(png["skills/b/ref.png"])
        (pkg / "skills" / "b" / "big.json").write_text("x" * (MAX_FILE_BYTES + 1), encoding="utf-8")
        (pkg / "skills" / "c").mkdir()
        (pkg / "skills" / "c" / "big.json").write_text("x" * (MAX_FILE_BYTES + 1), encoding="utf-8")
        _, read_files, read_assets = read_package(pkg)
        expect("oversized text beside a binary is an asset", None if sorted(read_assets) == ["skills/b/big.json", "skills/b/ref.png"] and "skills/c/big.json" in read_files else "wrong split", None)

    # Packed files: exact canonical JSON round-trips; anything else is caught.
    with tempfile.TemporaryDirectory(dir=ROOT) as tmp:
        doc = {"manifest": base_manifest, "files": base_files}
        good = Path(tmp) / "good.json"
        good.write_text(canonical_json(doc), encoding="utf-8")
        expect("packed round-trip", check_packed(good, doc, MAX_AGENT_BODY), None)
        pretty = Path(tmp) / "pretty.json"
        pretty.write_text(json.dumps(doc, indent=2), encoding="utf-8")
        expect("packed not canonical", check_packed(pretty, doc, MAX_AGENT_BODY), "not the document's canonical JSON")
        expect("packed differs", check_packed(good, {**doc, "files": {**base_files, "x.md": "y"}}, MAX_AGENT_BODY), "does not round-trip")
        expect("packed too big", check_packed(good, doc, 10), "PUT body limit")
        expect("packed missing", check_packed(Path(tmp) / "none.json", doc, MAX_AGENT_BODY), "missing")

    # Text Build refuses in an Enact document of a configuration bundle, named by the file inside.
    expect("placeholder syntax passes", refused_text('Write {{parameter:<name>}} or "{{secret:<name>}}".'), None)
    expect("placeholder refused", refused_text('"enabled": {{parameter:activationsEnabled}}'), "{{parameter:activationsEnabled}}")
    expect("secret placeholder refused", refused_text("{{secret:partnerAuth}}"), "{{secret:partnerAuth}}")
    expect("secret ARN refused", refused_text('"arn:aws:secretsmanager:us-east-2:111122223333:secret:x-AbCdEf"'), "Secrets Manager ARN")
    expect("access key refused", refused_text("AKIA" + "A" * 16), "access key id")
    expect("private key refused", refused_text("-----BEGIN RSA PRIVATE" + " KEY-----"), "private key")
    with tempfile.TemporaryDirectory(dir=ROOT) as tmp:
        packed = Path(tmp) / "sample.json"
        packed.write_text(canonical_json({"manifest": base_manifest, "files": base_files}), encoding="utf-8")
        expect("packed file without refused text", check_refused_text(packed), None)
        packed.write_text(canonical_json({"manifest": base_manifest, "files": {**base_files, "skills/a/x.md": "Use {{parameter:projectGid}}."}}), encoding="utf-8")
        expect("packed file names the file inside", check_refused_text(packed), "sample.json skills/a/x.md: holds the placeholder {{parameter:projectGid}}")

    # An agent that reads Persist through the allow-listed persist MCP (enact/config.json
    # mcp_allow_list) must pass; the "remote MCP" case above covers a server outside the allow-list.
    live_allow = sorted(set(allow) | set(config.get("mcp_allow_list", [])))
    if "persist" not in config.get("mcp_allow_list", []):
        failures.append("persist must be on enact/config.json mcp_allow_list")
    else:
        expect("persist MCP allowed", check_package("sample", {**base_manifest, "mcp_servers": ["persist"]}, own_b, validator, ["persist"], live_allow, None, lib), None)

    if failures:
        for f in failures:
            print(f"FAIL {f}", file=sys.stderr)
        return 1
    print("test-enact-packaging self-test passed (an agent on the allow-listed persist MCP passes)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--strict", action="store_true", help="every agent must pass, not only must-pass waves")
    parser.add_argument("--agent", action="append", help="check only this agent (repeatable)")
    parser.add_argument("--json", action="store_true", help="print results as JSON")
    parser.add_argument("--self-test", action="store_true", help="run the regression tests")
    parser.add_argument("--allow-list-from", metavar="URL", help="add the MCP servers GET <URL>/enact/mcp-servers allows (needs ENACT_API_KEY)")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
