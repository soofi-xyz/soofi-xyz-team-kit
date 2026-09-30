#!/usr/bin/env python3
"""Contract, safety, routing, and resolver tests for Silvally.

Every mapping, language, dataset and field used here comes from the synthetic registry fixture
(fixtures/synthetic-registry) or is built in a temporary copy of it. Example profiles under
examples/profiles are only schema-checked, and their identifiers are used solely to prove that no
core file or test mentions them.
"""

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
EXAMPLES = SKILL / "examples"
EXAMPLE_PROFILES = EXAMPLES / "profiles"
FIXTURE = SKILL / "fixtures" / "synthetic-registry"
FIXTURE_PROFILE = FIXTURE / "profiles" / "synthetic-alpha-omega.json"
LAYOUT = REFERENCE / "registry-layout.json"
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
STATUSES = {"PASS", "FAIL", "BLOCKED", "APPROVAL_REQUIRED"}
CORE_FILES = (
    ROOT / "agents" / "silvally.md",
    ROOT / "agents-copilot" / "silvally.agent.md",
    ROOT / ".codex" / "agents" / "silvally.toml",
    SKILL / "SKILL.md",
    *sorted((SKILL / "reference").glob("*.md")),
    *sorted((SKILL / "reference").glob("*.schema.json")),
    *sorted((SKILL / "scripts").glob("*.py")),
    Path(__file__),
    ROOT / "scripts" / "test-silvally-tools.py",
)
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
    if source_window is None:
        errors.append("missing sourceWindowPolicy for the final PROD-derived validation")
    else:
        if source_window.get("origin") not in {"profile-declared", "derived-at-intake"}:
            errors.append("source window policy origin")
        for key, default in (source_window.get("recordedDefaults") or {}).items():
            if source_window.get(key) != default:
                errors.append(f"source window recorded default {key} disagrees with the policy")
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
                if sum(k in constraint for k in ("const", "enum", "pattern", "nonEmpty")) != 1:
                    errors.append("column constraint needs exactly one of const, enum, pattern or nonEmpty")
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
    if value.get("verdict") == "READY":
        final = value.get("finalValidation") or {}
        selection = value.get("sourceWindowSelection") or {}
        steps = value.get("executionSteps") or []
        if final.get("status") != "PASS" or selection.get("status") != "CONFIRMED":
            errors.append("ready without a passing final PROD-derived validation on a confirmed window")
        elif final.get("sourceWindow") != selection.get("confirmedWindow"):
            errors.append("final validation window differs from the confirmed window")
        if value.get("runtime", {}).get("executionMode") != "observed-dev":
            errors.append("ready from a non-observed-dev execution mode")
        if not final.get("stagingApprovalDigests") or not final.get("executionApprovalDigests"):
            errors.append("ready without staging and execution approval digests")
        if not steps or any(step.get("environment") != "dev" or step.get("status") != "PASS" for step in steps):
            errors.append("ready without passing DEV execution steps")
        elif {step.get("approvalOperationDigest") for step in steps} - set(final.get("executionApprovalDigests") or []):
            errors.append("execution step without its own approval digest")
        if (value.get("finalValidation") or {}).get("prodAccess") not in {None, "read-only"}:
            errors.append("final validation claiming PROD writes")
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
        "profile": {"id": FIXTURE_PROFILE.name, "revision": "1", "sha256": digest},
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
            "region": "xx-test-1",
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
            "executionMode": "observed-dev",
        },
        "sourceWindowSelection": {
            "status": "CONFIRMED", "minimumCompleteUtcDays": 1, "allowLongerRange": True,
            "candidateComparisons": [{
                "start": "2099-01-01T00:00:00Z", "endExclusive": "2099-01-02T00:00:00Z", "complete": True,
                "sourceFamiliesPresent": ["members", "ledgers", "rates"],
                "coverageSignals": {"members-rows-present": 4, "ledgers-rows-present": 6, "rates-rows-present": 3},
                "rowCount": 13, "byteCount": 4096, "estimatedCostUsd": 0.05, "immutableEvidence": True,
            }],
            "recommendedWindow": {"start": "2099-01-01T00:00:00Z", "endExclusive": "2099-01-02T00:00:00Z", "completeUtcDays": 1},
            "confirmedWindow": {"start": "2099-01-01T00:00:00Z", "endExclusive": "2099-01-02T00:00:00Z", "completeUtcDays": 1},
            "evidenceIds": ["prod-source-window-metadata", "source-window-user-confirmation"],
        },
        "finalValidation": {
            "kind": "prod-derived-dev", "status": "PASS", "prodAccess": "read-only",
            "sourceWindow": {"start": "2099-01-01T00:00:00Z", "endExclusive": "2099-01-02T00:00:00Z", "completeUtcDays": 1},
            "stagingApprovalDigests": ["sha256:" + "e" * 64], "executionApprovalDigests": ["sha256:" + "f" * 64],
            "inputManifestSha256s": [digest], "evidenceIds": ["final-prod-derived-validation"],
        },
        "executionSteps": [{
            "sequence": 1, "mapping": "source-to-target@1.0.0", "environment": "dev", "status": "PASS",
            "approvalOperationDigest": "sha256:" + "f" * 64,
            "executionArn": "arn:aws:states:xx-test-1:000000000000:execution:transform:silvally-final-1",
            "inputManifestSha256": digest,
            "outputLocation": "s3://example-dev-bucket/outputs/silvally-synthetic/20990102T000000Z/full/",
            "executedSqlSha256s": [digest], "logLocations": ["/aws-glue/jobs/output"],
        }],
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


def fixture_profile() -> dict:
    return load_json(FIXTURE_PROFILE)


def example_profiles() -> list[Path]:
    return sorted(EXAMPLE_PROFILES.glob("*.json"))


def test_schemas_and_profiles() -> None:
    draft_check = validator(DRAFT_PROFILE_SCHEMA)
    profile_check = validator(PROFILE_SCHEMA)
    run_check = validator(RUN_SCHEMA)
    base = fixture_profile()
    assert_valid(profile_check, base, FIXTURE_PROFILE.name)
    if base["id"] != FIXTURE_PROFILE.name:
        fail("fixture profile id must equal its filename")
    seen: set[str] = set()
    for path in example_profiles():
        example = load_json(path)
        assert_valid(profile_check, example, f"example profile {path.name}")
        if example["id"] != path.name or example["id"] in seen:
            fail(f"{path.name}: example profile id must equal its filename and be unique")
        seen.add(example["id"])
    if not seen:
        fail("examples/profiles must hold at least one schema-valid example")

    incomplete_draft = valid_draft()
    assert_valid(draft_check, incomplete_draft, "valid incomplete intake draft")
    assert_rejected(profile_check, incomplete_draft, "incomplete intake draft as executable profile")
    premature_promotion = copy.deepcopy(incomplete_draft)
    premature_promotion["promotionEligible"] = True
    assert_rejected(draft_check, premature_promotion, "premature draft promotion")
    assert_valid(draft_check, valid_draft(complete=True), "complete promotable intake draft")
    missing_question = copy.deepcopy(incomplete_draft)
    missing_question["materialFacts"][0]["nextQuestion"] = None
    assert_rejected(draft_check, missing_question, "missing focused intake question")
    invented_selection = copy.deepcopy(incomplete_draft)
    invented_selection["selectedProfile"] = FIXTURE_PROFILE.name
    assert_rejected(draft_check, invented_selection, "profile selection without hard evidence")

    run = valid_run()
    assert_valid(run_check, run, "valid READY run with the final PROD-derived validation")
    blocked_final = copy.deepcopy(run)
    blocked_final["verdict"] = "BLOCKED"
    blocked_final["phases"][11]["status"] = "BLOCKED"
    blocked_final["finalValidation"].update({"status": "BLOCKED", "sourceWindow": None, "stagingApprovalDigests": [],
                                             "executionApprovalDigests": [], "inputManifestSha256s": []})
    blocked_final["executionSteps"] = []
    blocked_final["runtime"]["executionMode"] = "synthetic-local"
    blocked_final["remediations"] = [{
        "id": "run-final-prod-derived-validation", "findingCode": "FinalProdDerivedValidationRequired", "status": "BLOCKED",
        "classification": "ACCESS_OR_EVIDENCE", "owner": "Silvally operator", "repository": None,
        "locations": ["sourceWindowSelection"], "locationEvidenceIds": ["prod-source-window-metadata"],
        "recommendedChange": "Confirm the recommended PROD-derived window, approve its DEV staging and executions, then rerun.",
        "regressionEvidence": ["Approved DEV executions on the confirmed window pass phases 1-11."],
        "rerunPhases": [1, 3, 4, 9, 10, 11, 12], "rerunDirections": ["source-to-target"],
    }]
    assert_valid(run_check, blocked_final, "valid BLOCKED run awaiting the final PROD-derived validation")
    for label, mutate in (
        ("READY from synthetic-local evidence", lambda r: r["runtime"].__setitem__("executionMode", "synthetic-local")),
        ("READY without final validation", lambda r: r.pop("finalValidation")),
        ("READY with a blocked final validation", lambda r: r["finalValidation"].__setitem__("status", "BLOCKED")),
        ("READY without a source window selection", lambda r: r.pop("sourceWindowSelection")),
        ("READY with an unconfirmed window", lambda r: r["sourceWindowSelection"].update({"status": "NEEDS_CONFIRMATION", "confirmedWindow": None})),
        ("READY without a staging approval digest", lambda r: r["finalValidation"].__setitem__("stagingApprovalDigests", [])),
        ("READY without an execution approval digest", lambda r: r["finalValidation"].__setitem__("executionApprovalDigests", [])),
        ("READY without DEV executions", lambda r: r.__setitem__("executionSteps", [])),
        ("READY with a synthetic-local execution step", lambda r: r["executionSteps"][0].__setitem__("environment", "synthetic-local")),
        ("READY with an unapproved execution step", lambda r: r["executionSteps"][0].__setitem__("approvalOperationDigest", None)),
        ("READY on a window other than the confirmed one", lambda r: r["finalValidation"]["sourceWindow"].update(
            {"start": "2098-12-31T00:00:00Z", "endExclusive": "2099-01-01T00:00:00Z"})),
        ("final validation claiming PROD writes", lambda r: r["finalValidation"].__setitem__("prodAccess", "read-write")),
    ):
        bad = copy.deepcopy(run)
        mutate(bad)
        assert_rejected(run_check, bad, label)
    prod_derived = copy.deepcopy(blocked_final)
    prod_derived["sourceWindowSelection"] = {
        "status": "NEEDS_CONFIRMATION", "minimumCompleteUtcDays": 1, "allowLongerRange": True,
        "candidateComparisons": [{
            "start": "2099-01-01T00:00:00Z", "endExclusive": "2099-01-02T00:00:00Z", "complete": True,
            "sourceFamiliesPresent": ["members", "ledgers", "rates"],
            "coverageSignals": {"tier-gold": 17, "tier-silver": 9},
            "rowCount": 120, "byteCount": 4096, "estimatedCostUsd": 0.05, "immutableEvidence": True,
        }],
        "recommendedWindow": {"start": "2099-01-01T00:00:00Z", "endExclusive": "2099-01-02T00:00:00Z", "completeUtcDays": 1},
        "confirmedWindow": None, "evidenceIds": ["source-window-metadata"],
    }
    assert_valid(run_check, prod_derived, "valid unconfirmed PROD-derived window")
    confirmed = copy.deepcopy(prod_derived)
    confirmed["sourceWindowSelection"]["status"] = "CONFIRMED"
    confirmed["sourceWindowSelection"]["confirmedWindow"] = copy.deepcopy(confirmed["sourceWindowSelection"]["recommendedWindow"])
    assert_valid(run_check, confirmed, "valid confirmed PROD-derived window")
    partial_day = copy.deepcopy(prod_derived)
    partial_day["sourceWindowSelection"]["candidateComparisons"][0]["endExclusive"] = "2099-01-01T12:00:00Z"
    assert_rejected(run_check, partial_day, "partial PROD day")
    implied = copy.deepcopy(prod_derived)
    implied["sourceWindowSelection"]["confirmedWindow"] = copy.deepcopy(implied["sourceWindowSelection"]["recommendedWindow"])
    assert_rejected(run_check, implied, "source window confirmation without confirmed status")
    blocked_window = copy.deepcopy(prod_derived)
    blocked_window["sourceWindowSelection"].update({"status": "BLOCKED", "candidateComparisons": [], "recommendedWindow": None,
                                                    "confirmedWindow": None, "evidenceIds": ["prod-metadata-access-denied"]})
    assert_valid(run_check, blocked_window, "blocked PROD-derived window without invented candidates")

    not_ready = copy.deepcopy(run)
    not_ready["verdict"] = "NOT_READY"
    not_ready["phases"][5]["status"] = "FAIL"
    not_ready["failures"] = [{"phase": 6, "code": "EndpointDatasetNotRequired", "message": "A declared edge endpoint dataset is absent from an output's requiredInputs."}]
    not_ready["remediations"] = [{
        "id": "declare-edge-endpoint", "findingCode": "EndpointDatasetNotRequired", "status": "FAIL", "classification": "CONFIGURATION",
        "owner": "Kecleon", "repository": "example/registry", "locations": ["registration.json/outputs/1/requiredInputs"],
        "locationEvidenceIds": ["pinned-registration"], "recommendedChange": "Add the endpoint vertex dataset to the output's requiredInputs.",
        "regressionEvidence": ["Registered runtime executes with zero dangling endpoints."], "rerunPhases": [6, 9, 11, 12],
        "rerunDirections": ["canon-to-omega"],
    }]
    assert_valid(run_check, not_ready, "valid not-ready run with remediation")
    unavailable = {"availability": "UNAVAILABLE", "subject": "runtime-output", "reason": "Static configuration failure stopped runtime proof.",
                   "evidenceIds": ["static-failure"]}
    early = copy.deepcopy(not_ready)
    early["datasets"] = [copy.deepcopy(unavailable)]
    early["graph"] = {**unavailable, "subject": "graph-output"}
    early["runtime"] = {**unavailable, "subject": "transform-runtime"}
    assert_valid(run_check, early, "valid early not-ready run with unavailable evidence")
    unavailable_ready = copy.deepcopy(early)
    unavailable_ready.update({"verdict": "READY", "failures": [], "remediations": []})
    unavailable_ready["phases"][5]["status"] = "PASS"
    assert_rejected(run_check, unavailable_ready, "READY run with unavailable evidence")
    no_remediation = copy.deepcopy(not_ready)
    no_remediation["remediations"] = []
    assert_rejected(run_check, no_remediation, "not-ready verdict without remediation")
    for label, mutate in (
        ("mutable repository ref", lambda r: r["configurationPackage"]["sourceRevisions"][0].__setitem__("commitSha", "main")),
        ("raw PII evidence", lambda r: r["sensitivity"].__setitem__("containsRawPii", True)),
        ("secret evidence", lambda r: r["sensitivity"].__setitem__("containsSecrets", True)),
        ("credential-bearing location", lambda r: r["datasets"][0].__setitem__("location", "s3://safe/output?token=secret")),
        ("phase order", lambda r: r["phases"].reverse()),
    ):
        bad = copy.deepcopy(run)
        mutate(bad)
        assert_rejected(run_check, bad, label)
    unresolved = copy.deepcopy(run)
    unresolved["boundaryDecisions"].append({"id": "identity-scheme-change", "proposedChange": "Replace the business identity scheme",
                                            "classification": "PRODUCT_CHANGE", "evidenceIds": ["identity-contract"], "resolved": False,
                                            "handoffOwner": "Lexicon"})
    unresolved["configurationPackage"]["unresolvedProductChangeHandoffs"] = ["identity-scheme-change"]
    assert_rejected(run_check, unresolved, "READY with unresolved product change")

    no_window = copy.deepcopy(base)
    no_window.pop("sourceWindowPolicy")
    assert_rejected(profile_check, no_window, "profile without a source window policy")
    wrong_default = copy.deepcopy(base)
    wrong_default["sourceWindowPolicy"]["minimumCompleteUtcDays"] = 3
    assert_rejected(profile_check, wrong_default, "source window default recorded differently from the policy")
    for setting in ("representationFamily", "identityScheme", "executableCodePath", "dependencyType", "storageEngineMode", "failureSemantics"):
        bad = copy.deepcopy(base)
        bad["configurationChoices"][setting] = ["not-configuration"]
        assert_rejected(profile_check, bad, f"{setting} as configuration")
    projection = 1

    def mutated(fn) -> dict:
        value = copy.deepcopy(base)
        fn(value)
        return value

    contract = lambda p, n=0: p["directions"][projection]["outputContracts"][n]  # noqa: E731
    cases = [
        ("registered mapping without source paths", lambda p: p["directions"][0]["mapping"].pop("sourcePaths")),
        ("invented mapping without resolvable source", lambda p: p["directions"][0]["mapping"].update({"id": "invented", "sourcePaths": []})),
        ("csv output contract without a delimiter", lambda p: contract(p)["format"].pop("delimiter")),
        ("multi-character csv delimiter", lambda p: contract(p)["format"].__setitem__("delimiter", ";;")),
        ("column constraint with both const and enum", lambda p: contract(p).__setitem__("columnConstraints", [{"column": "tier", "const": "gold", "enum": ["gold"]}])),
        ("column constraint with both pattern and nonEmpty", lambda p: contract(p).__setitem__("columnConstraints", [{"column": "tier", "pattern": "^x$", "nonEmpty": True}])),
        ("unique-key check without a key", lambda p: p["invariants"][0]["check"].pop("key")),
        ("check of an unknown kind", lambda p: p["invariants"][0]["check"].__setitem__("kind", "custom-code")),
        ("row-count check without a bound", lambda p: p["invariants"][4]["check"].pop("equals")),
        ("override of a non-derivable field", lambda p: p["directions"][projection]["derivationOverrides"][0].__setitem__("field", "sql")),
        ("oracle with a credential-bearing location", lambda p: p["oracles"][0].__setitem__("location", "s3://bucket/x?token=1")),
        ("allowed loss of an unknown kind", lambda p: p["allowedLosses"][0].__setitem__("kind", "anything-goes")),
        ("unknown Lexicon model diff policy", lambda p: p.__setitem__("lexiconModelPolicy", {"path": "languages/canon.json", "candidateLexiconDiff": "warn"})),
        ("partial-input evidence pinned to a branch", lambda p: p.__setitem__("partialInputPolicy", {
            "status": "supported", "mechanism": "outputDatasets selects outputs and their required inputs",
            "evidence": [{"repository": "example/transform", "commitSha": "main", "path": "src/plan.ts"}]})),
        ("planned artifact claiming a manifest digest", lambda p: p["validationSources"].append({
            "id": "planned", "kind": "existing-dev-artifact", "location": "s3://example-bucket/inputs/x/", "region": "xx-test-1",
            "artifactStatus": "planned", "tbd": ["manifest"], "manifestSha256": "0" * 64, "appliesTo": ["alpha-to-canon"], "required": True})),
        ("ready artifact without a manifest version", lambda p: p["validationSources"].append({
            "id": "ready", "kind": "existing-dev-artifact", "location": "s3://example-bucket/inputs/x/", "region": "xx-test-1",
            "artifactStatus": "ready", "manifestSha256": "0" * 64, "appliesTo": ["alpha-to-canon"], "required": True})),
    ]
    for label, fn in cases:
        assert_rejected(profile_check, mutated(fn), label)
    assert_valid(profile_check, mutated(lambda p: contract(p).__setitem__("columnConstraints", [{"column": "tier", "pattern": "^(gold|silver|)$"}])),
                 "pattern column constraint")
    concept_policy = {"currentDefinitionRequired": True, "rejectAbsent": True, "rejectDeprecated": True,
                      "reintroductionRequiresModelingApproval": True, "forbiddenConcepts": []}
    assert_valid(profile_check, mutated(lambda p: p.__setitem__("lexiconConceptPolicy", concept_policy)), "safe concept policy")
    assert_rejected(profile_check, mutated(lambda p: p.__setitem__("lexiconConceptPolicy", {**concept_policy, "rejectAbsent": False})),
                    "profile permitting absent Lexicon concepts")


def test_shared_forbidden_list() -> None:
    check = validator(FORBIDDEN_SCHEMA)
    for path in (FORBIDDEN, FIXTURE / "forbidden-concepts.json"):
        shared = load_json(path)
        assert_valid(check, shared, path.name)
        if len({c["label"] for c in shared["concepts"]}) != len(shared["concepts"]):
            fail(f"{path.name}: duplicate forbidden concepts")
        if len({(p["concept"], p["property"]) for p in shared["properties"]}) != len(shared["properties"]):
            fail(f"{path.name}: duplicate forbidden properties")
    fixture = load_json(FIXTURE / "forbidden-concepts.json")
    bad_label = copy.deepcopy(fixture)
    bad_label["concepts"][0]["label"] = "Member-Legacy"
    assert_rejected(check, bad_label, "forbidden concept with a non-canonical label")
    bad_key = copy.deepcopy(fixture)
    bad_key["retiredMappings"][0]["mapping"] = "alpha-to-omega@latest"
    assert_rejected(check, bad_key, "retired mapping without an exact version")
    labels = {c["label"] for c in load_json(FORBIDDEN)["concepts"]}
    for path in [*example_profiles(), FIXTURE_PROFILE]:
        extras = set(load_json(path).get("lexiconConceptPolicy", {}).get("forbiddenConcepts", []))
        if extras & labels:
            fail(f"{path.name}: repeats shared forbidden concepts instead of using the shared list")
    if "forbidden-concepts.json" not in read(RESOLVER):
        fail("resolver does not load the shared forbidden list by default")


def test_core_and_references() -> None:
    agent = read(AGENT)
    skill = read(SKILL / "SKILL.md")
    core = (agent + "\n" + skill).lower()
    naming_corpus = agent + "\n" + skill + "\n" + read(REFERENCE / "operating-contract.md")
    if "Transform Configuration Validation Agent" not in naming_corpus:
        fail("Silvally validation-agent role is missing")
    for obsolete_role in ("Transform Configuration Agent", "Operational Architect"):
        if obsolete_role in naming_corpus:
            fail(f"Silvally retains obsolete role wording {obsolete_role!r}")
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
        "name every contradicted field", "already implemented but not yet revalidated",
        "complete utc-day", "day-or-range confirmation",
        "never choose random rows", "sourcewindowselection",
        "removedlexiconconcept", "pinned current lexicon",
        "absent or deprecated", "reintroduction", "explicit pinned modeling approval",
        "derivationoverrides", "check-profile", "one rejected case per required input", "registry-layout.json",
        "final prod-derived validation", "finalprodderivedvalidationrequired", "derivedsourcewindowpolicy",
        "recordeddefaults", "own approval digest", "never `ready`", "source_window.py",
        "package slices", "prod transform is never invoked", "unpublished-in-prod",
    ):
        if token not in core:
            fail(f"core routing/safety contract missing {token!r}")
    phases = read(REFERENCE / "validation-phases-and-gates.md")
    if re.findall(r"(?m)^(\d+)\. \*\*", phases) != [str(n) for n in range(1, 13)]:
        fail("phase contract must contain exactly the ordered 12 phases")
    for status in STATUSES:
        if status not in phases:
            fail(f"phase contract missing status {status}")
    for filename in ("operating-contract.md", "validation-phases-and-gates.md", "evidence-requirements.md",
                     "validation-report.md", "known-failure-modes.md", "registry-layout.json"):
        read(REFERENCE / filename)
    if (REFERENCE / "profiles").exists() or (REFERENCE / "calibrations").exists():
        fail("profiles and calibrations belong under examples/, not reference/")
    layout = load_json(LAYOUT)
    for key in ("hubLanguage", "conceptModelPath", "languageDefinitionPath", "registrationGlob", "publishedRegistry", "materialize", "transformRuntime"):
        if key not in layout:
            fail(f"registry layout lacks {key}")


def example_terms() -> set[str]:
    """Mapping-, dataset- and environment-specific identifiers declared by the example profiles."""
    terms: set[str] = set()
    hub = load_json(LAYOUT)["hubLanguage"]

    def add(value) -> None:
        if isinstance(value, str) and len(value) >= 6 and value != hub and re.search(r"[-_@0-9]", value):
            terms.add(value)

    for path in example_profiles():
        profile = load_json(path)
        add(path.stem)
        for direction in profile["directions"]:
            mapping = direction["mapping"]
            mapping_id = mapping.get("id") or mapping.get("expectedId")
            add(mapping_id)
            if mapping.get("version"):
                add(f"{mapping_id}@{mapping['version']}")
            for dataset in mapping.get("expectedOutputDatasets", []) + mapping.get("plannedSource", {}).get("expectedOutputDatasets", []):
                add(dataset)
            for contract in direction.get("outputContracts", []):
                add(contract["dataset"])
                for table in contract["requiredInputs"]:
                    add(table)
        for source in profile["validationSources"]:
            add(source["id"])
            location = source.get("location", "")
            if location.startswith("s3://"):
                add(location[5:].split("/", 1)[0])
                for segment in location[5:].split("/")[1:]:
                    if re.search(r"\d{8}", segment):
                        add(segment)
    return terms


def test_no_mapping_specific_content() -> None:
    terms = example_terms()
    if not terms:
        fail("example profiles yielded no identifiers to guard against")
    offenders = []
    for path in CORE_FILES:
        text = read(path)
        for term in sorted(terms):
            if re.search(rf"(?<![A-Za-z0-9_@.-]){re.escape(term)}(?![A-Za-z0-9_@-])", text):
                offenders.append(f"{path.relative_to(ROOT)}: {term}")
        if any(set(m) != {"0"} for m in re.findall(r"(?<![0-9a-fA-F])\d{12}(?![0-9a-fA-F])", text)):
            offenders.append(f"{path.relative_to(ROOT)}: 12-digit account-like number")
    if offenders:
        fail("core files mention example-profile identifiers:\n  " + "\n  ".join(offenders[:40]))
    for script in sorted((SKILL / "scripts").glob("*.py")):
        if "examples" in read(script):
            fail(f"{script.name} references the examples area; profiles must be passed as inputs")


def test_naming_and_sanitization() -> None:
    paths = [DRAFT_PROFILE_SCHEMA, PROFILE_SCHEMA, RUN_SCHEMA, FORBIDDEN, FORBIDDEN_SCHEMA, LAYOUT, FIXTURE_PROFILE,
             *example_profiles(), *sorted((EXAMPLES / "calibrations").glob("*.md"))]
    kebab_file = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+)+$")
    for path in paths:
        if path.name in {"config.json", "data.json", "utils.md", "test.json"} or not kebab_file.fullmatch(path.name):
            fail(f"non-self-describing filename: {path.name}")
    corpus = "\n".join(read(path) for path in paths)
    for pattern in (r"AKIA[0-9A-Z]{16}", r"(?i)aws_secret_access_key\s*[:=]\s*\S+", r"(?i)https?://[^/\s]+:[^@\s]+@"):
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


def test_generic_intake_contract() -> None:
    core = (read(AGENT) + "\n" + read(SKILL / "SKILL.md")).lower()
    for token in ("profile id is not required", "bounded read-only discovery", "one focused question at a time", "bare",
                  "business-language similarity", "transform-configuration-profile-draft.schema.json", "context_complete",
                  "do not run mapping tests", "without redundant questions"):
        if token not in core:
            fail(f"generic intake contract missing {token!r}")
    bare = valid_draft()
    if bare["intakeState"] != "NEEDS_INPUT" or bare["promotionEligible"] or not bare["unresolvedFacts"]:
        fail("bare invocation did not remain in intake with missing context")
    expert = valid_draft(complete=True)
    if expert["intakeState"] != "CONTEXT_COMPLETE" or not expert["promotionEligible"]:
        fail("complete expert intake did not take the validation fast path")


# ---------------------------------------------------------------------------
# Resolver on the synthetic registry
# ---------------------------------------------------------------------------


def load_resolver():
    spec = importlib.util.spec_from_file_location("resolve_transform_intent", RESOLVER)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class Registry:
    """A disposable copy of the synthetic registry that tests may modify."""

    def __init__(self, tmp: Path, name: str) -> None:
        self.root = tmp / name
        shutil.copytree(FIXTURE, self.root)
        self.candidate = self.root / "candidate"
        self.main = self.candidate
        self.registries: list[str] = []

    def registration(self, key: str) -> Path:
        mapping_id, version = key.split("@")
        return self.candidate / "mappings" / mapping_id / version / "registration.json"

    def edit(self, key: str, fn) -> None:
        doc = json.loads(self.registration(key).read_text())
        fn(doc)
        self.registration(key).write_text(json.dumps(doc, indent=2))

    def add_mapping(self, key: str, doc: dict, sql: dict[str, str]) -> None:
        path = self.registration(key)
        (path.parent / "queries").mkdir(parents=True, exist_ok=True)
        for output in doc["outputs"]:
            text = sql[output["dataset"]]
            (path.parent / "queries" / f"{output['dataset']}.sql").write_text(text)
            output["queries"] = [{"path": f"queries/{output['dataset']}.sql", "sha256": hashlib.sha256(text.encode()).hexdigest()}]
        path.write_text(json.dumps(doc, indent=2))

    def edit_language(self, language: str, fn) -> None:
        path = self.candidate / "languages" / f"{language}.json"
        doc = json.loads(path.read_text())
        fn(doc)
        path.write_text(json.dumps(doc, indent=2))

    def args(self, *extra: str, profiles: Path | None = None) -> list[str]:
        out = ["--layout", str(self.root / "layout.json"), "--lexicon-root", str(self.candidate), "--main-lexicon-root", str(self.main),
               "--forbidden-concepts", str(self.root / "forbidden-concepts.json"), "--profiles", str(profiles or self.root / "profiles")]
        catalog = self.root / "package-slices.json"
        if catalog.exists():
            out += ["--slice-catalog", str(catalog)]
        for spec in self.registries:
            out += ["--registry", spec]
        return out + list(extra)

    def run(self, command: str, *extra: str, profiles: Path | None = None, expect_ok: bool = True) -> dict:
        out = self.root / f"out-{command}.json"
        result = subprocess.run([sys.executable, str(RESOLVER), command, *self.args(*extra, profiles=profiles), "--out", str(out)],
                                capture_output=True, text=True)
        if expect_ok and result.returncode != 0:
            fail(f"resolver {command} {extra}: {result.stderr[-600:]}")
        return json.loads(out.read_text())

    def discover(self, request: str, profiles: Path | None = None) -> dict:
        return self.run("discover", "--request", request, profiles=profiles)


def codes(result: dict) -> set[str]:
    return {f["code"] for f in result.get("findings", [])}


def offered(result: dict) -> list[str]:
    question = next((q for q in result.get("questions", []) if q["id"] == "mapping-choice"), {"options": []})
    return [o["id"] for o in question["options"]]


def test_parse() -> None:
    resolver = load_resolver()
    parsed = resolver.parse_request("/silvally validate canon (alpha/beta) to omega ledger summaries @2.0.0 in prod round trip")
    if (parsed["status"] != "PARSED" or parsed["sourceTerms"] != ["canon"] or parsed["qualifiers"] != ["alpha", "beta"]
            or parsed["targetTerms"] != ["omega", "ledger", "summaries"]):
        fail(f"short-request grammar mis-parsed terms: {parsed}")
    if parsed["hints"] != {"version": "2.0.0", "environment": "prod", "mode": "round-trip"}:
        fail(f"short-request hints mis-parsed: {parsed['hints']}")
    if parsed.get("slices"):
        fail(f"a request without a for-clause produced slices: {parsed.get('slices')}")
    if resolver.parse_request("check canon omega")["status"] != "UNPARSED":
        fail("a request without a direction was parsed")
    if "ledger_summary" not in resolver.qualifier_phrases(["ledger", "summaries"]) or "member_report" not in resolver.qualifier_phrases(["member", "reports"]):
        fail("a trailing plural qualifier is not tried in singular form")
    catalog = json.loads((FIXTURE / "package-slices.json").read_text())
    sliced = resolver.parse_request("validate canon to omega for members, ledgers", catalog)
    if sliced["status"] != "PARSED" or sliced["slices"] != ["members", "ledgers"]:
        fail(f"named package slices were not extracted: {sliced}")
    if sliced["sourceTerms"] != ["canon"] or sliced["targetTerms"] != ["omega"]:
        fail(f"slice words leaked into language terms: {sliced}")
    lazy = resolver.parse_request("validate lexicon to interprose for sms, dsa and m2d")
    if lazy["status"] != "PARSED" or lazy["slices"] != ["sms", "dsa", "m2d"]:
        fail(f"the first-class lazy slice phrase was not parsed: {lazy}")
    if lazy["sourceTerms"] != ["lexicon"] or lazy["targetTerms"] != ["interprose"]:
        fail(f"the lazy slice phrase did not keep the package language pair: {lazy}")
    other = resolver.parse_request("validate quiq to lexicon")
    if other["slices"] or other["sourceTerms"] != ["quiq"] or other["targetTerms"] != ["lexicon"]:
        fail(f"a different language pair was treated as package slices: {other}")


def test_resolution_and_selection(tmp: Path) -> None:
    reg = Registry(tmp, "select")
    result = reg.discover("test canon (alpha) to omega ledger summary")
    if result["status"] != "RESOLVED" or result["selection"]["selected"] != "canon-to-omega@2.0.0":
        fail(f"an output qualifier did not select the version that outputs it: {result.get('selection')}")
    if [s["mapping"] for s in result["workflow"]["steps"]] != ["alpha-to-canon@1.0.0", "canon-to-omega@2.0.0"]:
        fail("a qualifier naming a producer language did not chain the producer before the projection")
    if result["selectedProfile"] != FIXTURE_PROFILE.name:
        fail("the profile declaring every workflow step was not selected")
    if result["workflow"]["persistPolicySource"] != "profile" or any(q["id"] == "persist-policy" for q in result["questions"]):
        fail("a profile-fixed Persist policy was asked again")
    cumulative = reg.discover("test canon to omega member report")
    if cumulative["selection"].get("selectionRule") != "cumulative-superset" or cumulative["selection"]["selected"] != "canon-to-omega@2.0.0":
        fail(f"cumulative versions did not select the superset version: {cumulative['selection']}")
    pinned = reg.discover("test canon to omega@1.0.0")
    if pinned["selection"]["selected"] != "canon-to-omega@1.0.0" or "UpstreamSourceUnresolved" not in codes(pinned):
        fail("a version hint did not pin the older version, or the missing producer was not reported")
    ambiguous = reg.discover("test canon to omega")
    if ambiguous["status"] != "AMBIGUOUS" or set(offered(ambiguous)) != {"canon-to-omega@1.0.0", "canon-to-omega@2.0.0", "none"}:
        fail(f"competing versions without a qualifier were not ambiguous: {offered(ambiguous)}")
    no_match = reg.discover("test alpha to omega")
    retired = [c for c in no_match["candidates"] if c.get("mapping") == "alpha-to-omega@0.9.0"]
    if no_match["status"] != "NO_MAPPING" or not retired or "alpha-to-omega@0.9.0" in offered(no_match):
        fail("a retired direct mapping was selected or offered instead of listed")
    if "RetiredMappingInRegistry" not in codes(no_match):
        fail("a retired mapping still in the registry was not reported")
    unknown = reg.discover("test alhpa to canon")
    if unknown["status"] != "UNKNOWN_LANGUAGE" or not any("spelling-close-to-alhpa" in c["reasons"] for c in unknown["candidates"]):
        fail("an unknown language did not offer the close spelling")
    two = reg.discover("test canon to omega sigma")
    if two["status"] != "AMBIGUOUS" or {c["language"] for c in two["candidates"]} != {"omega", "sigma"}:
        fail("two target languages on one side were not ambiguous")
    retired_id = reg.discover("test beta to canon")
    if not any("retired-in-lexicon" in c["reasons"] for c in retired_id["candidates"]) or "beta-to-canon" in offered(retired_id):
        fail("a retired mapping id from the registry's retired list was offered")
    forward = reg.discover("test alpha to canon")
    cross = next(q for q in forward["questions"] if q["id"] == "cross-source-step")
    if {o["id"] for o in cross["options"]} != {"canon-to-omega@1.0.0", "canon-to-omega@2.0.0", "canon-to-sigma@1.0.0", "none"}:
        fail(f"projections consuming the forward outputs were not offered as cross-source steps: {cross['options']}")


def test_round_trip_and_parity(tmp: Path) -> None:
    reg = Registry(tmp, "roundtrip")
    reg.add_mapping("canon-to-alpha@1.0.0", {
        "id": "canon-to-alpha", "version": "1.0.0", "status": "ENABLED", "engine": "spark-sql", "from": "canon", "to": "alpha",
        "inputs": [{"table": "vertex-member", "view": "source_vertex_member", "format": "parquet", "options": {},
                    "graph": {"kind": "vertex", "label": "member", "idColumn": "~id", "properties": []}}],
        "output": {"shape": "tabular", "format": "jsonl", "options": {}},
        "outputs": [{"dataset": "members", "requiredInputs": ["vertex-member"]}],
    }, {"members": "SELECT regexp_replace(`~id`, '^member-', '') AS member_id FROM source_vertex_member\n"})
    result = reg.discover("test alpha to canon", profiles=tmp / "none")
    if [s["mapping"] for s in result["workflow"]["steps"]] != ["alpha-to-canon@1.0.0", "canon-to-alpha@1.0.0"]:
        fail("a registered inverse was not appended for the default round trip")
    parity = {p["dataset"]: p for p in result["parityDerivation"]}
    if parity["members"]["status"] != "DERIVED" or parity["members"]["comparedFields"] != ["display_name", "member_id", "tier"]:
        fail(f"round-trip parity fields were not derived from the source definition: {parity['members']}")
    if parity["members"]["coverageTargets"] != [{"field": "tier", "values": ["gold", "silver"]}]:
        fail("enum coverage targets were not derived from the source definition")
    gaps = {d for d, p in parity.items() if p.get("finding") == "RoundTripDatasetGap"}
    if gaps != {"ledgers", "rates"}:
        fail(f"forward inputs the inverse does not reconstruct were not gaps: {gaps}")
    one_way = reg.discover("test alpha to canon one way", profiles=tmp / "none")
    if len(one_way["workflow"]["steps"]) != 1:
        fail("a one-way hint still appended the inverse")


def test_concepts_and_forbidden_content(tmp: Path) -> None:
    reg = Registry(tmp, "forbidden")
    reg.edit("canon-to-sigma@1.0.0", lambda d: None)
    sql = reg.registration("canon-to-sigma@1.0.0").parent / "queries" / "member_digest.sql"
    sql.write_text(sql.read_text().replace("FROM", ", legacy_code FROM"))
    result = reg.discover("test canon to sigma", profiles=tmp / "none")
    hits = [f for f in result["findings"] if f["code"] == "ForbiddenConceptInSql"]
    if [h["concept"] for h in hits] != ["legacy_code"]:
        fail(f"a forbidden scoped property in SQL was not found: {hits}")
    reg.edit_language("canon", lambda d: d["vertices"][0]["properties"].__setitem__("legacy_code", {"type": "string"}))
    reg.edit_language("canon", lambda d: d["edges"].append({"type": "member_legacy_link", "from": "member", "to": "member", "properties": {}}))
    model = reg.discover("test canon to sigma", profiles=tmp / "none")
    if not {"ForbiddenPropertyInLexicon", "ForbiddenConceptInLexicon"} <= codes(model):
        fail(f"forbidden model content was not reported: {codes(model)}")

    history = Registry(tmp, "history")
    main = tmp / "main-repo"
    shutil.copytree(history.candidate, main)
    git = lambda *a: subprocess.run(["git", "-C", str(main), *a], check=True, capture_output=True)  # noqa: E731
    git("init", "-q")
    git("config", "user.email", "t@example.invalid")
    git("config", "user.name", "t")
    concepts = json.loads((main / "languages" / "canon.json").read_text())
    concepts["vertices"].append({"type": "member_note", "is_deprecated": False, "properties": {}, "indexes": {}})
    (main / "languages" / "canon.json").write_text(json.dumps(concepts, indent=2))
    git("add", "-A")
    git("commit", "-qm", "add member_note")
    concepts["vertices"] = [v for v in concepts["vertices"] if v["type"] != "member_note"]
    (main / "languages" / "canon.json").write_text(json.dumps(concepts, indent=2))
    git("commit", "-qam", "remove member_note")
    history.main = main
    history.edit_language("canon", lambda d: d["vertices"].append({"type": "member_note", "is_deprecated": False, "properties": {}, "indexes": {}}))
    history.edit("canon-to-sigma@1.0.0", lambda d: d["inputs"].append(
        {"table": "vertex-member-note", "view": "source_vertex_member_note", "format": "parquet", "options": {},
         "graph": {"kind": "vertex", "label": "member_note", "idColumn": "~id", "properties": []}}))
    removed = history.discover("test canon to sigma", profiles=tmp / "none")
    finding = next((f for f in removed["findings"] if f["code"] == "RemovedLexiconConcept"), None)
    if not finding or finding["state"] != "REMOVED_ON_MAIN" or len(finding["mainHistoryCommits"]) != 2:
        fail(f"a concept removed on main and reintroduced by the candidate was not reported: {finding}")
    if removed["lexiconModel"]["addedConcepts"] != ["member_note"]:
        fail("the candidate model diff against main was not computed")


def test_profile_drift_and_model_policy(tmp: Path) -> None:
    reg = Registry(tmp, "drift")
    profiles = reg.root / "profiles"
    profile = json.loads(FIXTURE_PROFILE.read_text())
    projection = profile["directions"][1]
    projection["outputContracts"][0]["requiredInputs"] = ["vertex-member", "vertex-ledger"]
    projection["outputContracts"][1]["format"] = {"type": "csv", "delimiter": ",", "header": True}
    projection["mapping"]["expectedOutputDatasets"] = ["member_report"]
    profile["lexiconModelPolicy"] = {"path": "languages/canon.json", "candidateLexiconDiff": "forbidden",
                                     "approvedAdditions": [{"concept": "member", "property": "joined_at", "approval": "fixture-owner-approval"}]}
    (profiles / FIXTURE_PROFILE.name).write_text(json.dumps(profile, indent=2))
    main = tmp / "drift-main"
    shutil.copytree(reg.candidate, main)
    reg.main = main
    reg.edit_language("canon", lambda d: d["vertices"][0]["properties"].__setitem__("joined_at", {"type": "string"}))
    result = reg.discover("test canon (alpha) to omega ledger summary")
    found = codes(result)
    for code in ("ProfileOutputInputDrift", "OutputFormatDrift", "ProfileOutputDatasetDrift", "LexiconModelApprovedAdditions"):
        if code not in found:
            fail(f"{code} was not reported: {sorted(found)}")
    if "LexiconModelDiffersFromMain" in found:
        fail("an owner-approved model addition was reported as an unapproved diff")
    reg.edit_language("canon", lambda d: d["vertices"][1]["properties"].__setitem__("unapproved", {"type": "string"}))
    if "LexiconModelDiffersFromMain" not in codes(reg.discover("test canon (alpha) to omega ledger summary")):
        fail("an unapproved model difference was not reported")

    planned = json.loads(FIXTURE_PROFILE.read_text())
    planned["id"] = "synthetic-planned.json"
    planned["directions"][1]["mapping"] = {"status": "not-registered", "expectedId": "canon-to-omega", "owner": "kecleon",
                                           "reason": "Version 3.0.0 is still being authored",
                                           "plannedSource": {"repository": "example-org/synthetic-registry", "sourcePaths": ["mappings/canon-to-omega/3.0.0"],
                                                             "generatedArtifact": {"generatorPath": "mappings", "logicalArtifactPath": "transform-mappings/canon-to-omega/3.0.0/mapping.json",
                                                                                   "materializationCommand": "cp -R mappings <out>"},
                                                             "expectedOutputDatasets": ["audit"], "outputDatasetMatch": "exact"}}
    planned_dir = tmp / "planned-profiles"
    planned_dir.mkdir()
    (planned_dir / "synthetic-planned.json").write_text(json.dumps(planned))
    planned_result = Registry(tmp, "planned").discover("test canon to omega audit", profiles=planned_dir)
    entry = next((c for c in planned_result.get("candidates", []) if c.get("status") == "PLANNED"), None)
    if not entry or "canon-to-omega@3.0.0" in offered(planned_result) or "PlannedMappingNotRegistered" not in codes(planned_result):
        fail(f"a planned, unregistered mapping was not listed as planned without being offered: {planned_result.get('candidates')}")


def test_registry_sources(tmp: Path) -> None:
    reg = Registry(tmp, "sources")
    published = tmp / "published" / "transform-mappings" / "canon-to-omega" / "2.0.0"
    published.mkdir(parents=True)
    doc = json.loads(reg.registration("canon-to-omega@2.0.0").read_text())
    doc["outputs"] = doc["outputs"][:1]
    (published / "mapping.json").write_text(json.dumps(doc))
    reg.registries = [f"dev={tmp / 'published'}"]
    result = reg.discover("test canon (alpha) to omega ledger summary")
    drift = [f for f in result["findings"] if f["code"] == "RegistrySourceDrift"]
    if [d["mapping"] for d in drift] != ["canon-to-omega@2.0.0"]:
        fail(f"a published registry disagreeing with the candidate was not reported: {drift}")
    endpoint = Registry(tmp, "endpoint-only")
    endpoint.add_mapping("canon-to-zeta@1.0.0", {
        "id": "canon-to-zeta", "version": "1.0.0", "status": "ENABLED", "engine": "spark-sql", "from": "canon", "to": "zeta",
        "inputs": [{"table": "vertex-member", "view": "source_vertex_member", "format": "parquet", "options": {},
                    "graph": {"kind": "vertex", "label": "member", "idColumn": "~id", "properties": []}}],
        "output": {"shape": "tabular", "format": "csv", "options": {"header": True}},
        "outputs": [{"dataset": "zeta_rows", "requiredInputs": ["vertex-member"]}],
    }, {"zeta_rows": "SELECT `~id` AS member FROM source_vertex_member\n"})
    zeta = endpoint.discover("test canon to zeta", profiles=tmp / "none")
    if zeta["languages"]["zeta"]["state"] != "MAPPING_ENDPOINT_ONLY" or "LanguageDefinitionMissing" not in codes(zeta):
        fail("a mapping endpoint without a registered definition was not reported")
    blocked = [p for p in zeta["parityDerivation"] if p["dataset"] == "zeta_rows"]
    if not blocked or blocked[0]["status"] != "BLOCKED" or blocked[0]["finding"] != "TargetSchemaUndefined":
        fail(f"parity for an undefined target language was not blocked: {blocked}")


def publish(root: Path, doc: dict) -> Path:
    path = root / "transform-mappings" / doc["id"] / doc["version"] / "mapping.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc))
    return path


def test_version_default(tmp: Path) -> None:
    reg = Registry(tmp, "version-default")
    docs = {v: json.loads(reg.registration(f"canon-to-omega@{v}").read_text()) for v in ("1.0.0", "2.0.0")}
    published = tmp / "version-published"
    for version, base in (("1.0.0", "1.0.0"), ("2.0.0", "2.0.0"), ("9.0.0", "2.0.0"), ("10.0.0", "2.0.0")):
        pinned = publish(published, {**docs[base], "version": version})
    reg.registries = [f"dev={published}"]
    latest = reg.discover("test canon to omega")
    selection = latest.get("versionSelection") or {}
    if latest["status"] != "RESOLVED" or latest["selection"]["selected"] != "canon-to-omega@10.0.0":
        fail(f"several published versions did not default to the highest semver (10.0.0 > 9.0.0): {latest['selection'].get('selected')}")
    if selection.get("rule") != "latest-published-semver" or selection.get("requested") is not None:
        fail(f"the defaulted version was not recorded as latest-published-semver: {selection}")
    expected_notice = "Resolved canon-to-omega@10.0.0 — latest of 1.0.0, 2.0.0, 9.0.0, 10.0.0; add @x.y.z to pick another."
    if latest.get("notice") != expected_notice or selection.get("notice") != expected_notice:
        fail(f"the defaulted version was not announced upfront: {latest.get('notice')!r}")
    if selection["pin"] != {"source": "published-registry", "label": "dev", "path": str(pinned.relative_to(published)),
                            "sha256": hashlib.sha256(pinned.read_bytes()).hexdigest()}:
        fail(f"the defaulted version was not pinned to its published mapping.json digest: {selection['pin']}")
    if any(q["id"] in {"mapping-version", "mapping-choice"} for q in latest["questions"]):
        fail("a defaulted version was asked again instead of announced")
    draft = reg.run("draft-profile", "--request", "test canon to omega")
    if draft.get("versionSelection") != selection:
        fail("the draft profile did not record the version selection")
    if Draft202012Validator:
        for schema_path in (DRAFT_PROFILE_SCHEMA, RUN_SCHEMA):
            defs = json.loads(schema_path.read_text())["$defs"]
            checker = Draft202012Validator({"$ref": "#/$defs/versionSelection", "$defs": defs}, format_checker=FormatChecker())
            if list(checker.iter_errors(selection)):
                fail(f"{schema_path.name} rejects the resolver's versionSelection: {[e.message for e in checker.iter_errors(selection)]}")
            for label, bad in (("a defaulted version without a notice", {k: v for k, v in selection.items() if k != "notice"}),
                               ("a defaulted version claiming a requested version", {**selection, "requested": "1.0.0"}),
                               ("a defaulted version pinned to an unpublished registration",
                                {**selection, "pin": {**selection["pin"], "source": "checked-in-registration"}}),
                               ("a version selection without a digest pin", {**selection, "pin": {"source": "published-registry"}})):
                if checker.is_valid(bad):
                    fail(f"{schema_path.name} accepted {label}")

    single = Registry(tmp, "version-single")
    single_published = tmp / "version-single-published"
    for base in ("1.0.0", "2.0.0"):
        publish(single_published, docs[base])
    single.registries = [f"dev={single_published}"]
    one = single.discover("test canon (alpha) to omega ledger summary")
    if one["selection"]["selected"] != "canon-to-omega@2.0.0" or one["versionSelection"]["rule"] != "single-match" or "notice" in one:
        fail(f"a request matching one published version announced a version default: {one.get('versionSelection')}")

    explicit = reg.discover("test canon to omega@1.0.0")
    if (explicit["selection"]["selected"] != "canon-to-omega@1.0.0" or explicit["versionSelection"]["rule"] != "explicit-version"
            or explicit["versionSelection"]["requested"] != "1.0.0" or "notice" in explicit):
        fail(f"an explicit @version did not win over the latest published version: {explicit.get('versionSelection')}")

    unpublished_newer = Registry(tmp, "version-unpublished-newer")
    only_v1 = tmp / "version-only-v1"
    publish(only_v1, docs["1.0.0"])
    unpublished_newer.registries = [f"dev={only_v1}"]
    older = unpublished_newer.discover("test canon to omega")
    if older["status"] != "RESOLVED" or older["selection"]["selected"] != "canon-to-omega@2.0.0":
        fail(f"a checked-in newer version was not selected so DEV proof can continue: {older.get('selection')}")
    if older.get("versionSelection", {}).get("rule") != "latest-candidate-semver":
        fail(f"a candidate-only default was not recorded as latest-candidate-semver: {older.get('versionSelection')}")
    if "Not in a DEV catalog" not in (older.get("notice") or ""):
        fail(f"a candidate-only default did not announce DEV proof: {older.get('notice')!r}")

    none_published = Registry(tmp, "version-none-published")
    other = tmp / "version-other-published"
    publish(other, json.loads(none_published.registration("canon-to-sigma@1.0.0").read_text()))
    none_published.registries = [f"dev={other}"]
    missing = none_published.discover("test canon to omega")
    if missing["status"] != "RESOLVED" or missing["selection"]["selected"] != "canon-to-omega@2.0.0":
        fail(f"checked-in versions of an unpublished pair did not stay RESOLVED: {missing['status']} {missing.get('selection')}")

    prod_absent = Registry(tmp, "version-unpublished-in-prod")
    dev_pub = tmp / "version-dev-v2"
    prod_pub = tmp / "version-prod-v1"
    publish(dev_pub, docs["2.0.0"])
    publish(prod_pub, docs["1.0.0"])
    prod_absent.registries = [f"dev={dev_pub}", f"prod={prod_pub}"]
    observed = prod_absent.discover("test canon to omega")
    unpublished = next((f for f in observed.get("findings", []) if f["code"] == "UnpublishedInProd"), None)
    if observed["status"] != "RESOLVED" or observed["selection"]["selected"] != "canon-to-omega@2.0.0":
        fail(f"absence from PROD rejected a DEV-published version: {observed.get('selection')}")
    if unpublished is None or unpublished.get("severity") != "informational":
        fail("absence from the PROD catalog was not an informational finding")
    if any(f["code"] == "UnpublishedInProd" and f.get("severity") == "fail" for f in observed.get("findings", [])):
        fail("unpublished-in-PROD was treated as a mapping failure")

    two_ids = Registry(tmp, "version-two-ids")
    two_published = tmp / "version-two-ids-published"
    publish(two_published, docs["2.0.0"])
    twin = {**docs["1.0.0"], "id": "canon-to-omega-twin", "version": "3.0.0"}
    two_ids.registries = [f"dev={two_published}"]
    publish(two_published, twin)
    ambiguous = two_ids.discover("test canon to omega")
    if ambiguous["status"] != "AMBIGUOUS" or "canon-to-omega-twin@3.0.0" not in offered(ambiguous) or "notice" in ambiguous:
        fail(f"different published mapping ids for one request were defaulted instead of asked: {ambiguous['status']} {offered(ambiguous)}")


def test_contracts_and_profile_check(tmp: Path) -> None:
    reg = Registry(tmp, "contracts")
    derived = reg.run("contracts", "--mapping", "canon-to-omega@2.0.0")
    outputs = {o["dataset"]: o for o in derived["outputs"]}
    if outputs["member_report"]["format"] != {"type": "csv", "delimiter": ";", "header": True} or outputs["ledger_summary"]["format"] != {"type": "jsonl"}:
        fail(f"output formats were not derived from the registration: {outputs}")
    if outputs["member_report"]["key"] != ["member_id"] or outputs["ledger_summary"]["columns"][-1] != "last_activity":
        fail("keys and columns were not derived from the target language definition")
    edge = next(i for i in derived["inputs"] if i["table"] == "edge-member-has-ledger")
    if edge["endpoints"] != {"from": "vertex-member", "to": "vertex-ledger"} or edge["requiredColumns"] != ["~id", "~from", "~to"]:
        fail("graph input contracts were not derived from the bindings")
    member = next(i for i in derived["inputs"] if i["table"] == "vertex-member")
    if member["optionalColumns"] != ["nickname:String"]:
        fail("optional graph properties were not separated from required columns")
    reg.edit("canon-to-omega@2.0.0", lambda d: d["outputs"][1].__setitem__("requiredInputs", ["vertex-member", "edge-member-has-ledger"]))
    broken = reg.run("contracts", "--mapping", "canon-to-omega@2.0.0")
    if not any(f["code"] == "EndpointDatasetNotRequired" and f["endpoint"] == "vertex-ledger" for f in broken["findings"]):
        fail(f"an edge whose endpoint dataset is not required was not reported: {broken['findings']}")
    graph = reg.run("contracts", "--mapping", "alpha-to-canon@1.0.0")
    edge_out = next(o for o in graph["outputs"] if o["dataset"] == "edge-member-has-ledger")
    if edge_out["shape"] != "graph" or edge_out["graph"]["endpoints"] != {"from": "vertex-member", "to": "vertex-ledger"}:
        fail("graph output contracts were not derived")

    clean = Registry(tmp, "profile-check")
    ok = clean.run("check-profile", "--profile", str(FIXTURE_PROFILE))
    if not ok["derivedEqualsProfileModuloOverrides"]:
        fail(f"the fixture profile does not regenerate from the registry: {ok['undeclared']}")
    declared = {(d["dataset"], d["field"]) for e in ok["directions"] for d in e.get("differences", [])}
    if declared != {("ledger_summary", "columns"), ("ledger_summary", "columnSource")}:
        fail(f"profile differences are not exactly the declared overrides: {declared}")
    undeclared = json.loads(FIXTURE_PROFILE.read_text())
    undeclared["directions"][1]["outputContracts"][0]["columns"] = ["member_id"]
    undeclared["directions"][1]["derivationOverrides"].append({"dataset": "member_report", "field": "key", "reason": "stale override for the test"})
    path = tmp / "undeclared.json"
    path.write_text(json.dumps(undeclared))
    bad = clean.run("check-profile", "--profile", str(path), expect_ok=False)
    if bad["derivedEqualsProfileModuloOverrides"] or [u["field"] for u in bad["undeclared"]] != ["columns"] or len(bad["staleOverrides"]) != 1:
        fail(f"an undeclared difference or a stale override was accepted: {bad['undeclared']} {bad['staleOverrides']}")

    draft = clean.run("draft-profile", "--request", "test canon (alpha) to omega ledger summary")
    validator(DRAFT_PROFILE_SCHEMA).errors(draft) and fail(f"draft-profile output is not schema-valid: {validator(DRAFT_PROFILE_SCHEMA).errors(draft)}")
    regenerated = {d["mapping"]["id"]: d for d in draft["derivedDirections"]}
    if set(regenerated) != {"alpha-to-canon", "canon-to-omega"} or len(regenerated["canon-to-omega"]["outputContracts"]) != 2:
        fail("draft-profile did not regenerate every workflow direction")
    window_policy = draft.get("derivedSourceWindowPolicy") or {}
    if window_policy.get("requiredSourceFamilies") != ["ledgers", "members", "rates"] or window_policy.get("origin") != "derived-at-intake" \
            or window_policy.get("recordedDefaults") != {"minimumCompleteUtcDays": 1, "allowLongerRange": True} \
            or not {"members-rows-present", "ledgers-rows-present", "rates-rows-present"} <= set(window_policy.get("requiredCoverageSignals", [])):
        fail(f"draft-profile did not derive the PROD-derived source window policy from the workflow inputs: {window_policy}")
    none = clean.run("draft-profile", "--request", "test canon to omega", profiles=tmp / "none")
    if "derivedDirections" in none or none["selectedProfile"] is not None:
        fail("an ambiguous request produced derived directions or a selected profile")


def test_package_slices(tmp: Path) -> None:
    reg = Registry(tmp, "slices")
    result = reg.discover("validate canon to omega for members, ledgers")
    if result["status"] != "RESOLVED" or result["selection"]["selected"] != "canon-to-omega@2.0.0":
        fail(f"named slices did not resolve to the covering version: {result.get('selection')}")
    steps = result["workflow"]["steps"]
    if [s.get("slice") for s in steps] != ["members", "ledgers"]:
        fail(f"slices were not separate workflow steps: {steps}")
    if [s.get("outputDatasets") for s in steps] != [["member_report"], ["ledger_summary"]]:
        fail(f"each slice did not keep its own outputs: {steps}")
    if {s["mapping"] for s in steps} != {"canon-to-omega@2.0.0"}:
        fail(f"slices selected more than one mapping: {steps}")
    if any(s.get("inputSource") != "profile-evidence" for s in steps):
        fail(f"slice steps did not read profile evidence: {steps}")
    if any("alpha-to-canon" in s["mapping"] for s in steps):
        fail("a slice word chained a producer mapping")
    if result["parsed"]["slices"] != ["members", "ledgers"] or result["intent"].get("qualifiers"):
        fail(f"slice words leaked as qualifiers: {result['intent']}")
    if result["parsed"]["hints"].get("mode") != "one-way":
        fail("named slices did not force one-way")
    upstream = next((q for q in result["questions"] if q["id"] == "upstream-source"), None)
    if upstream and upstream.get("default") != "existing-graph-export":
        fail(f"package slices did not default upstream to an existing graph export: {upstream}")
    pinned = reg.discover("validate canon to omega@1.0.0 for members, ledgers")
    if pinned["selection"]["selected"] != "canon-to-omega@1.0.0" or "SliceOutputsMissing" not in codes(pinned):
        fail("a pinned version missing a slice output was not reported")


def test_layout_independence() -> None:
    resolver = load_resolver()
    default = load_json(LAYOUT)
    resolver.load_layout(FIXTURE / "layout.json")
    try:
        if resolver.HUB_LANGUAGE != "canon" or resolver.normalize_dataset("edge-member-has-ledger") != "member_has_ledger":
            fail("the registry layout did not configure the hub language and graph dataset prefixes")
    finally:
        resolver.apply_layout(default)
    if resolver.HUB_LANGUAGE != default["hubLanguage"]:
        fail("restoring the default layout failed")
    source = read(RESOLVER)
    for literal in ('"src/', "'src/", '"infra/', "/lexicon/", 'HUB_LANGUAGE = "'):
        if literal in source:
            fail(f"resolver hardcodes a registry path or hub instead of reading the layout: {literal}")


def main() -> int:
    test_schemas_and_profiles()
    test_shared_forbidden_list()
    test_core_and_references()
    test_no_mapping_specific_content()
    test_naming_and_sanitization()
    test_golden_routes_and_dry_run()
    test_generic_intake_contract()
    test_parse()
    test_layout_independence()
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        (tmp / "none").mkdir()
        test_resolution_and_selection(tmp)
        test_round_trip_and_parity(tmp)
        test_concepts_and_forbidden_content(tmp)
        test_profile_drift_and_model_policy(tmp)
        test_registry_sources(tmp)
        test_version_default(tmp)
        test_package_slices(tmp)
        test_contracts_and_profile_check(tmp)
    print("Silvally contract and resolver tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
