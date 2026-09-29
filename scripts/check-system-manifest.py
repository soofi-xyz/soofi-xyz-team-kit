#!/usr/bin/env python3
"""Validate System composition manifests and the emits they reference.

Run from the plugin repo root, or point it at manifests in a target repo:

    python3 scripts/check-system-manifest.py [path/to/system.manifest.json ...]

With no arguments it checks every
skills/build-system-product/reference/examples/*/system.manifest.json.
Exit status is 1 when any manifest is rejected.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

try:
    from jsonschema import Draft202012Validator
except ModuleNotFoundError:
    print("missing dependency: install jsonschema", file=sys.stderr)
    raise SystemExit(2)

ROOT = Path(__file__).resolve().parent.parent
SKILLS = ROOT / "skills"
SYSTEM_REFERENCE = SKILLS / "build-system-product" / "reference"
MANIFEST_SCHEMA = SYSTEM_REFERENCE / "composition.manifest.schema.json"
SYSTEM_WORKFLOW_SCHEMA = SYSTEM_REFERENCE / "system-workflow.schema.json"
CONNECT_SCHEMA = SKILLS / "build-connect-product" / "reference" / "contracts" / "flow.schema.json"
TRANSFORM_SCHEMA = SKILLS / "build-transform-product" / "reference" / "contracts" / "contracts.schema.json"
EXAMPLES = SYSTEM_REFERENCE / "examples"

KIND_PRODUCT = {
    "product-definition": "product-orchestration",
    "product-schema": "product-orchestration",
    "product-flow-template": "product-orchestration",
    "product-flow": "product-orchestration",
    "product-waterfall": "product-orchestration",
    "product-invocation": "product-orchestration",
    "lexicon-catalog": "lexicon",
    "connect-partner": "connect",
    "connect-activation": "connect",
    "transform-request": "transform",
    "transform-mapping": "transform",
    "persist-collection": "persist",
    "deploy-environment": "deploy",
    "system-workflow": "system-runtime",
    "system-openapi": "system-runtime",
    "system-fixtures": "system-runtime",
}
SERVE_KINDS = ("product-definition", "product-flow-template", "product-flow")
REMOTE = re.compile(r"^[a-z][a-z0-9+.-]*://")
REPO = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
ENV_NAME = re.compile(r"^[A-Z][A-Z0-9_]*$")
FORBIDDEN_IN_MANIFEST = {
    "JDBC connection string": re.compile(r"jdbc:", re.I),
    "Spark SQL": re.compile(r"\bselect\s+[\w*.,\s]+?\s+from\s+\w", re.I),
    "AWS access key": re.compile(r"\bA(KIA|SIA)[0-9A-Z]{16}\b"),
    "secret ARN": re.compile(r"arn:aws:secretsmanager:"),
    "private key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
}


def _load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _def_validator(schema_path: Path, definition: str) -> Draft202012Validator:
    schema = dict(_load_json(schema_path))
    schema["$ref"] = f"#/$defs/{definition}"
    return Draft202012Validator(schema)


MANIFEST_VALIDATOR = Draft202012Validator(_load_json(MANIFEST_SCHEMA))
SYSTEM_WORKFLOW_VALIDATOR = Draft202012Validator(_load_json(SYSTEM_WORKFLOW_SCHEMA))
LEAF_VALIDATORS = {
    "connect-partner": _def_validator(CONNECT_SCHEMA, "PartnerConfiguration"),
    "connect-activation": _def_validator(CONNECT_SCHEMA, "Activation"),
    "transform-request": _def_validator(TRANSFORM_SCHEMA, "Request"),
    "transform-mapping": _def_validator(TRANSFORM_SCHEMA, "Mapping"),
}


def _strings(value: Any):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)


def _schema_path(error) -> str:
    return "/".join(str(part) for part in error.absolute_path) or "(root)"


def _duplicates(values: list[str]) -> list[str]:
    seen: set[str] = set()
    return sorted({value for value in values if value in seen or seen.add(value)})


def _template_targets(definition: dict) -> set[str]:
    targets: set[str] = set()
    for state in definition.get("States", {}).values():
        if not isinstance(state, dict):
            continue
        for key in ("Next", "Default"):
            if isinstance(state.get(key), str):
                targets.add(state[key])
        for choice in state.get("Choices", []):
            if isinstance(choice, dict) and isinstance(choice.get("Next"), str):
                targets.add(choice["Next"])
    return targets


class ManifestCheck:
    def __init__(self, manifest_path: Path):
        self.path = manifest_path
        self.base = manifest_path.parent
        self.errors: list[str] = []
        self.emits: dict[str, Any] = {}

    def fail(self, where: str, message: str) -> None:
        self.errors.append(f"{where}: {message}")

    def run(self) -> list[str]:
        try:
            manifest = _load_json(self.path)
        except (OSError, json.JSONDecodeError) as exc:
            return [f"(root): cannot read manifest: {exc}"]
        schema_errors = sorted(MANIFEST_VALIDATOR.iter_errors(manifest), key=_schema_path)
        for error in schema_errors:
            self.fail(_schema_path(error), error.message)
        if schema_errors:
            return self.errors
        self.manifest = manifest
        self.config_refs: dict[str, dict] = manifest["configRefs"]
        self.check_ids()
        self.check_workflow()
        self.check_orchestration()
        self.check_dependencies()
        self.check_forbidden_content()
        self.resolve_config_refs()
        self.check_unreferenced_emits()
        self.check_product_emits()
        self.check_leaf_emits()
        self.check_system_workflows()
        return self.errors

    def check_ids(self) -> None:
        manifest = self.manifest
        for field, values in (
            ("products", [item["product"] for item in manifest["products"]]),
            ("workflow", [step["id"] for step in manifest["workflow"]]),
            ("successCriteria", [item["id"] for item in manifest["successCriteria"]]),
        ):
            for value in _duplicates(values):
                self.fail(field, f"duplicate id {value!r}")

    def check_workflow(self) -> None:
        declared = {item["product"]: item["role"] for item in self.manifest["products"]}
        used: set[str] = set()
        for index, step in enumerate(self.manifest["workflow"]):
            where = f"workflow/{index}"
            used.add(step["product"])
            if step["product"] not in declared:
                self.fail(where, f"product {step['product']!r} is not declared in products")
            ref = self.config_refs.get(step["configRef"])
            if ref is None:
                self.fail(where, f"configRef {step['configRef']!r} does not exist in configRefs")
                continue
            expected_product = KIND_PRODUCT.get(ref["kind"])
            if expected_product and expected_product != step["product"]:
                self.fail(
                    where,
                    f"configRef {step['configRef']!r} is a {ref['kind']} ref, which belongs to "
                    f"{expected_product!r}, not {step['product']!r}",
                )
            owner = ref.get("ownerAgent")
            if owner and owner != step["agent"]:
                self.fail(
                    where,
                    f"agent {step['agent']!r} does not own configRef {step['configRef']!r} "
                    f"(ownerAgent {owner!r})",
                )
        for product, role in declared.items():
            if role != "reference-only" and product not in used:
                self.fail("products", f"{product!r} has role {role!r} but no workflow step uses it")

    def check_orchestration(self) -> None:
        manifest = self.manifest
        roles = {item["product"]: item["role"] for item in manifest["products"]}
        kinds = {ref["kind"] for ref in self.config_refs.values()}
        orchestration = manifest.get("orchestration", {})
        mode = orchestration.get("mode", "product-service")
        product_serves = roles.get("product-orchestration") in ("serve", "execute")

        if mode == "product-service" and "product-orchestration" not in roles:
            self.fail("products", "orchestration mode product-service requires product-orchestration")
        if product_serves:
            for kind in SERVE_KINDS:
                if kind not in kinds:
                    self.fail("configRefs", f"product-orchestration serves but no {kind} ref is declared")
        if orchestration.get("invocationMode") == "waterfall" and "product-waterfall" not in kinds:
            self.fail("configRefs", "invocationMode waterfall requires a product-waterfall ref")

        thin = mode == "thin-package-deferred" or (roles.get("system-runtime") == "serve" and not product_serves)
        if thin:
            if "system-runtime" not in roles:
                self.fail("products", "thin-package-deferred requires a system-runtime product")
            if not any(
                item.get("verify") == "deferred" and "product" in item["description"].lower()
                for item in manifest["successCriteria"]
            ):
                self.fail(
                    "successCriteria",
                    "a thin System package needs a deferred criterion naming the Product cutover",
                )

    def check_dependencies(self) -> None:
        dependencies = self.manifest["dependencies"]
        repos = dependencies.get("repos", [])
        for index, repo in enumerate(repos):
            if not REPO.match(repo):
                self.fail(f"dependencies/repos/{index}", f"{repo!r} is not an owner/name repository")
        for repo in _duplicates(repos):
            self.fail("dependencies/repos", f"duplicate repository {repo!r}")
        for index, env in enumerate(dependencies.get("env", [])):
            if not ENV_NAME.match(env["name"]):
                self.fail(f"dependencies/env/{index}", f"{env['name']!r} is not an UPPER_SNAKE env var")

    def check_forbidden_content(self) -> None:
        for text in _strings(self.manifest):
            for label, pattern in FORBIDDEN_IN_MANIFEST.items():
                if pattern.search(text):
                    self.fail("(root)", f"manifest contains a {label}; keep it in the owning product's config")

    def resolve_config_refs(self) -> None:
        base = self.base.resolve()
        for name, ref in self.config_refs.items():
            where = f"configRefs/{name}"
            path = ref["path"]
            if REMOTE.match(path):
                if "digest" not in ref:
                    self.fail(where, f"remote path {path!r} must be pinned with a digest")
                continue
            if Path(path).is_absolute() or ".." in Path(path).parts:
                self.fail(where, f"path {path!r} must stay inside the composition package")
                continue
            target = (base / path).resolve()
            if not target.exists():
                self.fail(where, f"path {path!r} does not resolve to a file next to the manifest")
                continue
            if target.suffix == ".json":
                try:
                    self.emits[name] = _load_json(target)
                except json.JSONDecodeError as exc:
                    self.fail(where, f"{path} is not valid JSON: {exc}")

    def check_unreferenced_emits(self) -> None:
        emits_dir = self.base.resolve() / "emits"
        if not emits_dir.is_dir():
            return
        referenced = [
            (self.base / ref["path"]).resolve()
            for ref in self.config_refs.values()
            if not REMOTE.match(ref["path"])
        ]
        for path in sorted(emits_dir.rglob("*")):
            if not path.is_file() or path.name.startswith("."):
                continue
            if not any(path == ref or ref in path.parents for ref in referenced):
                self.fail(
                    "configRefs",
                    f"{path.relative_to(self.base.resolve())} is emitted but no configRef points to it; "
                    "declare its product, configRef and workflow step or delete it",
                )

    def _emits_of(self, kind: str) -> dict[str, Any]:
        return {
            name: self.emits[name]
            for name, ref in self.config_refs.items()
            if ref["kind"] == kind and isinstance(self.emits.get(name), dict)
        }

    def check_product_emits(self) -> None:
        product_name = self.manifest.get("productName", self.manifest["systemId"])
        for name, definition in self._emits_of("product-definition").items():
            if definition.get("name") != product_name:
                self.fail(
                    f"configRefs/{name}",
                    f"product definition name {definition.get('name')!r} does not match {product_name!r}",
                )

        template_names: set[str] = set()
        for name, template in self._emits_of("product-flow-template").items():
            where = f"configRefs/{name}"
            if not template.get("name"):
                self.fail(where, "flow template has no name")
            else:
                template_names.add(template["name"])
            definition = template.get("definition", {})
            states = definition.get("States", {})
            if definition.get("StartAt") not in states:
                self.fail(where, f"StartAt {definition.get('StartAt')!r} is not a state")
            for target in sorted(_template_targets(definition) - set(states)):
                self.fail(where, f"transition to unknown state {target!r}")

        flow_names: set[str] = set()
        for name, flow in self._emits_of("product-flow").items():
            where = f"configRefs/{name}"
            flow_names.add(flow.get("name", ""))
            template = flow.get("flow_template_name")
            if not template:
                self.fail(where, "product flow must set flow_template_name")
            elif template not in template_names:
                self.fail(where, f"flow_template_name {template!r} does not match an emitted flow template")

        for name, waterfall in self._emits_of("product-waterfall").items():
            for index, entry in enumerate(waterfall.get("waterfall", [])):
                if entry.get("flow_name") not in flow_names:
                    self.fail(
                        f"configRefs/{name}",
                        f"waterfall/{index} flow_name {entry.get('flow_name')!r} does not match an emitted product flow",
                    )

    def check_leaf_emits(self) -> None:
        for kind, validator in LEAF_VALIDATORS.items():
            for name, document in self._emits_of(kind).items():
                for error in sorted(validator.iter_errors(document), key=_schema_path):
                    self.fail(f"configRefs/{name}", f"{kind} contract: {_schema_path(error)}: {error.message}")

        partners = {doc.get("configuration_id") for doc in self._emits_of("connect-partner").values()}
        for name, activation in self._emits_of("connect-activation").items():
            where = f"configRefs/{name}"
            if partners and activation.get("configuration_id") not in partners:
                self.fail(where, f"configuration_id {activation.get('configuration_id')!r} matches no emitted partner")
            if activation.get("enabled") and not self.manifest["deploy"]["activationEnabled"]:
                self.fail(where, "activation is enabled while deploy.activationEnabled is false")

        mappings = {
            (mapping.get("from", {}).get("name"), mapping.get("to", {}).get("name"))
            for catalog in self._emits_of("lexicon-catalog").values()
            for mapping in catalog.get("mappings", [])
            if isinstance(mapping, dict)
        }
        languages = {
            language.get("name")
            for catalog in self._emits_of("lexicon-catalog").values()
            for language in catalog.get("languages", [])
            if isinstance(language, dict)
        }
        for source, target in sorted(mappings, key=str):
            for language in (source, target):
                if language not in languages:
                    self.fail("configRefs", f"lexicon mapping uses undeclared language {language!r}")
        if self._emits_of("lexicon-catalog"):
            for name, request in self._emits_of("transform-request").items():
                pair = (request.get("from"), request.get("to"))
                if pair not in mappings:
                    self.fail(f"configRefs/{name}", f"no emitted Lexicon mapping for {pair[0]!r} -> {pair[1]!r}")

        for name, environment in self._emits_of("deploy-environment").items():
            where = f"configRefs/{name}"
            if environment.get("activationEnabled") is not False:
                self.fail(where, "deploy environment must keep activationEnabled false")
            for component in environment.get("components", []):
                for ref in component.get("refs", []):
                    if ref not in self.config_refs:
                        self.fail(where, f"component ref {ref!r} does not exist in configRefs")


    def check_system_workflows(self) -> None:
        """Mirrors the System's deploy-time checks beyond the published JSON Schema."""
        for name, workflow in self._emits_of("system-workflow").items():
            where = f"configRefs/{name}"
            schema_errors = sorted(SYSTEM_WORKFLOW_VALIDATOR.iter_errors(workflow), key=_schema_path)
            for error in schema_errors:
                self.fail(where, f"system-workflow contract: {_schema_path(error)}: {error.message}")
            if schema_errors:
                continue
            if workflow["id"] != self.manifest["systemId"]:
                self.fail(where, f"workflow id {workflow['id']!r} must equal systemId {self.manifest['systemId']!r}")
            trigger = workflow["trigger"]
            fields = set(trigger["fields"])
            for field in workflow["ledgerKey"]:
                if field not in fields:
                    self.fail(where, f"ledger key field {field!r} is not a field of trigger {trigger['id']!r}")
            for field in trigger.get("dataFilter", {}):
                if field not in fields:
                    self.fail(where, f"data filter field {field!r} is not a field of trigger {trigger['id']!r}")
            seen: set[str] = set()
            self._check_workflow_block(where, "states", workflow["startAt"], workflow["states"], seen)

    def _check_workflow_block(
        self, where: str, block: str, start_at: str, states: dict, seen: set[str]
    ) -> None:
        if start_at not in states:
            self.fail(where, f"{block}: startAt {start_at!r} is not a state in this block")
        for state_name, state in states.items():
            path = f"{block}.{state_name}"
            if state_name in seen:
                self.fail(where, f"{path}: state names must be unique across the whole definition")
            seen.add(state_name)
            kind = state["type"]
            targets: list[str] = []
            if kind == "Choice":
                targets = [choice["next"] for choice in state["choices"]] + [state["default"]]
            elif kind not in ("Succeed", "Fail"):
                if ("next" in state) == ("end" in state):
                    self.fail(where, f"{path}: set exactly one of next or end")
                if "next" in state:
                    targets = [state["next"]]
            for target in targets:
                if target not in states:
                    self.fail(where, f"{path}: {target!r} is not a state in the same block")
            if kind == "Map":
                iterator = state["iterator"]
                self._check_workflow_block(where, f"{path}.iterator", iterator["startAt"], iterator["states"], seen)
            if kind == "Parallel":
                for index, branch in enumerate(state["branches"]):
                    self._check_workflow_block(
                        where, f"{path}.branches.{index}", branch["startAt"], branch["states"], seen
                    )


def check_manifest(path: Path) -> list[str]:
    return ManifestCheck(path).run()


def main(argv: list[str]) -> int:
    paths = [Path(arg) for arg in argv] or sorted(EXAMPLES.glob("*/system.manifest.json"))
    if not paths:
        print("no System manifests found", file=sys.stderr)
        return 1
    failed = False
    for path in paths:
        errors = check_manifest(path)
        label = path.resolve().relative_to(ROOT) if path.resolve().is_relative_to(ROOT) else path
        if errors:
            failed = True
            print(f"{label}: rejected", file=sys.stderr)
            for error in errors:
                print(f"  - {error}", file=sys.stderr)
        else:
            print(f"{label}: valid")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
