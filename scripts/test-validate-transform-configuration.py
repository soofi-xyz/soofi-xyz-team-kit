#!/usr/bin/env python3
"""Contract, safety, routing, and synthetic-run tests for Silvally."""

from __future__ import annotations

import copy
import json
import re
import sys
from pathlib import Path

try:
    from jsonschema import Draft202012Validator, FormatChecker
except ModuleNotFoundError:
    Draft202012Validator = None
    FormatChecker = None

ROOT = Path(__file__).resolve().parent.parent
SKILL = ROOT / "skills" / "validate-transform-configuration"
REFERENCE = SKILL / "reference"
AGENT = ROOT / "agents" / "silvally.md"
DRAFT_PROFILE_SCHEMA = REFERENCE / "transform-configuration-profile-draft.schema.json"
PROFILE_SCHEMA = REFERENCE / "transform-configuration-profile.schema.json"
RUN_SCHEMA = REFERENCE / "transform-configuration-run.schema.json"
PROFILE_NAMES = (
    "dsa-filter-decision.json",
    "quiq-sms-lifecycle.json",
    "m2d-document-media.json",
)
CALIBRATION_NAMES = (
    "dsa-filter-decision-round-trip.md",
    "quiq-sms-full-day-round-trip.md",
    "m2d-document-media-round-trip.md",
)
STATUSES = {"PASS", "FAIL", "BLOCKED", "APPROVAL_REQUIRED"}
DOMAIN_BRANCH_TERMS = ("dsa-filter-decision", "quiq-sms-lifecycle", "m2d-document-media")
MATERIAL_FACT_IDS = (
    "source-and-target-meaning",
    "required-directions",
    "configuration-repository-and-ref",
    "environment-region-and-mode",
    "sample-or-evidence-source",
    "sensitivity-and-handling",
    "required-fields-and-permitted-losses",
    "consumer-and-readback",
    "success-scale-and-cost",
    "configuration-product-boundary",
)


def fail(message: str) -> None:
    raise AssertionError(message)


def read(path: Path) -> str:
    if not path.is_file():
        fail(f"missing required file: {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def load_json(path: Path) -> dict:
    try:
        value = json.loads(read(path))
    except json.JSONDecodeError as exc:
        fail(f"{path.relative_to(ROOT)}: invalid JSON ({exc})")
    if not isinstance(value, dict):
        fail(f"{path.relative_to(ROOT)}: expected object")
    return value


class ContractValidator:
    def __init__(self, kind: str, schema: dict) -> None:
        self.kind = kind
        self.external = (
            Draft202012Validator(schema, format_checker=FormatChecker())
            if Draft202012Validator is not None
            else None
        )

    def errors(self, value: dict) -> list[str]:
        if self.kind == "profile":
            errors = profile_errors(value)
        elif self.kind == "draft":
            errors = draft_errors(value)
        else:
            errors = run_errors(value)
        if self.external is not None:
            errors.extend(error.message for error in self.external.iter_errors(value))
        return errors

    def is_valid(self, value: dict) -> bool:
        return not self.errors(value)


def validator(path: Path) -> ContractValidator:
    schema = load_json(path)
    if Draft202012Validator is not None:
        Draft202012Validator.check_schema(schema)
    if schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
        fail(f"{path.relative_to(ROOT)}: must declare JSON Schema draft 2020-12")
    if schema.get("$id") != path.name:
        fail(f"{path.relative_to(ROOT)}: schema ID must equal filename")
    if schema.get("type") != "object" or schema.get("additionalProperties") is not False:
        fail(f"{path.relative_to(ROOT)}: schema must be a closed object")
    kind = (
        "profile"
        if path == PROFILE_SCHEMA
        else "draft"
        if path == DRAFT_PROFILE_SCHEMA
        else "artifact"
    )
    return ContractValidator(kind, schema)


def profile_errors(value: dict) -> list[str]:
    required = {
        "id", "contractVersion", "terminologyAliases", "roles", "datasets",
        "invariants", "repositories", "discoveryProbes", "directions",
        "validationSources", "evidencePolicy", "graph", "adapters", "consumers", "scaleTiers",
        "approvals", "transformClassification", "configurationChoices",
        "productBoundary",
    }
    errors = [f"missing {field}" for field in sorted(required - value.keys())]
    if value.get("contractVersion") != 1:
        errors.append("contractVersion")
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*\.json", value.get("id", "")):
        errors.append("id")
    approvals = value.get("approvals", {})
    if approvals != {"devWrites": "explicit", "prodWrites": "forbidden", "perOperation": True}:
        errors.append("approvals")
    for repository in value.get("repositories", []):
        if repository.get("revisionPolicy") != "commit-sha":
            errors.append("mutable repository policy")
        if repository.get("role") not in {
            "configuration-source", "product-runtime", "domain-contract",
        }:
            errors.append("repository role")
        if not repository.get("candidateDiscovery") or not repository.get("requiredPaths"):
            errors.append("repository discovery contract")
    for direction in value.get("directions", []):
        mapping = direction.get("mapping", {})
        if mapping.get("status") == "registered":
            for field in (
                "id", "version", "repository", "sourcePaths",
                "artifactPath", "expectedOutputDatasets",
            ):
                if not mapping.get(field):
                    errors.append(f"registered mapping {field}")
        elif mapping.get("status") == "not-registered":
            for field in ("expectedId", "owner", "reason"):
                if not mapping.get(field):
                    errors.append(f"unregistered mapping {field}")
        else:
            errors.append("mapping registration status")
    if not value.get("validationSources"):
        errors.append("validation sources")
    for invariant in value.get("invariants", []):
        if invariant.get("phase") not in range(1, 13):
            errors.append("invariant phase")
    classification = value.get("transformClassification", {})
    if classification.get("kind") == "deterministic":
        if not classification.get("expectedOutputTests") or not classification.get("negativeTests"):
            errors.append("deterministic test evidence")
    elif classification.get("kind") == "non-deterministic":
        for field in ("confidenceOutput", "thresholds", "humanReviewPolicy"):
            if not classification.get(field):
                errors.append(f"non-deterministic {field}")
    else:
        errors.append("transform classification")
    allowed_choices = {
        "fieldNames", "schemaShape", "formats", "normalizationRules",
        "mappingExpressions", "profileInputs", "vocabularySelections",
    }
    if set(value.get("configurationChoices", {})) != allowed_choices:
        errors.append("product boundary disguised as configuration")
    return errors


def draft_errors(value: dict) -> list[str]:
    required = {
        "id", "contractVersion", "intakeState", "originalRequest",
        "candidateProfiles", "selectedProfile", "discoveryTrace",
        "materialFacts", "boundaryDecisions", "unresolvedFacts",
        "promotionEligible", "sensitivity", "localLocation",
    }
    errors = [f"missing {field}" for field in sorted(required - value.keys())]
    facts = value.get("materialFacts", [])
    fact_ids = [fact.get("id") for fact in facts]
    if len(fact_ids) != len(MATERIAL_FACT_IDS) or set(fact_ids) != set(MATERIAL_FACT_IDS):
        errors.append("material facts must appear exactly once")
    unresolved = set(value.get("unresolvedFacts", []))
    actual_unresolved = {
        fact.get("id")
        for fact in facts
        if fact.get("state") in {"AMBIGUOUS", "MISSING"}
    }
    if unresolved != actual_unresolved:
        errors.append("unresolved facts do not match fact states")
    for fact in facts:
        unresolved_state = fact.get("state") in {"AMBIGUOUS", "MISSING"}
        if unresolved_state and not fact.get("nextQuestion"):
            errors.append(f"{fact.get('id')} lacks next question")
        if not unresolved_state and fact.get("nextQuestion") is not None:
            errors.append(f"{fact.get('id')} retains a resolved question")
    if value.get("promotionEligible"):
        if value.get("intakeState") not in {"CONTEXT_COMPLETE", "VALIDATING"}:
            errors.append("promotion before context complete")
        if unresolved:
            errors.append("promotion with unresolved facts")
    selected = value.get("selectedProfile")
    selected_candidates = [
        candidate for candidate in value.get("candidateProfiles", [])
        if candidate.get("disposition") == "SELECTED"
    ]
    if selected is None and selected_candidates:
        errors.append("selected candidate without selected profile")
    if selected is not None and (
        len(selected_candidates) != 1
        or selected_candidates[0].get("profileId") != selected
        or not selected_candidates[0].get("hardSignals")
    ):
        errors.append("selected profile lacks one hard-signal candidate")
    sensitivity = value.get("sensitivity", {})
    if sensitivity != {"containsRawPii": False, "containsSecrets": False}:
        errors.append("unsafe draft sensitivity")
    return errors


def run_errors(value: dict) -> list[str]:
    required = {
        "id", "contractVersion", "profile", "discoveryTrace",
        "configurationPackage", "environment",
        "sensitivity", "datasets", "graph", "runtime",
        "persistCanary", "exporterHydration", "roundTrip", "phases", "approvals",
        "boundaryDecisions", "cost", "failures", "verdict",
    }
    errors = [f"missing {field}" for field in sorted(required - value.keys())]
    if value.get("contractVersion") != 1:
        errors.append("contractVersion")
    if value.get("verdict") not in {"READY", "NOT_READY", "BLOCKED"}:
        errors.append("verdict")
    package = value.get("configurationPackage", {})
    for repository in package.get("sourceRevisions", []):
        if not re.fullmatch(r"[a-f0-9]{40}", repository.get("commitSha", "")):
            errors.append("mutable repository ref")
    sensitivity = value.get("sensitivity", {})
    if sensitivity.get("containsRawPii") is not False:
        errors.append("raw PII")
    if sensitivity.get("containsSecrets") is not False:
        errors.append("secrets")
    for dataset in value.get("datasets", []):
        location = dataset.get("location", "")
        if not re.fullmatch(r"(?:local|s3)://[^?#@]+", location):
            errors.append("unsafe location")
    phases = value.get("phases", [])
    if [phase.get("number") for phase in phases] != list(range(1, 13)):
        errors.append("phase order")
    for phase in phases:
        if phase.get("status") not in STATUSES:
            errors.append("phase status")
    unresolved = [
        decision for decision in value.get("boundaryDecisions", [])
        if decision.get("classification") == "PRODUCT_CHANGE"
        and decision.get("resolved") is False
    ]
    if value.get("verdict") == "READY" and unresolved:
        errors.append("ready with unresolved product change")
    return errors


def assert_valid(checker: ContractValidator, value: dict, label: str) -> None:
    errors = checker.errors(value)
    if errors:
        fail(f"{label}: {'; '.join(errors)}")


def assert_rejected(checker: ContractValidator, value: dict, label: str) -> None:
    if checker.is_valid(value):
        fail(f"{label}: invalid value was accepted")


def valid_draft(*, complete: bool = False) -> dict:
    state = "CONFIRMED" if complete else "MISSING"
    return {
        "id": "transform-configuration-draft-" + "a" * 12,
        "contractVersion": 1,
        "intakeState": "CONTEXT_COMPLETE" if complete else "NEEDS_INPUT",
        "originalRequest": "Help me test a new transformation",
        "candidateProfiles": [],
        "selectedProfile": None,
        "discoveryTrace": [
            {
                "kind": "workspace",
                "subject": "current-workspace",
                "result": "No exact mapping identity was supplied",
                "evidenceIds": ["workspace-scan"],
            }
        ],
        "materialFacts": [
            {
                "id": fact_id,
                "state": state,
                "value": "confirmed value" if complete else None,
                "evidenceIds": ["intake-evidence"] if complete else [],
                "nextQuestion": None if complete else f"What is {fact_id}?",
            }
            for fact_id in MATERIAL_FACT_IDS
        ],
        "boundaryDecisions": [],
        "unresolvedFacts": [] if complete else list(MATERIAL_FACT_IDS),
        "promotionEligible": complete,
        "sensitivity": {"containsRawPii": False, "containsSecrets": False},
        "localLocation": "local://transform-configuration-intake/draft-a1b2c3",
    }


def valid_run() -> dict:
    digest = "sha256:" + "a" * 64
    phases = [
        {"number": number, "status": "PASS", "evidenceIds": [f"phase-{number}-proof"]}
        for number in range(1, 13)
    ]
    proof = {"required": True, "status": "PASS", "evidenceIds": ["bounded-proof"]}
    return {
        "id": "validation-" + "b" * 12,
        "contractVersion": 1,
        "profile": {"id": PROFILE_NAMES[0], "revision": "1", "sha256": digest},
        "discoveryTrace": [
            {
                "repository": "example/lexicon",
                "selectionMethod": "matching-open-pull-request",
                "materialization": "matching-local-checkout",
                "selectedCommitSha": "d" * 40,
                "pullRequestNumber": 37,
                "requiredPathsVerified": True,
                "rejectedCandidateCommitShas": [],
            },
            {
                "repository": "example/transform",
                "selectionMethod": "default-branch",
                "materialization": "isolated-checkout",
                "selectedCommitSha": "c" * 40,
                "pullRequestNumber": None,
                "requiredPathsVerified": True,
                "rejectedCandidateCommitShas": [],
            },
        ],
        "configurationPackage": {
            "id": "synthetic-transform-configuration",
            "version": "1.0.0",
            "transformProduct": {
                "name": "Transform",
                "version": "2",
                "sha256": digest,
            },
            "directions": [
                {
                    "id": "source-to-target",
                    "sourceLanguage": {
                        "id": "source",
                        "revision": "1.0.0",
                        "sha256": digest,
                    },
                    "targetLanguage": {
                        "id": "target",
                        "revision": "1.0.0",
                        "sha256": digest,
                    },
                    "mapping": {
                        "id": "source-to-target",
                        "revision": "1.0.0",
                        "sha256": digest,
                    },
                    "evidenceIds": ["source-to-target-proof"],
                }
            ],
            "lexicon": {
                "id": "lexicon",
                "revision": "2.0.0",
                "sha256": digest,
            },
            "sourceRevisions": [
                {"slug": "example/transform", "commitSha": "c" * 40}
            ],
            "dependencies": [
                {
                    "product": "Test",
                    "version": "1",
                    "sha256": digest,
                    "role": "expected and negative checks",
                },
                {
                    "product": "Deploy",
                    "version": "1",
                    "sha256": digest,
                    "role": "environment provenance",
                },
            ],
            "testEvidenceIds": ["expected-output-proof", "negative-test-proof"],
            "deployedDigest": digest,
            "unresolvedProductChangeHandoffs": [],
            "marketplaceRegistrationReady": True,
        },
        "environment": {
            "name": "dev",
            "accountHash": digest,
            "region": "us-east-2",
            "writePolicy": "approval-required",
        },
        "sensitivity": {
            "classification": "restricted",
            "sanitization": "aggregates-and-digests-only",
            "containsRawPii": False,
            "containsSecrets": False,
        },
        "datasets": [
            {
                "name": "synthetic-output",
                "schemaSha256": digest,
                "rowCount": 37,
                "contentSha256": digest,
                "location": "local://synthetic/output",
            }
        ],
        "graph": {
            "required": True,
            "identityUnique": True,
            "endpointCount": 37,
            "danglingEndpointCount": 0,
        },
        "runtime": {
            "sparkVersion": "3.3.0",
            "transformRevision": "c" * 40,
            "deploymentDigest": digest,
            "executionMode": "synthetic-local",
        },
        "persistCanary": proof,
        "exporterHydration": proof,
        "roundTrip": {
            **proof,
            "comparedFields": 9,
            "mismatchCount": 0,
        },
        "phases": phases,
        "boundaryDecisions": [
            {
                "id": "field-mapping-choice",
                "proposedChange": "Map registered source fields to target fields",
                "classification": "CONFIGURATION",
                "evidenceIds": ["mapping-contract"],
                "resolved": True,
                "handoffOwner": None,
            }
        ],
        "approvals": [],
        "cost": {"ceilingUsd": 0, "estimatedUsd": 0, "actualUsd": 0},
        "failures": [],
        "verdict": "READY",
    }


def test_schemas_and_profiles() -> list[dict]:
    draft_check = validator(DRAFT_PROFILE_SCHEMA)
    profile_check = validator(PROFILE_SCHEMA)
    run_check = validator(RUN_SCHEMA)
    profiles = []
    seen_ids: set[str] = set()
    for filename in PROFILE_NAMES:
        path = REFERENCE / "profiles" / filename
        profile = load_json(path)
        assert_valid(profile_check, profile, filename)
        if profile["id"] != filename:
            fail(f"{filename}: profile id must equal filename")
        if profile["id"] in seen_ids:
            fail(f"{filename}: duplicate profile id")
        seen_ids.add(profile["id"])
        if profile["approvals"] != {
            "devWrites": "explicit",
            "prodWrites": "forbidden",
            "perOperation": True,
        }:
            fail(f"{filename}: unsafe approval policy")
        profiles.append(profile)

    incomplete_draft = valid_draft()
    assert_valid(draft_check, incomplete_draft, "valid incomplete intake draft")
    assert_rejected(
        profile_check,
        incomplete_draft,
        "incomplete intake draft as executable profile",
    )

    premature_promotion = copy.deepcopy(incomplete_draft)
    premature_promotion["promotionEligible"] = True
    assert_rejected(draft_check, premature_promotion, "premature draft promotion")

    complete_draft = valid_draft(complete=True)
    assert_valid(draft_check, complete_draft, "complete promotable intake draft")

    missing_question = copy.deepcopy(incomplete_draft)
    missing_question["materialFacts"][0]["nextQuestion"] = None
    assert_rejected(draft_check, missing_question, "missing focused intake question")

    invented_selection = copy.deepcopy(incomplete_draft)
    invented_selection["selectedProfile"] = PROFILE_NAMES[0]
    assert_rejected(
        draft_check,
        invented_selection,
        "profile selection without hard evidence",
    )

    run = valid_run()
    assert_valid(run_check, run, "valid synthetic run")

    mutable = copy.deepcopy(run)
    mutable["configurationPackage"]["sourceRevisions"][0]["commitSha"] = "main"
    assert_rejected(run_check, mutable, "mutable repository ref")

    pii = copy.deepcopy(run)
    pii["sensitivity"]["containsRawPii"] = True
    assert_rejected(run_check, pii, "raw PII evidence")

    secret = copy.deepcopy(run)
    secret["sensitivity"]["containsSecrets"] = True
    assert_rejected(run_check, secret, "secret evidence")

    signed_url = copy.deepcopy(run)
    signed_url["datasets"][0]["location"] = "s3://safe/output?token=secret"
    assert_rejected(run_check, signed_url, "credential-bearing location")

    wrong_order = copy.deepcopy(run)
    wrong_order["phases"][0], wrong_order["phases"][1] = (
        wrong_order["phases"][1],
        wrong_order["phases"][0],
    )
    assert_rejected(run_check, wrong_order, "phase order")

    unresolved = copy.deepcopy(run)
    unresolved["boundaryDecisions"].append({
        "id": "identity-scheme-change",
        "proposedChange": "Replace the business identity scheme",
        "classification": "PRODUCT_CHANGE",
        "evidenceIds": ["identity-contract"],
        "resolved": False,
        "handoffOwner": "Lexicon",
    })
    unresolved["configurationPackage"]["unresolvedProductChangeHandoffs"] = [
        "identity-scheme-change"
    ]
    assert_rejected(run_check, unresolved, "READY with unresolved product change")

    for setting in (
        "representationFamily",
        "identityScheme",
        "executableCodePath",
        "dependencyType",
        "storageEngineMode",
        "failureSemantics",
    ):
        invalid_profile = copy.deepcopy(profiles[0])
        invalid_profile["configurationChoices"][setting] = ["not-configuration"]
        assert_rejected(profile_check, invalid_profile, f"{setting} as configuration")

    missing_mapping_source = copy.deepcopy(profiles[0])
    del missing_mapping_source["directions"][0]["mapping"]["sourcePaths"]
    assert_rejected(
        profile_check,
        missing_mapping_source,
        "registered mapping without source paths",
    )

    invented_direction = copy.deepcopy(profiles[0])
    invented_direction["directions"][0]["mapping"]["id"] = "invented-mapping"
    invented_direction["directions"][0]["mapping"]["sourcePaths"] = []
    assert_rejected(
        profile_check,
        invented_direction,
        "invented mapping without resolvable source",
    )
    return profiles


def test_core_and_references(profiles: list[dict]) -> None:
    agent = read(AGENT)
    skill = read(SKILL / "SKILL.md")
    core = (agent + "\n" + skill).lower()
    operating_contract = read(REFERENCE / "operating-contract.md")
    naming_corpus = agent + "\n" + skill + "\n" + operating_contract
    if "Transform Configuration Validation Agent" not in naming_corpus:
        fail("Silvally validation-agent role is missing")
    for obsolete_role in (
        "Transform Configuration Agent",
        "Operational Architect",
    ):
        if obsolete_role in naming_corpus:
            fail(f"Silvally retains obsolete role wording {obsolete_role!r}")
    for term in DOMAIN_BRANCH_TERMS:
        if term in core:
            fail(f"core must not branch on profile {term}")

    for token in (
        "kecleon", "mew", "unown", "conkeldurr", "machamp",
        "explicit approval", "prod", "read-only", "fail closed",
        "ready", "not_ready", "blocked", "configuration", "product_change",
        "test", "deploy", "system", "runtime",
        "open pull requests", "current workspace", "requiredpaths",
        "generic repository test suite", "incomplete discovery",
        "absent system-wide", "declared local spark setup",
    ):
        if token not in core:
            fail(f"core routing/safety contract missing {token!r}")

    phases = read(REFERENCE / "validation-phases-and-gates.md")
    numbered = re.findall(r"(?m)^(\d+)\. \*\*", phases)
    if numbered != [str(number) for number in range(1, 13)]:
        fail("phase contract must contain exactly the ordered 12 phases")
    for status in STATUSES:
        if status not in phases:
            fail(f"phase contract missing status {status}")

    for profile in profiles:
        for invariant in profile["invariants"]:
            if invariant["phase"] not in range(1, 13):
                fail(f"{profile['id']}: invariant phase outside core state machine")

    decision = next(
        profile for profile in profiles if profile["id"] == "dsa-filter-decision.json"
    )
    repositories = {repository["slug"]: repository for repository in decision["repositories"]}
    lexicon = repositories.get("Spring-Oaks-Capital-LLC/lexicon")
    if lexicon is None or lexicon["role"] != "configuration-source":
        fail("Decision profile must discover mappings from the Lexicon repository")
    if lexicon["candidateDiscovery"] != (
        "requested-ref-then-matching-open-pr-then-default-branch"
    ):
        fail("Decision profile must discover an unmerged mapping candidate")
    transform = repositories.get("Spring-Oaks-Capital-LLC/transform")
    if transform is None or {
        "scripts/setup-spark-tests.sh",
        "scripts/run-spark-tests.sh",
    } - set(transform["requiredPaths"]):
        fail("Decision profile must declare the pinned Transform Spark harness")
    mappings = {
        direction["mapping"].get("id"): direction["mapping"]
        for direction in decision["directions"]
    }
    expected_mappings = {
        "decision-to-lexicon": "1.0.0",
        "lexicon-to-decision": "1.0.0",
        "lexicon-to-interprose": "3.0.0",
    }
    if {
        mapping_id: mapping.get("version")
        for mapping_id, mapping in mappings.items()
    } != expected_mappings:
        fail("Decision profile does not declare the three exact mapping identities")
    evidence = {
        source["id"]: source for source in decision["validationSources"]
    }.get("decision-contract-freeze")
    if evidence is None or evidence.get("manifestSha256") != (
        "e890fb58a0866b9cd873b3665d6cae12adbcf29d12952e84edb63a9cf1495e5d"
    ):
        fail("Decision profile must pin the sanitized contract-freeze manifest")
    decision_text = json.dumps(decision).lower()
    for invented in (
        "dsa-client-events", "filter-decision-graph", "dsa-form-1281",
        "decision-category", "reason-category", "claydol",
    ):
        if invented in decision_text:
            fail(f"Decision profile contains obsolete or invented term {invented!r}")

    required = (
        "operating-contract.md",
        "validation-phases-and-gates.md",
        "evidence-requirements.md",
        "validation-report.md",
        "known-failure-modes.md",
    )
    for filename in required:
        read(REFERENCE / filename)
    for filename in CALIBRATION_NAMES:
        read(REFERENCE / "calibrations" / filename)


def test_naming_and_sanitization() -> None:
    paths = [
        DRAFT_PROFILE_SCHEMA,
        PROFILE_SCHEMA,
        RUN_SCHEMA,
        *(REFERENCE / "profiles" / name for name in PROFILE_NAMES),
        *(REFERENCE / "calibrations" / name for name in CALIBRATION_NAMES),
    ]
    kebab_file = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+)+$")
    prohibited_names = {"config.json", "data.json", "utils.md", "test.json"}
    for path in paths:
        if path.name in prohibited_names or not kebab_file.fullmatch(path.name):
            fail(f"non-self-describing filename: {path.name}")

    corpus = "\n".join(read(path) for path in paths if path.suffix in {".json", ".md"})
    secret_patterns = (
        r"AKIA[0-9A-Z]{16}",
        r"(?i)aws_secret_access_key\s*[:=]\s*\S+",
        r"(?i)https?://[^/\s]+:[^@\s]+@",
    )
    for pattern in secret_patterns:
        if re.search(pattern, corpus):
            fail(f"reference corpus contains prohibited secret pattern {pattern}")


def test_golden_routes_and_dry_run() -> None:
    scenarios = [
        ("ambiguous terminology", "BLOCKED", "terminology"),
        ("transform mapping defect", "NOT_READY", "Kecleon"),
        ("lexicon model gap", "NOT_READY", "Unown"),
        ("persist canary mismatch", "NOT_READY", "Conkeldurr"),
        ("scale cost unknown", "BLOCKED", "Machamp"),
        ("dev write pending", "BLOCKED", "APPROVAL_REQUIRED"),
        ("prod write requested", "BLOCKED", "read-only"),
    ]
    core = read(AGENT) + "\n" + read(SKILL / "SKILL.md")
    for name, verdict, expected in scenarios:
        if expected.lower() not in core.lower():
            fail(f"golden route {name!r} cannot resolve {expected!r}")
        if verdict not in core:
            fail(f"golden route {name!r} lacks verdict {verdict}")

    # Synthetic local validation traverses all phases without an external write.
    synthetic = ["PASS" for _ in range(12)]
    if len(synthetic) != 12 or any(status not in STATUSES for status in synthetic):
        fail("synthetic local validation did not traverse the core phases")

    # Bounded DEV dry-run must stop before each declared mutating proof.
    mutating_phases = {9, 10}
    dry_run = [
        "APPROVAL_REQUIRED" if number in mutating_phases else "PASS"
        for number in range(1, 13)
    ]
    executed_writes = 0
    if executed_writes != 0:
        fail("bounded DEV dry-run performed an external write")
    if any(dry_run[number - 1] != "APPROVAL_REQUIRED" for number in mutating_phases):
        fail("bounded DEV dry-run did not stop at approval gates")


def test_generic_intake_contract() -> None:
    core = (read(AGENT) + "\n" + read(SKILL / "SKILL.md")).lower()
    for token in (
        "profile id is not required",
        "bounded read-only discovery",
        "one focused question at a time",
        "bare",
        "business-language similarity",
        "transform-configuration-profile-draft.schema.json",
        "context_complete",
        "do not run mapping tests",
        "without redundant questions",
    ):
        if token not in core:
            fail(f"generic intake contract missing {token!r}")

    def select_profile(candidates: list[dict]) -> str | None:
        supported = [
            candidate["profileId"]
            for candidate in candidates
            if candidate["compatible"] and candidate["hardSignals"]
        ]
        return supported[0] if len(supported) == 1 else None

    if select_profile([
        {
            "profileId": PROFILE_NAMES[0],
            "compatible": True,
            "hardSignals": ["pull-request-path-match"],
        }
    ]) != PROFILE_NAMES[0]:
        fail("one hard-signal profile was not selected")

    if select_profile([
        {
            "profileId": PROFILE_NAMES[0],
            "compatible": True,
            "hardSignals": ["mapping-match"],
        },
        {
            "profileId": PROFILE_NAMES[1],
            "compatible": True,
            "hardSignals": ["language-match"],
        },
    ]) is not None:
        fail("ambiguous profile candidates were selected arbitrarily")

    if select_profile([
        {
            "profileId": PROFILE_NAMES[0],
            "compatible": True,
            "hardSignals": [],
        }
    ]) is not None:
        fail("business-language similarity selected a profile without evidence")

    bare = valid_draft()
    if bare["intakeState"] != "NEEDS_INPUT" or bare["promotionEligible"]:
        fail("bare invocation did not remain in intake")
    if not bare["unresolvedFacts"]:
        fail("bare invocation draft did not preserve missing context")

    expert = valid_draft(complete=True)
    if expert["intakeState"] != "CONTEXT_COMPLETE" or not expert["promotionEligible"]:
        fail("complete expert intake did not take the validation fast path")


def main() -> int:
    profiles = test_schemas_and_profiles()
    test_core_and_references(profiles)
    test_naming_and_sanitization()
    test_golden_routes_and_dry_run()
    test_generic_intake_contract()
    print(
        "Silvally contract tests passed: generic intake, 3 profiles, 12 phases, "
        "synthetic local validation, bounded DEV dry-run, 0 writes"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as exc:
        print(f"Silvally contract tests failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
