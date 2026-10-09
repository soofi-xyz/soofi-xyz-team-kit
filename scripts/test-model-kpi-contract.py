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


def assert_current_finance_boundary() -> None:
    family = section(REFERENCE, "Select an executable family")
    require_concepts(
        REFERENCE,
        family,
        {
            "catalog contract": ("financial-metrics-catalog/v2",),
            "92 definitions": ("92 definitions",),
            "30 selected IDs": ("contains 30 ids",),
            "closed Persist list": ("payment-metric-supported-definitions.ts",),
            "unsupported ID rejection": ("rejects any other metric id",),
            "activation distinct": ("separate release-owned selection",),
        },
    )


def assert_prompt_and_capability_map() -> None:
    prompt = read(PROMPT)
    require_concepts(
        PROMPT,
        prompt,
        {
            "complete intent": ("grain/entity", "acceptance examples"),
            "read-only evidence": ("read-only evidence",),
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
            "current API boundary": ("no automatic graph-inspection operation",),
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
                "persist supported-definition/compiler contract",
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
    assert_current_finance_boundary()
    assert_prompt_and_capability_map()
    assert_skill_contract()
    assert_domain_boundary()
    print("model business/finance KPI guidance contract tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
