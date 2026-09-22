#!/usr/bin/env python3
"""Validate the team-kit's Atlas SQL migration boundary."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ATLAS_IPNS = "k51qzi5uqu5dhzmj1jtn06idud425ozwdjjjn4eu7q01g2t814h7rw4du0nd04"
ATLAS_GATEWAYS = (
    "https://ipfs.filebase.io,"
    "https://ipfs.io,"
    "https://dweb.link,"
    "https://w3s.link"
)
MCP_ENV_KEYS = {"ATLAS_IPNS", "ATLAS_GATEWAYS", "DATABASE_URL"}

RETIRED_PATHS = (
    "skills/county-open-data-publish",
    "skills/county-query-table-publish",
    "skills/use-elephant-query-db",
    "skills/use-oracle/runtime/catalog",
    "skills/use-oracle/runtime/scripts/catalog",
    "skills/use-oracle/runtime/tests/catalog",
)

PUBLICATION_ONLY_MODULES = (
    "skills/use-oracle/runtime/src/core/filebase.mjs",
    "skills/use-oracle/runtime/src/core/coverage-publication.mjs",
    "skills/use-oracle/runtime/src/core/query-table-publication.mjs",
    "skills/use-oracle/runtime/src/core/hoa-pm-property-publication.mjs",
    "skills/use-oracle/runtime/src/core/hoa-pm-overlay-publisher.mjs",
    "skills/use-oracle/runtime/src/core/hoa-pm-publication-keys.mjs",
    "skills/use-oracle/runtime/src/enrichment/hoa-pm-object-publication.mjs",
)

LEGACY_PATTERNS = {
    "legacy MCP environment": re.compile(
        r"\b(?:PROPERTY_QUERY_TABLE_MAP|PERMIT_QUERY_TABLE_MAP|"
        r"DATASET_COVERAGE_MAP|PUBLISHED_COUNTY_CATALOG_URL|"
        r"ORACLE_OPEN_DATA_[A-Z_]+|ORACLE_GEO_INDEX_[A-Z_]+)\b"
    ),
    "retired specialized MCP tool": re.compile(
        r"\b(?:getPropertyPermits|getDatasetQueryCapabilities|"
        r"executeDatasetQueryPlan|queryHoas|getHoaQuerySchema|queryPlaces|"
        r"analyzePlaceColocation|discoverPlaceColocationCandidates|"
        r"getPlaceQuerySchema|queryPermits|getPermitQuerySchema|"
        r"getPermitCoverage)\b"
    ),
    "retired public skill": re.compile(
        r"\b(?:county-open-data-publish|county-query-table-publish|"
        r"use-elephant-query-db|coverage-only-publication)\b"
    ),
    "per-county publication pointer": re.compile(
        r"\b(?:oracle-open-data-|oracle-query-table-|oracle-dataset-coverage-)"
    ),
    "retired catalog surface": re.compile(
        r"(?:runtime/catalog/|catalog:sync-mcp-json|catalog:update)"
    ),
}

NEGATION = re.compile(
    r"\b(?:do not|don't|never|not|required no|without|retired|removed|"
    r"does not|must not)\b",
    re.IGNORECASE,
)
ORACLE_NODE_PREREQUISITE = re.compile(
    r"(?:clone|checkout|sibling|prerequisite|requires?).{0,160}"
    r"(?:oracle-node|Counties-trasform-scripts|elephant-query-db)",
    re.IGNORECASE | re.DOTALL,
)
PER_COUNTY_PUBLICATION = re.compile(
    r"(?:per[- ]county|each county|county(?:'s)? own).{0,120}"
    r"(?:IPNS|public pointer|publication pointer)",
    re.IGNORECASE | re.DOTALL,
)
RETIRED_RUNTIME_COMMANDS = (
    '"publish"',
    '"export-coverage"',
    '"sign-coverage-approval"',
    '"publish-coverage"',
    '"hoa-pm-publish"',
    '"hoa-pm-property-publish"',
    '"permit-publish"',
)

RETAINED_TOOLS = (
    "listPublishedCounties",
    "listOracleProperties",
    "getOracleProperty",
    "getOracleDatasetInfo",
    "getPropertyQuerySchema",
    "queryProperties",
    "findPropertiesInArea",
    "sumPropertyValueInArea",
    "listClassesByDataGroup",
    "listPropertiesByClassName",
    "getPropertySchema",
    "getVerifiedScriptExamples",
)


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def active_docs(root: Path) -> list[Path]:
    paths = [root / "README.md"]
    paths.extend((root / "agents").glob("*.md"))
    paths.extend((root / "skills").glob("*/SKILL.md"))
    paths.extend((root / "skills/use-oracle/reference").glob("*.md"))
    paths.extend((root / "skills/use-elephant-mcp/reference").glob("*.md"))
    paths.extend((root / "skills/build-elephant-hero-facts/rules").glob("*.md"))
    paths.extend((root / "docs").glob("*.md"))
    return sorted(path for path in paths if path.is_file())


def legacy_findings(text: str) -> list[str]:
    findings = [
        label
        for label, pattern in LEGACY_PATTERNS.items()
        if pattern.search(text)
    ]
    for match in ORACLE_NODE_PREREQUISITE.finditer(text):
        start = max(0, match.start() - 80)
        end = min(len(text), match.end() + 80)
        if not NEGATION.search(text[start:end]):
            findings.append("external ingestion repository prerequisite")
            break
    for match in PER_COUNTY_PUBLICATION.finditer(text):
        start = max(0, match.start() - 80)
        end = min(len(text), match.end() + 80)
        if not NEGATION.search(text[start:end]):
            findings.append("per-county publication instruction")
            break
    return findings


def validate_mcp(root: Path, errors: list[str]) -> None:
    path = root / "mcp.json"
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
        server = config["mcpServers"]["elephant"]
        env = server["env"]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        fail(errors, f"mcp.json: invalid Elephant configuration ({exc})")
        return

    keys = set(env)
    if keys != MCP_ENV_KEYS:
        fail(errors, f"mcp.json: env keys must be {sorted(MCP_ENV_KEYS)}, got {sorted(keys)}")
    if env.get("ATLAS_IPNS") != ATLAS_IPNS:
        fail(errors, "mcp.json: ATLAS_IPNS must use the canonical global Atlas name")
    if env.get("ATLAS_GATEWAYS") != ATLAS_GATEWAYS:
        fail(errors, "mcp.json: ATLAS_GATEWAYS must use the canonical four-gateway order")
    database_url = env.get("DATABASE_URL")
    if not isinstance(database_url, str) or not database_url.startswith("file:${HOME}/"):
        fail(errors, "mcp.json: local DATABASE_URL must use the portable home-directory file URL")
    launcher = " ".join(server.get("args", []))
    if "github:elephant-xyz/elephant-mcp#main" not in launcher or " mcp" not in launcher:
        fail(errors, "mcp.json: retain the Node-version launcher and MCP 2.0 GitHub entrypoint")
    if 'case "$DATABASE_URL"' not in launcher:
        fail(errors, "mcp.json: launcher must expand the portable home-directory DATABASE_URL")


def validate_removed_surface(root: Path, errors: list[str]) -> None:
    for rel in RETIRED_PATHS:
        path = root / rel
        if path.is_file() or (
            path.is_dir()
            and any(candidate.is_file() for candidate in path.rglob("*"))
        ):
            fail(errors, f"{rel}: retired Atlas-predecessor surface must be absent")
    for rel in PUBLICATION_ONLY_MODULES:
        if (root / rel).exists():
            fail(errors, f"{rel}: legacy publication-only module must be absent")

    package = json.loads(
        (root / "skills/use-oracle/runtime/package.json").read_text(encoding="utf-8")
    )
    catalog_scripts = sorted(
        name for name in package.get("scripts", {}) if name.startswith("catalog:")
    )
    if catalog_scripts:
        fail(errors, f"runtime package: remove catalog scripts {catalog_scripts}")

    cli_path = root / "skills/use-oracle/runtime/bin/elephant-county.mjs"
    cli = cli_path.read_text(encoding="utf-8")
    for command in RETIRED_RUNTIME_COMMANDS:
        if f"command === {command}" in cli:
            fail(errors, f"{cli_path.relative_to(root)}: retired runtime command {command}")


def validate_docs(root: Path, errors: list[str]) -> None:
    for path in active_docs(root):
        text = path.read_text(encoding="utf-8")
        for finding in legacy_findings(text):
            fail(errors, f"{path.relative_to(root)}: {finding}")

    tools_path = root / "skills/use-elephant-mcp/reference/tools-and-workflows.md"
    tools = tools_path.read_text(encoding="utf-8")
    for tool in RETAINED_TOOLS:
        if tool not in tools:
            fail(errors, f"{tools_path.relative_to(root)}: missing retained v2 tool {tool}")

    oracle = (root / "agents/oracle.md").read_text(encoding="utf-8")
    sequence = (
        "validate <group-dir>",
        "hash <group-dir>",
        "validate <county>-<group>.car",
        "export-tables <county>-<group>.car",
        "upload <county>-<group>.car",
        "Atlas PR",
        "global Atlas IPNS",
    )
    sequence_text = oracle[oracle.find(sequence[0]) :]
    positions = [sequence_text.find(token) for token in sequence]
    if any(position < 0 for position in positions) or positions != sorted(positions):
        fail(errors, "agents/oracle.md: Atlas publication sequence is missing or out of order")

    query_db = (root / "skills/query-db-loading-matching/SKILL.md").read_text(
        encoding="utf-8"
    )
    for token in (
        "folio",
        "watermark",
        "tombstone",
        "permit/property",
        "official",
        "roof age",
        "enrichment",
        "not the public source",
    ):
        if token.lower() not in query_db.lower():
            fail(errors, f"query-db-loading-matching: missing internal invariant '{token}'")


def validate(root: Path = ROOT) -> list[str]:
    errors: list[str] = []
    validate_mcp(root, errors)
    validate_removed_surface(root, errors)
    validate_docs(root, errors)
    return errors


def main() -> int:
    errors = validate()
    if errors:
        print("Atlas migration validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("Atlas migration validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
