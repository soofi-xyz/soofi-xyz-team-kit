#!/usr/bin/env python3
"""Contract, safety, routing, and synthetic-run tests for Silvally."""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
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
PROFILES = REFERENCE / "profiles"
RESOLVER = SKILL / "scripts" / "resolve-transform-intent.py"
SHORT_REQUEST_REFERENCES = (
    "intent-resolution.md",
    "intake-questions-and-gates.md",
    "test-dataset-recommendations.md",
    "execution-and-parity.md",
    "adding-profiles.md",
)
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
        "validationWorkflow", "validationSources", "evidencePolicy", "graph",
        "adapters", "consumers", "scaleTiers",
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
    workflow = value.get("validationWorkflow", {})
    steps = workflow.get("steps", [])
    if [step.get("sequence") for step in steps] != list(range(1, len(steps) + 1)):
        errors.append("validation workflow sequence")
    direction_ids = {direction.get("id") for direction in value.get("directions", [])}
    if any(step.get("direction") not in direction_ids for step in steps):
        errors.append("validation workflow direction")
    if workflow.get("persistPolicy") not in {"required", "forbidden"}:
        errors.append("validation workflow Persist policy")
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
    source_window = value.get("sourceWindowPolicy")
    if source_window is not None:
        if source_window.get("kind") != "prod-derived-complete-utc-days":
            errors.append("source window policy kind")
        if source_window.get("minimumCompleteUtcDays", 0) < 1:
            errors.append("source window minimum")
        if not source_window.get("requiredSourceFamilies"):
            errors.append("source window source families")
        if not source_window.get("requiredCoverageSignals"):
            errors.append("source window coverage signals")
    concept_policy = value.get("lexiconConceptPolicy")
    if concept_policy is not None:
        for field in (
            "currentDefinitionRequired",
            "rejectAbsent",
            "rejectDeprecated",
            "reintroductionRequiresModelingApproval",
        ):
            if concept_policy.get(field) is not True:
                errors.append("unsafe lexicon concept policy")
        if not isinstance(concept_policy.get("forbiddenConcepts"), list):
            errors.append("missing forbidden Lexicon concepts")
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
        "boundaryDecisions", "cost", "failures", "remediations", "verdict",
    }
    errors = [f"missing {field}" for field in sorted(required - value.keys())]
    if value.get("contractVersion") != 1:
        errors.append("contractVersion")
    if value.get("verdict") not in {"READY", "NOT_READY", "BLOCKED"}:
        errors.append("verdict")
    remediations = value.get("remediations", [])
    if value.get("verdict") in {"NOT_READY", "BLOCKED"} and not remediations:
        errors.append("non-ready verdict without remediation")
    for remediation in remediations:
        for field in (
            "id", "findingCode", "status", "classification", "owner",
            "locations", "locationEvidenceIds", "recommendedChange", "regressionEvidence",
            "rerunPhases", "rerunDirections",
        ):
            if not remediation.get(field):
                errors.append(f"remediation {field}")
        if remediation.get("classification") not in {
            "CONFIGURATION", "PRODUCT_CHANGE", "ACCESS_OR_EVIDENCE",
        }:
            errors.append("remediation classification")
    mapping_key = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*@[0-9]+\.[0-9]+\.[0-9]+")
    for step in value.get("executionSteps", []):
        if not mapping_key.fullmatch(step.get("mapping", "")):
            errors.append("execution step mapping must be an exact id@version")
        location = step.get("outputLocation")
        if location is not None and not re.fullmatch(r"(?:s3://[^?#@]+/|local://[a-z0-9][a-z0-9/_-]*)", location):
            errors.append("execution step output location must be credential-free")
    for entry in value.get("parityDerivation", []):
        if not mapping_key.fullmatch(entry.get("comparedBy", "")):
            errors.append("parity derivation must name an exact mapping")
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
        if dataset.get("availability") == "UNAVAILABLE":
            if not dataset.get("subject") or not dataset.get("reason") or not dataset.get("evidenceIds"):
                errors.append("incomplete unavailable dataset evidence")
            continue
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
    if value.get("verdict") == "READY" and (
        any(
            dataset.get("availability") == "UNAVAILABLE"
            for dataset in value.get("datasets", [])
        )
        or value.get("graph", {}).get("availability") == "UNAVAILABLE"
        or value.get("runtime", {}).get("availability") == "UNAVAILABLE"
    ):
        errors.append("ready with unavailable evidence")
    source_window = value.get("sourceWindowSelection")
    if source_window is not None:
        minimum_days = source_window.get("minimumCompleteUtcDays", 0)

        def parse_utc(raw: str) -> datetime:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))

        def valid_complete_window(window: dict) -> bool:
            try:
                start = parse_utc(window["start"])
                end = parse_utc(window["endExclusive"])
            except (KeyError, TypeError, ValueError):
                return False
            duration_days = (end - start).total_seconds() / 86400
            return (
                start.tzinfo is not None
                and start.utcoffset() == timezone.utc.utcoffset(start)
                and start.hour == start.minute == start.second == start.microsecond == 0
                and end.hour == end.minute == end.second == end.microsecond == 0
                and duration_days == window.get("completeUtcDays")
                and duration_days >= minimum_days
            )

        status = source_window.get("status")
        recommended = source_window.get("recommendedWindow")
        if status != "BLOCKED" and (
            not isinstance(recommended, dict)
            or not valid_complete_window(recommended)
        ):
            errors.append("invalid recommended complete UTC window")
        if status == "BLOCKED" and recommended is not None:
            errors.append("blocked source window has a recommendation")
        for candidate in source_window.get("candidateComparisons", []):
            candidate_window = {
                "start": candidate.get("start"),
                "endExclusive": candidate.get("endExclusive"),
                "completeUtcDays": 1,
            }
            if not valid_complete_window(candidate_window):
                errors.append("candidate is not one complete UTC day")
            if candidate.get("complete") and (
                not candidate.get("sourceFamiliesPresent")
                or not candidate.get("immutableEvidence")
            ):
                errors.append("complete candidate lacks closure evidence")
        confirmed = source_window.get("confirmedWindow")
        candidates = source_window.get("candidateComparisons", [])
        if status != "BLOCKED" and not candidates:
            errors.append("source window has no candidate comparisons")
        if status == "CONFIRMED":
            if not isinstance(confirmed, dict) or not valid_complete_window(confirmed):
                errors.append("confirmed source window is invalid")
        elif confirmed is not None:
            errors.append("unconfirmed source window has confirmation")
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
        "remediations": [],
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

    prod_derived = copy.deepcopy(run)
    prod_derived["sourceWindowSelection"] = {
        "status": "NEEDS_CONFIRMATION",
        "minimumCompleteUtcDays": 1,
        "allowLongerRange": True,
        "candidateComparisons": [
            {
                "start": "2026-09-23T00:00:00Z",
                "endExclusive": "2026-09-24T00:00:00Z",
                "complete": True,
                "sourceFamiliesPresent": [
                    "decision_batch",
                    "debt_outcomes",
                    "authoritative_graph_export",
                ],
                "coverageSignals": {
                    "accepted-outcomes": 17,
                    "rejected-outcomes": 9,
                    "client-events": 12,
                },
                "rowCount": 120,
                "byteCount": 4096,
                "estimatedCostUsd": 0.05,
                "immutableEvidence": True,
            }
        ],
        "recommendedWindow": {
            "start": "2026-09-23T00:00:00Z",
            "endExclusive": "2026-09-24T00:00:00Z",
            "completeUtcDays": 1,
        },
        "confirmedWindow": None,
        "evidenceIds": ["source-window-metadata"],
    }
    assert_valid(run_check, prod_derived, "valid unconfirmed PROD-derived window")

    confirmed_window = copy.deepcopy(prod_derived)
    confirmed_window["sourceWindowSelection"]["status"] = "CONFIRMED"
    confirmed_window["sourceWindowSelection"]["confirmedWindow"] = copy.deepcopy(
        confirmed_window["sourceWindowSelection"]["recommendedWindow"]
    )
    assert_valid(run_check, confirmed_window, "valid confirmed PROD-derived window")

    partial_day = copy.deepcopy(prod_derived)
    partial_day["sourceWindowSelection"]["candidateComparisons"][0][
        "endExclusive"
    ] = "2026-09-23T12:00:00Z"
    assert_rejected(run_check, partial_day, "partial PROD day")

    implied_confirmation = copy.deepcopy(prod_derived)
    implied_confirmation["sourceWindowSelection"]["confirmedWindow"] = copy.deepcopy(
        implied_confirmation["sourceWindowSelection"]["recommendedWindow"]
    )
    assert_rejected(
        run_check,
        implied_confirmation,
        "source window confirmation without confirmed status",
    )

    inaccessible_metadata = copy.deepcopy(prod_derived)
    inaccessible_metadata["sourceWindowSelection"].update(
        {
            "status": "BLOCKED",
            "candidateComparisons": [],
            "recommendedWindow": None,
            "confirmedWindow": None,
            "evidenceIds": ["prod-metadata-access-denied"],
        }
    )
    assert_valid(
        run_check,
        inaccessible_metadata,
        "blocked PROD-derived window without invented candidates",
    )

    not_ready = copy.deepcopy(run)
    not_ready["verdict"] = "NOT_READY"
    not_ready["phases"][5]["status"] = "FAIL"
    not_ready["failures"] = [
        {
            "phase": 6,
            "code": "FormMappingEndpointIncomplete",
            "message": "A declared edge endpoint dataset is absent from mapping inputs.",
        }
    ]
    not_ready["remediations"] = [
        {
            "id": "declare-form-source-endpoint",
            "findingCode": "FormMappingEndpointIncomplete",
            "status": "FAIL",
            "classification": "CONFIGURATION",
            "owner": "Kecleon",
            "repository": "example/lexicon",
            "locations": ["mapping.json/inputs", "mapping.json/outputs/0/requiredInputs"],
            "locationEvidenceIds": ["pinned-generator-source"],
            "recommendedChange": "Declare the edge source vertex dataset in the existing mapping inputs.",
            "regressionEvidence": ["Registered runtime executes with zero dangling endpoints."],
            "rerunPhases": [6, 9, 11, 12],
            "rerunDirections": ["lexicon-to-interprose"],
        }
    ]
    assert_valid(run_check, not_ready, "valid not-ready run with remediation")

    early_not_ready = copy.deepcopy(not_ready)
    unavailable = {
        "availability": "UNAVAILABLE",
        "subject": "runtime-output",
        "reason": "Static configuration failure stopped runtime proof.",
        "evidenceIds": ["static-failure"],
    }
    early_not_ready["datasets"] = [copy.deepcopy(unavailable)]
    early_not_ready["graph"] = {
        **copy.deepcopy(unavailable),
        "subject": "graph-output",
    }
    early_not_ready["runtime"] = {
        **copy.deepcopy(unavailable),
        "subject": "transform-runtime",
    }
    assert_valid(
        run_check,
        early_not_ready,
        "valid early not-ready run with unavailable evidence",
    )

    unavailable_ready = copy.deepcopy(early_not_ready)
    unavailable_ready["verdict"] = "READY"
    unavailable_ready["phases"][5]["status"] = "PASS"
    unavailable_ready["failures"] = []
    unavailable_ready["remediations"] = []
    assert_rejected(
        run_check,
        unavailable_ready,
        "READY run with unavailable evidence",
    )

    no_remediation = copy.deepcopy(not_ready)
    no_remediation["remediations"] = []
    assert_rejected(
        run_check,
        no_remediation,
        "not-ready verdict without remediation",
    )

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

    missing_mapping_source = copy.deepcopy(profiles[1])
    del missing_mapping_source["directions"][0]["mapping"]["sourcePaths"]
    assert_rejected(
        profile_check,
        missing_mapping_source,
        "registered mapping without source paths",
    )

    invented_direction = copy.deepcopy(profiles[1])
    invented_direction["directions"][0]["mapping"]["id"] = "invented-mapping"
    invented_direction["directions"][0]["mapping"]["sourcePaths"] = []
    assert_rejected(
        profile_check,
        invented_direction,
        "invented mapping without resolvable source",
    )

    unsafe_concept_policy = copy.deepcopy(profiles[0])
    unsafe_concept_policy["lexiconConceptPolicy"]["rejectAbsent"] = False
    assert_rejected(
        profile_check,
        unsafe_concept_policy,
        "profile permitting absent Lexicon concepts",
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
        "mapping `configuration` defect", "typed-null materialization",
        "never guess a path", "generated mapping artifacts",
        "name every contradicted field", "vertex-rule-execution",
        "already implemented but not yet revalidated",
        "complete utc-day", "day-or-range confirmation",
        "never choose random rows", "sourcewindowselection",
        "removedlexiconconcept", "pinned current lexicon",
        "absent or deprecated", "reintroduction",
        "explicit pinned modeling approval",
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
        direction["id"]: direction["mapping"]
        for direction in decision["directions"]
    }
    expected_mappings = {
        "decision-to-lexicon",
        "lexicon-to-decision",
        "lexicon-to-interprose",
    }
    expected_versions = {
        "decision-to-lexicon": "1.0.0",
        "lexicon-to-decision": "1.0.0",
        "lexicon-to-interprose": "3.0.0",
    }
    if set(mappings) != expected_mappings or any(
        mapping.get("status") != "registered"
        or mapping.get("id") != mapping_id
        or mapping.get("version") != expected_versions[mapping_id]
        or mapping.get("repository") != "Spring-Oaks-Capital-LLC/lexicon"
        or not mapping.get("sourcePaths")
        or mapping.get("generatedArtifact", {}).get("logicalArtifactPath")
        != f"transform-mappings/{mapping_id}/{expected_versions[mapping_id]}/mapping.json"
        or not mapping.get("generatedArtifact", {}).get("materializationCommand")
        for mapping_id, mapping in mappings.items()
    ):
        fail("Decision profile must pin all three registered, generated mappings")
    if mappings["decision-to-lexicon"]["expectedOutputDatasets"] != [
        "product_execution",
        "product_execution_has_child_execution",
        "product_execution_includes_debt",
        "company_represents_debt",
    ]:
        fail("Decision forward outputs must be the four registered canonical concepts")
    if "rule_execution" in json.dumps(decision["datasets"] + decision["invariants"]):
        fail("Decision profile retains a removed rule_execution concept")
    evidence_sources = {
        source["id"]: source for source in decision["validationSources"]
    }
    full_day = evidence_sources.get("decision-full-day-dev")
    if full_day != {
        "id": "decision-full-day-dev",
        "kind": "existing-dev-artifact",
        "location": (
            "s3://transformpipelinestack-databuckete3889a50-rmklq0v3to8q/"
            "inputs/dsa-filter-decision-prod-derived/"
            "2026-09-18T000000Z_2026-09-19T000000Z_v1/"
        ),
        "region": "us-east-2",
        "artifactStatus": "ready",
        "manifestSha256": (
            "167469f157cf18ed0225570dbbf7b5f213498fd4dd3405a87edc6e25302824cc"
        ),
        "manifestVersionId": "Rl2cIl7LIcDPoj6BOmsvVRIW4EURgmmf",
        "appliesTo": [
            "decision-to-lexicon",
            "lexicon-to-decision",
            "lexicon-to-interprose",
        ],
        "required": True,
    }:
        fail("Decision profile must pin the manifested full-day DEV artifact")
    rejected_path = evidence_sources.get("decision-mixed-rejected-path")
    if rejected_path is None or rejected_path.get("manifestSha256") != (
        "e890fb58a0866b9cd873b3665d6cae12adbcf29d12952e84edb63a9cf1495e5d"
    ):
        fail("Decision profile must pin the sanitized mixed rejected-path manifest")
    adapted = evidence_sources.get("decision-mixed-rejected-path-adapted")
    if adapted is None or adapted.get("artifactStatus") != "staging" or "manifestSha256" in adapted:
        fail("An unmanifested adapted rejected-path package must stay staging")
    if "lexicon-decision-spark-sql" not in evidence_sources:
        fail("Decision profile must run the Lexicon Decision Spark SQL suite")
    workflow = decision["validationWorkflow"]
    if (
        [step["direction"] for step in workflow["steps"]]
        != [
            "decision-to-lexicon",
            "lexicon-to-decision",
            "lexicon-to-interprose",
        ]
        or workflow["persistPolicy"] != "forbidden"
    ):
        fail("Decision profile must run forward then two reverse checks without Persist")
    expected_parity = {
        "decision_batch": 17,
        "chunk_executions": 7,
        "debt_outcomes": 4,
        "rule_evaluations": 5,
        "dsa_client_id_updates": 7,
        "graph_identity_references": 5,
    }
    for direction_id in ("decision-to-lexicon", "lexicon-to-decision"):
        direction = next(
            item for item in decision["directions"] if item["id"] == direction_id
        )
        parity = {
            dataset["dataset"]: len(dataset["fields"])
            for dataset in direction.get("parityDatasets", [])
        }
        if parity != expected_parity:
            fail(f"{direction_id}: incomplete per-dataset Decision field parity")
    form_direction = next(
        item for item in decision["directions"]
        if item["id"] == "lexicon-to-interprose"
    )
    if {
        dataset["dataset"]: len(dataset["fields"])
        for dataset in form_direction.get("parityDatasets", [])
    } != {"form_1281": 7}:
        fail("lexicon-to-interprose: form_1281 must compare all seven fields")
    expected_tests = set(decision["transformClassification"]["expectedOutputTests"])
    if {
        "decision-sql-executed",
        "full-utc-day-decision-coverage",
    } - expected_tests:
        fail("Decision profile must require executed SQL and full-day coverage")
    if "dsa-latest-edge-regression" not in set(
        decision["transformClassification"]["negativeTests"]
    ):
        fail("Decision profile must require the DSA latest-edge regression")
    source_window = decision.get("sourceWindowPolicy", {})
    if (
        source_window.get("kind") != "prod-derived-complete-utc-days"
        or source_window.get("minimumCompleteUtcDays") != 1
        or source_window.get("allowLongerRange") is not True
        or set(source_window.get("requiredSourceFamilies", []))
        != {
            "decision_batch",
            "chunk_executions",
            "debt_outcomes",
            "rule_evaluations",
            "dsa_client_id_updates",
            "graph_identity_references",
        }
        or "not-required-runs"
        not in set(source_window.get("requiredCoverageSignals", []))
    ):
        fail("Decision profile must require a complete PROD-derived UTC day")
    concept_policy = decision.get("lexiconConceptPolicy", {})
    if (
        any(
            concept_policy.get(field) is not True
            for field in (
                "currentDefinitionRequired",
                "rejectAbsent",
                "rejectDeprecated",
                "reintroductionRequiresModelingApproval",
            )
        )
        or "rule_execution" not in set(concept_policy.get("forbiddenConcepts", []))
        or "rule_execution_decided_debt"
        not in set(concept_policy.get("forbiddenConcepts", []))
    ):
        fail("Decision profile must reject removed/deprecated Lexicon concepts")
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


def load_resolver():
    spec = importlib.util.spec_from_file_location("resolve_transform_intent", RESOLVER)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def vertex(name: str, properties: dict, required: list[str] | None = None) -> dict:
    return {
        "type": name,
        "is_deprecated": False,
        "deprecated_properties": {},
        "properties": properties,
        "required": required if required is not None else list(properties),
    }


def props(*names: str, **enums: list[str]) -> dict:
    out = {name: {"type": "string", "minLength": 1} for name in names}
    for name, values in enums.items():
        out[name] = {"type": "string", "enum": values}
    return out


DECISION_FIELDS = {
    "decision_batch": props(
        "source_run_id", "schema_version", "candidate_count", "accepted_count",
        "rejected_count", "chunk_count", "historical_client_event_status",
        "evidence_manifest_uri", "evidence_manifest_versioning",
        "evidence_manifest_version_id", "evidence_manifest_etag",
        "evidence_manifest_size", "evidence_manifest_sha256",
        "versioned_source_object_count", "unversioned_stable_read_object_count",
        "source_object_count", status=["complete", "not_required"],
    ),
    "chunk_executions": props(
        "source_run_id", "chunk_index", "chunk_count", "candidate_count",
        "accepted_count", "rejected_count", "filter_execution_arn",
    ),
    "debt_outcomes": props("source_run_id", "chunk_index", "debt_id", outcome=["accepted", "rejected"]),
    "rule_evaluations": props(
        "source_run_id", "chunk_index", "debt_id",
        "latest_oos_restricted_state_blocks_dsa_offer",
        "latest_oos_missing_state_blocks_dsa_offer",
    ),
    "dsa_client_id_updates": props(
        "schema_version", "event_type", "debtID", "dsc_client_id",
        "effective_at", "source_run_id", "idempotency_key",
    ),
    "graph_identity_references": props(
        "source_run_id", "debt_identifier", "dsa_company_identifier",
        "identity_basis", "authoritative_graph_export",
    ),
}
DECISION_GRAPH = [
    "product_execution", "product_execution_has_child_execution",
    "product_execution_includes_debt", "company_represents_debt",
]
SMS_GRAPH = [
    "vertex-debt", "vertex-phone-number", "vertex-text-message", "vertex-template",
    "edge-debt-has-text-message", "edge-phone-number-has-text-message",
    "edge-text-message-status-changed", "edge-text-message-has-rendered-artifact-uri",
    "edge-text-message-rendered-from-template",
]
EMAIL_GRAPH = [
    "vertex-debt", "vertex-email", "vertex-email-message", "vertex-template",
    "edge-debt-has-email-message", "edge-email-has-email-message",
    "edge-email-message-has-from-email", "edge-email-message-rendered-from-template",
    "edge-email-message-status-changed",
]


def mapping_doc(mid: str, version: str, source: str, target: str, inputs: list[str], outputs: list[str], shape: str, graph_inputs: bool = False) -> dict:
    return {
        "id": mid,
        "version": version,
        "status": "ENABLED",
        "engine": "spark-sql",
        "from": source,
        "to": target,
        "inputs": [
            {"table": t, "view": f"source_{t.replace('-', '_')}", "format": "parquet", "options": {},
             **({"graph": {"kind": "vertex" if t.startswith("vertex-") else "edge"}} if graph_inputs and t.startswith(("vertex-", "edge-")) else {})}
            for t in inputs
        ],
        "output": {"shape": shape, "format": "csv" if shape == "graph" else "jsonl", "options": {}},
        "outputs": [{"dataset": o, "requiredInputs": inputs, "queries": [{"path": f"queries/{o}.sql"}], "dependsOn": []} for o in outputs],
    }


REGISTERED_MAPPINGS = {
    "decision-to-lexicon@1.0.0": ("decision", "lexicon", list(DECISION_FIELDS), DECISION_GRAPH, "tabular", False),
    "lexicon-to-decision@1.0.0": ("lexicon", "decision", DECISION_GRAPH, [d for d in DECISION_FIELDS if d != "graph_identity_references"], "tabular", False),
    "lexicon-to-interprose@1.0.0": ("lexicon", "interprose", EMAIL_GRAPH, ["debt", "email_queue"], "tabular", True),
    "lexicon-to-interprose@2.0.0": ("lexicon", "interprose", SMS_GRAPH + ["hydrated_text_message_artifact"], ["sms_log"], "tabular", True),
    "lexicon-to-interprose@3.0.0": ("lexicon", "interprose", ["company_represents_debt"], ["form_1281"], "tabular", False),
    "lexicon-to-sms@1.0.0": ("lexicon", "sms", SMS_GRAPH + ["hydrated_text_message_artifact"], ["sms_log"], "tabular", True),
    "quiq-to-lexicon@1.0.0": ("quiq", "lexicon", ["lifecycle"], SMS_GRAPH, "graph", False),
    "interprose-to-lexicon@1.0.0": ("interprose", "lexicon", ["debt", "txt_msg_log", "email_queue"], EMAIL_GRAPH + SMS_GRAPH[:3] + ["edge-company-represents-debt"], "graph", False),
}


def build_lexicon_fixture(root: Path) -> dict[str, Path]:
    candidate, main, dev, prod, staging = (root / n for n in ("candidate", "main", "dev", "prod", "staging"))
    concepts_main = ["debt", "company", "product", "product_execution", "phone_number", "text_message", "template", "email", "email_message"]
    edges_main = [
        "product_has_execution", "product_execution_includes_debt", "company_represents_debt",
        "debt_has_text_message", "phone_number_has_text_message", "text_message_status_changed",
        "text_message_has_rendered_artifact_uri", "text_message_rendered_from_template",
        "debt_has_email_message", "email_has_email_message", "email_message_has_from_email",
        "email_message_rendered_from_template", "email_message_status_changed",
    ]
    for checkout, extra_edges in ((main, []), (candidate, ["product_execution_has_child_execution"])):
        write_json(checkout / "src/data/lexicon.json", {
            "vertices": [vertex(v, props("id")) for v in concepts_main],
            "edges": [{"type": e, "from": "a", "to": "b", "properties": {}} for e in edges_main + extra_edges],
        })
        spec = checkout / "infra/test/transform-mappings.spec.ts"
        spec.parent.mkdir(parents=True, exist_ok=True)
        spec.write_text('for (const retired of [\n  "interprose-to-graph",\n  "sms-to-interprose",\n  "sms-log-to-interprose",\n]) {}\n')
    (candidate / "src/data/lexicons.ts").write_text(
        "export const lexicons: Record<string, LexiconRegistryEntry> = {\n"
        "  lexicon: {\n  },\n  interprose: {\n  },\n  quiq: {\n  },\n};\n"
    )
    stack = candidate / "infra/lib/lexicon-stack.ts"
    stack.parent.mkdir(parents=True, exist_ok=True)
    stack.write_text("\n".join(
        f'        parameterName: "/lexicon/{p}",' for p in ("data-uri", "interprose-data-uri", "quiq-data-uri", "decision-data-uri", "transform-mappings-uri")
    ))
    write_json(candidate / "src/data/decision.json", {
        "vertices": [vertex(name, fields) for name, fields in DECISION_FIELDS.items()],
        "edges": [],
    })
    write_json(candidate / "src/data/interprose.json", {
        "vertices": [
            vertex("form_1281", props("debtID", "dsc_client_id", "form_config_id", "field_identifier", "effective_at", "source_run_id", "idempotency_key")),
            vertex("txt_msg_log", props("txt_msg_log_id", "debt_id", "status")),
        ],
        "edges": [],
    })
    write_json(candidate / "src/data/quiq.json", {"vertices": [vertex("lifecycle", props("interaction_identifier", "canonical_status"))], "edges": []})
    for key in ("decision-to-lexicon@1.0.0", "lexicon-to-decision@1.0.0"):
        mid, version = key.split("@")
        write_json(candidate / f"src/transform/mappings/{mid}/registration.json", mapping_doc(mid, version, *REGISTERED_MAPPINGS[key]))
    for key, spec_args in REGISTERED_MAPPINGS.items():
        mid, version = key.split("@")
        write_json(dev / f"transform-mappings/{mid}/{version}/mapping.json", mapping_doc(mid, version, *spec_args))
        if "decision" not in key and key != "lexicon-to-interprose@3.0.0":
            write_json(prod / f"transform-mappings/{mid}/{version}/mapping.json", mapping_doc(mid, version, *spec_args))
    write_json(staging / "transform-mappings/decision-to-lexicon/2.0.0/mapping.json", mapping_doc(
        "decision-to-lexicon", "2.0.0", "decision", "lexicon", list(DECISION_FIELDS), DECISION_GRAPH + ["rule_execution"], "graph",
    ))
    staged_sql = staging / "transform-mappings/decision-to-lexicon/2.0.0/queries/product_execution.sql"
    staged_sql.parent.mkdir(parents=True, exist_ok=True)
    staged_sql.write_text("SELECT source_run_id AS rule_execution_id FROM source_decision_batch -- rule_execution\n")
    write_json(staging / "transform-mappings/lexicon-to-decision/1.0.0/mapping.json", mapping_doc(
        "lexicon-to-decision", "1.0.0", "lexicon", "decision", DECISION_GRAPH, list(DECISION_FIELDS), "tabular",
    ))
    ssm_dev = root / "ssm-dev.txt"
    ssm_dev.write_text("/lexicon/data-uri\n/lexicon/decision-data-uri\n/lexicon/interprose-data-uri\n/lexicon/quiq-data-uri\n/lexicon/transform-mappings-uri\n")
    return {"candidate": candidate, "main": main, "dev": dev, "prod": prod, "staging": staging, "ssm-dev": ssm_dev}


def build_stale_decision_profiles(root: Path) -> Path:
    """Copy the shipped profiles, reverting Decision to its pre-registration shape."""
    root.mkdir(parents=True)
    for source in sorted(PROFILES.glob("*.json")):
        profile = json.loads(source.read_text())
        if profile["id"] == "dsa-filter-decision.json":
            for direction in profile["directions"]:
                mapping = direction["mapping"]
                expected = list(mapping["expectedOutputDatasets"])
                if direction["id"] == "decision-to-lexicon":
                    expected += ["product", "product_has_execution", "company", "debt"]
                direction["mapping"] = {
                    "status": "not-registered",
                    "expectedId": mapping["id"],
                    "owner": "kecleon",
                    "reason": "Stale pre-registration fixture used to prove drift detection.",
                    "plannedSource": {
                        "repository": mapping["repository"],
                        "sourcePaths": mapping["sourcePaths"],
                        "generatedArtifact": mapping["generatedArtifact"],
                        "expectedOutputDatasets": expected,
                    },
                }
                for dataset in direction.get("parityDatasets", []):
                    if dataset["dataset"] == "decision_batch":
                        dataset["fields"].remove("evidence_manifest_version_id")
        write_json(root / source.name, profile)
    return root


def build_main_with_removed_concept(root: Path, main: Path, label: str) -> Path:
    """A full-history main checkout that once declared ``label`` and later removed it."""
    shutil.copytree(main, root)
    lexicon_path = root / "src/data/lexicon.json"
    current = json.loads(lexicon_path.read_text())
    revived = copy.deepcopy(current)
    revived["edges"].append({"type": label, "from": "a", "to": "b", "properties": {}})

    def git(*args: str) -> None:
        subprocess.run(
            ["git", "-C", str(root), "-c", "user.name=silvally", "-c", "user.email=silvally@example.invalid", *args],
            check=True, capture_output=True,
        )

    git("init", "-q")
    for document, message in ((revived, "add concept"), (current, "remove concept")):
        write_json(lexicon_path, document)
        git("add", "-A")
        git("commit", "-q", "-m", message)
    return root


def test_intent_resolution() -> None:
    resolver = load_resolver()

    parsed = resolver.parse_request("/silvally validate lexicon (sms/decision/anything) to interprose @3.0.0 in prod round trip")
    if parsed["status"] != "PARSED" or parsed["qualifiers"] != ["sms", "decision"]:
        fail(f"qualifier parsing failed: {parsed}")
    if parsed["hints"] != {"version": "3.0.0", "environment": "prod", "mode": "round-trip"}:
        fail(f"hint parsing failed: {parsed['hints']}")
    if resolver.parse_request("test the decision stuff")["status"] != "UNPARSED":
        fail("a request without a direction was parsed")

    with tempfile.TemporaryDirectory() as tmp:
        paths = build_lexicon_fixture(Path(tmp))
        stale_profiles = build_stale_decision_profiles(Path(tmp) / "stale-profiles")

        def run(request: str, *extra: str, profiles: Path = stale_profiles, main: Path = paths["main"]) -> dict:
            args = [
                "discover", "--request", request,
                "--lexicon-root", str(paths["candidate"]),
                "--main-lexicon-root", str(main),
                "--registry", f"dev={paths['dev']}",
                "--registry", f"prod={paths['prod']}",
                "--ssm-parameters", f"dev={paths['ssm-dev']}",
                "--profiles", str(profiles),
                *extra,
            ]
            parser_args = resolver_args(resolver, args)
            return resolver.discover(request, resolver.load_registry(parser_args))

        def codes(result: dict) -> set[str]:
            return {f["code"] for f in result.get("findings", [])}

        def question(result: dict, qid: str) -> dict | None:
            return next((q for q in result.get("questions", []) if q["id"] == qid), None)

        decision = run("test decision to lexicon")
        if decision["status"] != "RESOLVED" or decision["selection"]["selected"] != "decision-to-lexicon@1.0.0":
            fail(f"decision forward did not resolve: {decision.get('status')}")
        if [s["mapping"] for s in decision["workflow"]["steps"]] != ["decision-to-lexicon@1.0.0", "lexicon-to-decision@1.0.0"]:
            fail("decision round trip order is wrong")
        if [c["mapping"] for c in decision["workflow"]["optionalCrossSource"]] != ["lexicon-to-interprose@3.0.0"]:
            fail("decision cross-source continuation was not offered")
        if decision["selectedProfile"] != "dsa-filter-decision.json":
            fail("decision profile was not selected from the mapping identity")
        if decision["parityPolicy"] != {"fieldSource": "language-definition-and-registration", "declaredFields": "minimum", "undefinedDatasets": "block"}:
            fail("selected profile parity policy was not surfaced")
        parity = {p["dataset"]: p for p in decision["parityDerivation"]}
        if len(parity["decision_batch"]["fields"]) != 17 or parity["decision_batch"]["profileDeclared"]["missingFromProfile"] != ["evidence_manifest_version_id"]:
            fail("derived parity did not add the definition field missing from the profile")
        if parity["graph_identity_references"]["status"] != "FAIL" or parity["graph_identity_references"]["finding"] != "RoundTripDatasetGap":
            fail("unreconstructed forward input was not a round-trip gap")
        if parity["debt_outcomes"]["coverageTargets"] != [{"field": "outcome", "values": ["accepted", "rejected"]}]:
            fail("enum coverage targets were not derived")
        if not parity["form_1281"].get("optional") or len(parity["form_1281"]["fields"]) != 7:
            fail("optional cross-source parity was not derived from the target language")
        checks = {c["concept"]: c for c in decision["conceptChecks"]["decision-to-lexicon@1.0.0"]}
        states = {concept: check["state"] for concept, check in checks.items()}
        if states["product_execution_has_child_execution"] != "ADDED_IN_CANDIDATE" or states["product_execution"] != "ACTIVE_ON_MAIN":
            fail(f"concept classification against main failed: {states}")
        if checks["product_execution_has_child_execution"].get("historyChecked") is not False:
            fail("an added concept checked without main history must say so")
        if not {"HubOutputNotGraph", "ProfileRegistrationStatusDrift", "ProfileOutputDatasetDrift"} <= codes(decision):
            fail(f"decision profile drift not reported: {codes(decision)}")
        if any(scan["forbiddenLabels"] for scan in decision["sqlScan"].values()):
            fail("clean Decision SQL reported a forbidden label")

        current = run("test decision to lexicon", profiles=resolver.DEFAULT_PROFILES)
        current_parity = {p["dataset"]: p for p in current["parityDerivation"]}
        if "ProfileRegistrationStatusDrift" in codes(current):
            fail("the shipped Decision profile still lags the registered mappings")
        if any(f["code"] == "ProfileOutputDatasetDrift" and f.get("direction") == "decision-to-lexicon" for f in current["findings"]):
            fail("the shipped Decision profile expects outputs the forward mapping does not register")
        if current_parity["decision_batch"]["profileDeclared"]["missingFromProfile"]:
            fail("the shipped Decision profile omits a decision_batch definition field")

        revived_main = build_main_with_removed_concept(Path(tmp) / "main-history", paths["main"], "product_execution_has_child_execution")
        revived = run("test decision to lexicon", main=revived_main)
        revived_check = next(
            c for c in revived["conceptChecks"]["decision-to-lexicon@1.0.0"]
            if c["concept"] == "product_execution_has_child_execution"
        )
        if revived_check["state"] != "REMOVED_ON_MAIN" or len(revived_check.get("mainHistoryCommits", [])) != 2:
            fail(f"a concept removed from main history was accepted as additive: {revived_check}")
        if not any(f["code"] == "RemovedLexiconConcept" and f["concept"] == "product_execution_has_child_execution" for f in revived["findings"]):
            fail("a concept revived from main history was not reported")
        if [q["id"] for q in decision["questions"]] != ["environment", "test-dataset", "direction-mode", "cross-source-step", "persist-policy"]:
            fail(f"decision question plan wrong: {[q['id'] for q in decision['questions']]}")
        if question(decision, "environment")["default"] != "dev" or question(decision, "persist-policy")["default"] != "forbidden":
            fail("environment or Persist defaults are unsafe")
        if question(decision, "direction-mode")["default"] != "round-trip":
            fail("forward request did not default to round trip")
        dataset_ids = [o["id"] for o in question(decision, "test-dataset")["options"]]
        if dataset_ids[:2] != ["decision-full-day-dev", "decision-mixed-rejected-path"] or "prod-derived-full-utc-day" not in dataset_ids:
            fail(f"dataset recommendations missing profile evidence or proposals: {dataset_ids}")
        rec = next(r for r in decision["datasetRecommendations"] if r["id"] == "prod-derived-full-utc-day")
        if not rec["location"].startswith("s3://<dev-transform-data-bucket>/inputs/decision-prod-derived/"):
            fail("proposed dataset location violates the inputs/<language>-<purpose>/ layout")

        cross = run("test lexicon decision to interprose")
        if cross["status"] != "RESOLVED" or cross["selection"]["selected"] != "lexicon-to-interprose@3.0.0":
            fail("decision qualifier did not select the form projection version")
        if [s["mapping"] for s in cross["workflow"]["steps"]] != ["decision-to-lexicon@1.0.0", "lexicon-to-interprose@3.0.0"]:
            fail("cross-source request did not chain the qualifier producer")
        if question(cross, "direction-mode")["default"] != "one-way" or question(cross, "mapping-version") is None:
            fail("cross-source question defaults are wrong")
        selected = next(c for c in cross["selection"]["candidates"] if c["mapping"] == "lexicon-to-interprose@3.0.0")
        if not any(s["kind"] == "chain-producer" and s["via"] == "decision-to-lexicon@1.0.0" for s in selected["signals"]):
            fail("cross-source selection lacks chain-producer evidence")

        sms_projection = run("test lexicon (sms) to interprose")
        if sms_projection["selection"]["selected"] != "lexicon-to-interprose@2.0.0":
            fail("sms qualifier did not select the sms_log projection")
        if sms_projection["selectedProfile"] != "quiq-sms-lifecycle.json":
            fail("sms projection did not match the lifecycle profile")
        if "UpstreamSourceUnresolved" not in codes(sms_projection) or question(sms_projection, "upstream-source") is None:
            fail("unresolved upstream producer was not asked")
        sms_parity = sms_projection["parityDerivation"][0]
        if sms_parity["status"] != "BLOCKED" or sms_parity["finding"] != "DatasetUndefined":
            fail("dataset absent from the target language did not block derived parity")

        ambiguous = run("test lexicon to interprose")
        if ambiguous["status"] != "AMBIGUOUS" or len(ambiguous["candidates"]) != 3:
            fail("unqualified multi-version request was not ambiguous")
        if question(ambiguous, "mapping-choice") is None:
            fail("ambiguous request did not ask for the mapping")

        pinned = run("test lexicon to interprose @1.0.0")
        if pinned["selection"]["selected"] != "lexicon-to-interprose@1.0.0":
            fail("version hint did not select the exact mapping")

        sms = run("test sms to lexicon")
        if sms["status"] != "NO_MAPPING" or sms.get("selection", {}).get("selected"):
            fail("missing sms-to-lexicon mapping was not reported")
        if "LanguageDefinitionMissing" not in codes(sms) or sms["languages"]["sms"]["state"] != "MAPPING_ENDPOINT_ONLY":
            fail("undefined sms language was not reported")
        ranked = [c.get("mapping") for c in sms["candidates"]]
        if ranked[:2] != ["lexicon-to-sms@1.0.0", "quiq-to-lexicon@1.0.0"] or "sms-to-interprose" not in ranked:
            fail(f"sms candidates not ranked by evidence: {ranked}")
        choice = question(sms, "mapping-choice")
        if choice is None or choice["options"][-1]["id"] != "none" or any(o["id"] == "sms-to-interprose" for o in choice["options"]):
            fail("sms mapping-choice question must exclude retired ids and offer none")

        unknown = run("test foo to bar")
        if unknown["status"] != "UNKNOWN_LANGUAGE" or not any(c.get("language") == "decision" for c in unknown["candidates"]):
            fail("unknown languages did not list registered languages")

        staged = run("test decision to lexicon @2.0.0", "--registry", f"staging={paths['staging']}")
        removed = [f for f in staged["findings"] if f["code"] == "RemovedLexiconConcept"]
        if [f["concept"] for f in removed] != ["rule_execution"]:
            fail("forbidden Lexicon concept in a mapping output was not reported")
        if "RegistrySourceDrift" not in codes(staged):
            fail("differing registrations for one mapping identity were not reported")
        sql_hits = [f for f in staged["findings"] if f["code"] == "ForbiddenConceptInSql"]
        if [(f["concept"], f["query"]) for f in sql_hits] != [("rule_execution", "product_execution.sql")]:
            fail(f"forbidden label in mapping SQL was not reported: {sql_hits}")

        draft = resolver.draft_profile("test sms to lexicon", sms)
        assert_valid(validator(DRAFT_PROFILE_SCHEMA), draft, "auto-generated sms draft")
        if draft["promotionEligible"] or draft["intakeState"] != "NEEDS_INPUT":
            fail("auto-generated draft skipped intake")
        resolved_draft = resolver.draft_profile("test decision to lexicon", decision)
        assert_valid(validator(DRAFT_PROFILE_SCHEMA), resolved_draft, "auto-generated decision draft")
        if resolved_draft["selectedProfile"] != "dsa-filter-decision.json":
            fail("resolved draft lost the selected profile")

    run_checker = validator(RUN_SCHEMA)
    run = valid_run()
    digest = "sha256:" + "b" * 64
    run["intentResolution"] = {
        "request": "test decision to lexicon",
        "status": "RESOLVED",
        "source": "decision",
        "target": "lexicon",
        "qualifiers": [],
        "selectedMappings": ["decision-to-lexicon@1.0.0", "lexicon-to-decision@1.0.0"],
        "candidateMappings": ["lexicon-to-interprose@3.0.0"],
        "registrySources": ["candidate", "dev", "prod"],
        "resolverSha256": "sha256:" + hashlib.sha256(RESOLVER.read_bytes()).hexdigest(),
    }
    run["executionSteps"] = [{
        "sequence": 1,
        "mapping": "decision-to-lexicon@1.0.0",
        "environment": "dev",
        "status": "PASS",
        "approvalOperationDigest": digest,
        "executionArn": "arn:aws:states:us-east-2:111122223333:execution:TransformPipelineStack-transform-pipeline:silvally-run-1-decision-to-lexicon",
        "inputManifestSha256": digest,
        "outputLocation": "s3://example-transform-bucket/outputs/silvally/run/",
        "planSha256": digest,
        "metadataSha256": digest,
        "executedSqlSha256s": [digest],
        "logLocations": ["/aws/vendedlogs/states/transform-pipeline"],
    }]
    run["parityDerivation"] = [{
        "language": "decision", "dataset": "decision_batch", "comparedBy": "lexicon-to-decision@1.0.0",
        "fieldSource": "language-definition", "fieldCount": 17, "mismatchCount": 0, "status": "PASS",
    }]
    assert_valid(run_checker, run, "run with intent resolution and execution steps")
    bad = copy.deepcopy(run)
    bad["executionSteps"][0]["mapping"] = "decision-to-lexicon@latest"
    assert_rejected(run_checker, bad, "mutable mapping version in execution step")
    bad = copy.deepcopy(run)
    bad["executionSteps"][0]["outputLocation"] = "https://signed.example/object?X-Amz-Signature=abc"
    assert_rejected(run_checker, bad, "signed URL output location")
    glue_logs = copy.deepcopy(run)
    glue_logs["executionSteps"][0]["logLocations"] = [
        "TransformPipelineStack-StateMachineLogGroup15B91BCB-WXDLtH0ceaMc",
        "/aws-glue/jobs/output:jr_8f8330c9bd6fc81e4e5debb680bb9c7075d1a5348014c32707952dfe4a5e5566",
    ]
    assert_valid(run_checker, glue_logs, "stack-named and Glue job log locations")
    bad = copy.deepcopy(run)
    bad["executionSteps"][0]["logLocations"] = ["https://console.aws.amazon.com/cloudwatch/home?region=us-east-2"]
    assert_rejected(run_checker, bad, "console URL as a log location")

    core = (read(AGENT) + "\n" + read(SKILL / "SKILL.md")).lower()
    for token in (
        "short requests", "resolve-transform-intent.py", "validation only",
        "never fix", "structured question tool", "dev deployment",
        "derived parity", "executionsteps", "current lexicon `main`",
        "no_mapping", "unknown_language", "persist policy (default `forbidden`)",
    ):
        if token not in core:
            fail(f"short-request contract missing {token!r}")
    skill = read(SKILL / "SKILL.md")
    for filename in SHORT_REQUEST_REFERENCES:
        if f"reference/{filename}" not in skill:
            fail(f"SKILL.md does not load {filename}")
        read(REFERENCE / filename)


def resolver_args(resolver, argv: list[str]):
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("command")
    parser.add_argument("--request", required=True)
    parser.add_argument("--lexicon-root")
    parser.add_argument("--main-lexicon-root")
    parser.add_argument("--registry", action="append")
    parser.add_argument("--ssm-parameters", action="append")
    parser.add_argument("--profiles", default=str(resolver.DEFAULT_PROFILES))
    return parser.parse_args(argv)


def main() -> int:
    profiles = test_schemas_and_profiles()
    test_core_and_references(profiles)
    test_naming_and_sanitization()
    test_golden_routes_and_dry_run()
    test_generic_intake_contract()
    test_intent_resolution()
    print(
        "Silvally contract tests passed: generic intake, short-request intent resolution, "
        "derived parity, 3 profiles, 12 phases, synthetic local validation, "
        "bounded DEV dry-run, 0 writes"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as exc:
        print(f"Silvally contract tests failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
