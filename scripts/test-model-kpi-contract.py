#!/usr/bin/env python3
"""Behavioral checks for Dialga/Jirachi business-metric ownership."""

from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DIALGA = "agents/dialga.md"
JIRACHI = "agents/jirachi.md"
BUILDER_SKILL = "skills/build-lexicon-product/SKILL.md"
BUILDER_REFERENCE = (
    "skills/build-lexicon-product/reference/business-financial-metric-catalogs.md"
)
CONFIGURER_SKILL = "skills/configure-model-product/SKILL.md"
CONFIGURER_REFERENCE = (
    "skills/configure-model-product/reference/kpi-to-metric-configuration.md"
)
CAPABILITY_MAP = "skills/guide-product-work/reference/iterations/model.md"

CONTRACT_FILES = (
    DIALGA,
    JIRACHI,
    BUILDER_SKILL,
    BUILDER_REFERENCE,
    CONFIGURER_SKILL,
    CONFIGURER_REFERENCE,
    CAPABILITY_MAP,
)


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def normalized(value: str) -> str:
    return " ".join(value.casefold().split())


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


def parse_agent(relative: str) -> tuple[dict[str, str], str]:
    text = read(relative).replace("\r\n", "\n").replace("\r", "\n")
    match = re.fullmatch(r"---\n(.*?)\n---\n(.*)", text, flags=re.DOTALL)
    if match is None:
        raise AssertionError(f"{relative} has malformed frontmatter")

    fields: dict[str, str] = {}
    for line in match.group(1).splitlines():
        key, separator, raw_value = line.partition(":")
        if not separator:
            raise AssertionError(f"{relative} has malformed frontmatter line: {line}")
        value = raw_value.strip()
        fields[key.strip()] = (
            json.loads(value)
            if value.startswith('"') and value.endswith('"')
            else value
        )
    return fields, match.group(2)


def assert_dialga_owns_metric_architecture() -> None:
    prompt = read(DIALGA)
    builder = read(BUILDER_SKILL)
    reference = read(BUILDER_REFERENCE)
    combined = "\n".join((prompt, builder, reference))

    require_concepts(
        DIALGA,
        prompt,
        {
            "architecture owner": ("own its reusable http api", "catalog architecture"),
            "builder reference": ("business-financial-metric-catalogs.md",),
            "Model implementation repository": ("prismteam-ai/model",),
            "coordinated Lexicon work": ("spring-oaks-capital-llc/lexicon",),
            "coordinated Persist work": ("spring-oaks-capital-llc/persist",),
            "configurer handoff": ("hand configuration-only work to `jirachi`",),
        },
    )
    require_concepts(
        BUILDER_REFERENCE,
        combined,
        {
            "canonical source": (
                "src/data/financial-metrics/payment-financial-metrics.v2.json",
            ),
            "type contract": ("scripts/lib/financial-metrics/types.ts",),
            "catalog contract": ("scripts/lib/financial-metrics/catalog.ts",),
            "materialization contract": (
                "scripts/lib/financial-metrics/materialization.ts",
            ),
            "release contract": ("scripts/lib/financial-metrics/release.ts",),
            "generated release": (
                ".generated/financial-metrics-catalog/releases/<lexicon_version_id>/",
            ),
            "approved marker": ("approved-release.json",),
            "discovery parameter": ("/lexicon/financial-metrics-catalog-uri",),
            "package identity": ("schema_version", "definition_set_digest"),
            "definition shape": (
                "metrics[]",
                "qualifying_conditions",
                "materialization_plan",
            ),
            "activation shape": ("dev_activation_allowlist.{profile,mode,metric_ids}",),
            "generated Model catalog": ('"mode": "generated"',),
            "published Model catalog": ('"mode": "published"',),
            "published URI": ('"artifactUri"',),
            "published digest": ('"digest": "sha256:',),
            "composition location": ("manifest.metriccatalogs[]",),
            "closed definition set": (
                "lambda/schemas/payment-metric-supported-definitions.ts",
            ),
            "compiler gate": (
                "lambda/services/paymentmetricdeclarativeplancompiler.ts",
            ),
            "catalog integrity": ("lambda/services/paymentmetriccatalogservice.ts",),
            "activation compatibility": (
                "lambda/payment-metric-prod-shadow-config.ts",
            ),
            "source precedence": (
                "pinned lexicon source package defines",
                "generated directory is publishable",
                "reviewed model release governs",
                "persist closed set and compiler decide",
            ),
            "runtime boundary": (
                "change `prismteam-ai/model`",
                "coordinate `spring-oaks-capital-llc/lexicon`",
                "coordinate `spring-oaks-capital-llc/persist`",
            ),
            "telemetry boundary": ("keep platform telemetry outside",),
        },
    )


def assert_jirachi_is_only_the_configurer() -> None:
    prompt = read(JIRACHI)
    skill = read(CONFIGURER_SKILL)
    reference = read(CONFIGURER_REFERENCE)
    combined = "\n".join((prompt, skill, reference))

    require_concepts(
        JIRACHI,
        prompt,
        {
            "intent elicitation": (
                "name and business question",
                "acceptance examples",
                "ask focused discovery questions",
            ),
            "reads Dialga contract": ("contracts defined by dialga",),
            "does not define architecture": ("do not define or invent",),
            "classification": (
                "`exact reuse`",
                "`supported configuration/composition`",
                "`new definition/family`",
            ),
            "supported lifecycle only": (
                "use only the discovered, existing model adapter",
            ),
            "builder handoff": ("hand the product gap to dialga",),
        },
    )
    require_concepts(
        CONFIGURER_REFERENCE,
        combined,
        {
            "canonical read location": (
                "src/data/financial-metrics/payment-financial-metrics.v2.json",
            ),
            "published read location": ("/lexicon/financial-metrics-catalog-uri",),
            "consumer read location": (
                "lambda/schemas/payment-metric-supported-definitions.ts",
                "lambda/services/paymentmetricdeclarativeplancompiler.ts",
            ),
            "adapter boundary": ("application: not applied",),
            "no unsupported submission": ("stop before model submission",),
            "architecture handoff": ("dialga owns the architecture",),
        },
    )

    architecture_definitions = (
        "generatorSourceAlias",
        "maximumPathHops",
        "Each `metrics[]` entry",
        "Dialga owns this architecture and keeps it synchronized",
    )
    present = [
        concept
        for concept in architecture_definitions
        if concept.casefold() in combined.casefold()
    ]
    if present:
        raise AssertionError(
            "Jirachi guidance still defines builder architecture: " + ", ".join(present)
        )


def assert_fail_closed_and_release_verification() -> None:
    configurer = "\n".join(
        (read(JIRACHI), read(CONFIGURER_SKILL), read(CONFIGURER_REFERENCE))
    )
    require_concepts(
        CONFIGURER_REFERENCE,
        configurer,
        {
            "fail closed": ("fail closed", "stop on a source"),
            "idempotent replay": ("idempotent replay",),
            "timeout recovery": ("timeout", "read-back"),
            "review gate": ("review", "authorized decision"),
            "release identity": ("release id", "release digest"),
            "artifact verification": ("source/artifact digest", "catalog artifact uri"),
            "no automatic activation": ("never activate automatically",),
            "publication boundary": ("publication does not activate",),
        },
    )


def assert_capability_map_ownership_split() -> None:
    capability_map = read(CAPABILITY_MAP)
    require_concepts(
        CAPABILITY_MAP,
        capability_map,
        {
            "builder contract piece": ("`metric-catalog-contract`",),
            "Dialga architecture ownership": (
                "dialga owns the schema",
                "implement model api/runtime",
            ),
            "Jirachi reads": ("jirachi reads this contract",),
            "Jirachi intent": ("jirachi collects",),
            "classification handoff": ("hand product/schema gaps to dialga",),
            "existing adapter only": ("jirachi may apply an existing adapter",),
            "release verification": ("verify release id/digest",),
            "no automatic activation": ("never activate automatically",),
        },
    )


def assert_prompt_synchronization() -> None:
    for agent in ("dialga", "jirachi"):
        source_path = f"agents/{agent}.md"
        copilot_path = f"agents-copilot/{agent}.agent.md"
        codex_path = f".codex/agents/{agent}.toml"

        source = read(source_path).replace("\r\n", "\n").replace("\r", "\n")
        copilot = read(copilot_path).replace("\r\n", "\n").replace("\r", "\n")
        if source != copilot:
            raise AssertionError(
                f"{copilot_path} is not synchronized with {source_path}"
            )

        fields, body = parse_agent(source_path)
        codex = tomllib.loads(read(codex_path))
        if codex.get("name") != fields["name"]:
            raise AssertionError(f"{codex_path} name is not synchronized")
        if codex.get("description") != fields["description"]:
            raise AssertionError(f"{codex_path} description is not synchronized")
        if codex.get("developer_instructions") != body:
            raise AssertionError(
                f"{codex_path} developer instructions are not synchronized"
            )


def assert_no_stale_counts_or_telemetry_content() -> None:
    stale_count = re.compile(
        r"\b\d+\s+(?:definitions|families|metric ids|metrics)\b",
        flags=re.IGNORECASE,
    )
    forbidden_domain_terms = ("cloud" + "watch",)

    for relative in CONTRACT_FILES:
        value = read(relative)
        match = stale_count.search(value)
        if match is not None:
            raise AssertionError(
                f"{relative} hard-codes a revision-specific metric count: {match.group(0)}"
            )
        normalized_value = normalized(value)
        present = [term for term in forbidden_domain_terms if term in normalized_value]
        if present:
            raise AssertionError(
                f"{relative} mixes platform telemetry into this contract: {present}"
            )


def main() -> int:
    assert_dialga_owns_metric_architecture()
    assert_jirachi_is_only_the_configurer()
    assert_fail_closed_and_release_verification()
    assert_capability_map_ownership_split()
    assert_prompt_synchronization()
    assert_no_stale_counts_or_telemetry_content()
    print("Dialga/Jirachi business-metric ownership contract tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
