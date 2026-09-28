#!/usr/bin/env python3
"""Contract tests for skills/build-system-product and the zygarde agent.

Run standalone from the plugin repo root:

    python3 scripts/test-build-system-product-contract.py
"""

from __future__ import annotations

import importlib.util
import json
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parent.parent
SKILL_DIR = ROOT / "skills" / "build-system-product"
EXAMPLE_DIR = SKILL_DIR / "reference" / "examples" / "sale-availability"
MANIFEST_NAME = "system.manifest.json"

_spec = importlib.util.spec_from_file_location("check_system_manifest", ROOT / "scripts" / "check-system-manifest.py")
checker = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(checker)

Mutation = Callable[[Path, dict], None]


def fail(message: str) -> None:
    raise AssertionError(message)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, document: Any) -> None:
    path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")


def edit_emit(package: Path, relative: str, change: Callable[[dict], None]) -> None:
    path = package / relative
    document = read_json(path)
    change(document)
    write_json(path, document)


def errors_after(mutate: Mutation) -> list[str]:
    with tempfile.TemporaryDirectory() as tmp:
        package = Path(tmp) / "sale-availability"
        shutil.copytree(EXAMPLE_DIR, package)
        manifest_path = package / MANIFEST_NAME
        manifest = read_json(manifest_path)
        mutate(package, manifest)
        write_json(manifest_path, manifest)
        return checker.check_manifest(manifest_path)


def assert_rejects(label: str, mutate: Mutation, expected: str) -> None:
    errors = errors_after(mutate)
    if not any(expected in error for error in errors):
        fail(f"{label}: expected an error containing {expected!r}, got {errors}")


def assert_accepts(label: str, mutate: Mutation) -> None:
    errors = errors_after(mutate)
    if errors:
        fail(f"{label}: expected no errors, got {errors}")


def step(manifest: dict, step_id: str) -> dict:
    return next(item for item in manifest["workflow"] if item["id"] == step_id)


def assert_worked_example() -> None:
    errors = checker.check_manifest(EXAMPLE_DIR / MANIFEST_NAME)
    if errors:
        fail(f"worked example must validate: {errors}")
    manifest = read_json(EXAMPLE_DIR / MANIFEST_NAME)
    products = {item["product"] for item in manifest["products"]}
    for product in ("product-orchestration", "lexicon", "connect", "transform", "deploy"):
        if product not in products:
            fail(f"worked example must compose {product}")
    emitted = {path.parent.name for path in (EXAMPLE_DIR / "emits").glob("*/*")}
    for layer in ("product", "lexicon", "connect", "transform", "deploy"):
        if layer not in emitted:
            fail(f"worked example must ship emits/{layer}/ drafts")


def assert_schema_rejections() -> None:
    assert_rejects("missing successCriteria", lambda _p, m: m.pop("successCriteria"), "'successCriteria' is a required property")
    assert_rejects("empty successCriteria", lambda _p, m: m.update(successCriteria=[]), "should be non-empty")
    assert_rejects("missing dependencies", lambda _p, m: m.pop("dependencies"), "'dependencies' is a required property")
    assert_rejects("unversioned", lambda _p, m: m.pop("contractVersion"), "'contractVersion' is a required property")
    assert_rejects("future version", lambda _p, m: m.update(contractVersion=2), "1 was expected")
    assert_rejects(
        "activation enabled",
        lambda _p, m: m["deploy"].update(activationEnabled=True),
        "False was expected",
    )
    assert_rejects(
        "unpinned-looking digest",
        lambda _p, m: m["configRefs"]["lexiconCatalog"].update(digest="latest"),
        "does not match",
    )


def assert_reference_resolution() -> None:
    assert_rejects(
        "unknown workflow configRef",
        lambda _p, m: step(m, "translate").update(configRef="missing"),
        "configRef 'missing' does not exist in configRefs",
    )
    assert_rejects(
        "undeclared workflow product",
        lambda _p, m: m.update(products=[p for p in m["products"] if p["product"] != "deploy"]),
        "product 'deploy' is not declared in products",
    )
    assert_rejects(
        "unused product",
        lambda _p, m: m["products"].append({"product": "persist", "role": "configure"}),
        "'persist' has role 'configure' but no workflow step uses it",
    )
    assert_accepts(
        "reference-only product may be unused",
        lambda _p, m: m["products"].append({"product": "persist", "role": "reference-only"}),
    )
    assert_rejects(
        "agent does not own ref",
        lambda _p, m: step(m, "translate").update(agent="lapras"),
        "agent 'lapras' does not own configRef 'transformRequest'",
    )
    assert_rejects(
        "ref kind belongs to another product",
        lambda _p, m: step(m, "translate").update(configRef="connectPartner", agent="lapras"),
        "belongs to 'connect', not 'transform'",
    )
    assert_rejects(
        "duplicate workflow id",
        lambda _p, m: step(m, "translate").update(id="publish-lexicon"),
        "duplicate id 'publish-lexicon'",
    )
    assert_rejects(
        "missing emit file",
        lambda p, _m: (p / "emits" / "transform" / "request.stub.json").unlink(),
        "does not resolve to a file next to the manifest",
    )
    assert_rejects(
        "path escapes package",
        lambda _p, m: m["configRefs"]["transformRequest"].update(path="../other/request.json"),
        "must stay inside the composition package",
    )
    assert_rejects(
        "remote ref without digest",
        lambda _p, m: m["configRefs"]["lexiconCatalog"].update(path="s3://lexicon/transform-catalog.json"),
        "must be pinned with a digest",
    )
    def remote_lexicon(p: Path, m: dict) -> None:
        (p / "emits" / "lexicon" / "catalog.stub.json").unlink()
        m["configRefs"]["lexiconCatalog"].update(path="s3://lexicon/transform-catalog.json", digest="sha256:" + "a" * 64)

    assert_accepts("remote ref with digest", remote_lexicon)
    def orphan_persist(p: Path, _m: dict) -> None:
        (p / "emits" / "persist").mkdir()
        (p / "emits" / "persist" / "collections.stub.md").write_text("# Persist\n", encoding="utf-8")

    assert_rejects(
        "emit file no configRef points to",
        orphan_persist,
        "emits/persist/collections.stub.md is emitted but no configRef points to it",
    )

    def declared_persist(p: Path, m: dict) -> None:
        orphan_persist(p, m)
        m["products"].append({"product": "persist", "role": "execute"})
        m["configRefs"]["persistCollection"] = {
            "kind": "persist-collection",
            "path": "emits/persist/collections.stub.md",
            "ownerAgent": "conkeldurr",
        }
        m["workflow"].append(
            {"id": "load-collection", "product": "persist", "configRef": "persistCollection", "agent": "conkeldurr", "gate": "collection-contract-agreed"}
        )

    assert_accepts("Persist declared as product, configRef and workflow step", declared_persist)
    assert_rejects(
        "bad repository",
        lambda _p, m: m["dependencies"]["repos"].append("not a repo"),
        "is not an owner/name repository",
    )
    assert_rejects(
        "bad env var",
        lambda _p, m: m["dependencies"]["env"].append({"name": "lexicon-root", "purpose": "x"}),
        "is not an UPPER_SNAKE env var",
    )


def assert_orchestration_rules() -> None:
    assert_rejects(
        "serve without product flow",
        lambda _p, m: (m["configRefs"].pop("productFlow"), m.update(workflow=[s for s in m["workflow"] if s["configRef"] != "productFlow"])),
        "no product-flow ref is declared",
    )
    assert_rejects(
        "waterfall mode without waterfall ref",
        lambda _p, m: m["orchestration"].update(invocationMode="waterfall"),
        "requires a product-waterfall ref",
    )
    assert_rejects(
        "product-service mode without Product",
        lambda _p, m: (
            m.update(products=[p for p in m["products"] if p["product"] != "product-orchestration"]),
            m.update(workflow=[s for s in m["workflow"] if s["product"] != "product-orchestration"]),
        ),
        "requires product-orchestration",
    )

    def thin_package(criteria_deferred: bool) -> Mutation:
        def mutate(_p: Path, m: dict) -> None:
            m["orchestration"]["mode"] = "thin-package-deferred"
            m["products"].append({"product": "system-runtime", "role": "serve"})
            m["configRefs"]["openapi"] = {"kind": "system-openapi", "path": "emits/product/invocation.contract.md", "ownerAgent": "zygarde"}
            m["workflow"].append({"id": "thin-serve", "product": "system-runtime", "configRef": "openapi", "agent": "zygarde", "gate": "fixtures-served"})
            if not criteria_deferred:
                for item in m["successCriteria"]:
                    item["verify"] = "manual"

        return mutate

    assert_accepts("thin package with deferred Product cutover", thin_package(True))
    assert_rejects("thin package without deferred cutover", thin_package(False), "deferred criterion naming the Product cutover")
    for label, text in (
        ("jdbc", "jdbc:postgresql://db/elephant"),
        ("spark sql", "select parcel_id from sales"),
        ("secret arn", "arn:aws:secretsmanager:us-east-1:1:secret:x"),
    ):
        assert_rejects(
            f"forbidden {label} in manifest",
            lambda _p, m, text=text: m["deploy"].update(notes=text),
            "keep it in the owning product's config",
        )


def assert_emit_contracts() -> None:
    assert_rejects(
        "flow without template",
        lambda p, _m: edit_emit(p, "emits/product/product-flows/default.stub.json", lambda d: d.pop("flow_template_name")),
        "product flow must set flow_template_name",
    )
    assert_rejects(
        "flow names unknown template",
        lambda p, _m: edit_emit(p, "emits/product/product-flows/default.stub.json", lambda d: d.update(flow_template_name="other")),
        "does not match an emitted flow template",
    )
    assert_rejects(
        "template transition to unknown state",
        lambda p, _m: edit_emit(
            p,
            "emits/product/flow-templates/sale_availability_lookup.stub.json",
            lambda d: d["definition"]["States"]["ResolveSaleAvailability"].update(Next="Nowhere"),
        ),
        "transition to unknown state 'Nowhere'",
    )
    assert_rejects(
        "product definition name mismatch",
        lambda p, _m: edit_emit(p, "emits/product/product.definition.stub.json", lambda d: d.update(name="other")),
        "does not match 'sale-availability'",
    )
    assert_rejects(
        "transform request breaks Transform contract",
        lambda p, _m: edit_emit(p, "emits/transform/request.stub.json", lambda d: d.update(contractVersion=1)),
        "transform-request contract",
    )
    assert_rejects(
        "transform pair without Lexicon mapping",
        lambda p, _m: edit_emit(p, "emits/transform/request.stub.json", lambda d: d.update(to="other-language")),
        "no emitted Lexicon mapping for 'county-sales' -> 'other-language'",
    )
    assert_rejects(
        "connect activation breaks Connect contract",
        lambda p, _m: edit_emit(p, "emits/connect/activation.stub.json", lambda d: d.pop("subscriber")),
        "connect-activation contract",
    )
    assert_rejects(
        "connect activation enabled while deploy inactive",
        lambda p, _m: edit_emit(p, "emits/connect/activation.stub.json", lambda d: d.update(enabled=True)),
        "activation is enabled while deploy.activationEnabled is false",
    )
    assert_rejects(
        "connect activation references unknown partner",
        lambda p, _m: edit_emit(p, "emits/connect/activation.stub.json", lambda d: d.update(configuration_id="someone-else")),
        "matches no emitted partner",
    )
    assert_rejects(
        "deploy component references unknown ref",
        lambda p, _m: edit_emit(p, "emits/deploy/environment.stub.json", lambda d: d["components"][0]["refs"].append("ghost")),
        "component ref 'ghost' does not exist in configRefs",
    )


def assert_discovery_parity() -> None:
    for peer in ("lapras", "kecleon", "zygarde"):
        for path in (
            ROOT / "agents" / f"{peer}.md",
            ROOT / "agents-copilot" / f"{peer}.agent.md",
            ROOT / ".codex" / "agents" / f"{peer}.toml",
        ):
            if not path.is_file():
                fail(f"{path.relative_to(ROOT)} must exist")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    for token in ("[`zygarde`](./agents/zygarde.md)", "[`build-system-product`](./skills/build-system-product/)"):
        if token not in readme:
            fail(f"README must list {token}")
    for router in ("arceus", "conkeldurr"):
        text = (ROOT / "agents" / f"{router}.md").read_text(encoding="utf-8")
        if "`zygarde`" not in text:
            fail(f"agents/{router}.md must route System composition to zygarde")
    agent = (ROOT / "agents" / "zygarde.md").read_text(encoding="utf-8")
    if "skills/build-system-product/SKILL.md" not in agent:
        fail("zygarde must load build-system-product")
    prd = (SKILL_DIR / "reference" / "PRD.md").read_text(encoding="utf-8")
    if "does **not** mean a deployable Product or System" not in prd:
        fail("PRD must state that no System runtime exists because the skill is present")


def main() -> int:
    assert_worked_example()
    assert_schema_rejections()
    assert_reference_resolution()
    assert_orchestration_rules()
    assert_emit_contracts()
    assert_discovery_parity()
    print("build-system-product contract tests passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as exc:
        print(f"build-system-product contract tests failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
