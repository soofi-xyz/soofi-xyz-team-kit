#!/usr/bin/env python3
"""Behavioral checks for Dialga/Jirachi business-metric ownership."""

from __future__ import annotations

import json
import os
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
MODEL_PRD = "skills/build-lexicon-product/reference/PRD.md"
JIRACHI_VARIANTS = (
    JIRACHI,
    "agents-copilot/jirachi.agent.md",
)
JIRACHI_CODEX = ".codex/agents/jirachi.toml"
JIRACHI_SCOPE = (
    "vocabulary lookup",
    "candidate validation",
    "governed changes",
    "ruleset definitions",
    "mapping registrations",
    "metric definitions",
    "kpi configuration",
    "versioned releases",
)

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
                "`in-family variant draft`",
                "`new family/capability`",
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


def require_all(relative: str, value: str, phrases: dict[str, str]) -> None:
    require_concepts(
        relative, value, {name: (phrase,) for name, phrase in phrases.items()}
    )


def assert_jirachi_drafts_in_family_variants() -> None:
    require_all(
        JIRACHI,
        read(JIRACHI),
        {
            "drafts in-family entries": "draft the new lexicon `metrics[]` entry",
            "exact existing shape": "copying the exact field shape of a sibling",
            "read-only validation": "validate read-only that its family",
            "compiler gates": "pass persist's compiler gates",
            "Lexicon review flow": "lexicon's normal review and release flow",
            "no direct writes": "never direct s3/ssm edits",
            "no activation": "never auto-activation",
            "closed-set prerequisite": "persist's closed id set must add the new id",
            "new families fail closed": "for a new family, new measure",
            "builder handoff": "hand the product gap to dialga",
        },
    )
    require_all(
        CONFIGURER_REFERENCE,
        "\n".join((read(CONFIGURER_REFERENCE), read(CONFIGURER_SKILL))),
        {
            "draft classification": "`in-family variant draft`",
            "new family classification": "`new family/capability`",
            "same-family sibling": "same `family_id`",
            "exact shape copy": "exact keys and value shapes",
            "generated plan": "omit `materialization_plan`",
            "compiler source": "paymentmetricdeclarativeplancompiler.ts",
            "metric-id prefix gate": "metric_id` starts with the family's prefix",
            "business-time gate": "business_time_property` is supported",
            "dimension gate": "known selector with exactly one matching string-equality",
            "condition gate": "enum value is in the compiler's supported sets",
            "election gate": "family's supported strategy",
            "gate failure fails closed": "any failure is `new family/capability`",
            "whole-catalog consumer risk": "one unknown id fails the whole catalog load",
            "no activation": "keep `dev_activation_allowlist` unchanged",
            "no direct writes": "never as a model request or direct s3/ssm edit",
        },
    )
    require_all(
        BUILDER_REFERENCE,
        read(BUILDER_REFERENCE),
        {
            "Jirachi draft boundary": "jirachi may draft an in-family variant",
            "Dialga owns new families": "dialga owns everything else, including new families",
            "closed-set coordination": "dialga coordinates that persist change",
        },
    )
    require_all(
        DIALGA,
        read(DIALGA),
        {
            "Jirachi drafts variants": "jirachi drafts in-family `metrics[]` variants",
            "Dialga owns new families": "dialga owns new families, new measures",
        },
    )


def assert_catalog_reference_needs_definitions() -> None:
    expectations = {
        JIRACHI: {
            "definitions required": "at least one `definitions[]` entry",
            "full package revision": "rides on a full package revision",
            "Persist reads Lexicon SSM": (
                "persist resolves the catalog through "
                "`/lexicon/financial-metrics-catalog-uri`, not model releases"
            ),
            "governance metadata": "governance metadata",
        },
        CONFIGURER_REFERENCE: {
            "definitions required": "at least one `definitions[]`",
            "schema name": "compositioncontractdocumentschema",
            "schema source": "src/domain/schemas.ts",
            "cannot submit alone": "cannot be submitted alone",
            "Persist reads Lexicon SSM": "not from model releases",
            "governance metadata": "governance metadata",
        },
        BUILDER_REFERENCE: {
            "definitions required": "at least one entry",
            "cannot submit alone": "cannot be submitted on its own",
            "Persist deploy-time resolution": "at deploy time",
            "governance metadata": "governance metadata",
        },
    }
    for relative, phrases in expectations.items():
        require_all(relative, read(relative), phrases)


NON_FINANCE_VERTICES: dict[str, dict[str, tuple[str, ...]]] = {
    "debt": {"debt_identifier": ()},
    "phone_call": {
        "interaction_identifier": (),
        "direction": ("INBOUND", "OUTBOUND"),
    },
}
NON_FINANCE_EDGES: dict[str, tuple[str, str, dict[str, tuple[str, ...]]]] = {
    "company_represents_debt": (
        "company",
        "debt",
        {"company_type": (), "status": ("ACTIVE", "DELETED"), "effective_at": ()},
    ),
    "debt_has_phone_call": ("debt", "phone_call", {"created_at": ()}),
    "phone_call_status_changed": (
        "phone_call",
        "phone_call",
        {
            "status": ("ATTEMPTED", "ANSWERED", "NO_ANSWER"),
            "duration": (),
            "effective_at": (),
        },
    ),
    "phone_call_contact_identified": (
        "phone_call",
        "phone_call",
        {"phone_contact_type": ("RIGHT_PARTY",), "effective_at": ()},
    ),
}


def assert_jirachi_derives_suggestions_from_model() -> None:
    sources = {
        JIRACHI: read(JIRACHI),
        CONFIGURER_SKILL: read(CONFIGURER_SKILL),
        CONFIGURER_REFERENCE: read(CONFIGURER_REFERENCE),
    }
    for relative, value in sources.items():
        require_all(
            relative,
            value,
            {
                "Model-derived suggestions": "model itself",
                "governed release read": "release_id=current",
                "definition reads": "listdefinitions",
                "runtime vocabulary read": "getreleasepersistlexicon",
                "verified OpenAPI": "contracts/openapi.yaml",
                "Lexicon schema fallback": "src/data/lexicon.json",
                "anchor entity": "anchor entity",
                "relationship path": "hop count",
                "business time": "business-time property",
                "ranked candidates": "ranked list of candidate metric definitions",
                "existing shape": "existing metric configuration shape"
                if relative == JIRACHI
                else "metrics[]",
                "no live graph": "live graph",
            },
        )
    require_all(
        CONFIGURER_REFERENCE,
        sources[CONFIGURER_REFERENCE],
        {
            "per-suggestion graph path": "graph path with relationship direction and hop count",
            "data-quality caveats": "data-quality caveats",
            "alternative formulations": "leading/lagging or alternative formulations",
            "why it answers": "why it answers the kpi",
            "format template": "as the format template for any domain",
            "shape gap": "mark that part as a dialga gap",
        },
    )


def assert_suggestions_not_restricted_to_finance() -> None:
    for relative in (JIRACHI, CONFIGURER_SKILL, CONFIGURER_REFERENCE):
        value = read(relative)
        require_all(
            relative,
            value,
            {
                "finance is one example": "one existing example of the metric configuration shape"
                if relative != CONFIGURER_REFERENCE
                else "one example of the metric",
                "not the universe": "not the universe of suggestions",
                "any domain": "any domain",
            },
        )
    require_all(
        JIRACHI,
        read(JIRACHI),
        {"not restricted": "suggestions are not restricted to the finance catalog"},
    )
    stale_anchors = (
        "## Configure a business or finance KPI",
        "verify the current payment source",
        "Read and verify existing contracts",
    )
    for relative in (JIRACHI, CONFIGURER_SKILL, CONFIGURER_REFERENCE, CAPABILITY_MAP):
        value = normalized(read(relative))
        present = [phrase for phrase in stale_anchors if normalized(phrase) in value]
        if present:
            raise AssertionError(
                f"{relative} still anchors Jirachi on the finance catalog: {present}"
            )


def assert_no_invented_elements() -> None:
    for relative in (JIRACHI, CONFIGURER_SKILL, CONFIGURER_REFERENCE):
        require_all(
            relative,
            read(relative),
            {
                "grounded only": "grounded only in elements",
                "never invent": "never invent entities, edges",
                "vocabulary gap": "model/vocabulary gap",
            },
        )
    require_all(
        BUILDER_REFERENCE,
        read(BUILDER_REFERENCE),
        {
            "Dialga adopts proposals": "dialga decides whether to adopt them",
            "no invented vocabulary": "invent a vocabulary element",
        },
    )


def assert_per_suggestion_executability() -> None:
    proposal = "governed proposal — needs dialga for runtime/consumer support"
    for relative in (JIRACHI, CONFIGURER_SKILL, CONFIGURER_REFERENCE):
        require_all(
            relative,
            read(relative),
            {
                "per suggestion": "per suggestion",
                "executable class": "executable today"
                if relative != CONFIGURER_SKILL
                else "can execute",
                "proposal class": proposal,
                "compiler source": "paymentmetricdeclarativeplancompiler.ts",
            },
        )
    require_concepts(
        CONFIGURER_REFERENCE,
        "\n".join(read(r) for r in (JIRACHI, CONFIGURER_SKILL, CONFIGURER_REFERENCE)),
        {
            "executability does not limit suggestions": (
                "never limits what jirachi suggests",
                "never used to narrow what jirachi suggests",
            ),
        },
    )
    require_all(
        CONFIGURER_REFERENCE,
        read(CONFIGURER_REFERENCE),
        {"return field": "executability: executable today | governed proposal"},
    )


def assert_non_finance_example() -> None:
    reference = read(CONFIGURER_REFERENCE)
    marker = "### Non-finance:"
    finance_marker = "### Finance:"
    if marker not in reference or finance_marker not in reference:
        raise AssertionError(
            f"{CONFIGURER_REFERENCE} needs both a non-finance and a finance worked example"
        )
    example = reference[reference.index(marker) : reference.index(finance_marker)]
    names = (
        set(NON_FINANCE_VERTICES)
        | set(NON_FINANCE_EDGES)
        | {prop for props in NON_FINANCE_VERTICES.values() for prop in props}
        | {prop for _, _, props in NON_FINANCE_EDGES.values() for prop in props}
        | {
            value
            for props in NON_FINANCE_VERTICES.values()
            for values in props.values()
            for value in values
        }
        | {
            value
            for _, _, props in NON_FINANCE_EDGES.values()
            for values in props.values()
            for value in values
        }
    )
    missing = sorted(name for name in names if name not in example)
    if missing:
        raise AssertionError(
            f"{CONFIGURER_REFERENCE} non-finance example lacks elements: {missing}"
        )
    require_all(
        CONFIGURER_REFERENCE,
        example,
        {
            "classified": "`new family/capability`",
            "executability": "governed proposal — needs dialga",
            "ranked": "ranked suggestions",
            "caveats": "caveats",
        },
    )
    if re.search(r"\bpayment_\w+", example):
        raise AssertionError("non-finance example must not depend on payment elements")

    lexicon_path = os.environ.get("MODEL_KPI_LEXICON_JSON")
    if lexicon_path:
        assert_example_elements_exist(json.loads(Path(lexicon_path).read_text()))


def assert_example_elements_exist(lexicon: dict) -> None:
    vertices = {vertex["type"]: vertex for vertex in lexicon["vertices"]}
    edges = {edge["type"]: edge for edge in lexicon["edges"]}

    def check_properties(owner: str, declared: dict, expected: dict) -> None:
        for prop, values in expected.items():
            if prop not in declared:
                raise AssertionError(f"lexicon {owner} has no property {prop}")
            enum = set(declared[prop].get("enum", ()))
            unknown = sorted(set(values) - enum)
            if unknown:
                raise AssertionError(
                    f"lexicon {owner}.{prop} lacks enum values {unknown}"
                )

    for name, props in NON_FINANCE_VERTICES.items():
        if name not in vertices:
            raise AssertionError(f"lexicon has no vertex {name}")
        check_properties(name, vertices[name]["properties"], props)
    for name, (source, target, props) in NON_FINANCE_EDGES.items():
        edge = edges.get(name)
        if edge is None:
            raise AssertionError(f"lexicon has no edge {name}")
        if (edge["from"], edge["to"]) != (source, target):
            raise AssertionError(f"lexicon edge {name} direction differs")
        check_properties(name, edge["properties"], props)


def assert_jirachi_description_scope() -> None:
    descriptions = {
        relative: parse_agent(relative)[0]["description"]
        for relative in JIRACHI_VARIANTS
    }
    descriptions[JIRACHI_CODEX] = tomllib.loads(read(JIRACHI_CODEX))["description"]
    for relative, description in descriptions.items():
        require_concepts(
            relative,
            description,
            {term: (term,) for term in JIRACHI_SCOPE}
            | {
                "builder handoff": ("use dialga",),
                "new families": ("new metric families",),
            },
        )


def assert_model_prd_has_no_platform_telemetry() -> None:
    prd = read(MODEL_PRD)
    if ("cloud" + "watch") in prd.casefold():
        raise AssertionError(f"{MODEL_PRD} still contains platform telemetry metrics")
    require_concepts(
        MODEL_PRD,
        prd,
        {
            "financial catalog parameter": ("/lexicon/financial-metrics-catalog-uri",),
            "financial catalog contract": ("business-financial-metric-catalogs.md",),
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
            "classification handoff": (
                "hand product/schema gaps and new families to dialga",
            ),
            "in-family draft": (
                "in-family variant draft",
                "draft the lexicon `metrics[]` entry in the existing shape",
            ),
            "catalog reference needs definitions": (
                "at least one `definitions[]` entry",
            ),
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
    assert_jirachi_drafts_in_family_variants()
    assert_catalog_reference_needs_definitions()
    assert_jirachi_derives_suggestions_from_model()
    assert_suggestions_not_restricted_to_finance()
    assert_no_invented_elements()
    assert_per_suggestion_executability()
    assert_non_finance_example()
    assert_jirachi_description_scope()
    assert_model_prd_has_no_platform_telemetry()
    assert_capability_map_ownership_split()
    assert_prompt_synchronization()
    assert_no_stale_counts_or_telemetry_content()
    print("Dialga/Jirachi business-metric ownership contract tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
