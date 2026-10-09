#!/usr/bin/env python3
"""Contract tests for Model-owned metric definitions and Persist execution."""

from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DIALGA = ROOT / "agents" / "dialga.md"
JIRACHI = ROOT / "agents" / "jirachi.md"
BUILD_SKILL = ROOT / "skills" / "build-lexicon-product" / "SKILL.md"
CONFIGURE_SKILL = ROOT / "skills" / "configure-model-product" / "SKILL.md"
KPI_REFERENCE = (
    ROOT
    / "skills"
    / "configure-model-product"
    / "reference"
    / "kpi-to-metric-configuration.md"
)
MODEL_ITERATIONS = (
    ROOT / "skills" / "guide-product-work" / "reference" / "iterations" / "model.md"
)
PRODUCT_CATALOG = (
    ROOT
    / "skills"
    / "guide-product-work"
    / "reference"
    / "product-catalog.json"
)
PRD = ROOT / "skills" / "build-lexicon-product" / "reference" / "PRD.md"
TEST_DATA = (
    ROOT / "skills" / "build-lexicon-product" / "reference" / "test-data.md"
)


def read(path: Path) -> str:
    if not path.is_file():
        raise AssertionError(f"missing contract file: {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


class ModelMetricMaterializationContractTests(unittest.TestCase):
    def test_agents_and_skills_load_the_kpi_workflow(self) -> None:
        for path in (DIALGA, JIRACHI, BUILD_SKILL, CONFIGURE_SKILL):
            with self.subTest(path=path.relative_to(ROOT)):
                text = read(path)
                self.assertIn("kpi-to-metric-configuration.md", text.lower())

    def test_configurer_is_question_led_and_rejects_cartesian_generation(self) -> None:
        corpus = "\n".join(
            read(path) for path in (JIRACHI, CONFIGURE_SKILL, KPI_REFERENCE)
        )
        for token in (
            "business/report question",
            "source ledger",
            "VALID",
            "NEEDS_BUSINESS_RULE",
            "REJECTED",
            "Cannot Be Generated",
            "numeric",
            "enum",
            "path",
            "canonical attribution",
            "once-only",
        ):
            with self.subTest(token=token):
                self.assertIn(token.casefold(), corpus.casefold())

        self.assertIn(
            "Do not generate every numeric property × enum property × graph path",
            corpus,
        )

    def test_kpi_capability_is_data_model_driven_and_delivers_metrics(self) -> None:
        corpus = "\n".join(
            read(path) for path in (DIALGA, JIRACHI, CONFIGURE_SKILL, KPI_REFERENCE)
        )
        for token in (
            "any governed data model",
            "not finance-specific",
            "entity",
            "relationship",
            "numeric-property",
            "enum-member",
            "current/as-of",
            "Deliver approved metrics",
            "SUGGESTED",
            "DELIVERED",
            "MATERIALIZED",
            "artifact URI and",
            "digest",
        ):
            with self.subTest(token=token):
                self.assertIn(token.casefold(), corpus.casefold())
        self.assertIn("reference example, not the scope boundary", corpus)

    def test_reference_records_current_lexicon_catalog_contract(self) -> None:
        text = read(KPI_REFERENCE)
        for token in (
            "src/data/financial-metrics/payment-financial-metrics.v2.json",
            "scripts/lib/financial-metrics/",
            "/lexicon/financial-metrics-catalog-uri",
            "payment.current_status.nsf.amount.sum",
            "payment.status.nsf.event_count",
            "metric_definition",
            "metric_period",
            "metric_cell",
            "FULL_HISTORY",
            "FORWARD_ONLY",
            "value = operation(C)",
            "physical identity additionally includes the Persist generation",
        ):
            with self.subTest(token=token):
                self.assertIn(token, text)

    def test_reference_covers_time_scope_and_historical_attribution(self) -> None:
        text = read(KPI_REFERENCE)
        for token in (
            "EVENT_FLOW",
            "LATEST_STATE",
            "AS_OF_SNAPSHOT",
            "CUMULATIVE_VALUE",
            "DEBT",
            "GLOBAL",
            "DAY",
            "MONTH",
            "QUARTER",
            "YEAR",
            "company_represents_debt",
            "debt_has_payment",
            "business time",
        ):
            with self.subTest(token=token):
                self.assertIn(token, text)
        self.assertIn("cannot prove historical DSA attribution", text)
        self.assertIn("Do not derive a month, quarter, or year", text)

    def test_model_and_persist_ownership_is_explicit(self) -> None:
        builder = "\n".join(read(path) for path in (DIALGA, BUILD_SKILL, PRD))
        configurer = "\n".join(read(path) for path in (JIRACHI, CONFIGURE_SKILL))
        for token in (
            "Neptune Streams",
            "recomputation",
            "mutable",
            "rebuild",
            "activation/rollback",
            "search",
        ):
            with self.subTest(token=token):
                self.assertIn(token.casefold(), builder.casefold())
                self.assertIn(token.casefold(), configurer.casefold())
        self.assertIn("Model owns", builder)
        self.assertIn("Persist owns", read(PRD))
        self.assertIn("Publication must not", builder)

    def test_capability_map_separates_business_and_observability_metrics(self) -> None:
        text = read(MODEL_ITERATIONS)
        for feature_id in (
            "business-kpi-discovery",
            "metric-materialization-validation",
            "metric-materialization-publication",
            "observability-metric-definitions",
        ):
            with self.subTest(feature_id=feature_id):
                self.assertIn(f"`{feature_id}`", text)

    def test_fixture_matrix_exercises_metric_semantics_without_runtime_claims(self) -> None:
        text = read(TEST_DATA)
        for token in (
            "Business KPI discovery",
            "Metric materialization validation",
            "Metric materialization delivery",
            "Observability metric definitions",
            "transition into and then out",
            "mixed-currency",
            "one non-financial model",
            "do not define a replacement wire schema",
        ):
            with self.subTest(token=token):
                self.assertIn(token, text)

    def test_product_catalog_preserves_the_ownership_boundary(self) -> None:
        catalog = json.loads(PRODUCT_CATALOG.read_text(encoding="utf-8"))
        products = {product["id"]: product for product in catalog["products"]}
        model = json.dumps(products["model"], sort_keys=True)
        persist = json.dumps(products["persist"], sort_keys=True)

        for token in (
            "metric-materialization",
            "closed-plan",
            "publication",
            "does not activate",
            "any governed data model",
            "suggest",
            "deliver",
        ):
            with self.subTest(product="model", token=token):
                self.assertIn(token, model)
        for token in (
            "plan compilation",
            "Neptune Streams",
            "mutable",
            "rebuilds",
            "activation/rollback",
            "search",
        ):
            with self.subTest(product="persist", token=token):
                self.assertIn(token, persist)


if __name__ == "__main__":
    unittest.main()
