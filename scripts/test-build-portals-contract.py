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
REPO_PREVIEW_RULES = SKILL_DIR / "rules" / "03-repo-and-amplify-preview.md"
VERIFICATION_RULES = SKILL_DIR / "rules" / "04-verification-gates.md"
LATENCY_REFERENCE = SKILL_DIR / "reference" / "measure-latency.mjs"
EXISTING_REPOSITORY_RULES = (
    SKILL_DIR / "rules" / "06-existing-repository-changes.md"
)

SOURCE_TYPES = ("figma", "portal_url", "other_design", "source_repo")
DELIVERY_MODES = ("new_repository", "existing_repository")
REQUIRED_SCHEMA_FIELDS = (
    "deliveryMode",
    "sourceType",
    "changeRequest",
    "openQuestions",
)
NEW_REPOSITORY_SCHEMA_FIELDS = (
    "screens",
    "breakpoints",
    "auth",
    "apis",
    "secrets",
    "infra",
    "testPersonas",
    "datasetRef",
    "hosting",
)
REQUIRED_SKILL_TOKENS = (
    "new_repository",
    "existing_repository",
    "changeRequest",
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
    "Prepare repository",
    "Plan or scaffold",
    "Frontend",
    "Backend",
    "Integrate or deploy",
    "Verify",
    "Pull request and handoff",
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
REPO_PREVIEW_TOKENS = (
    "gh repo create",
    "feat/portal-v1",
    "apps/web",
    "apps/api",
    "packages/shared",
    "amplify.yml",
    "feature-branch API",
    "deployment output",
    "custom domain",
    "out of scope",
)
VERIFICATION_TOKENS = (
    "repository's required gates",
    "scope-appropriate",
    "not applicable",
    "no coverage regression",
    "pull request",
    "100%",
    "80%",
    "mobile",
    "tablet",
    "desktop",
    "BrowserStack",
    "preview",
    "real feature",
    "p95",
    "< 200",
    "coverage",
    "latency JSON",
)
LATENCY_SCRIPT_TOKENS = (
    "API_URL",
    "DATASET_PATH",
    "REQUEST_COUNT",
    ".sort(",
    "p95",
    ">= 200",
)
EXISTING_REPOSITORY_TOKENS = (
    "git status --short",
    "git worktree",
    "base branch",
    "feature branch",
    "preserve user changes",
    "existing architecture",
    "minimum necessary",
    "gh pr create",
    "update an existing PR",
    "never merge",
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

    delivery_mode = document.get("deliveryMode")
    allowed_modes = schema.get("properties", {}).get("deliveryMode", {}).get("enum")
    if allowed_modes and delivery_mode not in allowed_modes:
        fail(f"{label}: deliveryMode must be one of {allowed_modes}")

    source_type = document.get("sourceType")
    allowed = schema.get("properties", {}).get("sourceType", {}).get("enum")
    if allowed and source_type not in allowed:
        fail(f"{label}: sourceType must be one of {allowed}")

    open_questions = document.get("openQuestions")
    if not isinstance(open_questions, list):
        fail(f"{label}: openQuestions must be an array")

    if delivery_mode == "new_repository":
        missing = [
            field for field in NEW_REPOSITORY_SCHEMA_FIELDS if field not in document
        ]
        if missing:
            fail(
                f"{label}: new_repository missing required fields: "
                f"{', '.join(missing)}"
            )
    elif delivery_mode == "existing_repository":
        if "repositoryContext" not in document:
            fail(f"{label}: existing_repository requires repositoryContext")


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
    if "new_repository" not in lowered or "existing_repository" not in lowered:
        fail("intake rules must resolve new vs existing repository intent first")
    if "backend" not in lowered or "change request" not in lowered:
        fail("intake rules must support scoped backend changes")
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

    delivery_mode_enum = (
        schema.get("properties", {}).get("deliveryMode", {}).get("enum", [])
    )
    for delivery_mode in DELIVERY_MODES:
        if delivery_mode not in delivery_mode_enum:
            fail(f"schema deliveryMode enum must include {delivery_mode!r}")

    conditional_contract = json.dumps(schema.get("allOf", []))
    for token in (
        "new_repository",
        "existing_repository",
        "repositoryContext",
        "source_repo",
    ):
        if token not in conditional_contract:
            fail(f"schema conditionals must include {token!r}")

    breakpoint_schema = schema.get("properties", {}).get("breakpoints", {})
    breakpoint_constraints = json.dumps(breakpoint_schema.get("allOf", []))
    for breakpoint_name in ("mobile", "tablet", "desktop"):
        if f'"const": "{breakpoint_name}"' not in breakpoint_constraints:
            fail(
                "schema breakpoints must require one "
                f"{breakpoint_name!r} breakpoint"
            )

    valid_example = {
        "deliveryMode": "new_repository",
        "sourceType": "portal_url",
        "changeRequest": {
            "summary": "Create a portal from the supplied design",
            "scopes": ["frontend", "backend", "infrastructure"],
        },
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

    existing_example = {
        "deliveryMode": "existing_repository",
        "sourceType": "source_repo",
        "changeRequest": {
            "summary": "Add one backend endpoint",
            "scopes": ["backend"],
        },
        "repositoryContext": {
            "repository": "example-org/example-portal",
            "baseBranch": "main",
            "featureBranch": "feat/add-backend-endpoint",
        },
        "openQuestions": [],
    }
    validate_against_schema(schema, existing_example, "existing repository example")

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


def assert_repo_preview_contract() -> None:
    rules_text = read_text(REPO_PREVIEW_RULES)
    lowered = rules_text.lower()

    for token in REPO_PREVIEW_TOKENS:
        if token.lower() not in lowered:
            fail(f"repo and Amplify preview rules must include {token!r}")

    if "production api" not in lowered or "reject" not in lowered:
        fail("preview rules must reject production API URLs")
    if "app id" not in lowered or "never construct" not in lowered:
        fail("preview URL must never be constructed from an embedded app ID")


def assert_verification_contract() -> None:
    rules_text = read_text(VERIFICATION_RULES)
    latency_text = read_text(LATENCY_REFERENCE)

    for token in VERIFICATION_TOKENS:
        if token.lower() not in rules_text.lower():
            fail(f"verification rules must include {token!r}")
    for token in LATENCY_SCRIPT_TOKENS:
        if token not in latency_text:
            fail(f"latency reference must include {token!r}")


def assert_existing_repository_contract() -> None:
    rules_text = read_text(EXISTING_REPOSITORY_RULES)

    for token in EXISTING_REPOSITORY_TOKENS:
        if token.lower() not in rules_text.lower():
            fail(f"existing-repository rules must include {token!r}")


def main() -> int:
    skill_text = read_text(SKILL_MD)
    rules_text = read_text(INTAKE_RULES)
    corpus = "\n".join([skill_text, rules_text])

    assert_skill_corpus_contains_tokens(corpus)
    assert_intake_rules(corpus)

    schema = load_schema()
    assert_schema_contract(schema)
    assert_lambda_template_contract()
    assert_repo_preview_contract()
    assert_verification_contract()
    assert_existing_repository_contract()

    print("build-portals contract tests passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as exc:
        print(f"build-portals contract tests failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
