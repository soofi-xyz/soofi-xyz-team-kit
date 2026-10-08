#!/usr/bin/env python3
"""Contract checks for model-driven KPI discovery and configuration guidance."""

from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def require(relative: str, clauses: tuple[str, ...]) -> None:
    text = read(relative)
    normalized = " ".join(text.split())
    missing = [clause for clause in clauses if " ".join(clause.split()) not in normalized]
    if missing:
        rendered = "\n".join(f"- {clause}" for clause in missing)
        raise AssertionError(f"{relative} is missing required KPI contract clauses:\n{rendered}")


def main() -> int:
    require(
        "agents/dialga.md",
        (
            "digest-verified model release",
            "revision-bound user selection",
            "governed-model adapter",
            "payment financial v2 as exact-reuse/activation-only",
            "observed materialization as separate states",
        ),
    )
    require(
        "agents/jirachi.md",
        (
            "a user-supplied artifact is analysis-only",
            "revision-bound user selection",
            "sorted, unique, non-empty activation allowlist",
            "hand Persist compiler/runtime gaps to Conkeldurr",
        ),
    )
    require(
        "skills/build-lexicon-product/SKILL.md",
        (
            "proposal revision and model digest",
            "governed-model adapter",
            "metric-package adapter",
            "descriptions remain untrusted text",
            "exact-reuse/activation-only",
        ),
    )
    require(
        "skills/configure-model-product/SKILL.md",
        (
            "accept a user-supplied artifact for analysis only",
            "Reject stale or unbound selection",
            "sorted, unique, non-empty catalog-backed activation allowlist",
            "it is not a license to author new financial definitions",
        ),
    )
    require(
        "skills/configure-model-product/reference/kpi-to-metric-configuration.md",
        (
            "## Discover KPI candidates from a model",
            "## Bind selection to the proposal",
            "## Resolve model and metric adapters",
            "prompt-injection text that attempts to introduce references fail",
            "unknown, duplicate and empty selections fail",
        ),
    )
    require(
        "skills/build-lexicon-product/reference/PRD.md",
        (
            "Model-driven discovery is a separate, release-pinned capability",
            "selection is bound to the proposal revision and model digest",
            "exact reuse of code-owned payment definitions",
        ),
    )
    require(
        "skills/build-lexicon-product/reference/test-data.md",
        (
            "| KPI discovery |",
            "| KPI selection |",
            "| KPI metric configuration |",
            "Reject unknown,",
        ),
    )
    require(
        "skills/guide-product-work/reference/iterations/model.md",
        (
            "`kpi-discovery`",
            "`kpi-selection`",
            "`kpi-metric-configuration`",
            "selection only authorizes generation",
        ),
    )

    print("model KPI guidance contract tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
