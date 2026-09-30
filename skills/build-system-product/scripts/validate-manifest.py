#!/usr/bin/env python3
"""Validate System composition manifests against schema and semantic rules."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

try:
    from jsonschema import Draft202012Validator
    from jsonschema.exceptions import SchemaError
except ImportError as exc:  # pragma: no cover - dependency failure is actionable.
    raise SystemExit("missing validation dependency: install jsonschema==4.25.1") from exc


SKILL_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = SKILL_ROOT / "reference" / "composition.manifest.schema.json"
DEFAULT_MANIFEST = (
    SKILL_ROOT
    / "reference"
    / "examples"
    / "sale-availability"
    / "composition.manifest.json"
)
REQUIRED_KINDS = {
    "product-definition",
    "product-schema",
    "product-flow-template",
    "product-flow",
    "product-invocation",
}


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"{path}: file does not exist") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"{path}:{exc.lineno}:{exc.colno}: {exc.msg}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{path}: expected a JSON object")
    return value


def semantic_errors(manifest: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    orchestration = manifest.get("orchestration", {})
    if orchestration.get("mode") != "system-service":
        errors.append("orchestration.mode must be system-service")

    serving_systems = [
        product
        for product in manifest.get("products", [])
        if product.get("product") == "system-runtime" and product.get("role") == "serve"
    ]
    if len(serving_systems) != 1:
        errors.append("products must contain exactly one system-runtime with role serve")

    config_refs = manifest.get("configRefs", {})
    kinds = {ref.get("kind") for ref in config_refs.values()}
    missing_kinds = sorted(REQUIRED_KINDS - kinds)
    if missing_kinds:
        errors.append(f"configRefs missing required kinds: {', '.join(missing_kinds)}")
    if sum(1 for ref in config_refs.values() if ref.get("kind") == "product-schema") < 2:
        errors.append("configRefs must contain request and response product-schema entries")

    for name, ref in config_refs.items():
        ref_path = Path(ref.get("path", ""))
        if ref_path.is_absolute() or ".." in ref_path.parts:
            errors.append(f"configRefs.{name}.path must stay inside the configuration package")

    for index, step in enumerate(manifest.get("workflow", [])):
        config_ref = step.get("configRef")
        if config_ref not in config_refs:
            errors.append(f"workflow[{index}].configRef does not resolve: {config_ref}")

    evidence = manifest.get("evidence", {})
    if evidence.get("level") == "spec" and not evidence.get("artifacts"):
        errors.append("spec evidence must name at least one artifact")
    return errors


def validate(path: Path, validator: Draft202012Validator) -> list[str]:
    try:
        manifest = load_json(path)
    except ValueError as exc:
        return [str(exc)]

    errors = [
        f"{path}: {'/'.join(str(part) for part in error.absolute_path) or '<root>'}: {error.message}"
        for error in sorted(validator.iter_errors(manifest), key=lambda item: list(item.absolute_path))
    ]
    errors.extend(f"{path}: {message}" for message in semantic_errors(manifest))
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "manifests",
        nargs="*",
        type=Path,
        default=[DEFAULT_MANIFEST],
        help="Manifest paths; defaults to the bundled sale-availability example.",
    )
    args = parser.parse_args()

    schema = load_json(SCHEMA_PATH)
    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError as exc:
        raise SystemExit(f"{SCHEMA_PATH}: invalid schema: {exc.message}") from exc

    validator = Draft202012Validator(schema)
    errors = [
        error
        for manifest_path in args.manifests
        for error in validate(manifest_path.resolve(), validator)
    ]
    if errors:
        for error in errors:
            print(error)
        return 1

    for manifest_path in args.manifests:
        print(f"valid System manifest: {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
