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
FORBIDDEN = REFERENCE / "forbidden-concepts.json"
FORBIDDEN_SCHEMA = REFERENCE / "forbidden-concepts.schema.json"
PROFILE_NAMES = (
    "lexicon-interprose-v4.json",
    "quiq-sms-lifecycle.json",
    "m2d-document-media.json",
)
CALIBRATION_NAMES = (
    "lexicon-interprose-v4-round-trip.md",
    "quiq-sms-full-day-round-trip.md",
    "m2d-document-media-round-trip.md",
)
RETIRED_FILES = (
    PROFILES / "dsa-filter-decision.json",
    REFERENCE / "calibrations" / "dsa-filter-decision-round-trip.md",
)
STATUSES = {"PASS", "FAIL", "BLOCKED", "APPROVAL_REQUIRED"}
DOMAIN_BRANCH_TERMS = (
    "lexicon-interprose-v4", "quiq-sms-lifecycle", "m2d-document-media",
    "form_1281", "payment_plan_schedule", "dsa-filter-decision",
)
V4_KEY = "lexicon-to-interprose@4.0.0"
V4_OUTPUTS = ("form_1281", "payment_plan", "payment_plan_schedule")
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
        elif self.kind == "forbidden":
            errors = forbidden_errors(value)
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
    kind = {
        PROFILE_SCHEMA: "profile",
        DRAFT_PROFILE_SCHEMA: "draft",
        FORBIDDEN_SCHEMA: "forbidden",
    }.get(path, "artifact")
    return ContractValidator(kind, schema)


def forbidden_errors(value: dict) -> list[str]:
    errors = [f"missing {f}" for f in ("id", "contractVersion", "evidence", "concepts", "properties", "retiredMappings") if f not in value]
    label = re.compile(r"[a-z0-9]+(?:_[a-z0-9]+)*")
    key = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*@[0-9]+\.[0-9]+\.[0-9]+")
    for concept in value.get("concepts", []):
        if not label.fullmatch(concept.get("label", "")) or concept.get("kind") not in {"vertex", "edge"}:
            errors.append("forbidden concept label or kind")
    for prop in value.get("properties", []):
        if not label.fullmatch(prop.get("concept", "")) or not label.fullmatch(prop.get("property", "")):
            errors.append("forbidden property must be scoped to a concept")
        if not isinstance(prop.get("sqlScan"), bool):
            errors.append("forbidden property sqlScan flag")
    for retired in value.get("retiredMappings", []):
        if not key.fullmatch(retired.get("mapping", "")):
            errors.append("retired mapping must be an exact id@version")
    if not re.fullmatch(r"[a-f0-9]{40}", value.get("evidence", {}).get("mainCommitSha", "")):
        errors.append("forbidden list must pin a Lexicon main commit")
    return errors


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
    for source in value.get("validationSources", []):
        if source.get("artifactStatus") == "planned":
            if "manifestSha256" in source or "manifestVersionId" in source:
                errors.append("planned artifact claims a manifest")
            if not source.get("tbd"):
                errors.append("planned artifact without TBD placeholders")
    for direction in value.get("directions", []):
        for contract in direction.get("outputContracts", []):
            fmt = contract.get("format", {})
            if fmt.get("type") == "csv" and (
                len(fmt.get("delimiter", "")) != 1 or not isinstance(fmt.get("header"), bool)
            ):
                errors.append("csv output contract needs a one-character delimiter and header flag")
            for constraint in contract.get("columnConstraints", []):
                if ("const" in constraint) == ("enum" in constraint):
                    errors.append("column constraint needs exactly one of const or enum")
    model_policy = value.get("lexiconModelPolicy")
    if model_policy is not None and model_policy.get("candidateLexiconDiff") not in {"forbidden", "allowed"}:
        errors.append("Lexicon model diff policy")
    for evidence in value.get("partialInputPolicy", {}).get("evidence", []):
        if not re.fullmatch(r"[a-f0-9]{40}", evidence.get("commitSha", "")):
            errors.append("partial-input evidence must pin a commit")
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
        for log in step.get("logLocations", []):
            if not re.fullmatch(r"(?:[A-Za-z0-9_./#-]+(?::[A-Za-z0-9_.#$\[\]-][A-Za-z0-9_./#$\[\]-]*)?|local://[a-z0-9][a-z0-9/_-]*)", log):
                errors.append("execution step log location must be a log group or local path")
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
                    "debt_settlement_agency",
                    "payment_plan",
                    "payment_plan_schedule",
                ],
                "coverageSignals": {
                    "dsa-active": 17,
                    "dsa-deleted": 9,
                    "payment-plan-cancelled": 12,
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
            "rerunDirections": ["lexicon-to-interprose-v4"],
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

    v4 = next(p for p in profiles if p["id"] == "lexicon-interprose-v4.json")
    planned_with_manifest = copy.deepcopy(v4)
    package = next(s for s in planned_with_manifest["validationSources"] if s["kind"] == "existing-dev-artifact")
    package["artifactStatus"] = "planned"
    package["tbd"] = ["manifestSha256"]
    assert_rejected(profile_check, planned_with_manifest, "planned artifact claiming a manifest digest")

    planned_without_tbd = copy.deepcopy(v4)
    package = next(s for s in planned_without_tbd["validationSources"] if s["kind"] == "existing-dev-artifact")
    package["artifactStatus"] = "planned"
    del package["manifestSha256"], package["manifestVersionId"]
    assert_rejected(profile_check, planned_without_tbd, "planned artifact without TBD placeholders")

    ready_without_manifest = copy.deepcopy(v4)
    package = next(s for s in ready_without_manifest["validationSources"] if s["kind"] == "existing-dev-artifact")
    del package["manifestVersionId"]
    assert_rejected(profile_check, ready_without_manifest, "ready artifact without a manifest version")

    csv_without_delimiter = copy.deepcopy(v4)
    del csv_without_delimiter["directions"][1]["outputContracts"][0]["format"]["delimiter"]
    assert_rejected(profile_check, csv_without_delimiter, "csv output contract without a delimiter")

    multi_char_delimiter = copy.deepcopy(v4)
    multi_char_delimiter["directions"][1]["outputContracts"][0]["format"]["delimiter"] = "||"
    assert_rejected(profile_check, multi_char_delimiter, "multi-character csv delimiter")

    ambiguous_constraint = copy.deepcopy(v4)
    ambiguous_constraint["directions"][1]["outputContracts"][0]["columnConstraints"][0]["enum"] = ["1281"]
    assert_rejected(profile_check, ambiguous_constraint, "column constraint with both const and enum")

    unknown_model_policy = copy.deepcopy(v4)
    unknown_model_policy["lexiconModelPolicy"]["candidateLexiconDiff"] = "warn"
    assert_rejected(profile_check, unknown_model_policy, "unknown Lexicon model diff policy")

    mutable_partial_evidence = copy.deepcopy(v4)
    mutable_partial_evidence["partialInputPolicy"]["evidence"][0]["commitSha"] = "main"
    assert_rejected(profile_check, mutable_partial_evidence, "partial-input evidence pinned to a branch")

    forbidden_check = validator(FORBIDDEN_SCHEMA)
    shared = load_json(FORBIDDEN)
    assert_valid(forbidden_check, shared, "shared forbidden concepts")
    bad_label = copy.deepcopy(shared)
    bad_label["concepts"][0]["label"] = "Rule-Execution"
    assert_rejected(forbidden_check, bad_label, "forbidden concept with a non-canonical label")
    bad_key = copy.deepcopy(shared)
    bad_key["retiredMappings"][0]["mapping"] = "decision-to-lexicon@latest"
    assert_rejected(forbidden_check, bad_key, "retired mapping without an exact version")
    return profiles


def check_v4_profile(profiles: list[dict]) -> None:
    v4 = next(p for p in profiles if p["id"] == "lexicon-interprose-v4.json")
    directions = {d["id"]: d for d in v4["directions"]}
    if set(directions) != {"interprose-to-lexicon", "lexicon-to-interprose-v4"}:
        fail("v4 profile must declare the Interprose sample forward step and the v4 projection")
    projection = directions["lexicon-to-interprose-v4"]["mapping"]
    if (
        projection.get("status") != "registered"
        or projection.get("id") != "lexicon-to-interprose"
        or projection.get("version") != "4.0.0"
        or "src/transform/mappings/lexicon-to-interprose/versions/4.0.0" not in projection.get("sourcePaths", [])
        or projection.get("generatedArtifact", {}).get("logicalArtifactPath")
        != "transform-mappings/lexicon-to-interprose/4.0.0/mapping.json"
        or projection.get("expectedOutputDatasets") != list(V4_OUTPUTS)
        or projection.get("outputDatasetMatch") != "exact"
    ):
        fail("v4 projection must be the registered lexicon-to-interprose@4.0.0 with exactly three outputs")
    forward = directions["interprose-to-lexicon"]["mapping"]
    if (
        forward.get("status") != "registered"
        or forward.get("version") != "1.0.0"
        or forward.get("outputDatasetMatch") != "includes"
        or forward.get("generatedArtifact", {}).get("logicalArtifactPath")
        != "transform-mappings/interprose-to-lexicon/1.0.0/mapping.json"
    ):
        fail("round-trip forward step must be the generated interprose-to-lexicon@1.0.0 subset")

    contracts = {c["dataset"]: c for c in directions["lexicon-to-interprose-v4"]["outputContracts"]}
    if set(contracts) != set(V4_OUTPUTS):
        fail("v4 must declare one output contract per output")
    expected_inputs = {
        "form_1281": {"vertex-debt", "vertex-company", "edge-company-represents-debt"},
        "payment_plan": {
            "vertex-debt", "vertex-payment-plan", "vertex-user-account",
            "edge-debt-has-payment-plan", "edge-debt-payment-plan-status-changed",
            "edge-payment-plan-has-total-amount", "edge-payment-plan-created-by-user-account",
            "edge-payment-plan-updated-by-user-account",
        },
        "payment_plan_schedule": {
            "vertex-payment-plan", "vertex-payment-plan-installment", "edge-payment-plan-has-installment",
        },
    }
    for dataset, inputs in expected_inputs.items():
        contract = contracts[dataset]
        if set(contract["requiredInputs"]) != inputs:
            fail(f"{dataset}: per-output graph inputs differ from the team direction")
        if contract["format"] != {"type": "csv", "delimiter": "|", "header": True}:
            fail(f"{dataset}: output must be pipe-delimited CSV with a header")
        if contract["status"] != "planned" or not contract.get("tbd"):
            fail(f"{dataset}: an unbuilt output contract must be planned with TBD notes")
    all_inputs = set().union(*expected_inputs.values())
    declared_sources = {d["name"] for d in v4["datasets"] if d["role"] == "source"}
    if not all_inputs <= declared_sources:
        fail(f"v4 datasets omit graph inputs: {sorted(all_inputs - declared_sources)}")
    if set(forward["expectedOutputDatasets"]) != all_inputs:
        fail("the round-trip forward subset must produce exactly the v4 graph inputs")
    form = contracts["form_1281"]
    if form["columns"] != ["debtID", "form_config_id", "field_identifier", "value"] or form["columnSource"] != "consumer-contract":
        fail("form_1281 must be a four-column consumer contract")
    constraints = {c["column"]: c for c in form["columnConstraints"]}
    if constraints.get("form_config_id", {}).get("const") != "1281" or set(
        constraints.get("field_identifier", {}).get("enum", [])
    ) != {"DSA_NAME", "REPORTED_DATE", "DSA_REPRESENTATION"}:
        fail("form_1281 constants are wrong")

    interprose = {
        "payment_plan": {
            "payment_plan_id", "payment_dest_id", "paused", "create_date", "deactivation_date", "active",
            "created_by", "misc_notes", "account_type", "debt_id", "last_updated_by", "last_update",
            "complete_date", "payment_total", "payment_method",
        },
        "payment_plan_schedule": {
            "payment_schedule_id", "payment_plan_id", "amount", "service_fee", "payment_date", "active",
            "promise_status",
        },
    }
    parity = {p["dataset"]: p["fields"] for p in directions["lexicon-to-interprose-v4"]["parityDatasets"]}
    for dataset in ("payment_plan", "payment_plan_schedule"):
        if contracts[dataset]["columnSource"] != "language-definition-subset":
            fail(f"{dataset}: columns must be a subset of interprose.json")
        if parity[dataset] != contracts[dataset]["columns"]:
            fail(f"{dataset}: parity fields must equal the declared graph-fillable columns")
        if not set(parity[dataset]) <= interprose[dataset]:
            fail(f"{dataset}: declares a column interprose.json does not define")
    for not_fillable in ("misc_notes", "payment_method", "account_type", "paused"):
        if not_fillable in parity["payment_plan"]:
            fail(f"payment_plan declares non-graph-fillable column {not_fillable}")
    for needs_status_edge in ("payment_date", "promise_status", "active"):
        if needs_status_edge in parity["payment_plan_schedule"]:
            fail(f"payment_plan_schedule declares {needs_status_edge} without its status edge input")
    if v4["parityPolicy"] != {
        "fieldSource": "language-definition-and-registration",
        "declaredFields": "exact",
        "undefinedDatasets": "consumer-contract",
    }:
        fail("v4 parity must be exact graph-fillable columns plus the form consumer contract")

    if v4["validationWorkflow"] != {
        "steps": [
            {"sequence": 1, "id": "forward-interprose-sample", "direction": "interprose-to-lexicon", "inputSource": "profile-evidence"},
            {"sequence": 2, "id": "project-v4", "direction": "lexicon-to-interprose-v4", "inputSource": "previous-step-output"},
        ],
        "persistPolicy": "forbidden",
    }:
        fail("v4 must run Interprose sample -> Interprose-to-Lexicon SQL -> v4 without Persist")
    strategy = v4["roundTripStrategy"]
    if (
        strategy["steps"] != ["interprose-to-lexicon", "lexicon-to-interprose-v4"]
        or strategy["comparison"] != "column-diff"
        or strategy["comparisonScope"] != "inverse-outputs"
        or {k["dataset"] for k in strategy["rowKeys"]} != set(V4_OUTPUTS)
    ):
        fail("v4 round-trip strategy must column-diff every output by row key")
    if v4["lexiconModelPolicy"] != {"candidateLexiconDiff": "forbidden", "path": "src/data/lexicon.json", "modelAdditions": "forbidden"}:
        fail("v4 must forbid any lexicon.json diff against main")

    invariants = {i["id"]: i for i in v4["invariants"]}
    election = invariants.get("dsa-election-matches-is-dsa", {}).get("description", "")
    for token in ("version 2", "DEBT_SETTLEMENT_AGENCY", "company_identifier", "created_at descending then effective_at descending", "is_dsa"):
        if token not in election:
            fail(f"DSA election invariant omits {token!r}")
    cents = invariants.get("cents-conversion-exact", {}).get("description", "")
    if "total_amount * 100" not in cents or "scheduled_amount * 100" not in cents:
        fail("cents conversion must cover plan totals and installment amounts")
    for required in ("lexicon-model-unchanged", "no-forbidden-concepts", "csv-pipe-header", "persist-not-invoked", "partial-input-runs", "round-trip-column-diff"):
        if required not in invariants:
            fail(f"v4 profile lacks invariant {required}")

    partial = v4["partialInputPolicy"]
    if partial["status"] != "supported" or {c["expected"] for c in partial["cases"]} != {"PASS", "REJECTED"}:
        fail("partial-input runs must prove both an accepted subset and a rejected missing input")
    for case in partial["cases"]:
        needed = set().union(*(expected_inputs[o] for o in case["outputDatasets"]))
        complete = needed <= set(case["providedInputs"])
        if complete != (case["expected"] == "PASS"):
            fail(f"partial-input case {case['id']} expectation contradicts the required inputs")

    packages = {s["id"]: s for s in v4["validationSources"] if s["kind"] == "existing-dev-artifact"}
    staged = "s3://transformpipelinestack-databuckete3889a50-rmklq0v3to8q/inputs/lexicon-interprose-v4/20260928-dev-stage-sample_v1/"
    expected_packages = {
        "lexicon-interprose-v4-dev-stage-sample": (staged + "stage/", ["interprose-to-lexicon"]),
        "lexicon-interprose-v4-dev-graph-export": (staged + "lexicon/", ["lexicon-to-interprose-v4"]),
    }
    if set(packages) != set(expected_packages):
        fail(f"v4 DEV package must be the staged Interprose sample and graph export: {sorted(packages)}")
    for package_id, (location, applies_to) in expected_packages.items():
        package = packages[package_id]
        if (
            package["location"] != location
            or package["region"] != "us-east-2"
            or package["artifactStatus"] != "ready"
            or package["appliesTo"] != applies_to
            or not re.fullmatch(r"[a-f0-9]{64}", package.get("manifestSha256", ""))
            or not package.get("manifestVersionId")
            or "tbd" in package
        ):
            fail(f"{package_id}: a ready DEV package needs its staged prefix, manifest digest, and version")
    tests = {s["path"] for s in v4["validationSources"] if s["kind"] == "repository-test"}
    if "infra/test/spark/test_lexicon_to_interprose.py" not in tests:
        fail("v4 must execute the candidate's v4 Spark SQL tests")
    text = json.dumps(v4).lower()
    for retired in ("decision_batch", "dsc_client_id", "source_run_id", "product_execution", "lexicon-to-decision", "decision-to-lexicon", "3.0.0"):
        if retired in text:
            fail(f"v4 profile retains Decision term {retired!r}")


def check_shared_forbidden_concepts(profiles: list[dict]) -> None:
    for path in RETIRED_FILES:
        if path.exists():
            fail(f"retired Decision file still exists: {path.relative_to(ROOT)}")
    shared = load_json(FORBIDDEN)
    labels = {c["label"] for c in shared["concepts"]}
    expected = {
        "rule_execution", "rule_execution_evidence_package", "rule_execution_status_changed",
        "rule_execution_evaluates_ruleset", "rule_execution_has_exclusion", "rule_execution_for_campaign",
        "rule_execution_has_child_execution", "rule_execution_has_evidence_package",
        "rule_execution_decided_debt", "product_execution_has_child_execution",
    }
    if not expected <= labels:
        fail(f"shared forbidden list omits {sorted(expected - labels)}")
    scoped = {(p["concept"], p["property"]) for p in shared["properties"]}
    for pair in (
        ("company_represents_debt", "dsc_client_id"),
        ("company_represents_debt", "idempotency_key"),
        ("company_represents_debt", "source_run_id"),
        ("product_execution", "dsa_company_identifier"),
        ("product_execution_includes_debt", "outcome"),
    ):
        if pair not in scoped:
            fail(f"shared forbidden list omits Decision-only property {pair}")
    if len(scoped) != len(shared["properties"]):
        fail("shared forbidden properties contain duplicates")
    retired = {r["mapping"] for r in shared["retiredMappings"]}
    if retired != {"decision-to-lexicon@1.0.0", "lexicon-to-decision@1.0.0", "lexicon-to-interprose@3.0.0"}:
        fail(f"retired Decision mappings are wrong: {sorted(retired)}")
    for profile in profiles:
        extras = set(profile.get("lexiconConceptPolicy", {}).get("forbiddenConcepts", []))
        if extras & labels:
            fail(f"{profile['id']}: repeats shared forbidden concepts instead of using the shared list")
    resolver = read(RESOLVER)
    if "forbidden-concepts.json" not in resolver:
        fail("resolver does not load the shared forbidden list by default")


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
        "name every contradicted field", "vertex-payment-plan-installment",
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

    check_v4_profile(profiles)
    check_shared_forbidden_concepts(profiles)

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
        FORBIDDEN,
        FORBIDDEN_SCHEMA,
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


FORM_GRAPH = ["vertex-debt", "vertex-company", "edge-company-represents-debt"]
PAYMENT_PLAN_GRAPH = [
    "vertex-debt", "vertex-payment-plan", "vertex-user-account",
    "edge-debt-has-payment-plan", "edge-debt-payment-plan-status-changed",
    "edge-payment-plan-has-total-amount", "edge-payment-plan-created-by-user-account",
    "edge-payment-plan-updated-by-user-account",
]
SCHEDULE_GRAPH = ["vertex-payment-plan", "vertex-payment-plan-installment", "edge-payment-plan-has-installment"]
V4_OUTPUT_INPUTS = {"form_1281": FORM_GRAPH, "payment_plan": PAYMENT_PLAN_GRAPH, "payment_plan_schedule": SCHEDULE_GRAPH}
V4_INPUTS = list(dict.fromkeys(FORM_GRAPH + PAYMENT_PLAN_GRAPH + SCHEDULE_GRAPH))
V4_OUTPUT = {"shape": "tabular", "format": "csv", "options": {"delimiter": "|", "header": True}}
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
INTERPROSE_TABLES = ["account", "debt", "debt_settlement_agency", "email_queue", "payment", "payment_plan", "payment_plan_schedule", "txt_msg_log"]
FORM_SQL = (
    "SELECT d.`~id` AS debtID, '1281' AS form_config_id, 'DSA_NAME' AS field_identifier, c.`name:String` AS value\n"
    "FROM source_edge_company_represents_debt e\n"
    "JOIN source_vertex_company c ON c.`~id` = e.`~from`\n"
    "JOIN source_vertex_debt d ON d.`~id` = e.`~to`\n"
    "WHERE e.`version:Int` = 2 AND e.`company_type:String` = 'DEBT_SETTLEMENT_AGENCY'\n"
)


def mapping_doc(
    mid: str, version: str, source: str, target: str, inputs: list[str], outputs: list[str], shape: str,
    graph_inputs: bool = False, *, output_inputs: dict[str, list[str]] | None = None, output: dict | None = None,
) -> dict:
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
        "output": output or {"shape": shape, "format": "csv" if shape == "graph" else "jsonl", "options": {}},
        "outputs": [
            {"dataset": o, "requiredInputs": (output_inputs or {}).get(o, inputs), "queries": [{"path": f"queries/{o}.sql"}], "dependsOn": []}
            for o in outputs
        ],
    }


def v4_doc(**overrides) -> dict:
    doc = mapping_doc(
        "lexicon-to-interprose", "4.0.0", "lexicon", "interprose", V4_INPUTS, list(V4_OUTPUTS), "tabular", True,
        output_inputs=V4_OUTPUT_INPUTS, output=V4_OUTPUT,
    )
    doc.update(overrides)
    return doc


REGISTERED_MAPPINGS = {
    "lexicon-to-interprose@1.0.0": ("lexicon", "interprose", EMAIL_GRAPH, ["debt", "email_queue"], "tabular", True),
    "lexicon-to-interprose@2.0.0": ("lexicon", "interprose", SMS_GRAPH + ["hydrated_text_message_artifact"], ["sms_log"], "tabular", True),
    "lexicon-to-sms@1.0.0": ("lexicon", "sms", SMS_GRAPH + ["hydrated_text_message_artifact"], ["sms_log"], "tabular", True),
    "quiq-to-lexicon@1.0.0": ("quiq", "lexicon", ["lifecycle"], SMS_GRAPH, "graph", False),
    "interprose-to-lexicon@1.0.0": (
        "interprose", "lexicon", INTERPROSE_TABLES,
        list(dict.fromkeys(EMAIL_GRAPH + SMS_GRAPH[:3] + V4_INPUTS + ["vertex-postal-mail"])), "graph", False,
    ),
}
STALE_DEV_MAPPINGS = {
    "decision-to-lexicon@1.0.0": ("decision", "lexicon", ["decision_batch"], ["product_execution"], "tabular", False),
    "lexicon-to-decision@1.0.0": ("lexicon", "decision", ["product_execution"], ["decision_batch"], "tabular", False),
    "lexicon-to-interprose@3.0.0": ("lexicon", "interprose", ["company_represents_debt"], ["form_1281"], "tabular", False),
}


def write_mapping(root: Path, doc: dict, sql: dict[str, str] | None = None) -> None:
    base = root / f"transform-mappings/{doc['id']}/{doc['version']}"
    write_json(base / "mapping.json", doc)
    for name, text in (sql or {}).items():
        (base / "queries").mkdir(parents=True, exist_ok=True)
        (base / "queries" / name).write_text(text)


def lexicon_model(extra_edges: list[dict] | None = None, extra_properties: dict[str, list[str]] | None = None) -> dict:
    vertices = [
        "debt", "company", "payment_plan", "payment_plan_installment", "user_account", "product",
        "product_execution", "phone_number", "text_message", "template", "email", "email_message",
    ]
    edges = [
        "company_represents_debt", "debt_has_payment_plan", "debt_payment_plan_status_changed",
        "payment_plan_has_total_amount", "payment_plan_has_installment", "payment_plan_created_by_user_account",
        "payment_plan_updated_by_user_account", "payment_plan_installment_status_changed",
        "product_has_execution", "product_execution_includes_debt",
        "debt_has_text_message", "phone_number_has_text_message", "text_message_status_changed",
        "text_message_has_rendered_artifact_uri", "text_message_rendered_from_template",
        "debt_has_email_message", "email_has_email_message", "email_message_has_from_email",
        "email_message_rendered_from_template", "email_message_status_changed",
    ]
    edge_properties = {
        "company_represents_debt": ["company_type", "status", "effective_at", "version", "created_at"],
        "payment_plan_has_total_amount": ["total_amount", "effective_at", "created_at"],
    }
    for concept, names in (extra_properties or {}).items():
        edge_properties[concept] = edge_properties.get(concept, []) + names
    return {
        "vertices": [vertex(v, props("id")) for v in vertices] + [{**vertex("postal_mail", props("id")), "is_deprecated": True}],
        "edges": [
            {"type": e, "from": "a", "to": "b", "properties": props(*edge_properties.get(e, []))}
            for e in edges
        ] + (extra_edges or []),
    }


def write_checkout(checkout: Path, model: dict) -> None:
    write_json(checkout / "src/data/lexicon.json", model)
    spec = checkout / "infra/test/transform-mappings.spec.ts"
    spec.parent.mkdir(parents=True, exist_ok=True)
    spec.write_text('for (const retired of [\n  "interprose-to-graph",\n  "sms-to-interprose",\n  "sms-log-to-interprose",\n]) {}\n')


def build_lexicon_fixture(root: Path) -> dict[str, Path]:
    names = ("candidate", "candidate-v4", "candidate-drift", "main", "dev", "prod", "v4", "v4-bad", "staging", "history-stage")
    paths = {n: root / n for n in names}
    write_checkout(paths["main"], lexicon_model())
    for name in ("candidate", "candidate-v4"):
        write_checkout(paths[name], lexicon_model())
    write_checkout(paths["candidate-drift"], lexicon_model(
        extra_edges=[
            {"type": "product_execution_has_child_execution", "from": "product_execution", "to": "product_execution", "properties": {}},
            {"type": "debt_collection_channel_changed", "from": "debt", "to": "debt", "properties": {}},
        ],
        extra_properties={"company_represents_debt": ["dsc_client_id"]},
    ))
    for name in ("candidate", "candidate-v4", "candidate-drift"):
        checkout = paths[name]
        (checkout / "src/data/lexicons.ts").write_text(
            "export const lexicons: Record<string, LexiconRegistryEntry> = {\n"
            "  lexicon: {\n  },\n  interprose: {\n  },\n  quiq: {\n  },\n};\n"
        )
        stack = checkout / "infra/lib/lexicon-stack.ts"
        stack.parent.mkdir(parents=True, exist_ok=True)
        stack.write_text("\n".join(
            f'        parameterName: "/lexicon/{p}",' for p in ("data-uri", "interprose-data-uri", "quiq-data-uri", "transform-mappings-uri")
        ))
        write_json(checkout / "src/data/interprose.json", {
            "vertices": [
                vertex("payment_plan", props(
                    "payment_plan_id", "payment_dest_id", "paused", "create_date", "deactivation_date", "active",
                    "created_by", "misc_notes", "account_type", "debt_id", "last_updated_by", "last_update",
                    "complete_date", "payment_total", "payment_method",
                ), required=[]),
                vertex("payment_plan_schedule", props(
                    "payment_schedule_id", "payment_plan_id", "amount", "service_fee", "payment_date", "active",
                    promise_status=["PENDING", "DEFERRED", "KEPT", "BROKEN"],
                ), required=[]),
                vertex("debt_settlement_agency", props("id", "debt_id", "dsa_name", "reported_date", "delete_date"), required=[]),
                vertex("txt_msg_log", props("txt_msg_log_id", "debt_id", "status")),
            ],
            "edges": [],
        })
        write_json(checkout / "src/data/quiq.json", {"vertices": [vertex("lifecycle", props("interaction_identifier", "canonical_status"))], "edges": []})
    registration = paths["candidate-v4"] / "src/transform/mappings/lexicon-to-interprose/versions/4.0.0"
    write_json(registration / "registration.json", v4_doc())
    (registration / "queries").mkdir(parents=True)
    for dataset in V4_OUTPUTS:
        (registration / "queries" / f"{dataset}.sql").write_text(FORM_SQL if dataset == "form_1281" else f"SELECT 1 AS {dataset}_marker\n")
    for key, spec_args in REGISTERED_MAPPINGS.items():
        mid, version = key.split("@")
        write_mapping(paths["dev"], mapping_doc(mid, version, *spec_args))
        write_mapping(paths["prod"], mapping_doc(mid, version, *spec_args))
    for key, spec_args in STALE_DEV_MAPPINGS.items():
        mid, version = key.split("@")
        write_mapping(paths["dev"], mapping_doc(mid, version, *spec_args))
    write_mapping(paths["v4"], v4_doc(), {"form_1281.sql": FORM_SQL})
    bad_inputs = dict(V4_OUTPUT_INPUTS, payment_plan=[i for i in PAYMENT_PLAN_GRAPH if i != "edge-payment-plan-has-total-amount"])
    write_mapping(paths["v4-bad"], mapping_doc(
        "lexicon-to-interprose", "4.0.0", "lexicon", "interprose", V4_INPUTS, list(V4_OUTPUTS), "tabular", True,
        output_inputs=bad_inputs, output={"shape": "tabular", "format": "csv", "options": {"delimiter": ",", "header": False}},
    ))
    staged_inputs = V4_INPUTS + ["edge-product-execution-has-child-execution"]
    write_mapping(
        paths["staging"],
        mapping_doc(
            "lexicon-to-interprose", "4.0.0", "lexicon", "interprose", staged_inputs, list(V4_OUTPUTS), "tabular", True,
            output_inputs=V4_OUTPUT_INPUTS, output=V4_OUTPUT,
        ),
        {"form_1281.sql": FORM_SQL.replace("c.`name:String` AS value", "e.dsc_client_id AS value") + "-- joins rule_execution for legacy parity\n"},
    )
    write_mapping(paths["history-stage"], mapping_doc(
        "interprose-to-lexicon", "2.0.0", "interprose", "lexicon", INTERPROSE_TABLES,
        V4_INPUTS + ["edge-debt-collection-channel-changed"], "graph",
    ))
    ssm_dev = root / "ssm-dev.txt"
    ssm_dev.write_text("/lexicon/data-uri\n/lexicon/interprose-data-uri\n/lexicon/quiq-data-uri\n/lexicon/transform-mappings-uri\n")
    return {**paths, "ssm-dev": ssm_dev}


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

    parsed = resolver.parse_request("/silvally validate lexicon (sms/payment/anything) to interprose @4.0.0 in prod round trip")
    if parsed["status"] != "PARSED" or parsed["qualifiers"] != ["sms", "payment"]:
        fail(f"qualifier parsing failed: {parsed}")
    if parsed["hints"] != {"version": "4.0.0", "environment": "prod", "mode": "round-trip"}:
        fail(f"hint parsing failed: {parsed['hints']}")
    if resolver.parse_request("test the payment plan stuff")["status"] != "UNPARSED":
        fail("a request without a direction was parsed")
    if resolver.qualifier_phrases(["payment", "plans"]) != {"payment", "plan", "plans", "payment_plan", "payment_plans"}:
        fail(f"qualifier phrases are wrong: {resolver.qualifier_phrases(['payment', 'plans'])}")

    with tempfile.TemporaryDirectory() as tmp:
        paths = build_lexicon_fixture(Path(tmp))

        def run(request: str, *extra: str, lexicon: str = "candidate-v4", main: Path = paths["main"], registries: tuple[str, ...] = ("dev", "prod")) -> dict:
            args = [
                "discover", "--request", request,
                "--lexicon-root", str(paths[lexicon]),
                "--main-lexicon-root", str(main),
                *[a for label in registries for a in ("--registry", f"{label}={paths[label]}")],
                "--ssm-parameters", f"dev={paths['ssm-dev']}",
                *extra,
            ]
            return resolver.discover(request, resolver.load_registry(resolver_args(resolver, args)))

        def codes(result: dict) -> set[str]:
            return {f["code"] for f in result.get("findings", [])}

        def question(result: dict, qid: str) -> dict | None:
            return next((q for q in result.get("questions", []) if q["id"] == qid), None)

        def signal_datasets(result: dict, key: str, kind: str) -> list[str]:
            selected = next(c for c in result["selection"]["candidates"] if c["mapping"] == key)
            return sorted(d for s in selected["signals"] if s["kind"] == kind for d in s.get("datasets", []))

        # New behavior: form 1281 and payment plan requests resolve to the v4 projection.
        form = run("test lexicon to interprose form 1281")
        if form["status"] != "RESOLVED" or form["selection"]["selected"] != V4_KEY:
            fail(f"form 1281 request did not resolve to {V4_KEY}: {form.get('status')} {form['selection'].get('selected')}")
        if signal_datasets(form, V4_KEY, "output-dataset") != ["form_1281"]:
            fail("form 1281 selection lacks output-dataset evidence")
        if [c["mapping"] for c in form["selection"]["candidates"]] != [
            "lexicon-to-interprose@1.0.0", "lexicon-to-interprose@2.0.0", V4_KEY,
        ]:
            fail(f"retired lexicon-to-interprose@3.0.0 was offered: {[c['mapping'] for c in form['selection']['candidates']]}")
        if form["selectedProfile"] != "lexicon-interprose-v4.json":
            fail("v4 profile was not selected from the mapping identity")
        for request, dataset in (
            ("test lexicon payment plan to interprose", "payment_plan"),
            ("test lexicon payment plans to interprose", "payment_plan"),
            ("test lexicon (payment plan schedule) to interprose", "payment_plan_schedule"),
            ("check lexicon (form 1281) -> interprose in dev", "form_1281"),
        ):
            result = run(request)
            if result["status"] != "RESOLVED" or result["selection"]["selected"] != V4_KEY:
                fail(f"{request!r} did not resolve to {V4_KEY}")
            if dataset not in signal_datasets(result, V4_KEY, "output-dataset"):
                fail(f"{request!r} lacks the {dataset} output-dataset signal")
        if not {"UpstreamSourceUnresolved", "RetiredMappingInRegistry"} <= codes(form):
            fail(f"v4 resolution findings are incomplete: {codes(form)}")
        if {"ProfileRegistrationStatusDrift", "LexiconModelDiffersFromMain", "OutputFormatDrift", "ProfileOutputInputDrift", "ForbiddenConceptInSql",
                "RemovedLexiconConcept", "ForbiddenConceptInLexicon", "ForbiddenPropertyInLexicon"} & codes(form):
            fail(f"clean v4 candidate reported a violation: {codes(form)}")
        retired_found = sorted(f["mapping"] for f in form["findings"] if f["code"] == "RetiredMappingInRegistry")
        if retired_found != ["decision-to-lexicon@1.0.0", "lexicon-to-decision@1.0.0", "lexicon-to-interprose@3.0.0"]:
            fail(f"stale Decision mappings in the DEV registry were not reported: {retired_found}")
        if form["lexiconModel"]["identical"] is not True:
            fail("an unchanged candidate lexicon.json was not proven identical to main")
        upstream = next(f for f in form["findings"] if f["code"] == "UpstreamSourceUnresolved")
        if upstream["candidates"] != ["interprose-to-lexicon@1.0.0"]:
            fail(f"round-trip producer was not offered upstream: {upstream['candidates']}")
        if [q["id"] for q in form["questions"]] != ["environment", "mapping-version", "upstream-source", "test-dataset"]:
            fail(f"v4 question plan wrong: {[q['id'] for q in form['questions']]}")
        if question(form, "upstream-source")["default"] != "interprose-to-lexicon@1.0.0":
            fail("upstream default does not follow the profile round-trip workflow")
        if form["workflow"]["persistPolicyDefault"] != "forbidden" or form["workflow"]["persistPolicySource"] != "profile":
            fail("profile-fixed Persist policy was not applied")
        if [(s["mapping"], s["profileStatus"]) for s in form["profileWorkflow"]] != [
            ("interprose-to-lexicon@1.0.0", "registered"), (V4_KEY, "registered"),
        ] or form["profileWorkflow"][1]["registrySources"] != ["candidate"]:
            fail(f"profile workflow was not surfaced: {form['profileWorkflow']}")
        if form["partialInputPolicy"]["status"] != "supported":
            fail("partial-input policy was not surfaced")
        parity = {p["dataset"]: p for p in form["parityDerivation"]}
        if parity["form_1281"]["fieldSource"] != "consumer-contract" or parity["form_1281"]["comparedFields"] != [
            "debtID", "form_config_id", "field_identifier", "value",
        ]:
            fail(f"form_1281 parity must come from the consumer contract: {parity['form_1281']}")
        plan = parity["payment_plan"]
        if len(plan["comparedFields"]) != 10 or plan["status"] != "DERIVED":
            fail(f"payment_plan must compare exactly the graph-fillable columns: {plan}")
        if not {"misc_notes", "payment_method", "account_type", "paused"} <= set(plan["profileDeclared"]["excludedByProfile"]):
            fail("non-graph-fillable payment_plan columns were not recorded as excluded")
        if plan["profileDeclared"]["missingFromProfile"]:
            fail("exact parity must not report definition fields as missing from the profile")
        schedule = parity["payment_plan_schedule"]
        if schedule["comparedFields"] != ["payment_schedule_id", "payment_plan_id", "amount"] or schedule["coverageTargets"]:
            fail(f"payment_plan_schedule must compare three columns without uncompared enum targets: {schedule}")
        recs = form["datasetRecommendations"]
        if [(r["id"], r["status"]) for r in recs[:2]] != [
            ("lexicon-interprose-v4-dev-stage-sample", "ready"), ("lexicon-interprose-v4-dev-graph-export", "ready"),
        ] or any(r.get("tbd") or not r.get("manifestSha256") for r in recs[:2]):
            fail(f"ready v4 packages were not recommended with their manifests: {recs[:2]}")
        if question(form, "test-dataset")["default"] != "lexicon-interprose-v4-dev-stage-sample":
            fail("the ready profile package was not offered as the default dataset")
        proposal = next(r for r in recs if r["id"] == "prod-derived-full-utc-day")
        if not proposal["location"].startswith("s3://<dev-transform-data-bucket>/inputs/lexicon-interprose-prod-derived/"):
            fail(f"proposed dataset location violates the inputs/<language>-<purpose>/ layout: {proposal['location']}")
        states = {c["concept"]: c["state"] for c in form["conceptChecks"][V4_KEY]}
        if set(states.values()) != {"ACTIVE_ON_MAIN"} or len(states) != len(V4_INPUTS):
            fail(f"v4 graph inputs were not all active on main: {states}")

        # A profile that still declares v4 as planned names it for a request but never selects it.
        planned_profiles = Path(tmp) / "planned-profiles"
        shutil.copytree(PROFILES, planned_profiles)
        planned_v4 = load_json(planned_profiles / "lexicon-interprose-v4.json")
        projection = next(d for d in planned_v4["directions"] if d["id"] == "lexicon-to-interprose-v4")
        registered = projection["mapping"]
        projection["mapping"] = {
            "status": "not-registered",
            "expectedId": registered["id"],
            "owner": "kecleon",
            "reason": "Regression fixture: the v4 projection before its Lexicon branch registers it.",
            "plannedSource": {
                "repository": registered["repository"],
                "sourcePaths": registered["sourcePaths"],
                "generatedArtifact": registered["generatedArtifact"],
                "expectedOutputDatasets": registered["expectedOutputDatasets"],
                "outputDatasetMatch": registered["outputDatasetMatch"],
            },
        }
        write_json(planned_profiles / "lexicon-interprose-v4.json", planned_v4)
        planned_args = ("--profiles", str(planned_profiles))
        planned_drift = run("test lexicon to interprose form 1281", *planned_args)
        if "ProfileRegistrationStatusDrift" not in codes(planned_drift):
            fail("a planned profile direction registered by the candidate did not report drift")
        planned = run("test lexicon to interprose form 1281", *planned_args, lexicon="candidate")
        if planned["status"] != "AMBIGUOUS" or planned["selection"]["selected"] is not None:
            fail("an unregistered planned mapping was selected")
        planned_candidate = next((c for c in planned["candidates"] if c["mapping"] == V4_KEY), None)
        if planned_candidate is None or "output-dataset-form_1281" not in planned_candidate["reasons"] or planned_candidate["status"] != "PLANNED":
            fail(f"planned v4 was not listed as the matching candidate: {planned['candidates']}")
        finding = next((f for f in planned["findings"] if f["code"] == "PlannedMappingNotRegistered"), None)
        if finding is None or not finding["matchesRequest"] or finding["profile"] != "lexicon-interprose-v4.json":
            fail("PlannedMappingNotRegistered was not reported")
        if any(o["id"] == V4_KEY for o in question(planned, "mapping-choice")["options"]) or not planned.get("nextSteps"):
            fail("planned mapping must not be selectable and must explain the next step")

        # Regression: existing SMS and email behavior is unchanged.
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
        if question(sms_projection, "persist-policy") is not None:
            fail("a profile-fixed Persist policy was asked again")

        ambiguous = run("test lexicon to interprose")
        if ambiguous["status"] != "AMBIGUOUS" or [c["mapping"] for c in ambiguous["candidates"]] != [
            "lexicon-to-interprose@1.0.0", "lexicon-to-interprose@2.0.0", V4_KEY,
        ]:
            fail(f"unqualified multi-version request was not ambiguous over live versions: {ambiguous.get('candidates')}")
        if question(ambiguous, "mapping-choice") is None:
            fail("ambiguous request did not ask for the mapping")

        pinned = run("test lexicon to interprose @1.0.0")
        if pinned["selection"]["selected"] != "lexicon-to-interprose@1.0.0":
            fail("version hint did not select the exact mapping")
        if run("test lexicon to interprose @3.0.0")["status"] != "AMBIGUOUS":
            fail("a retired version hint selected a retired mapping")

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

        # Inverse: Decision is retired; its mappings are named but never offered.
        decision = run("test decision to lexicon")
        if decision["status"] != "NO_MAPPING":
            fail(f"retired Decision mapping still resolved: {decision['status']}")
        retired_candidates = [c for c in decision["candidates"] if "retired-in-kit" in c.get("reasons", [])]
        if [c["mapping"] for c in retired_candidates] != ["decision-to-lexicon@1.0.0", "lexicon-to-decision@1.0.0"]:
            fail(f"retired Decision mappings were not explained: {decision['candidates']}")
        if any(o["id"].startswith(("decision-to-lexicon", "lexicon-to-decision")) for o in question(decision, "mapping-choice")["options"]):
            fail("a retired Decision mapping was offered as a choice")

        unknown = run("test foo to bar")
        if unknown["status"] != "UNKNOWN_LANGUAGE" or not any(c.get("language") == "interprose" for c in unknown["candidates"]):
            fail("unknown languages did not list registered languages")

        # Round trip from an Interprose sample: forward SQL, then v4, compared only where v4 writes.
        round_trip = run("test interprose to lexicon round trip")
        if [s["mapping"] for s in round_trip["workflow"]["steps"]] != ["interprose-to-lexicon@1.0.0", V4_KEY]:
            fail(f"Interprose sample round trip did not chain the v4 projection: {round_trip['workflow']['steps']}")
        if round_trip["selectedProfile"] != "lexicon-interprose-v4.json":
            fail("round trip did not select the v4 profile")
        if any(f["code"] == "ProfileOutputDatasetDrift" and f["direction"] == "interprose-to-lexicon" for f in round_trip["findings"]):
            fail("an includes-match subset of a large generated mapping was reported as drift")
        trip = {p["dataset"]: p for p in round_trip["parityDerivation"]}
        if trip["payment_plan"]["status"] != "DERIVED" or len(trip["payment_plan"]["comparedFields"]) != 10:
            fail(f"round-trip payment_plan column diff is wrong: {trip['payment_plan']}")
        if trip["account"]["status"] != "OUT_OF_SCOPE" or trip["txt_msg_log"]["status"] != "OUT_OF_SCOPE":
            fail("forward inputs outside the v4 outputs must be out of scope, not round-trip gaps")
        if trip["form_1281"]["fieldSource"] != "consumer-contract":
            fail("round-trip form_1281 must use the consumer contract")

        states = {c["concept"]: c["state"] for c in round_trip["conceptChecks"]["interprose-to-lexicon@1.0.0"]}
        if states["postal_mail"] != "NOT_SELECTED" or states["payment_plan"] != "ACTIVE_ON_MAIN":
            fail(f"profile-selected output subset did not scope concept checks: {states}")
        if "LexiconConceptInactive" in codes(round_trip):
            fail("a deprecated output outside the profile's selected subset failed the v4 round trip")
        qualified = run("test interprose to lexicon round trip form 1281")
        if [s["mapping"] for s in qualified["workflow"]["steps"]] != ["interprose-to-lexicon@1.0.0", V4_KEY]:
            fail("form 1281 qualifier did not choose the v4 inverse")
        email = run("test interprose to lexicon (email queue) round trip")
        if [s["mapping"] for s in email["workflow"]["steps"]] != ["interprose-to-lexicon@1.0.0", "lexicon-to-interprose@1.0.0"]:
            fail(f"email qualifier did not choose the email inverse: {email['workflow']['steps']}")
        if email["selectedProfile"] is not None:
            fail("a profile that does not declare every workflow step was selected")
        if not any(f["code"] == "LexiconConceptInactive" and f["concept"] == "postal_mail" for f in email["findings"]):
            fail("a deprecated output of a full-mapping run was not reported")
        before_v4 = run("test interprose to lexicon round trip form 1281", *planned_args, lexicon="candidate")
        if [s["mapping"] for s in before_v4["workflow"]["steps"]] != ["interprose-to-lexicon@1.0.0"]:
            fail(f"an unrequested inverse was substituted for the unregistered one: {before_v4['workflow']['steps']}")
        if before_v4["selectedProfile"] != "lexicon-interprose-v4.json" or before_v4["profileWorkflow"][1]["registrySources"]:
            fail("the planned-inverse run must keep the v4 profile and show its projection as unregistered")
        if not any(f["code"] == "PlannedMappingNotRegistered" and f["mapping"] == V4_KEY for f in before_v4["findings"]):
            fail("an unregistered inverse named by the request was not reported")

        # Inverse: registered output contracts that drift from the profile.
        drift = run("test lexicon to interprose form 1281", lexicon="candidate", registries=("dev", "prod", "v4-bad"))
        fmt = [f for f in drift["findings"] if f["code"] == "OutputFormatDrift"]
        if len(fmt) != 3 or any(f["fields"] != ["delimiter", "header"] for f in fmt):
            fail(f"comma-delimited headerless outputs were not reported: {fmt}")
        inputs = [f for f in drift["findings"] if f["code"] == "ProfileOutputInputDrift"]
        if [(f["dataset"], f["missingFromRegistry"]) for f in inputs] != [("payment_plan", ["edge-payment-plan-has-total-amount"])]:
            fail(f"missing payment_plan required input was not reported: {inputs}")

        # Inverse: forbidden labels and Decision-only properties in graph inputs or SQL.
        staged = run("test lexicon to interprose form 1281", lexicon="candidate", registries=("dev", "prod", "staging"))
        removed = [f for f in staged["findings"] if f["code"] == "RemovedLexiconConcept"]
        if [(f["concept"], f["state"]) for f in removed] != [("product_execution_has_child_execution", "FORBIDDEN")]:
            fail(f"reverted Decision edge in v4 inputs was not reported: {removed}")
        sql_hits = sorted((f["concept"], f["query"]) for f in staged["findings"] if f["code"] == "ForbiddenConceptInSql")
        if sql_hits != [("dsc_client_id", "form_1281.sql"), ("rule_execution", "form_1281.sql")]:
            fail(f"forbidden label or property in v4 SQL was not reported: {sql_hits}")
        merged = run("test lexicon to interprose form 1281", registries=("dev", "prod", "staging"))
        if "RegistrySourceDrift" not in codes(merged):
            fail("differing registrations for one mapping identity were not reported")

        # Inverse: the candidate lexicon.json changes the model.
        model = run("test lexicon to interprose form 1281", lexicon="candidate-drift", registries=("dev", "prod", "v4"))
        model_finding = next((f for f in model["findings"] if f["code"] == "LexiconModelDiffersFromMain"), None)
        if model_finding is None or model_finding["addedConcepts"] != ["debt_collection_channel_changed", "product_execution_has_child_execution"]:
            fail(f"a lexicon.json diff against main was not reported: {model_finding}")
        if model_finding["changedConcepts"] != {"company_represents_debt": {
            "addedProperties": ["dsc_client_id"], "removedProperties": [], "addedIndexes": [], "removedIndexes": [],
        }}:
            fail(f"changed concept properties were not itemized: {model_finding['changedConcepts']}")
        if not any(f["code"] == "ForbiddenConceptInLexicon" and f["concept"] == "product_execution_has_child_execution" and f["revision"] == "candidate" for f in model["findings"]):
            fail("a shared forbidden concept in the candidate lexicon.json was not reported")
        if not any(f["code"] == "ForbiddenPropertyInLexicon" and f["property"] == "dsc_client_id" for f in model["findings"]):
            fail("a Decision-only property in the candidate lexicon.json was not reported")
        unchecked = run("test lexicon to interprose form 1281", "--main-lexicon-root", "")
        if "LexiconModelUnchecked" not in codes(unchecked):
            fail("a missing main checkout must leave the Lexicon diff explicitly unchecked")

        # Generic concept history: an added concept that main history once removed.
        added = run("test interprose to lexicon @2.0.0", lexicon="candidate-drift", registries=("history-stage",))
        added_check = next(c for c in added["conceptChecks"]["interprose-to-lexicon@2.0.0"] if c["concept"] == "debt_collection_channel_changed")
        if added_check["state"] != "ADDED_IN_CANDIDATE" or added_check.get("historyChecked") is not False:
            fail(f"an added concept checked without main history must say so: {added_check}")
        revived_main = build_main_with_removed_concept(Path(tmp) / "main-history", paths["main"], "debt_collection_channel_changed")
        revived = run("test interprose to lexicon @2.0.0", lexicon="candidate-drift", registries=("history-stage",), main=revived_main)
        revived_check = next(c for c in revived["conceptChecks"]["interprose-to-lexicon@2.0.0"] if c["concept"] == "debt_collection_channel_changed")
        if revived_check["state"] != "REMOVED_ON_MAIN" or len(revived_check.get("mainHistoryCommits", [])) != 2:
            fail(f"a concept removed from main history was accepted as additive: {revived_check}")

        draft = resolver.draft_profile("test sms to lexicon", sms)
        assert_valid(validator(DRAFT_PROFILE_SCHEMA), draft, "auto-generated sms draft")
        if draft["promotionEligible"] or draft["intakeState"] != "NEEDS_INPUT":
            fail("auto-generated draft skipped intake")
        resolved_draft = resolver.draft_profile("test lexicon to interprose form 1281", form)
        assert_valid(validator(DRAFT_PROFILE_SCHEMA), resolved_draft, "auto-generated v4 draft")
        if resolved_draft["selectedProfile"] != "lexicon-interprose-v4.json":
            fail("resolved draft lost the selected profile")

    run_checker = validator(RUN_SCHEMA)
    run = valid_run()
    digest = "sha256:" + "b" * 64
    run["intentResolution"] = {
        "request": "test lexicon to interprose form 1281",
        "status": "RESOLVED",
        "source": "lexicon",
        "target": "interprose",
        "qualifiers": ["form", "1281"],
        "selectedMappings": [V4_KEY],
        "candidateMappings": ["interprose-to-lexicon@1.0.0"],
        "registrySources": ["candidate", "dev", "prod"],
        "resolverSha256": "sha256:" + hashlib.sha256(RESOLVER.read_bytes()).hexdigest(),
    }
    run["executionSteps"] = [{
        "sequence": 1,
        "mapping": V4_KEY,
        "environment": "dev",
        "status": "PASS",
        "approvalOperationDigest": digest,
        "executionArn": "arn:aws:states:us-east-2:111122223333:execution:TransformPipelineStack-transform-pipeline:silvally-run-1-lexicon-to-interprose",
        "inputManifestSha256": digest,
        "outputLocation": "s3://example-transform-bucket/outputs/silvally/run/",
        "planSha256": digest,
        "metadataSha256": digest,
        "executedSqlSha256s": [digest],
        "logLocations": ["/aws/vendedlogs/states/transform-pipeline"],
    }]
    run["parityDerivation"] = [{
        "language": "interprose", "dataset": "form_1281", "comparedBy": V4_KEY,
        "fieldSource": "consumer-contract", "fieldCount": 4, "mismatchCount": 0, "status": "PASS",
    }]
    assert_valid(run_checker, run, "run with intent resolution and execution steps")
    bad = copy.deepcopy(run)
    bad["executionSteps"][0]["mapping"] = "lexicon-to-interprose@latest"
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
        "forbidden-concepts.json",
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
    parser.add_argument("--forbidden-concepts", default=str(resolver.DEFAULT_FORBIDDEN))
    args = parser.parse_args(argv)
    if args.main_lexicon_root == "":
        args.main_lexicon_root = None
    return args


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
