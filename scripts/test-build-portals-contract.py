#!/usr/bin/env python3
"""Contract tests for skills/build-portals intake and portal-spec schema.

Run standalone from the plugin repo root:

    python3 scripts/test-build-portals-contract.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILL_DIR = ROOT / "skills" / "build-portals"
SKILL_MD = SKILL_DIR / "SKILL.md"
INTAKE_RULES = SKILL_DIR / "rules" / "01-intake-and-portal-spec.md"
SCHEMA_PATH = SKILL_DIR / "reference" / "portal-spec.schema.json"
LAMBDA_RULES = SKILL_DIR / "rules" / "02-deterministic-lambda-template.md"
LAMBDA_REFERENCE = SKILL_DIR / "reference" / "portal-api-stack.ts"

SOURCE_TYPES = ("figma", "portal_url", "other_design", "source_repo")
REQUIRED_SCHEMA_FIELDS = (
    "sourceType",
    "screens",
    "breakpoints",
    "auth",
    "apis",
    "secrets",
    "infra",
    "testPersonas",
    "datasetRef",
    "hosting",
    "openQuestions",
)
REQUIRED_SKILL_TOKENS = (
    "figma",
    "portal_url",
    "other_design",
    "source_repo",
    "Figma MCP",
)
HARD_STOP_FIELDS = (
    "designSource",
    "deliveryContext",
    "openQuestions",
    "GitHub org",
    "repository name",
    "AWS account",
    "Amplify",
    "auth model",
    "API contract",
    "testPersonas",
    "datasetRef",
    "BrowserStack",
    "do not scaffold",
)
PIPELINE_STAGES = (
    "Intake",
    "Normalize",
    "Create repo",
    "Scaffold",
    "Frontend",
    "Backend",
    "Integrate",
    "Verify",
    "Handoff",
)
LAMBDA_TEMPLATE_TOKENS = (
    "PortalApiStackProps",
    "PortalApiStack",
    "memorySize",
    "timeoutSeconds",
    "provisionedConcurrentExecutions",
    "'live'",
    "grantRead",
    "LogGroup",
    "Tracing.ACTIVE",
    "p95",
    "DurationAlarm",
    "ErrorAlarm",
)


def fail(message: str) -> None:
    raise AssertionError(message)


def read_text(path: Path) -> str:
    if not path.is_file():
        fail(f"missing required file: {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def load_schema() -> dict:
    text = read_text(SCHEMA_PATH)
    try:
        schema = json.loads(text)
    except json.JSONDecodeError as exc:
        fail(f"{SCHEMA_PATH.relative_to(ROOT)}: invalid JSON ({exc})")
    if not isinstance(schema, dict):
        fail(f"{SCHEMA_PATH.relative_to(ROOT)}: schema root must be an object")
    return schema


def validate_required_properties(schema: dict, document: dict, label: str) -> None:
    required = schema.get("required")
    if not isinstance(required, list):
        fail(f"{SCHEMA_PATH.relative_to(ROOT)}: required must be a list")
    missing = [field for field in required if field not in document]
    if missing:
        fail(f"{label}: missing required fields: {', '.join(missing)}")


def validate_against_schema(schema: dict, document: dict, label: str) -> None:
    validate_required_properties(schema, document, label)

    source_type = document.get("sourceType")
    allowed = schema.get("properties", {}).get("sourceType", {}).get("enum")
    if allowed and source_type not in allowed:
        fail(f"{label}: sourceType must be one of {allowed}")

    open_questions = document.get("openQuestions")
    if not isinstance(open_questions, list):
        fail(f"{label}: openQuestions must be an array")


def assert_skill_corpus_contains_tokens(corpus: str) -> None:
    lowered = corpus.lower()
    for token in REQUIRED_SKILL_TOKENS:
        if token.lower() not in lowered:
            fail(f"skill corpus must mention {token!r}")

    for field in HARD_STOP_FIELDS:
        if field.lower() not in lowered:
            fail(f"skill corpus must document hard-stop field {field!r}")

    for stage in PIPELINE_STAGES:
        if stage.lower() not in lowered:
            fail(f"skill corpus must include pipeline stage {stage!r}")

    stop_phrases = (
        "stop if `openquestions` is non-empty",
        "stop if openquestions is non-empty",
        "do not scaffold while `openquestions` is non-empty",
        "do not scaffold while openquestions is non-empty",
    )
    if not any(phrase in lowered for phrase in stop_phrases):
        fail("skill corpus must state stop-before-scaffold when openQuestions is non-empty")


def assert_intake_rules(corpus: str) -> None:
    lowered = corpus.lower()
    if "exactly one" not in lowered:
        fail("intake rules must require exactly one primary design source")
    if "other_design" not in lowered:
        fail("intake rules must describe other_design for exported screenshots")
    if "figma mcp" not in lowered:
        fail("intake rules must route Figma URLs through Figma MCP")
    if "exported" not in lowered and "screenshot" not in lowered:
        fail("intake rules must state exported screenshots are other_design, not figma")


def assert_schema_contract(schema: dict) -> None:
    required = schema.get("required", [])
    for field in REQUIRED_SCHEMA_FIELDS:
        if field not in required:
            fail(f"schema required must include {field!r}")

    source_enum = schema.get("properties", {}).get("sourceType", {}).get("enum", [])
    for source_type in SOURCE_TYPES:
        if source_type not in source_enum:
            fail(f"schema sourceType enum must include {source_type!r}")

    valid_example = {
        "sourceType": "portal_url",
        "screens": [
            {
                "route": "/",
                "purpose": "Landing page",
                "states": ["logged-out"],
            }
        ],
        "breakpoints": [
            {"name": "mobile", "widthPx": 390},
            {"name": "tablet", "widthPx": 768},
            {"name": "desktop", "widthPx": 1280},
        ],
        "auth": {"mode": "none", "callbackEnvKeys": []},
        "apis": [],
        "secrets": [],
        "infra": {
            "memoryMb": 512,
            "timeoutSeconds": 30,
            "provisionedConcurrency": 0,
            "logRetentionDays": 30,
        },
        "testPersonas": [{"name": "anonymous", "role": "visitor"}],
        "datasetRef": {"location": "s3://example-bucket/example-dataset", "format": "json"},
        "hosting": {"mode": "amplify-preview", "customDomain": "out_of_scope_v1"},
        "openQuestions": [],
    }
    validate_against_schema(schema, valid_example, "valid example")

    blocked_example = dict(valid_example)
    blocked_example["openQuestions"] = ["Need GitHub org and repository name"]
    validate_against_schema(schema, blocked_example, "blocked example")

    incomplete = {"sourceType": "figma"}
    try:
        validate_required_properties(schema, incomplete, "incomplete example")
    except AssertionError:
        pass
    else:
        fail("schema must reject documents missing required fields")


def assert_lambda_template_contract() -> None:
    rules_text = read_text(LAMBDA_RULES)
    reference_text = read_text(LAMBDA_REFERENCE)
    corpus = "\n".join([rules_text, reference_text])

    for token in LAMBDA_TEMPLATE_TOKENS:
        if token not in corpus:
            fail(f"deterministic Lambda template must include {token!r}")

    if "512" not in reference_text or "30" not in reference_text:
        fail("Lambda reference must default to 512 MB and 30 seconds")
    if "provisionedConcurrentExecutions = 0" not in reference_text:
        fail("Lambda reference must default provisioned concurrency to 0")
    if "wildcard" not in rules_text.lower() or "least-privilege" not in rules_text.lower():
        fail("Lambda rules must document least-privilege and wildcard IAM policy")


def main() -> int:
    skill_text = read_text(SKILL_MD)
    rules_text = read_text(INTAKE_RULES)
    corpus = "\n".join([skill_text, rules_text])

    assert_skill_corpus_contains_tokens(corpus)
    assert_intake_rules(corpus)

    schema = load_schema()
    assert_schema_contract(schema)
    assert_lambda_template_contract()

    print("build-portals contract tests passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as exc:
        print(f"build-portals contract tests failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
