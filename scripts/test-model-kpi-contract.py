#!/usr/bin/env python3
"""Behavioral contract checks for business/finance KPI configuration guidance."""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PROMPT = "agents/jirachi.md"
SKILL = "skills/configure-model-product/SKILL.md"
REFERENCE = "skills/configure-model-product/reference/kpi-to-metric-configuration.md"
CAPABILITY_MAP = "skills/guide-product-work/reference/iterations/model.md"


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def normalized(value: str) -> str:
    return " ".join(value.casefold().split())


def section(relative: str, heading: str) -> str:
    text = read(relative)
    match = re.search(
        rf"(?ms)^##+ {re.escape(heading)}\s*$\n(.*?)(?=^##+ |\Z)",
        text,
    )
    if match is None:
        raise AssertionError(f"{relative} is missing section {heading!r}")
    return match.group(1)


def require_concepts(
    relative: str,
    value: str,
    concepts: dict[str, tuple[str, ...]],
) -> None:
    haystack = normalized(value)
    missing = [
        name
        for name, alternatives in concepts.items()
        if not any(normalized(alternative) in haystack for alternative in alternatives)
    ]
    if missing:
        raise AssertionError(
            f"{relative} is missing behavioral concepts: {', '.join(missing)}"
        )


def assert_intent_contract() -> None:
    intent = section(REFERENCE, "Complete the KPI intent")
    bullets = [
        normalized(match.group(1))
        for match in re.finditer(r"(?m)^-\s+(.+?);?$", intent)
    ]
    concepts = {
        "name/business question": ("name and business question",),
        "grain/entity": ("grain/entity",),
        "measure": ("measure",),
        "aggregation": ("aggregation",),
        "filters": ("filters", "exclusions"),
        "time/window": ("time semantics and reporting window",),
        "dimensions/grouping": ("dimensions/grouping",),
        "output/consumer": ("output and consuming",),
        "acceptance examples": ("acceptance examples",),
    }
    for name, alternatives in concepts.items():
        if not any(
            any(normalized(alternative) in bullet for alternative in alternatives)
            for bullet in bullets
        ):
            raise AssertionError(f"{REFERENCE} intent contract is missing {name}")
    require_concepts(
        REFERENCE,
        intent,
        {
            "discovery questions": ("ask focused discovery questions",),
            "no guessed semantics": ("do not infer",),
        },
    )


def assert_evidence_and_classification() -> None:
    evidence = section(REFERENCE, "Gather read-only model evidence")
    require_concepts(
        REFERENCE,
        evidence,
        {
            "read-only Lexicon": ("lexicon schema bytes", "read-only evidence"),
            "directed relationships": ("directed relationships",),
            "catalog definitions": ("metric catalogs/definitions",),
            "consumer compiler": ("supported-definition/compiler contract",),
            "no Model graph inspection": ("do not claim that model inspects neptune",),
            "no automatic generation": ("generates kpi configuration automatically",),
        },
    )

    classification = section(REFERENCE, "Classify support")
    labels = re.findall(r"(?m)^-\s+`([^`]+)`", classification)
    expected = [
        "exact reuse",
        "supported configuration/composition",
        "new definition/family",
    ]
    if labels[:3] != expected:
        raise AssertionError(
            f"{REFERENCE} must classify KPI support in order as {expected}; got {labels[:3]}"
        )
    require_concepts(
        REFERENCE,
        classification,
        {
            "exact IDs": ("exact existing metric ids",),
            "unknown IDs fail closed": ("unknown id", "new definition/family"),
            "partial matches fail closed": ("partial semantic match", "new definition/family"),
        },
    )


def assert_real_lifecycle_and_fail_closed_behavior() -> None:
    lifecycle = section(REFERENCE, "Use the real generic Model lifecycle")
    require_concepts(
        REFERENCE,
        lifecycle,
        {
            "change set": ("change-set submission",),
            "artifact upload": ("artifact upload",),
            "composition selector": ("composition.documentartifactid",),
            "composition source digest": (
                "set `sourcedigest` to the selected json artifact's digest",
            ),
            "validation": ("validation start, status and results",),
            "review": ("review submission", "review decision"),
            "publication": ("publication start", "publication"),
            "read-back": ("read the immutable release",),
            "release identity": ("release id/digest",),
            "digest verification": ("source digest", "artifact digest"),
            "no KPI routes": ("does not expose kpi-specific routes",),
            "adapter boundary": ("application: not applied",),
        },
    )

    fail_closed = section(REFERENCE, "Fail closed for new definitions and families")
    require_concepts(
        REFERENCE,
        fail_closed,
        {
            "no unsupported submission": (
                "do not submit `new definition/family`",
            ),
            "Lexicon work": ("lexicon catalog source/type", "validator/generator"),
            "Persist work": ("persist supported-definition list", "family/plan compiler"),
            "Model builder handoff": ("dialga",),
            "Persist builder handoff": ("conkeldurr",),
        },
    )

    activation = section(REFERENCE, "Keep activation separate")
    require_concepts(
        REFERENCE,
        activation,
        {
            "publication distinct": ("do not activate",),
            "never automatic": ("never perform activation automatically",),
            "runtime evidence": ("runtime evidence",),
        },
    )


def assert_canonical_metric_contract() -> None:
    canonical = section(REFERENCE, "Discover the canonical files and selected revisions")
    require_concepts(
        REFERENCE,
        canonical,
        {
            "canonical source": (
                "src/data/financial-metrics/payment-financial-metrics.v2.json",
            ),
            "activation source": ("top-level `dev_activation_allowlist`",),
            "type contract": ("scripts/lib/financial-metrics/types.ts",),
            "catalog validator": ("scripts/lib/financial-metrics/catalog.ts",),
            "release builder": ("scripts/lib/financial-metrics/release.ts",),
            "generated release": (
                ".generated/financial-metrics-catalog/releases/<lexicon_version_id>/",
            ),
            "approved marker": ("approved-release.json",),
            "discovery parameter": ("/lexicon/financial-metrics-catalog-uri",),
            "count boundary": ("counts are revision-specific observations",),
        },
    )

    shape = section(REFERENCE, "Read the actual payment catalog shape")
    require_concepts(
        REFERENCE,
        shape,
        {
            "package identity": ("package_id", "package_version", "release_id"),
            "catalog identity": ("schema_version", "contract_versions"),
            "metric identity": ("metric_id", "definition_version", "family_id"),
            "entities": ("root", "graph_source"),
            "relationships": ("path_hops", "scope_paths"),
            "measure": ("measure",),
            "aggregation": ("calculation", "unit"),
            "grain": ("grains", "scopes"),
            "filters": ("qualifying_conditions",),
            "dimensions": ("dimensions",),
            "time": ("time_behavior", "business_time_property", "coverage_mode"),
            "source references": ("source_metadata",),
            "runtime dependencies": ("triggering_vertices", "materialization_plan"),
            "activation": ("dev_activation_allowlist.{profile,mode,metric_ids}",),
            "no per-definition activation": ("not a definition status",),
            "reporting window elsewhere": ("no request-specific reporting start/end window",),
            "consumer elsewhere": ("does not store the user's consumer",),
            "no invented dependency field": ("there is no generic `dependencies` field",),
        },
    )

    persist = section(REFERENCE, "Persist is the execution gate")
    require_concepts(
        REFERENCE,
        persist,
        {
            "catalog schema": ("lambda/schemas/payment-metric-catalog.ts",),
            "closed definitions": (
                "lambda/schemas/payment-metric-supported-definitions.ts",
            ),
            "catalog integrity": (
                "lambda/services/paymentmetriccatalogservice.ts",
            ),
            "compiler gate": (
                "lambda/services/paymentmetricdeclarativeplancompiler.ts",
            ),
            "activation consumer": (
                "lambda/services/paymentmetricmaterializationplan.ts",
            ),
            "production pin": ("lambda/payment-metric-prod-shadow-config.ts",),
            "no duplicate allowlist": (
                "does not live in a second persist-authored list",
            ),
            "read-only compatibility": ("read-only compatibility checks",),
        },
    )


def assert_model_catalog_mapping_and_precedence() -> None:
    model = section(REFERENCE, "Represent metric catalogs in Model")
    require_concepts(
        REFERENCE,
        model,
        {
            "manifest location": ("manifest.metriccatalogs[]",),
            "generated mode": ('"mode": "generated"',),
            "generated contract": ('"contractversion": "base-metrics-catalog/v1"',),
            "generator source": ('"generatorsourcealias"',),
            "generated input": ('"input": "package"',),
            "maximum path": ('"maximumpathhops"',),
            "published mode": ('"mode": "published"',),
            "published URI": ('"artifacturi"',),
            "published digest": ('"digest": "sha256:',),
            "payment artifact": ("payment-financial-metrics.v2.json",),
            "marker is not catalog": (
                "do not put the mutable ssm uri, `approved-release.json`",
            ),
            "composition artifact": ("composition.documentartifactid",),
            "definitions stay in Lexicon": (
                "lexicon still owns the referenced definitions",
            ),
        },
    )

    precedence = section(REFERENCE, "Apply source-of-truth precedence")
    require_concepts(
        REFERENCE,
        precedence,
        {
            "Lexicon semantics": ("lexicon source catalog owns metric semantics",),
            "generated attestation": ("generated lexicon catalog and marker",),
            "Model metadata": (
                "model release owns review/publication metadata",
            ),
            "Persist executability": (
                "persist closed set and compiler own executability",
            ),
            "source mismatch": ("regenerate through lexicon",),
            "Model mismatch": ("stop the model proposal/publication",),
            "unsupported consumer": (
                "configuration, activation and materialization stay unsupported",
            ),
        },
    )


def assert_counts_are_not_contracts() -> None:
    forbidden_count_contracts = (
        "92 definitions",
        "92-id",
        "30 ids",
        "30-item",
        "all-92",
    )
    for relative in (PROMPT, SKILL, REFERENCE, CAPABILITY_MAP):
        value = normalized(read(relative))
        present = [term for term in forbidden_count_contracts if term in value]
        if present:
            raise AssertionError(
                f"{relative} hard-codes revision-specific metric counts as contract: {present}"
            )


def assert_prompt_and_capability_map() -> None:
    prompt = read(PROMPT)
    require_concepts(
        PROMPT,
        prompt,
        {
            "complete intent": ("grain/entity", "acceptance examples"),
            "read-only evidence": ("read-only evidence",),
            "canonical catalog": (
                "src/data/financial-metrics/payment-financial-metrics.v2.json",
            ),
            "actual shape": ("metrics[]", "qualifying_conditions"),
            "Model generated catalog": ('mode: "generated"',),
            "Model published catalog": ('mode: "published"',),
            "Persist compiler": ("paymentmetricdeclarativeplancompiler.ts",),
            "precedence": ("apply precedence fail closed",),
            "exact reuse": ("`exact reuse`",),
            "supported configuration": ("`supported configuration/composition`",),
            "new definition": ("`new definition/family`",),
            "generic lifecycle": ("generic model lifecycle",),
            "not applied boundary": ("application: not applied",),
            "new definition fail closed": ("fail closed before model submission",),
            "release read-back": ("release id", "release digest"),
            "no automatic activation": ("never activate automatically",),
        },
    )

    capability_map = read(CAPABILITY_MAP)
    require_concepts(
        CAPABILITY_MAP,
        capability_map,
        {
            "intent piece": ("`kpi-intent`",),
            "classification piece": ("`kpi-evidence-classification`",),
            "release piece": ("`kpi-governed-release`",),
            "canonical source": (
                "src/data/financial-metrics/payment-financial-metrics.v2.json",
            ),
            "generated catalog": ("generated base metrics",),
            "published catalog": ("published immutable lexicon catalog uri/digest",),
            "precedence": (
                "lexicon source → generated artifact → model reference → persist support",
            ),
            "not applied state": ("return `not applied`",),
            "activation separation": ("never activate automatically",),
        },
    )


def assert_skill_contract() -> None:
    skill = read(SKILL)
    require_concepts(
        SKILL,
        skill,
        {
            "business/finance boundary": (
                "business outcomes and finance measures",
            ),
            "intent discovery": ("ask focused questions",),
            "Lexicon schema evidence": ("lexicon schema",),
            "relationship evidence": ("directed relationships",),
            "consumer compiler evidence": (
                "lambda/services/paymentmetricdeclarativeplancompiler.ts",
            ),
            "canonical catalog": (
                "src/data/financial-metrics/payment-financial-metrics.v2.json",
            ),
            "generated release": (
                ".generated/financial-metrics-catalog/releases/<lexicon_version_id>/",
            ),
            "activation source": ("top-level `dev_activation_allowlist`",),
            "actual shape": ("qualifying_conditions", "materialization_plan"),
            "Model generated shape": ('mode="generated"',),
            "Model published shape": ('mode="published"',),
            "source precedence": ("pinned lexicon source owns metric semantics",),
            "Persist precedence": (
                "pinned persist code decides whether a definition is executable",
            ),
            "exact reuse": ("`exact reuse`",),
            "supported configuration": ("`supported configuration/composition`",),
            "new definition": ("`new definition/family`",),
            "exact IDs": ("return the exact metric ids",),
            "generic lifecycle": ("generic model lifecycle",),
            "adapter boundary": ("application: not applied",),
            "Lexicon gap": ("lexicon catalog source/type changes",),
            "Persist gap": ("persist supported-definition",),
            "release ID": ("release id",),
            "release digest": ("release digest",),
            "activation separation": ("never activate automatically",),
        },
    )


def assert_domain_boundary() -> None:
    forbidden = (
        "cloud" + "watch",
        "observability" + " metric",
    )
    for relative in (PROMPT, SKILL, REFERENCE, CAPABILITY_MAP):
        value = normalized(read(relative))
        present = [term for term in forbidden if term in value]
        if present:
            raise AssertionError(
                f"{relative} mixes platform telemetry terms into the KPI contract: {present}"
            )


def main() -> int:
    assert_intent_contract()
    assert_evidence_and_classification()
    assert_real_lifecycle_and_fail_closed_behavior()
    assert_canonical_metric_contract()
    assert_model_catalog_mapping_and_precedence()
    assert_counts_are_not_contracts()
    assert_prompt_and_capability_map()
    assert_skill_contract()
    assert_domain_boundary()
    print("model business/finance KPI guidance contract tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
