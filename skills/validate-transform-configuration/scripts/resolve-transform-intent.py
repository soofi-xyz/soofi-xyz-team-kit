#!/usr/bin/env python3
"""Resolve a short Transform validation request into a read-only intake plan.

Examples:
  resolve-transform-intent.py parse --request "test <source> to <target> <output words>"
  resolve-transform-intent.py discover --request "test <source> to <target>" \
      --workspace "$WS" --candidate-pr <registry-pr> --aws dev=<dev-profile> [--profiles <profile-dir>]
  resolve-transform-intent.py discover --request "test <hub> <qualifier> to <target>" \
      --lexicon-root <candidate-checkout> --main-lexicon-root <main-checkout> \
      --registry dev=<registry-dir> --ssm-parameters dev=<ssm-names.json>
  resolve-transform-intent.py draft-profile --request "test <source> to <target>" ...
  resolve-transform-intent.py contracts --mapping <id>@<version> --lexicon-root ... --registry ...
  resolve-transform-intent.py check-profile --profile <profile.json> --lexicon-root ... --registry ...
  resolve-transform-intent.py promote-run-profile --draft draft.json --intent intent.json --out run-profile.json

Every repository path, SSM name, hub language and default comes from the
registry layout (reference/registry-layout.json, or --layout). With --workspace
the script fetches whatever is not supplied: pinned registry checkouts through
gh/git and, for each --aws label=PROFILE, the published mapping registry and
language parameter names through read-only AWS CLI calls (see
fetch_validation_inputs.py). Without --workspace it only reads local files.
Output is JSON on stdout (or --out); see reference/intent-resolution.md.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FORBIDDEN = SKILL_ROOT / "reference" / "forbidden-concepts.json"
DEFAULT_LAYOUT = SKILL_ROOT / "reference" / "registry-layout.json"
DATA_BUCKET_INPUT_ROOT = "inputs"
LAYOUT: dict = json.loads(DEFAULT_LAYOUT.read_text())
HUB_LANGUAGE: str = LAYOUT["hubLanguage"]
GRAPH_PREFIX = re.compile(r"^(?:vertex|edge)[-_]")


def apply_layout(layout: dict) -> None:
    """Point every path, parameter and hub-language lookup at one registry layout."""
    global LAYOUT, HUB_LANGUAGE, GRAPH_PREFIX
    LAYOUT = layout
    HUB_LANGUAGE = layout["hubLanguage"]
    prefixes = "|".join(re.escape(p) for p in layout.get("graphDatasetPrefixes", ["vertex", "edge"]))
    GRAPH_PREFIX = re.compile(rf"^(?:{prefixes})[-_]")


def load_layout(path: str | Path | None) -> dict:
    layout = json.loads(Path(path).read_text()) if path else json.loads(DEFAULT_LAYOUT.read_text())
    apply_layout(layout)
    return layout


def concept_model_path(root: Path) -> Path:
    return root / LAYOUT["conceptModelPath"]


def language_definition_path(root: Path, language: str) -> Path:
    return root / LAYOUT["languageDefinitionPath"].format(language=language)


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

VERBS = ("test", "validate", "check", "verify", "run", "try", "prove", "e2e")
FILLER = {
    "the", "a", "an", "mapping", "mappings", "transform", "transforms",
    "transformation", "transformations", "end", "e2e", "full", "please",
    "language", "from", "flow", "pipeline",
}
ARROWS = re.compile(r"\s*(?:->|=>|→|\binto\b|\bto\b)\s*")
VERSION_HINT = re.compile(r"(?:@|\bv(?:ersion)?\s*)(\d+\.\d+\.\d+)")
ENV_HINT = re.compile(r"\b(?:in|on|against)\s+(dev|prod|production|development)\b")
FOR_SLICES = re.compile(r"\bfor\s+(.+)$")
SLICE_JOINERS = {"and", "or", "plus"}
DEFAULT_SLICES = SKILL_ROOT / "reference" / "package-slices.json"
DEFAULT_ACTUALS = SKILL_ROOT / "reference" / "prod-actuals.json"
BUILTIN_SLICE_KEYS = ("sms", "dsa", "m2d")
MODE_HINTS = {
    "round-trip": re.compile(r"\bround[\s-]?trip\b|\broundtrip\b"),
    "one-way": re.compile(r"\bone[\s-]?way\b|\bforward only\b"),
}
OWNER_DECISIONS = {
    "preApproveFullRunOnCanaryPass": re.compile(
        r"\b(?:pre[\s-]?approve[sd]?|approve[sd]?)\s+(?:the\s+)?full(?:[\s-]window)?\s+(?:dev\s+)?run\b[^.;\n]*"
        r"|\bfull(?:[\s-]window)?\s+(?:dev\s+)?run\s+(?:is\s+)?pre[\s-]?approved\b[^.;\n]*"
        r"|\bif\s+the\s+canary\s+pass(?:es)?,?\s+(?:then\s+)?(?:run|proceed\s+(?:to|with)|start)\s+(?:the\s+)?full\b[^.;\n]*"),
    "acceptProductChanges": re.compile(
        r"\baccept(?:s|ed)?\s+(?:all\s+)?(?:transform\s+)?product[\s_-]?changes?\b[^.;\n]*"
        r"|\bproduct[\s_-]?changes?\s+(?:items\s+)?(?:are\s+)?(?:accepted|out\s+of\s+scope)\b[^.;\n]*"),
    "costCeilingUsd": re.compile(r"\bcost\s+ceiling\s+(?:of\s+)?(?:usd\s*)?\$?\s*(\d+(?:\.\d+)?)(?:\s*usd)?(?:\s+per\s+(?:job|run|execution))?"),
    "windowSelection": re.compile(r"\b(?:use\s+)?(?:the\s+)?most\s+recent\s+(?:full|complete)\s+utc\s+day\s+with\s+(?:real\s+)?data"
                                  r"(?:\s+per\s+slice)?"),
    "blanketDevWrites": re.compile(
        r"\b(?:all\s+)?dev\s+writes?\s+(?:\([^)]*\)\s+)?(?:are\s+)?(?:pre[\s-]?)?approved\b[^.;\n]*"
        r"|\b(?:pre[\s-]?)?approve[sd]?\s+(?:all\s+)?dev\s+writes?\b[^.;\n]*"),
    "sensitiveFieldStaging": re.compile(
        r"\b(?:approve[sd]?\s+)?stag(?:e|ing)\s+(?:of\s+)?(?:the\s+)?(?:real\s+)?(?:sensitive\s+fields?|pii"
        r"|phone\s+numbers?(?:\s+and\s+(?:sms\s+)?message\s+bodies)?)\s+(?:to|in)\s+dev\b[^.;\n]*"
        r"|\bsensitive[\s-]fields?\s+staging\s+(?:to\s+dev\s+)?(?:is\s+)?approved\b[^.;\n]*"),
}
OWNER_DECISION_VALUES = {
    "windowSelection": "most-recent-full-utc-day-with-data-per-slice",
    "blanketDevWrites": "staging-and-executions-for-this-run",
    "sensitiveFieldStaging": "stage-real-values-to-dev",
}
OWNER_PREFIX = re.compile(r"\bowner\s+decisions?\s*:?")


def extract_owner_decisions(text: str) -> tuple[str, dict]:
    """Up-front owner decisions that let an unattended run finish; absent ones keep the interactive defaults."""
    decisions: dict = {}
    spans: list[tuple[int, int]] = []
    for name, pattern in OWNER_DECISIONS.items():
        match = pattern.search(text)
        if not match:
            continue
        if name == "costCeilingUsd":
            decisions[name] = float(match.group(1))
        elif name in OWNER_DECISION_VALUES:
            decisions[name] = OWNER_DECISION_VALUES[name]
        else:
            decisions[name] = True
        spans.append(match.span())
    merged: list[list[int]] = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    for start, end in reversed(merged):
        text = text[:start] + " " + text[end:]
    text = OWNER_PREFIX.sub(" ", text)
    return re.split(r"[;\n]|\.(?=\s|$)", text, maxsplit=1)[0].strip(" ,"), decisions


def normalize_dataset(name: str) -> str:
    return GRAPH_PREFIX.sub("", name).replace("-", "_").lower()


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_actuals_catalog(path: Path | str | None = None) -> dict:
    source = Path(path) if path else DEFAULT_ACTUALS
    return json.loads(source.read_text()) if source.exists() else {"slices": {}}


def load_slice_catalog(path: Path | str | None = None) -> dict:
    source = Path(path) if path else DEFAULT_SLICES
    if not source.exists():
        return {"package": {}, "aliases": {k: k for k in BUILTIN_SLICE_KEYS},
                "slices": {k: {"id": k, "outputDatasets": [], "introducedIn": "0.0.0"} for k in BUILTIN_SLICE_KEYS}}
    return json.loads(source.read_text())


def extract_package_slices(text: str, catalog: dict) -> tuple[str, list[str]]:
    """Turn '… for sms, dsa and m2d' into slice ids. Slice words are not languages."""
    match = FOR_SLICES.search(text)
    if not match:
        return text, []
    aliases = dict(catalog.get("aliases") or {})
    known = set(catalog.get("slices") or {}) | set(aliases)
    if not known:
        known = set(BUILTIN_SLICE_KEYS)
    words = [w for w in re.split(r"[^a-z0-9_]+", match.group(1)) if w and w not in SLICE_JOINERS and w not in FILLER]
    mapped = [aliases.get(w, w) for w in words]
    if not mapped or any(name not in known for name in mapped):
        return text, []
    # preserve order, drop duplicates
    slices = list(dict.fromkeys(mapped))
    return text[:match.start()].strip(), slices


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


def parse_request(request: str, slice_catalog: dict | None = None) -> dict:
    text = request.strip().lower()
    text = re.sub(r"^/?silvally\b", "", text).strip()
    text, owner_decisions = extract_owner_decisions(text)
    hints: dict = {"version": None, "environment": None, "mode": None, "ownerDecisions": owner_decisions}
    version = VERSION_HINT.search(text)
    if version:
        hints["version"] = version.group(1)
        text = VERSION_HINT.sub(" ", text)
    env = ENV_HINT.search(text)
    if env:
        hints["environment"] = "prod" if env.group(1).startswith("prod") else "dev"
        text = ENV_HINT.sub(" ", text)
    for mode, pattern in MODE_HINTS.items():
        if pattern.search(text):
            hints["mode"] = mode
            text = pattern.sub(" ", text)
    text = re.sub(r"\bend[\s-]to[\s-]end\b", " ", text)
    for verb in VERBS:
        text = re.sub(rf"^\s*{verb}\b", " ", text).strip()
    text, slices = extract_package_slices(text, slice_catalog or load_slice_catalog())

    parts = ARROWS.split(text, maxsplit=1)
    if len(parts) != 2:
        return {
            "request": request,
            "status": "UNPARSED",
            "reason": "Expected '<source> to <target>' (for example 'test <source language> to <target language> <output words>').",
            "sourceTerms": [],
            "targetTerms": [],
            "qualifiers": [],
            "slices": slices,
            "hints": hints,
        }

    def terms(side: str) -> tuple[list[str], list[str]]:
        explicit = re.findall(r"\(([^)]*)\)", side)
        side = re.sub(r"\([^)]*\)", " ", side)
        words = [w for w in re.split(r"[^a-z0-9_]+", side) if w and w not in FILLER]
        qualifiers = [
            q for chunk in explicit for q in re.split(r"[^a-z0-9_]+", chunk)
            if q and q not in FILLER and q not in {"anything", "etc"}
        ]
        return words, qualifiers

    source_words, source_qualifiers = terms(parts[0])
    target_words, target_qualifiers = terms(parts[1])
    return {
        "request": request,
        "status": "PARSED",
        "sourceTerms": source_words,
        "targetTerms": target_words,
        "qualifiers": source_qualifiers + target_qualifiers,
        "slices": slices,
        "hints": hints,
    }


# ---------------------------------------------------------------------------
# Registry loading
# ---------------------------------------------------------------------------


@dataclass
class Mapping:
    id: str
    version: str
    source: str
    target: str
    status: str
    inputs: list[dict]
    outputs: list[dict]
    output: dict
    provenance: list[dict] = field(default_factory=list)
    query_files: list[Path] = field(default_factory=list)

    @property
    def key(self) -> str:
        return f"{self.id}@{self.version}"

    @property
    def input_names(self) -> list[str]:
        return [str(i.get("table")) for i in self.inputs]

    @property
    def output_names(self) -> list[str]:
        return [str(o.get("dataset")) for o in self.outputs]

    def signature(self) -> dict:
        return {
            "from": self.source,
            "to": self.target,
            "status": self.status,
            "inputs": sorted(self.input_names),
            "outputs": sorted(self.output_names),
            "shape": self.output.get("shape"),
            "format": self.output.get("format"),
        }

    def summary(self) -> dict:
        return {
            "mapping": self.key,
            "from": self.source,
            "to": self.target,
            "status": self.status,
            "outputShape": self.output.get("shape"),
            "outputFormat": self.output.get("format"),
            "inputs": self.input_names,
            "outputs": self.output_names,
            "provenance": self.provenance,
        }


def mapping_from_document(doc: dict, provenance: dict, query_dir: Path | None = None) -> Mapping | None:
    required = ("id", "version", "from", "to")
    if not all(isinstance(doc.get(k), str) for k in required):
        return None
    return Mapping(
        id=doc["id"],
        version=doc["version"],
        source=doc["from"],
        target=doc["to"],
        status=str(doc.get("status", "UNKNOWN")),
        inputs=list(doc.get("inputs", [])),
        outputs=list(doc.get("outputs", [])),
        output=dict(doc.get("output", {})),
        provenance=[provenance],
        query_files=sorted(query_dir.glob("**/*.sql")) if query_dir and query_dir.is_dir() else [],
    )


def load_registry_dir(label: str, root: Path) -> list[Mapping]:
    found = []
    glob = LAYOUT["publishedRegistry"]["mappingGlob"]
    for path in sorted(root.glob(f"**/{glob}")) or sorted(root.glob("*/*/mapping.json")):
        doc = json.loads(path.read_text())
        mapping = mapping_from_document(
            doc,
            {"kind": "published-registry", "label": label, "path": str(path.relative_to(root)), "sha256": sha256_file(path)},
            path.parent / "queries",
        )
        if mapping:
            found.append(mapping)
    return found


def load_checkout_registrations(label: str, root: Path) -> list[Mapping]:
    found = []
    for path in sorted(root.glob(LAYOUT["registrationGlob"])):
        doc = json.loads(path.read_text())
        mapping = mapping_from_document(
            doc,
            {"kind": "checked-in-registration", "label": label, "path": str(path.relative_to(root)), "sha256": sha256_file(path)},
            path.parent / "queries",
        )
        if mapping:
            found.append(mapping)
    return found


def load_retired_ids(root: Path) -> list[str]:
    source = LAYOUT.get("retiredMappingIds")
    if not source or not (root / source["path"]).exists():
        return []
    match = re.search(source["listPattern"], (root / source["path"]).read_text(), re.S)
    return re.findall(r'"([a-z0-9-]+)"', match.group(1)) if match else []


def merge_mappings(groups: list[list[Mapping]]) -> tuple[dict[str, Mapping], list[dict]]:
    merged: dict[str, Mapping] = {}
    drift = []
    for group in groups:
        for mapping in group:
            existing = merged.get(mapping.key)
            if existing is None:
                merged[mapping.key] = mapping
                continue
            if existing.signature() != mapping.signature():
                drift.append({
                    "mapping": mapping.key,
                    "code": "RegistrySourceDrift",
                    "sources": [existing.provenance[0], mapping.provenance[0]],
                    "left": existing.signature(),
                    "right": mapping.signature(),
                })
            existing.provenance.extend(mapping.provenance)
            existing.query_files.extend(mapping.query_files)
    return merged, drift


def load_languages(root: Path | None, ssm_files: dict[str, Path]) -> dict[str, dict]:
    languages: dict[str, dict] = {}

    def entry(name: str) -> dict:
        return languages.setdefault(name, {"name": name, "definition": None, "registrySources": []})

    params = LAYOUT["languageParameters"]
    if root is not None:
        registry = LAYOUT.get("languageRegistry")
        if registry and (root / registry["path"]).exists():
            text = (root / registry["path"]).read_text()
            block = re.search(registry["blockPattern"], text, re.S)
            for key in re.findall(registry["keyPattern"], block.group(1), re.M) if block else []:
                entry(key)["registrySources"].append(registry["path"])
        declared = params.get("declaredIn")
        if declared and (root / declared).exists():
            for param in re.findall(params["declarationPattern"], (root / declared).read_text()):
                name = ssm_language_name(param)
                entry(name)["registrySources"].append(f"{declared}:{param}")
        for name, info in list(languages.items()):
            candidate = language_definition_path(root, name)
            if candidate.exists():
                doc = json.loads(candidate.read_text())
                if isinstance(doc.get("vertices"), list):
                    info["definition"] = {
                        "path": str(candidate.relative_to(root)),
                        "sha256": sha256_file(candidate),
                        "datasets": {
                            v["type"]: {
                                "properties": {
                                    k: p for k, p in (v.get("properties") or {}).items()
                                    if k not in (v.get("deprecated_properties") or {})
                                },
                                "required": list(v.get("required") or []),
                                "deprecated": bool(v.get("is_deprecated")),
                            }
                            for v in doc["vertices"]
                            if isinstance(v, dict) and "type" in v
                        },
                        "edges": {
                            e["type"]: {
                                "from": e.get("from"),
                                "to": e.get("to"),
                                "properties": dict(e.get("properties") or {}),
                                "deprecated": bool(e.get("is_deprecated")),
                            }
                            for e in doc.get("edges") or []
                            if isinstance(e, dict) and "type" in e
                        },
                    }
    for label, path in ssm_files.items():
        for param in re.findall(r"[^\s\",\[\]]+", path.read_text()):
            if re.fullmatch(params["parameterPattern"], param):
                entry(ssm_language_name(param))["registrySources"].append(f"ssm:{label}:{param}")
    return languages


def ssm_language_name(param: str) -> str:
    params = LAYOUT["languageParameters"]
    stem = param.removeprefix(params["prefix"]).removesuffix(params["suffix"]).rstrip("-")
    return stem.replace("-", "_") if stem else HUB_LANGUAGE


def load_concepts(root: Path | None) -> dict[str, dict] | None:
    if root is None:
        return None
    path = concept_model_path(root)
    if not path.exists():
        return None
    doc = json.loads(path.read_text())
    concepts = {}
    for kind in ("vertices", "edges"):
        for item in doc.get(kind) or []:
            if isinstance(item, dict) and "type" in item:
                concepts[item["type"]] = {
                    "kind": kind[:-1] if kind == "edges" else "vertex",
                    "deprecated": bool(item.get("is_deprecated")),
                    "from": item.get("from"),
                    "to": item.get("to"),
                    "properties": sorted(item.get("properties") or {}),
                    "indexes": sorted(item.get("indexes") or {}),
                }
    return concepts


def lexicon_sha256(root: Path | None) -> str | None:
    path = concept_model_path(root) if root else None
    return sha256_file(path) if path and path.exists() else None


def load_profiles(roots: list[Path]) -> list[dict]:
    """Profiles are data supplied by the operator (--profiles DIR, repeatable); none are built in."""
    return [json.loads(p.read_text()) for root in roots for p in sorted(root.glob("*.json"))]


def load_forbidden(path: Path | None) -> dict:
    if path is None or not path.exists():
        return {"concepts": [], "properties": [], "retiredMappings": []}
    doc = json.loads(path.read_text())
    doc["sha256"] = sha256_file(path)
    return doc


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------


@dataclass
class Registry:
    languages: dict[str, dict]
    mappings: dict[str, Mapping]
    retired: list[str]
    drift: list[dict]
    main_concepts: dict[str, dict] | None
    candidate_concepts: dict[str, dict] | None
    profiles: list[dict]
    registry_labels: list[str]
    main_root: Path | None = None
    candidate_root: Path | None = None
    shared_forbidden: dict = field(default_factory=dict)

    @property
    def retired_keys(self) -> set[str]:
        return {r["mapping"] for r in self.shared_forbidden.get("retiredMappings", [])}

    def endpoint_languages(self) -> set[str]:
        names = set()
        for m in self.mappings.values():
            names.update((m.source, m.target))
        return names

    def known_languages(self) -> set[str]:
        return set(self.languages) | self.endpoint_languages()

    @property
    def has_published(self) -> bool:
        return any(p.get("kind") == "published-registry" for m in self.mappings.values() for p in m.provenance)

    def enabled(self, source: str | None = None, target: str | None = None) -> list[Mapping]:
        return sorted(
            (
                m for m in self.mappings.values()
                if m.status == "ENABLED"
                and m.key not in self.retired_keys
                and (source is None or m.source == source)
                and (target is None or m.target == target)
            ),
            key=lambda m: (m.id, [int(x) for x in m.version.split(".")]),
        )


def language_status(registry: Registry, name: str) -> dict:
    info = registry.languages.get(name)
    endpoint = name in registry.endpoint_languages()
    if info and info.get("definition"):
        state = "DEFINED"
    elif info:
        state = "REGISTERED_WITHOUT_DEFINITION"
    elif endpoint:
        state = "MAPPING_ENDPOINT_ONLY"
    else:
        state = "UNKNOWN"
    return {
        "name": name,
        "state": state,
        "definition": (info or {}).get("definition", {}) and {
            "path": info["definition"]["path"],
            "sha256": info["definition"]["sha256"],
        },
        "registrySources": (info or {}).get("registrySources", []),
        "usedByMappings": sorted(
            m.key for m in registry.mappings.values() if name in (m.source, m.target)
        ),
    }


def split_terms(registry: Registry, words: list[str]) -> tuple[str | None, list[str], list[str]]:
    known = registry.known_languages()
    matched = [w for w in words if w in known]
    others = [w for w in words if w not in known]
    if not words:
        return None, [], []
    if len(matched) == 1:
        return matched[0], others, []
    if len(matched) > 1 and HUB_LANGUAGE in matched:
        rest = [w for w in matched if w != HUB_LANGUAGE]
        return HUB_LANGUAGE, rest + others, []
    if len(matched) > 1:
        return None, others, matched
    return words[0], words[1:], []


def discriminating_inputs(candidates: list[Mapping]) -> dict[str, set[str]]:
    counts: dict[str, int] = {}
    for m in candidates:
        for name in {normalize_dataset(n) for n in m.input_names}:
            counts[name] = counts.get(name, 0) + 1
    shared = {n for n, c in counts.items() if c > 1} if len(candidates) > 1 else set()
    return {
        m.key: {normalize_dataset(n) for n in m.input_names} - shared for m in candidates
    }


def discriminating_outputs(candidates: list[Mapping]) -> dict[str, set[str]]:
    counts: dict[str, int] = {}
    for m in candidates:
        for name in {normalize_dataset(n) for n in m.output_names}:
            counts[name] = counts.get(name, 0) + 1
    shared = {n for n, c in counts.items() if c > 1} if len(candidates) > 1 else set()
    return {m.key: {normalize_dataset(n) for n in m.output_names} - shared for m in candidates}


def qualifier_phrases(qualifiers: list[str]) -> set[str]:
    """Contiguous qualifier word runs joined like dataset names ('ledger summaries' -> 'ledger_summary')."""
    phrases = set()
    for start in range(len(qualifiers)):
        for end in range(start + 1, len(qualifiers) + 1):
            words = qualifiers[start:end]
            phrases.add("_".join(words))
            last = words[-1]
            if len(last) > 4 and last.endswith("ies"):
                phrases.add("_".join(words[:-1] + [last[:-3] + "y"]))
            elif len(last) > 3 and last.endswith("s"):
                phrases.add("_".join(words[:-1] + [last[:-1]]))
    return phrases


def output_dataset_signals(candidate_outputs: set[str], phrases: set[str]) -> list[dict]:
    matched = sorted(candidate_outputs & phrases)
    return [{"kind": "output-dataset", "hard": True, "datasets": matched}] if matched else []


def qualifier_signals(registry: Registry, candidate: Mapping, qualifier: str, disc: set[str]) -> list[dict]:
    hub = candidate.source
    signals = []
    for producer in registry.enabled(source=qualifier, target=hub):
        overlap = disc & {normalize_dataset(n) for n in producer.output_names}
        if overlap:
            signals.append({"kind": "chain-producer", "hard": True, "via": producer.key, "datasets": sorted(overlap)})
    for sibling in registry.enabled(source=hub, target=qualifier):
        if sibling.key == candidate.key:
            continue
        overlap = disc & {normalize_dataset(n) for n in sibling.input_names}
        if overlap:
            signals.append({"kind": "chain-sibling", "hard": True, "via": sibling.key, "datasets": sorted(overlap)})
    tokens = [n for n in candidate.output_names + candidate.input_names if qualifier in n.lower()]
    if tokens:
        signals.append({"kind": "dataset-token", "hard": False, "datasets": sorted(set(tokens))})
    return signals


def served_qualifiers(registry: Registry, candidate: Mapping, disc: set[str]) -> list[str]:
    served = set()
    for m in registry.enabled(target=candidate.source):
        if disc & {normalize_dataset(n) for n in m.output_names}:
            served.add(m.source)
    for m in registry.enabled(source=candidate.source):
        if m.key != candidate.key and m.target != candidate.target and disc & {normalize_dataset(n) for n in m.input_names}:
            served.add(m.target)
    return sorted(served)


def select_mapping(registry: Registry, source: str, target: str, qualifiers: list[str], version: str | None) -> dict:
    candidates = registry.enabled(source=source, target=target)
    if not candidates:
        return {"status": "NO_MAPPING", "selected": None, "candidates": []}
    disc = discriminating_inputs(candidates)
    disc_out = discriminating_outputs(candidates)
    phrases = qualifier_phrases(qualifiers)
    ranked = []
    for m in candidates:
        signals = []
        if version and m.version == version:
            signals.append({"kind": "version-hint", "hard": True})
        for q in qualifiers:
            signals.extend(qualifier_signals(registry, m, q, disc[m.key]))
        signals.extend(output_dataset_signals(disc_out[m.key], phrases))
        ranked.append({
            **m.summary(),
            "servesQualifiers": served_qualifiers(registry, m, disc[m.key]),
            "signals": signals,
        })
    if version:
        hard = [r for r in ranked if any(s["kind"] == "version-hint" for s in r["signals"])]
        if len(hard) == 1:
            return {"status": "RESOLVED", "selected": hard[0]["mapping"], "candidates": ranked,
                    "versionSelection": version_selection(ranked, hard[0], version, "explicit-version")}
    elif len(ranked) == 1:
        hard = ranked
    elif qualifiers:
        hard = [r for r in ranked if any(s["hard"] for s in r["signals"])]
    else:
        hard = []
    if not version and registry.has_published and (hard or not qualifiers):
        return latest_published(ranked, hard or ranked, source, target)
    if len(hard) == 1:
        return {"status": "RESOLVED", "selected": hard[0]["mapping"], "candidates": ranked,
                "versionSelection": version_selection(ranked, hard[0], version, "explicit-version" if version else "single-match")}
    matched = hard or ([r for r in ranked if r["signals"]] if qualifiers else [])
    cumulative = cumulative_superset(matched) if not version else None
    if cumulative:
        return {"status": "RESOLVED", "selected": cumulative["mapping"], "candidates": ranked,
                "selectionRule": "cumulative-superset",
                "versionSelection": version_selection(ranked, cumulative, None, "cumulative-superset"),
                "reason": (f"{len(matched)} versions of {cumulative['mapping'].split('@')[0]} match; the highest version's outputs "
                           "include every other matching version's outputs (cumulative versions); request @<version> to pin an older one")}
    return {
        "status": "AMBIGUOUS",
        "selected": None,
        "candidates": ranked,
        "reason": (
            f"{len(ranked)} enabled {source}->{target} mapping versions; "
            + ("no qualifier or version selects exactly one" if not hard else f"{len(hard)} match the qualifier")
        ),
    }


def _semver(key: str) -> tuple[int, ...]:
    return tuple(int(part) for part in key.split("@")[1].split("."))


PROD_REGISTRY_LABELS = {"prod", "production"}
CANDIDATE_PROVENANCE = {"checked-in-registration", "candidate-build"}


def published_labels(candidate: dict) -> list[str]:
    return sorted({p["label"] for p in candidate.get("provenance", []) if p.get("kind") == "published-registry"})


def selection_labels(candidate: dict) -> list[str]:
    """Registries that may default a version. PROD catalog is observational only."""
    return [label for label in published_labels(candidate) if label not in PROD_REGISTRY_LABELS]


def is_default_selectable(candidate: dict) -> bool:
    kinds = {p.get("kind") for p in candidate.get("provenance", [])}
    return bool(selection_labels(candidate)) or bool(kinds & CANDIDATE_PROVENANCE)


def version_selection(ranked: list[dict], chosen: dict, requested: str | None, rule: str) -> dict:
    """Which version was chosen, from which candidates and by which rule; the pin is the chosen mapping.json digest."""
    mapping_id = chosen["mapping"].split("@")[0]
    same_id = sorted((r for r in ranked if r["mapping"].split("@")[0] == mapping_id), key=lambda r: _semver(r["mapping"]))
    pin = next((p for p in chosen.get("provenance", []) if p.get("kind") == "published-registry"), None) \
        or next(iter(chosen.get("provenance", [])), {})
    return {
        "requested": requested,
        "mappingId": mapping_id,
        "candidates": [{"version": r["mapping"].split("@")[1], "publishedIn": published_labels(r)} for r in same_id],
        "chosen": chosen["mapping"],
        "rule": rule,
        "pin": {"source": pin.get("kind"), "label": pin.get("label"), "path": pin.get("path"), "sha256": pin.get("sha256")},
    }


def latest_published(ranked: list[dict], pool: list[dict], source: str, target: str) -> dict:
    """No @version: the highest semver among DEV-published, candidate-build, and checked-in versions.

    PROD catalog membership never selects or rejects a version. A PR mapping that
    is absent from PROD is expected and stays RESOLVED so validation can continue
    to DEV execution proof.
    """
    eligible = [r for r in pool if is_default_selectable(r)]
    if not eligible:
        prod_only = [r for r in pool if set(published_labels(r)) <= PROD_REGISTRY_LABELS and published_labels(r)]
        if prod_only:
            eligible = prod_only
        else:
            return {"status": "NO_MAPPING", "selected": None, "candidates": ranked,
                    "unpublished": sorted(r["mapping"] for r in pool),
                    "reason": f"no ENABLED {source}->{target} mapping in DEV, a candidate checkout, or a published registry"}
    ids = sorted({r["mapping"].split("@")[0] for r in eligible})
    if len(ids) > 1:
        return {"status": "AMBIGUOUS", "selected": None, "candidates": ranked,
                "reason": f"{len(ids)} different {source}->{target} mapping ids ({', '.join(ids)}); choose one"}
    chosen = max(eligible, key=lambda r: _semver(r["mapping"]))
    published_non_prod = bool(selection_labels(chosen))
    rule = "latest-published-semver" if published_non_prod else "latest-candidate-semver"
    selection = version_selection(pool, chosen, None, rule)
    versions = [c["version"] for c in selection["candidates"]]
    if len(versions) == 1 and published_non_prod:
        selection["rule"] = "single-match"
        return {"status": "RESOLVED", "selected": chosen["mapping"], "candidates": ranked, "versionSelection": selection}
    scope = " matching the request" if len(pool) < len(ranked) else ""
    notice = f"Resolved {chosen['mapping']} — latest of {', '.join(versions)}{scope}; add @x.y.z to pick another."
    if not published_non_prod:
        notice += " Not in a DEV catalog; continuing to DEV execution proof from the pinned candidate."
    selection["notice"] = notice
    selection["rule"] = rule
    return {"status": "RESOLVED", "selected": chosen["mapping"], "candidates": ranked,
            "selectionRule": rule, "reason": notice, "versionSelection": selection}


def cumulative_superset(matches: list[dict]) -> dict | None:
    """Cumulative versions: pick the highest version of one mapping id when its outputs contain every other match's outputs."""
    if len(matches) < 2 or len({m["mapping"].split("@")[0] for m in matches}) != 1:
        return None
    top = max(matches, key=lambda m: _semver(m["mapping"]))
    if all(set(m.get("outputs", [])) <= set(top.get("outputs", [])) for m in matches):
        return top
    return None


def nearest_candidates(registry: Registry, source: str | None, target: str | None, terms: list[str]) -> list[dict]:
    out = []
    inverse_inputs: set[str] = set()
    if source and target:
        for inv in registry.enabled(source=target, target=source):
            inverse_inputs |= {normalize_dataset(n) for n in inv.input_names}
    for m in registry.enabled():
        reasons, score = [], 0
        if source and m.source == source:
            reasons.append("same-source")
            score += 1
        if target and m.target == target:
            reasons.append("same-target")
            score += 1
        if source and target and m.source == target and m.target == source:
            reasons.append("inverse-direction")
            score += 3
        for term in terms:
            if term == HUB_LANGUAGE:
                continue
            if term and (term in m.id or any(term in n.lower() for n in m.input_names + m.output_names)):
                reasons.append(f"mentions-{term}")
                score += 2
        if inverse_inputs and m.target == target and m.source != source:
            overlap = inverse_inputs & {normalize_dataset(n) for n in m.output_names}
            if overlap:
                reasons.append(f"produces-{len(overlap)}-of-{len(inverse_inputs)}-inverse-inputs")
                score += 4 * len(overlap) / len(inverse_inputs)
        if reasons:
            out.append({"mapping": m.key, "from": m.source, "to": m.target, "reasons": sorted(set(reasons)), "score": round(score, 2)})
    out.sort(key=lambda c: (-c["score"], c["mapping"]))
    for retired in registry.retired:
        if any(t and t in retired for t in terms):
            out.append({"mapping": retired, "from": None, "to": None, "reasons": ["retired-in-lexicon"]})
    for retired in sorted(registry.retired_keys):
        if any(t and t != HUB_LANGUAGE and t in retired for t in terms):
            out.append({"mapping": retired, "from": None, "to": None, "reasons": ["retired-in-kit"]})
    known = sorted(registry.known_languages())
    for term in terms:
        for close in difflib.get_close_matches(term, known, n=2, cutoff=0.75):
            if close != term:
                out.append({"mapping": None, "language": close, "reasons": [f"spelling-close-to-{term}"]})
    if not out:
        out = [{"mapping": None, "language": name, "reasons": ["registered-language"]} for name in known]
    return out


def continuation_steps(registry: Registry, source: str, forward: Mapping) -> dict:
    inverse = registry.enabled(source=forward.target, target=forward.source)
    produced = {normalize_dataset(n) for n in forward.output_names}
    cross = []
    for m in registry.enabled(source=forward.target):
        if m.target == forward.source:
            continue
        overlap = produced & {normalize_dataset(n) for n in m.input_names}
        if overlap:
            cross.append({"mapping": m.key, "to": m.target, "consumesForwardOutputs": sorted(overlap)})
    return {
        "inverse": [m.key for m in inverse],
        "crossSource": cross,
    }


def main_history_commits(root: Path | None, label: str) -> list[str] | None:
    """Commits on the pinned main checkout whose concept-model diff adds or removes the label.

    Returns None when the checkout has no full history, so callers cannot mistake
    an unchecked concept for an additive one.
    """
    if root is None or not (root / ".git").exists():
        return None
    try:
        shallow = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--is-shallow-repository"],
            capture_output=True, text=True, check=True, timeout=60,
        ).stdout.strip()
        if shallow != "false":
            return None
        return subprocess.run(
            ["git", "-C", str(root), "log", "--format=%H", "-S", f'"type": "{label}"', "--", LAYOUT["conceptModelPath"]],
            capture_output=True, text=True, check=True, timeout=120,
        ).stdout.split()
    except (OSError, subprocess.SubprocessError):
        return None


def concept_checks(registry: Registry, mapping: Mapping, forbidden: list[str], selected_outputs: set[str] | None = None) -> list[dict]:
    if HUB_LANGUAGE not in (mapping.source, mapping.target):
        return []
    graph_side = mapping.outputs if mapping.target == HUB_LANGUAGE else mapping.inputs
    results = []
    for item in graph_side:
        raw = str(item.get("dataset") or item.get("table"))
        label = normalize_dataset(raw)
        has_graph_binding = "graph" in item or mapping.target == HUB_LANGUAGE
        main = (registry.main_concepts or {}).get(label)
        candidate = (registry.candidate_concepts or {}).get(label)
        check: dict = {"dataset": raw, "concept": label}
        if selected_outputs is not None and raw not in selected_outputs and label not in forbidden:
            results.append({**check, "state": "NOT_SELECTED"})
            continue
        if label in forbidden:
            state = "FORBIDDEN"
        elif registry.main_concepts is None:
            state = "MAIN_UNAVAILABLE"
        elif main and main["deprecated"]:
            state = "DEPRECATED_ON_MAIN"
        elif main:
            state = "ACTIVE_ON_MAIN"
        elif candidate and not candidate["deprecated"]:
            history = main_history_commits(registry.main_root, label)
            check["historyChecked"] = history is not None
            if history:
                state = "REMOVED_ON_MAIN"
                check["mainHistoryCommits"] = history
            else:
                state = "ADDED_IN_CANDIDATE"
        elif not has_graph_binding:
            state = "AUXILIARY_INPUT"
        else:
            state = "ABSENT"
        results.append({**check, "state": state})
    return results


def shared_forbidden_labels(registry: Registry) -> set[str]:
    return {c["label"] for c in registry.shared_forbidden.get("concepts", [])}


def sql_scan_tokens(registry: Registry, labels: list[str]) -> list[str]:
    props = {p["property"] for p in registry.shared_forbidden.get("properties", []) if p.get("sqlScan")}
    return sorted(set(labels) | props)


def base_findings(registry: Registry) -> list[dict]:
    """Findings that hold for every request: registry drift, retired mappings, forbidden model content."""
    findings = list(registry.drift)
    retired = {r["mapping"]: r["reason"] for r in registry.shared_forbidden.get("retiredMappings", [])}
    for key in sorted(set(registry.mappings) & set(retired)):
        findings.append({
            "code": "RetiredMappingInRegistry",
            "mapping": key,
            "registrySources": sorted({p.get("label") for p in registry.mappings[key].provenance}),
            "detail": retired[key],
        })
    for revision, concepts in (("candidate", registry.candidate_concepts), ("main", registry.main_concepts)):
        if concepts is None:
            continue
        for concept in registry.shared_forbidden.get("concepts", []):
            if concept["label"] in concepts:
                findings.append({"code": "ForbiddenConceptInLexicon", "revision": revision, "concept": concept["label"], "detail": concept["reason"]})
        for prop in registry.shared_forbidden.get("properties", []):
            owner = concepts.get(prop["concept"])
            if owner and prop["property"] in owner["properties"]:
                findings.append({
                    "code": "ForbiddenPropertyInLexicon",
                    "revision": revision,
                    "concept": prop["concept"],
                    "property": prop["property"],
                    "detail": prop["reason"],
                })
    return findings


def lexicon_model_comparison(registry: Registry) -> dict:
    candidate, main = lexicon_sha256(registry.candidate_root), lexicon_sha256(registry.main_root)
    result: dict = {"candidateSha256": candidate, "mainSha256": main, "identical": None}
    if candidate is None or main is None:
        return result
    result["identical"] = candidate == main
    left, right = registry.main_concepts or {}, registry.candidate_concepts or {}
    changed = {}
    for label in sorted(set(left) & set(right)):
        delta = {
            "addedProperties": sorted(set(right[label]["properties"]) - set(left[label]["properties"])),
            "removedProperties": sorted(set(left[label]["properties"]) - set(right[label]["properties"])),
            "addedIndexes": sorted(set(right[label]["indexes"]) - set(left[label]["indexes"])),
            "removedIndexes": sorted(set(left[label]["indexes"]) - set(right[label]["indexes"])),
        }
        if any(delta.values()):
            changed[label] = delta
    result.update({
        "addedConcepts": sorted(set(right) - set(left)),
        "removedConcepts": sorted(set(left) - set(right)),
        "changedConcepts": changed,
    })
    return result


def approved_additions_check(registry: Registry, approved: list[dict]) -> dict:
    """Remove exactly the approved (concept, property) additions from the candidate and compare the rest with main."""
    paths = [concept_model_path(root) if root else None for root in (registry.candidate_root, registry.main_root)]
    if not all(p and p.exists() for p in paths):
        return {"checked": False}
    candidate, main = (json.loads(p.read_text()) for p in paths)
    present, missing = [], []
    for item in approved:
        owner = next(
            (c for group in ("vertices", "edges") for c in candidate.get(group, []) if c.get("type") == item["concept"]),
            None,
        )
        props = (owner or {}).get("properties") or {}
        key = f"{item['concept']}.{item['property']}"
        if item["property"] in props:
            props.pop(item["property"])
            present.append(key)
        else:
            missing.append(key)
    canonical = lambda doc: json.dumps(doc, sort_keys=True, separators=(",", ":"))
    return {"checked": True, "approvedPresent": sorted(present), "approvedMissing": sorted(missing),
            "otherwiseIdentical": canonical(candidate) == canonical(main)}


def failing_concepts(checks: list[dict]) -> list[dict]:
    return [c for c in checks if c["state"] in {"FORBIDDEN", "REMOVED_ON_MAIN", "DEPRECATED_ON_MAIN", "ABSENT"}]


def sql_forbidden_labels(mapping: Mapping, forbidden: list[str]) -> list[dict]:
    hits = []
    for path in sorted(set(mapping.query_files)):
        text = path.read_text()
        for label in forbidden:
            if re.search(rf"(?<![a-z0-9_]){re.escape(label)}(?![a-z0-9_])", text, re.I):
                hits.append({"concept": label, "query": path.name, "sha256": sha256_file(path)})
    return hits


def definition_fields(registry: Registry, language: str, dataset: str) -> dict | None:
    info = registry.languages.get(language) or {}
    definition = info.get("definition")
    if not definition:
        return None
    return definition["datasets"].get(dataset) or definition["datasets"].get(normalize_dataset(dataset))


@dataclass
class ParityContext:
    declared: dict[str, dict[str, list[str]]] = field(default_factory=dict)
    policy: dict = field(default_factory=dict)
    contracts: dict[str, dict] = field(default_factory=dict)
    scope: str = "all-forward-inputs"


def derive_parity(registry: Registry, steps: list[Mapping], ctx: ParityContext) -> list[dict]:
    """Derive per-dataset field sets from language definitions and registrations."""
    derived = []
    if not steps:
        return derived
    declared = ctx.declared
    forward = steps[0]
    inverse = next((m for m in steps[1:] if m.source == forward.target and m.target == forward.source), None)
    if inverse is not None:
        reconstructed = set(inverse.output_names)
        for dataset in forward.input_names:
            derived.append(parity_entry(
                registry, forward.source, dataset, "round-trip", inverse.key, ctx,
                present=dataset in reconstructed,
                declared=declared.get(inverse.key, {}).get(dataset)
                or declared.get(forward.key, {}).get(dataset),
            ))
        for dataset in sorted(reconstructed - set(forward.input_names)):
            derived.append(parity_entry(
                registry, forward.source, dataset, "round-trip", inverse.key, ctx,
                present=True, declared=declared.get(inverse.key, {}).get(dataset), extra=True,
            ))
    for m in steps:
        if m is forward or m is inverse or m.target == HUB_LANGUAGE:
            continue
        for dataset in m.output_names:
            derived.append(parity_entry(
                registry, m.target, dataset, "projection", m.key, ctx, present=True,
                declared=declared.get(m.key, {}).get(dataset),
            ))
    if inverse is None and forward.target != HUB_LANGUAGE:
        for dataset in forward.output_names:
            derived.append(parity_entry(
                registry, forward.target, dataset, "projection", forward.key, ctx, present=True,
                declared=declared.get(forward.key, {}).get(dataset),
            ))
    return derived


def parity_entry(registry, language, dataset, kind, mapping_key, ctx: ParityContext, *, present, declared, extra=False) -> dict:
    spec = definition_fields(registry, language, dataset)
    entry = {
        "language": language,
        "dataset": dataset,
        "comparison": kind,
        "comparedBy": mapping_key,
        "reconstructed": present,
    }
    contract = ctx.contracts.get(dataset)
    if not present and ctx.scope == "inverse-outputs":
        entry.update({
            "fieldSource": "language-definition" if spec else "UNDEFINED_IN_LEXICON",
            "fields": [],
            "status": "OUT_OF_SCOPE",
            "note": "the profile compares only datasets the inverse mapping outputs",
        })
        return entry
    if spec is None:
        if ctx.policy.get("undefinedDatasets") == "consumer-contract" and contract and contract["columnSource"] == "consumer-contract":
            entry.update({
                "fieldSource": "consumer-contract",
                "fields": list(contract["columns"]),
                "comparedFields": list(contract["columns"]),
                "columnConstraints": contract.get("columnConstraints", []),
                "status": "DERIVED",
            })
            return entry
        entry.update({
            "fieldSource": "UNDEFINED_IN_LEXICON",
            "fields": [],
            "status": "BLOCKED",
            "finding": "TargetSchemaUndefined" if registry.languages.get(language, {}).get("definition") is None else "DatasetUndefined",
        })
        return entry
    fields = sorted(spec["properties"])
    enums = {k: p["enum"] for k, p in spec["properties"].items() if isinstance(p, dict) and isinstance(p.get("enum"), list)}
    exact = ctx.policy.get("declaredFields") == "exact" and declared is not None
    compared = [f for f in declared if f in spec["properties"]] if exact else fields
    entry.update({
        "fieldSource": "language-definition",
        "fields": fields,
        "comparedFields": compared,
        "requiredFields": sorted(spec["required"]),
        "coverageTargets": [{"field": k, "values": v} for k, v in sorted(enums.items()) if k in compared],
        "status": "DERIVED",
    })
    if not present:
        entry.update({"status": "FAIL", "finding": "RoundTripDatasetGap"})
    if extra:
        entry["note"] = "reconstructed by the inverse mapping but not read by the forward mapping"
    if declared is not None:
        entry["profileDeclared"] = {
            "missingFromProfile": [] if exact else sorted(set(fields) - set(declared)),
            "excludedByProfile": sorted(set(fields) - set(declared)) if exact else [],
            "unknownToDefinition": sorted(set(declared) - set(fields)),
        }
        if entry["profileDeclared"]["unknownToDefinition"]:
            entry.update({"status": "BLOCKED", "finding": "ProfileParityDrift"})
    return entry


def profile_mapping_key(mapping: dict) -> str | None:
    mid = mapping.get("id") or mapping.get("expectedId")
    version = mapping.get("version")
    planned = mapping.get("plannedSource", {}).get("generatedArtifact", {}).get("logicalArtifactPath", "")
    if not version and planned.count("/") >= 3:
        version = planned.split("/")[2]
    return f"{mid}@{version}" if mid and version else None


def output_contract_drift(direction: dict, live: Mapping) -> list[dict]:
    drift = []
    live_outputs = {o.get("dataset"): o for o in live.outputs}
    options = live.output.get("options") or {}
    for contract in direction.get("outputContracts", []):
        dataset = contract["dataset"]
        registered = live_outputs.get(dataset)
        if registered is not None and "requiredInputs" in registered:
            expected, actual = set(contract["requiredInputs"]), set(registered.get("requiredInputs") or [])
            if expected != actual:
                drift.append({
                    "direction": direction["id"],
                    "code": "ProfileOutputInputDrift",
                    "dataset": dataset,
                    "missingFromRegistry": sorted(expected - actual),
                    "missingFromProfile": sorted(actual - expected),
                })
        fmt = contract["format"]
        observed = {"delimiter": options.get("delimiter", ","), "header": options.get("header", False),
                    **output_format(live, registered or {})}
        mismatched = sorted(k for k in fmt if fmt[k] != observed.get(k))
        if mismatched:
            drift.append({
                "direction": direction["id"],
                "code": "OutputFormatDrift",
                "dataset": dataset,
                "fields": mismatched,
                "expected": {k: fmt[k] for k in mismatched},
                "registered": {k: observed.get(k) for k in mismatched},
            })
    return drift


def match_profiles(registry: Registry, keys: list[str]) -> list[dict]:
    matches = []
    for profile in registry.profiles:
        signals, drift = [], []
        for direction in profile.get("directions", []):
            mapping = direction.get("mapping", {})
            key = profile_mapping_key(mapping)
            if key in keys:
                signals.append(f"mapping-match-{direction['id']}")
                live = registry.mappings.get(key)
                if live is None:
                    continue
                if mapping.get("status") == "not-registered" and live.status == "ENABLED":
                    drift.append({
                        "direction": direction["id"],
                        "code": "ProfileRegistrationStatusDrift",
                        "profileStatus": "not-registered",
                        "registryStatus": live.status,
                        "registrySources": [p.get("label") for p in live.provenance],
                    })
                expected = mapping.get("expectedOutputDatasets") or mapping.get("plannedSource", {}).get("expectedOutputDatasets")
                match_mode = mapping.get("outputDatasetMatch") or mapping.get("plannedSource", {}).get("outputDatasetMatch") or "exact"
                missing_from_registry = sorted(set(expected or []) - set(live.output_names))
                missing_from_profile = [] if match_mode == "includes" else sorted(set(live.output_names) - set(expected or []))
                if expected is not None and (missing_from_registry or missing_from_profile):
                    drift.append({
                        "direction": direction["id"],
                        "code": "ProfileOutputDatasetDrift",
                        "match": match_mode,
                        "missingFromRegistry": missing_from_registry,
                        "missingFromProfile": missing_from_profile,
                    })
                drift.extend(output_contract_drift(direction, live))
        if signals:
            matches.append({"profileId": profile["id"], "hardSignals": signals, "drift": drift})
    return matches


def profile_parity_fields(profile: dict | None) -> dict[str, dict[str, list[str]]]:
    if not profile:
        return {}
    out: dict[str, dict[str, list[str]]] = {}
    for direction in profile.get("directions", []):
        key = profile_mapping_key(direction.get("mapping", {}))
        out[key] = {p["dataset"]: p["fields"] for p in direction.get("parityDatasets", [])}
    return out


def profile_output_subsets(profile: dict | None) -> dict[str, set[str]]:
    """Mappings a profile runs with a selected subset of outputs (outputDatasetMatch: includes)."""
    out: dict[str, set[str]] = {}
    for direction in (profile or {}).get("directions", []):
        mapping = direction.get("mapping", {})
        source = mapping if mapping.get("status") == "registered" else mapping.get("plannedSource", {})
        if source.get("outputDatasetMatch") == "includes":
            out[profile_mapping_key(mapping)] = set(source.get("expectedOutputDatasets", []))
    return out


def profile_output_contracts(profile: dict | None) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for direction in (profile or {}).get("directions", []):
        for contract in direction.get("outputContracts", []):
            out[contract["dataset"]] = contract
    return out


def planned_candidates(registry: Registry, source: str, target: str, phrases: set[str]) -> list[dict]:
    """Profile directions for this language pair whose mapping is declared but not registered anywhere."""
    out = []
    for profile in registry.profiles:
        for direction in profile.get("directions", []):
            mapping = direction.get("mapping", {})
            if mapping.get("status") != "not-registered":
                continue
            if (direction.get("fromLanguage"), direction.get("toLanguage")) != (source, target):
                continue
            key = profile_mapping_key(mapping)
            if key is None or key in registry.mappings:
                continue
            outputs = {normalize_dataset(d) for d in mapping.get("plannedSource", {}).get("expectedOutputDatasets", [])}
            matched = sorted(outputs & phrases)
            out.append({
                "mapping": key,
                "from": source,
                "to": target,
                "status": "PLANNED",
                "reasons": ["profile-planned-not-registered", *[f"output-dataset-{d}" for d in matched]],
                "score": 4 * len(matched),
                "profiles": [profile["id"]],
                "owner": mapping.get("owner"),
                "detail": mapping.get("reason"),
            })
    return out


def dataset_recommendations(source: str, profile: dict | None, window: str) -> list[dict]:
    recs = []
    for source_entry in (profile or {}).get("validationSources", []):
        if source_entry.get("kind") in {"existing-dev-artifact", "sanitized-evidence-package"}:
            status = source_entry.get("artifactStatus", "ready" if source_entry.get("manifestFileSha256") else "unknown")
            rec = {
                "id": source_entry["id"],
                "kind": source_entry["kind"],
                "location": source_entry["location"],
                "status": status,
                "manifestFileSha256": source_entry.get("manifestFileSha256"),
                "note": (
                    "Existing profile evidence; verify manifest digest and version before use."
                    if status == "ready"
                    else f"Profile location reserved but not staged ({status}); cannot prove runtime behavior until it has a manifest digest and version."
                ),
            }
            if source_entry.get("tbd"):
                rec["tbd"] = source_entry["tbd"]
            recs.append(rec)
    language = source.replace("_", "-")
    recs.extend([
        {
            "id": "prod-derived-canary",
            "kind": "proposed-prod-derived",
            "location": f"s3://<dev-transform-data-bucket>/{DATA_BUCKET_INPUT_ROOT}/{language}-prod-derived/{window}_canary_v1/",
            "note": "10 real events per slice from the confirmed PROD UTC window, chosen deterministically; staged to DEV after approval and run first.",
        },
        {
            "id": "prod-derived-full-utc-day",
            "kind": "proposed-prod-derived",
            "location": f"s3://<dev-transform-data-bucket>/{DATA_BUCKET_INPUT_ROOT}/{language}-prod-derived/{window}_v1/",
            "note": "The whole confirmed UTC window read from PROD, manifested with SHA-256, written to DEV after approval; runs only after the canary passes and the full run is approved.",
        },
    ])
    return recs


NOT_SELECTABLE = {"retired-in-lexicon", "retired-in-kit", "profile-planned-not-registered"}


def question_plan(
    status: str,
    selection: dict,
    continuation: dict | None,
    hints: dict,
    recommendations: list[dict],
    candidates: list[dict],
    *,
    upstream_candidates: list[str] | None = None,
    upstream_default: str | None = None,
    default_mode: str = "round-trip",
    persist_policy: str | None = None,
) -> list[dict]:
    questions = []
    if status in {"AMBIGUOUS", "NO_MAPPING", "UNKNOWN_LANGUAGE"}:
        options = [
            {
                "id": c["mapping"] or c.get("language"),
                "label": f"{c['mapping'] or c.get('language')} ("
                + ", ".join(c.get("reasons", []) or [f"serves {q}" for q in c.get("servesQualifiers", [])] or ["candidate"])
                + (f"; profile {', '.join(c['profiles'])}" if c.get("profiles") else "")
                + ")",
            }
            for c in candidates
            if (c.get("mapping") or c.get("language"))
            and not NOT_SELECTABLE & set(c.get("reasons", []))
        ]
        options.append({"id": "none", "label": "None of these; stop and report the gap"})
        questions.append({
            "id": "mapping-choice",
            "prompt": "Which registered mapping should Silvally validate?",
            "options": options,
            "allowMultiple": False,
            "default": None,
        })
        return questions
    if hints.get("environment") is None:
        questions.append({
            "id": "environment",
            "prompt": f"Which environment should Silvally validate against ({LAYOUT['repository']['defaultRegion']})?",
            "options": [
                {"id": "dev", "label": "DEV (default): approval-gated staging and runs"},
                {"id": "prod-read-only", "label": "PROD read-only: metadata and existing evidence only"},
            ],
            "allowMultiple": False,
            "default": "dev",
        })
    versions = [c for c in selection.get("candidates", [])]
    if len(versions) > 1 and hints.get("version") is None and selection.get("selectionRule") not in {
        "latest-published-semver", "latest-candidate-semver",
    }:
        questions.append({
            "id": "mapping-version",
            "prompt": f"Silvally selected {selection['selected']}. Confirm the mapping version:",
            "options": [{"id": c["mapping"], "label": f"{c['mapping']} -> {', '.join(c['outputs'])}"} for c in versions],
            "allowMultiple": False,
            "default": selection["selected"],
        })
    if upstream_candidates:
        questions.append({
            "id": "upstream-source",
            "prompt": "Which upstream mapping produces the Lexicon graph this projection reads?",
            "options": [
                *[{"id": key, "label": f"Run {key} first, then the projection"} for key in upstream_candidates],
                {"id": "existing-graph-export", "label": "Use an existing immutable DEV graph export (manifest + SHA-256 required)"},
            ],
            "allowMultiple": False,
            "default": upstream_default if upstream_default in set(upstream_candidates) | {"existing-graph-export"} else None,
        })
    if continuation and continuation["inverse"] and hints.get("mode") is None:
        questions.append({
            "id": "direction-mode",
            "prompt": "Round-trip or one-way?",
            "options": [
                {"id": "round-trip", "label": f"Round-trip: forward then {', '.join(continuation['inverse'])} with field parity"},
                {"id": "one-way", "label": "One-way: forward mapping and target-shape checks only"},
            ],
            "allowMultiple": False,
            "default": default_mode,
        })
    if continuation and continuation["crossSource"]:
        questions.append({
            "id": "cross-source-step",
            "prompt": "Include a downstream cross-source step after the forward mapping?",
            "options": [
                *[{"id": c["mapping"], "label": f"{c['mapping']} (consumes {', '.join(c['consumesForwardOutputs'])})"} for c in continuation["crossSource"]],
                {"id": "none", "label": "No downstream step"},
            ],
            "allowMultiple": True,
            "default": None,
        })
    if persist_policy is not None:
        return questions
    questions.append({
        "id": "persist-policy",
        "prompt": "May the validation write a bounded canary to Persist?",
        "options": [
            {"id": "forbidden", "label": "Forbidden (default): prove graph closure from Transform outputs only"},
            {"id": "required", "label": "Required: bounded DEV canary and readback, each write approval-gated"},
        ],
        "allowMultiple": False,
        "default": "forbidden",
    })
    return questions


def load_registry(args) -> Registry:
    lexicon_root = Path(args.lexicon_root) if args.lexicon_root else None
    main_root = Path(args.main_lexicon_root) if args.main_lexicon_root else None
    forbidden_path = getattr(args, "forbidden_concepts", None)
    groups, labels = [], []
    if lexicon_root:
        groups.append(load_checkout_registrations("candidate", lexicon_root))
        labels.append("candidate")
    for spec in args.registry or []:
        label, _, path = spec.partition("=")
        groups.append(load_registry_dir(label, Path(path)))
        labels.append(label)
    mappings, drift = merge_mappings(groups)
    ssm_files = {}
    for spec in args.ssm_parameters or []:
        label, _, path = spec.partition("=")
        ssm_files[label] = Path(path)
    return Registry(
        languages=load_languages(lexicon_root, ssm_files),
        mappings=mappings,
        retired=load_retired_ids(main_root or lexicon_root) if (main_root or lexicon_root) else [],
        drift=drift,
        main_concepts=load_concepts(main_root),
        candidate_concepts=load_concepts(lexicon_root),
        profiles=load_profiles([Path(p) for p in args.profiles or []]),
        registry_labels=labels,
        main_root=main_root,
        candidate_root=lexicon_root,
        shared_forbidden=load_forbidden(Path(forbidden_path) if forbidden_path else DEFAULT_FORBIDDEN),
    )


def slice_records(catalog: dict, names: list[str]) -> list[dict]:
    declared = catalog.get("slices") or {}
    out = []
    for name in names:
        spec = declared.get(name) or {"id": name, "outputDatasets": [], "introducedIn": "0.0.0"}
        out.append({
            "id": spec.get("id", name),
            "outputDatasets": list(spec.get("outputDatasets") or []),
            "introducedIn": spec.get("introducedIn"),
        })
    return out


def pick_version_for_slices(selection: dict, registry: Registry, slices: list[dict]) -> tuple[dict, list[dict]]:
    """Keep the latest version that emits every named slice's datasets; otherwise keep the default."""
    required = {dataset for spec in slices for dataset in spec["outputDatasets"]}
    if not required:
        return selection, []
    candidates = [c for c in (selection.get("candidates") or []) if c.get("mapping")]
    if selection.get("selected"):
        mapping_id = selection["selected"].split("@")[0]
        pool = [c for c in candidates if c["mapping"].split("@")[0] == mapping_id]
    else:
        ids = {c["mapping"].split("@")[0] for c in candidates}
        if len(ids) != 1:
            return selection, []
        pool = [c for c in candidates if c["mapping"].split("@")[0] == next(iter(ids))]
    covering = [c for c in pool if required <= set(c.get("outputs") or [])]
    findings = []
    requested = (selection.get("versionSelection") or {}).get("requested")
    if requested:
        chosen = next((c for c in pool if c["mapping"].endswith(f"@{requested}")), None)
        if chosen and required <= set(chosen.get("outputs") or []):
            return selection, findings
        if selection.get("selected"):
            findings.append({
                "code": "SliceOutputsMissing",
                "mapping": selection["selected"],
                "slices": [spec["id"] for spec in slices],
                "datasets": sorted(required),
                "detail": "the selected version does not declare every named slice's outputs",
            })
        return selection, findings
    if covering:
        chosen = max(covering, key=lambda r: _semver(r["mapping"]))
        if selection.get("status") != "RESOLVED" or chosen["mapping"] != selection.get("selected"):
            rule = "latest-published-semver" if selection_labels(chosen) else "latest-candidate-semver"
            notice = (
                f"Resolved {chosen['mapping']} — latest of the versions that emit every named slice; "
                "add @x.y.z to pick another."
            )
            selection = {
                **selection,
                "status": "RESOLVED",
                "selected": chosen["mapping"],
                "selectionRule": rule,
                "reason": notice,
                "versionSelection": version_selection(candidates or pool, chosen, None, rule),
            }
            selection["versionSelection"]["notice"] = notice
    elif selection.get("selected"):
        findings.append({
            "code": "SliceOutputsMissing",
            "mapping": selection["selected"],
            "slices": [spec["id"] for spec in slices],
            "datasets": sorted(required),
            "detail": "the selected version does not declare every named slice's outputs",
        })
    return selection, findings


def discover(request: str, registry: Registry, window: str = "<startZ>_<endExclusiveZ>",
             slice_catalog: dict | None = None, actuals: dict | None = None) -> dict:
    catalog = slice_catalog if slice_catalog is not None else load_slice_catalog()
    actuals = actuals if actuals is not None else load_actuals_catalog()
    parsed = parse_request(request, catalog)
    result: dict = {"parsed": parsed, "intakeState": "NEEDS_INPUT", "registrySources": registry.registry_labels,
                    "ownerDecisions": parsed["hints"]["ownerDecisions"]}
    if parsed["status"] != "PARSED":
        result.update({"status": "UNPARSED", "questions": [], "nextStep": parsed["reason"]})
        return result
    if parsed["hints"].get("environment") == "prod":
        parsed["hints"]["environment"] = "dev"
        parsed["hints"]["prodCatalogReadOnly"] = True
        result["prodTransform"] = "forbidden"
        result["notice"] = (
            "PROD Transform is never invoked. Catalog and source-window inspection may be "
            "read-only PROD; execution proof is DEV."
        )
    source, source_quals, source_conflict = split_terms(registry, parsed["sourceTerms"])
    target, target_quals, target_conflict = split_terms(registry, parsed["targetTerms"])
    qualifiers = [q for q in parsed["qualifiers"] + source_quals + target_quals if q not in {source, target}]
    result["intent"] = {"source": source, "target": target, "qualifiers": qualifiers}
    languages = {n: language_status(registry, n) for n in {source, target, *qualifiers} if n}
    result["languages"] = languages
    if source_conflict or target_conflict or not source or not target:
        result.update({
            "status": "AMBIGUOUS",
            "reason": "More than one language named on one side of the request",
            "candidates": [{"mapping": None, "language": n, "reasons": ["named-in-request"]} for n in source_conflict + target_conflict],
        })
        result["questions"] = question_plan("AMBIGUOUS", {}, None, parsed["hints"], [], result["candidates"])
        return result

    unknown = [n for n in (source, target) if languages[n]["state"] == "UNKNOWN"]
    requested_slices = slice_records(catalog, parsed.get("slices") or [])
    package = catalog.get("package") or {}
    findings_early: list[dict] = []
    if requested_slices and package.get("from") == source and package.get("to") == target:
        if parsed["hints"].get("mode") is None:
            parsed["hints"]["mode"] = "one-way"
        result["slices"] = requested_slices
    elif requested_slices:
        result["slices"] = []
        findings_early.append({
            "code": "PackageSlicePairMismatch",
            "detail": "named slices apply only to the catalog package language pair; they were ignored",
            "slices": [spec["id"] for spec in requested_slices],
        })
    else:
        result["slices"] = []
    selection = select_mapping(registry, source, target, qualifiers, parsed["hints"]["version"])
    if result.get("slices"):
        selection, slice_findings = pick_version_for_slices(selection, registry, result["slices"])
    else:
        slice_findings = []
    result["selection"] = selection
    if selection.get("versionSelection"):
        result["versionSelection"] = selection["versionSelection"]
        if selection["versionSelection"].get("notice"):
            result["notice"] = selection["versionSelection"]["notice"]
    result["lexiconModel"] = lexicon_model_comparison(registry)
    findings = base_findings(registry) + findings_early + slice_findings
    chosen_key = selection.get("selected")
    chosen = next((c for c in selection.get("candidates") or [] if c.get("mapping") == chosen_key), None)
    prod_inspected = any(label in PROD_REGISTRY_LABELS for label in registry.registry_labels)
    if chosen_key and chosen and prod_inspected and not (set(published_labels(chosen)) & PROD_REGISTRY_LABELS):
        findings.append({
            "code": "UnpublishedInProd",
            "mapping": chosen_key,
            "severity": "informational",
            "detail": (
                "PROD catalog lacks this version; expected for a PR or unpublished mapping. "
                "This is not a mapping NOT_READY. Continue to DEV execution proof "
                "(UTC-day confirmation and DEV write approval)."
            ),
        })
        extra = " Unpublished in PROD (expected for a PR mapping); continuing to DEV execution proof."
        if extra not in (result.get("notice") or ""):
            result["notice"] = ((result.get("notice") or selection.get("reason") or "") + extra).strip()
            if result.get("versionSelection"):
                result["versionSelection"]["notice"] = result["notice"]
    if parsed["hints"].get("prodCatalogReadOnly"):
        findings.append({
            "code": "ProdTransformForbidden",
            "severity": "informational",
            "detail": "PROD Transform is never invoked (no StartExecution, Glue job, or write). Execution proof is DEV.",
        })
    phrases = qualifier_phrases(qualifiers)
    planned = planned_candidates(registry, source, target, phrases)
    findings.extend({
        "code": "PlannedMappingNotRegistered",
        "mapping": p["mapping"],
        "profile": p["profiles"][0],
        "owner": p["owner"],
        "matchesRequest": any(r.startswith("output-dataset-") for r in p["reasons"]),
        "detail": p["detail"],
    } for p in planned)
    for name in (source, target):
        state = languages[name]["state"]
        if state in {"MAPPING_ENDPOINT_ONLY", "REGISTERED_WITHOUT_DEFINITION"}:
            findings.append({
                "code": "LanguageDefinitionMissing",
                "language": name,
                "state": state,
                "detail": f"'{name}' is used by {languages[name]['usedByMappings']} but has no {LAYOUT['languageDefinitionPath'].format(language=name)} definition in the inspected registry revision",
            })

    if unknown or selection["status"] == "NO_MAPPING":
        status = "UNKNOWN_LANGUAGE" if unknown else "NO_MAPPING"
        candidates = nearest_candidates(registry, source, target, [source, target, *qualifiers]) + planned
        candidates = [{"mapping": key, "from": source, "to": target, "reasons": ["registered-not-published"], "score": 10}
                      for key in selection.get("unpublished", [])] + candidates
        request_terms = {t for t in (source, target, *qualifiers) if t and t != HUB_LANGUAGE}
        for candidate in candidates:
            if candidate.get("mapping"):
                candidate["profiles"] = [
                    p["id"] for p in registry.profiles if candidate["mapping"] in profile_parity_fields(p)
                ]
                for p in registry.profiles:
                    if p["id"] not in candidate["profiles"]:
                        continue
                    aliases = {
                        word
                        for values in p.get("terminologyAliases", {}).values()
                        for phrase in values
                        for word in phrase.lower().split()
                    }
                    if request_terms & aliases:
                        candidate["reasons"] = sorted(set(candidate["reasons"]) | {f"profile-alias-{p['id'].removesuffix('.json')}"})
                        candidate["score"] = round(candidate.get("score", 0) + 2, 2)
        candidates.sort(key=lambda c: (-c.get("score", 0), c.get("mapping") or c.get("language") or ""))
        result.update({"status": status, "candidates": candidates, "findings": findings})
        result["questions"] = question_plan(status, selection, None, parsed["hints"], [], candidates)
        result["nextSteps"] = [
            "Choose one of the listed registered mappings, or",
            "hand the missing language/mapping to Mew (schema lookup) and Kecleon (mapping implementation); Silvally does not create mappings.",
        ]
        return result
    if selection["status"] == "AMBIGUOUS":
        candidates = selection["candidates"] + sorted(planned, key=lambda c: -c["score"])
        result.update({"status": "AMBIGUOUS", "candidates": candidates, "findings": findings})
        result["questions"] = question_plan("AMBIGUOUS", selection, None, parsed["hints"], [], candidates)
        if any(f["code"] == "PlannedMappingNotRegistered" and f["matchesRequest"] for f in findings):
            result["nextSteps"] = [
                "The request names outputs of a mapping a profile declares but no inspected registry registers.",
                "Re-run with the candidate Lexicon branch checkout, or its cdk synth transform-mappings output as --registry, once the mapping owner publishes it; Silvally does not create mappings.",
            ]
        return result

    primary = registry.mappings[selection["selected"]]
    selected_summary = next(c for c in selection["candidates"] if c["mapping"] == primary.key)
    sliced = bool(result.get("slices"))
    if sliced and parsed["hints"].get("mode") is None:
        parsed["hints"]["mode"] = "one-way"
    upstream: list[str] = []
    if sliced:
        mode = parsed["hints"]["mode"] or "one-way"
        steps = [primary]
        continuation = {"inverse": [], "crossSource": []}
        builders = {spec["id"]: ((actuals or {}).get("slices") or {}).get(spec["id"], {}).get("inputBuilder")
                    for spec in result["slices"]}
        if primary.source == HUB_LANGUAGE and all(builders.values()):
            result["upstreamSource"] = {"kind": "prod-derived-input-builders", "slices": builders,
                                        "detail": "graph slices read a bounded read-only PROD Persist Gremlin neighbourhood "
                                                  "of the window's keys (graph_inputs.py); event slices take the PROD "
                                                  "Lambda's real inputs (prod_actuals.py inputs)"}
            findings.append({"code": "UpstreamSourceDefaulted", "mapping": primary.key, "severity": "informational",
                             "detail": "every named slice has a catalogued PROD-derived input builder; no answer is needed",
                             "slices": builders})
        elif primary.source == HUB_LANGUAGE:
            findings.append({
                "code": "UpstreamSourceUnresolved",
                "mapping": primary.key,
                "detail": (
                    "Named package slices are one-way projections from an existing graph; "
                    "choose an existing immutable graph export or an upstream producer. "
                    "Slice words are not producer languages."
                ),
                "candidates": [
                    m.key for m in registry.enabled(target=HUB_LANGUAGE)
                    if discriminating_inputs(registry.enabled(source=HUB_LANGUAGE, target=primary.target)).get(primary.key, set())
                    & {normalize_dataset(n) for n in m.output_names}
                ],
            })
    elif primary.source == HUB_LANGUAGE:
        upstream = sorted({
            s["via"] for s in selected_summary["signals"] if s["kind"] == "chain-producer"
        })
    mode = parsed["hints"]["mode"]
    if not sliced and primary.source == HUB_LANGUAGE and len(upstream) == 1:
        # Cross-source request: the qualifier's producer feeds the hub projection.
        producer = registry.mappings[upstream[0]]
        continuation = continuation_steps(registry, producer.source, producer)
        steps = [producer]
        if mode == "round-trip":
            steps += [registry.mappings[k] for k in continuation["inverse"][-1:]]
        steps.append(primary)
        continuation = {"inverse": continuation["inverse"] if mode is None else [], "crossSource": []}
    elif not sliced and primary.source == HUB_LANGUAGE:
        steps = [primary]
        continuation = {"inverse": [], "crossSource": []}
        findings.append({
            "code": "UpstreamSourceUnresolved",
            "mapping": primary.key,
            "detail": f"No unique <qualifier>-to-{HUB_LANGUAGE} producer feeds this projection; choose an upstream mapping or an existing immutable graph export",
            "candidates": [
                m.key for m in registry.enabled(target=HUB_LANGUAGE)
                if discriminating_inputs(registry.enabled(source=HUB_LANGUAGE, target=primary.target)).get(primary.key, set())
                & {normalize_dataset(n) for n in m.output_names}
            ],
        })
    elif not sliced:
        continuation = continuation_steps(registry, source, primary)
        steps = [primary]
        inverse_keys = continuation["inverse"]
        if phrases and len(inverse_keys) > 1:
            matching = [
                k for k in inverse_keys
                if phrases & {normalize_dataset(n) for n in registry.mappings[k].output_names}
            ]
            if len(matching) == 1:
                inverse_keys = matching
                continuation["inverse"] = matching
            elif not matching:
                planned_inverse = [
                    p for p in planned_candidates(registry, target, source, phrases)
                    if any(r.startswith("output-dataset-") for r in p["reasons"])
                ]
                findings.extend({
                    "code": "PlannedMappingNotRegistered",
                    "mapping": p["mapping"],
                    "profile": p["profiles"][0],
                    "owner": p["owner"],
                    "matchesRequest": True,
                    "detail": p["detail"],
                } for p in planned_inverse)
                if planned_inverse:
                    inverse_keys = []
                    continuation["inverse"] = []
        if mode != "one-way":
            steps += [registry.mappings[k] for k in inverse_keys[-1:]]
    forward = steps[0]
    profiles = match_profiles(registry, [m.key for m in steps] + [c["mapping"] for c in continuation["crossSource"]])
    step_keys = {m.key for m in steps}
    first_step = [p for p in profiles if p["profileId"] in {
        prof["id"] for prof in registry.profiles
        if step_keys <= set(profile_parity_fields(prof))
    }]
    selected_profile = None
    if len(first_step) == 1:
        selected_profile = next(p for p in registry.profiles if p["id"] == first_step[0]["profileId"])
    step_pairs = {(m.source, m.target) for m in steps}
    forbidden = sorted({
        concept
        for p in registry.profiles
        if p is selected_profile
        or any((d.get("fromLanguage"), d.get("toLanguage")) in step_pairs for d in p.get("directions", []))
        for concept in p.get("lexiconConceptPolicy", {}).get("forbiddenConcepts", [])
    } | shared_forbidden_labels(registry) | {normalize_dataset(r) for r in registry.retired})
    model_policy = (selected_profile or {}).get("lexiconModelPolicy")
    model = result["lexiconModel"]
    approved = (model_policy or {}).get("approvedAdditions") or []
    if model_policy and approved and model["identical"] is False:
        model["approvedAdditions"] = approved_additions_check(registry, approved)
    approved_only = bool(model.get("approvedAdditions", {}).get("otherwiseIdentical"))
    if approved_only:
        findings.append({
            "code": "LexiconModelApprovedAdditions",
            "profile": selected_profile["id"],
            "path": model_policy["path"],
            "approvedPresent": model["approvedAdditions"]["approvedPresent"],
            "approvedMissing": model["approvedAdditions"]["approvedMissing"],
        })
    if model_policy and model_policy["candidateLexiconDiff"] == "forbidden" and model["identical"] is False and not approved_only:
        findings.append({
            "code": "LexiconModelDiffersFromMain",
            "profile": selected_profile["id"],
            "path": model_policy["path"],
            "candidateSha256": model["candidateSha256"],
            "mainSha256": model["mainSha256"],
            "addedConcepts": model["addedConcepts"],
            "removedConcepts": model["removedConcepts"],
            "changedConcepts": model["changedConcepts"],
        })
    elif model_policy and model["identical"] is None:
        findings.append({
            "code": "LexiconModelUnchecked",
            "profile": selected_profile["id"],
            "detail": "Pass both --lexicon-root and --main-lexicon-root to prove the candidate concept model equals main",
        })
    optional = [registry.mappings[c["mapping"]] for c in continuation["crossSource"]]
    subsets = profile_output_subsets(selected_profile)
    concept = {m.key: concept_checks(registry, m, forbidden, subsets.get(m.key)) for m in steps + optional}
    for key, checks in concept.items():
        for c in failing_concepts(checks):
            removed = c["state"] in {"FORBIDDEN", "REMOVED_ON_MAIN"}
            findings.append({"code": "RemovedLexiconConcept" if removed else "LexiconConceptInactive", "mapping": key, **c})
    sql_scan = {}
    tokens = sql_scan_tokens(registry, forbidden)
    for m in steps + optional:
        hits = sql_forbidden_labels(m, tokens)
        sql_scan[m.key] = {"queriesScanned": len(set(m.query_files)), "forbiddenLabels": hits}
        findings.extend({"code": "ForbiddenConceptInSql", "mapping": m.key, **hit} for hit in hits)
    for m in steps:
        if m.target == HUB_LANGUAGE and m.output.get("shape") != "graph":
            findings.append({
                "code": "HubOutputNotGraph",
                "mapping": m.key,
                "detail": f"{m.key} writes {m.output.get('shape')}/{m.output.get('format')} into the Lexicon hub; graph identity and endpoint closure must be proven from tabular rows",
            })
    for p in profiles:
        findings.extend({"profile": p["profileId"], **d} for d in p["drift"])
    ctx = ParityContext(
        declared=profile_parity_fields(selected_profile),
        policy=(selected_profile or {}).get("parityPolicy") or {},
        contracts=profile_output_contracts(selected_profile),
        scope=(selected_profile or {}).get("roundTripStrategy", {}).get("comparisonScope", "all-forward-inputs"),
    )
    parity = derive_parity(registry, steps, ctx)
    for m in optional:
        for dataset in m.output_names:
            parity.append({**parity_entry(
                registry, m.target, dataset, "projection", m.key, ctx, present=True,
                declared=ctx.declared.get(m.key, {}).get(dataset),
            ), "optional": True})
    if forward.source != HUB_LANGUAGE:
        proposal_language = forward.source
    else:
        proposal_language = next((q for q in qualifiers if q in registry.known_languages()), f"{HUB_LANGUAGE}-{forward.target}")
    recommendations = dataset_recommendations(proposal_language, selected_profile, window)
    persist_policy = (selected_profile or {}).get("validationWorkflow", {}).get("persistPolicy")
    profile_workflow = profile_workflow_steps(registry, selected_profile)
    result.update({
        "status": "RESOLVED",
        "primaryDirection": primary.summary(),
        "workflow": {
            "steps": [
                {
                    "sequence": i + 1,
                    "mapping": primary.key,
                    "from": primary.source,
                    "to": primary.target,
                    "slice": spec["id"],
                    "outputDatasets": spec["outputDatasets"],
                    "inputSource": "profile-evidence",
                }
                for i, spec in enumerate(result["slices"])
            ] if result.get("slices") else [
                {"sequence": i + 1, "mapping": m.key, "from": m.source, "to": m.target,
                 "inputSource": "profile-evidence" if i == 0 else "previous-step-output"}
                for i, m in enumerate(steps)
            ],
            "optionalCrossSource": continuation["crossSource"],
            "persistPolicyDefault": persist_policy or "forbidden",
            "persistPolicySource": "profile" if persist_policy else "default",
        },
        "profileWorkflow": profile_workflow,
        "profileMatches": profiles,
        "selectedProfile": selected_profile["id"] if selected_profile else None,
        "parityPolicy": (selected_profile or {}).get("parityPolicy"),
        "partialInputPolicy": (selected_profile or {}).get("partialInputPolicy"),
        "conceptChecks": concept,
        "sqlScan": sql_scan,
        "parityDerivation": parity,
        "datasetRecommendations": recommendations,
        "findings": findings,
    })
    unresolved_upstream = next((f["candidates"] for f in findings if f.get("code") == "UpstreamSourceUnresolved"), None)
    result["questions"] = question_plan(
        "RESOLVED", selection, continuation, parsed["hints"], recommendations, [],
        upstream_candidates=unresolved_upstream,
        upstream_default=(
            "existing-graph-export" if result.get("slices")
            else next((s["mapping"] for s in profile_workflow if s["mapping"] != primary.key), None)
        ),
        default_mode="one-way" if (result.get("slices") or primary.source == HUB_LANGUAGE) else "round-trip",
        persist_policy=persist_policy,
    )
    return result


def profile_workflow_steps(registry: Registry, profile: dict | None) -> list[dict]:
    if not profile:
        return []
    directions = {d["id"]: d for d in profile.get("directions", [])}
    steps = []
    for step in profile.get("validationWorkflow", {}).get("steps", []):
        direction = directions.get(step["direction"], {})
        key = profile_mapping_key(direction.get("mapping", {}))
        live = registry.mappings.get(key)
        steps.append({
            "sequence": step["sequence"],
            "direction": step["direction"],
            "mapping": key,
            "inputSource": step["inputSource"],
            "profileStatus": direction.get("mapping", {}).get("status"),
            "registrySources": sorted({p.get("label") for p in live.provenance}) if live else [],
        })
    return steps


def draft_profile(request: str, discovery: dict, registry: Registry | None = None) -> dict:
    digest = hashlib.sha256(request.encode()).hexdigest()[:16]
    status = discovery.get("status")
    resolved = status == "RESOLVED"
    selected = discovery.get("selectedProfile")
    facts = []
    for fact_id in MATERIAL_FACT_IDS:
        state, value, question = "MISSING", None, None
        if fact_id == "source-and-target-meaning" and resolved:
            d = discovery["primaryDirection"]
            state, value = "INFERRED", f"{d['from']} -> {d['to']} via {d['mapping']}"
        elif fact_id == "required-directions" and resolved:
            state, value = "INFERRED", ", ".join(s["mapping"] for s in discovery["workflow"]["steps"])
        elif fact_id == "configuration-repository-and-ref" and resolved:
            state, value = "INFERRED", f"{LAYOUT['repository']['slug']} at the pinned candidate commit"
        elif fact_id == "sensitivity-and-handling":
            state, value = "INFERRED", "restricted; aggregates and digests only"
        elif fact_id == "configuration-product-boundary":
            state, value = "INFERRED", "validation only; Silvally never edits mappings"
        elif fact_id == "source-and-target-meaning":
            state = "AMBIGUOUS"
        if state in {"MISSING", "AMBIGUOUS"}:
            question = next(
                (q["prompt"] for q in discovery.get("questions", []) if fact_question(fact_id) == q["id"]),
                f"Confirm {fact_id.replace('-', ' ')}.",
            )
        facts.append({"id": fact_id, "state": state, "value": value, "evidenceIds": ["intent-resolution"] if value else [], "nextQuestion": question})
    draft = {
        "id": f"transform-configuration-draft-{digest}",
        "contractVersion": 1,
        "intakeState": "NEEDS_INPUT",
        "originalRequest": request,
        "candidateProfiles": [
            {
                "profileId": m["profileId"],
                "disposition": "SELECTED" if m["profileId"] == selected else "CANDIDATE",
                "hardSignals": m["hardSignals"],
                "reason": "registered mapping identity matches a profile direction",
            }
            for m in discovery.get("profileMatches", [])
        ],
        "selectedProfile": selected,
        "discoveryTrace": [
            {
                "kind": "mapping",
                "subject": "intent-resolution",
                "result": f"status {status}; registry sources {', '.join(discovery.get('registrySources', [])) or 'none'}",
                "evidenceIds": ["intent-resolution"],
            }
        ],
        "materialFacts": facts,
        "boundaryDecisions": [],
        "unresolvedFacts": [f["id"] for f in facts if f["state"] in {"MISSING", "AMBIGUOUS"}],
        "promotionEligible": False,
        "sensitivity": {"containsRawPii": False, "containsSecrets": False},
        "localLocation": f"local://transform-configuration-intake/draft-{digest}",
    }
    if discovery.get("versionSelection"):
        draft["versionSelection"] = discovery["versionSelection"]
    if resolved and registry is not None:
        draft["derivedDirections"] = [
            derive_direction(registry, registry.mappings[s["mapping"]]) for s in discovery["workflow"]["steps"]
        ]
        policy = draft_source_window_policy(discovery, registry)
        if policy:
            draft["derivedSourceWindowPolicy"] = policy
    return draft


def draft_source_window_policy(discovery: dict, registry: Registry) -> dict | None:
    """The PROD-derived source window every promoted profile needs, derived from the workflow's external inputs.

    Source families are the inputs of steps that do not read a previous step's output; coverage signals are one
    rows-present signal per family plus one per enum field the language definition declares for that family.
    Defaults are recorded so the operator sees and can change them before promotion.
    """
    kebab = lambda value: "-".join(p for p in str(value).lower().replace("_", "-").split("-") if p)  # noqa: E731
    families = sorted({name for s in discovery["workflow"]["steps"] if s.get("inputSource") != "previous-step-output"
                       for name in registry.mappings[s["mapping"]].input_names})
    if not families:
        return None
    signals = {f"{kebab(f)}-rows-present" for f in families}
    for entry in discovery.get("parityDerivation", []):
        if entry.get("dataset") in families:
            signals |= {f"{kebab(entry['dataset'])}-{kebab(t['field'])}-values-covered" for t in entry.get("coverageTargets", [])}
    defaults = {"minimumCompleteUtcDays": 1, "allowLongerRange": True}
    return {"kind": "prod-derived-complete-utc-days", **defaults, "requiredSourceFamilies": families,
            "requiredCoverageSignals": sorted(signals), "origin": "derived-at-intake", "recordedDefaults": defaults,
            "evidenceIds": ["intent-resolution"]}


RUN_SCOPED_REQUIRED_DECISIONS = ("windowSelection",)


def promote_run_profile(draft: dict, intent: dict, slice_catalog: dict, actuals: dict) -> dict:
    """Promote a draft to a run-scoped profile for a catalogued package from resolved intent and owner decisions.

    Fail-closed: every material fact must be resolved by the resolved intent, the package and PROD-actuals
    catalogs or an up-front owner decision; otherwise the result is BLOCKED with the facts still unknown.
    """
    decisions = dict(intent.get("ownerDecisions") or {})
    slices = [s["id"] for s in intent.get("slices") or []]
    package = slice_catalog.get("package") or {}
    mapping = (intent.get("primaryDirection") or {}).get("mapping") or (intent.get("selection") or {}).get("selected")
    catalogued = (actuals.get("slices") or {})
    reasons = []
    if intent.get("status") != "RESOLVED":
        reasons.append(f"the resolver status is {intent.get('status')}, not RESOLVED")
    if not slices:
        reasons.append("run-scoped promotion covers named package slices of a catalogued package only")
    if mapping and package.get("mappingId") and mapping.split("@")[0] != package["mappingId"]:
        reasons.append(f"{mapping} is not the catalogued package {package['mappingId']}")
    unknown = [s for s in slices if s not in (slice_catalog.get("slices") or {}) or s not in catalogued]
    if unknown:
        reasons.append(f"slices {unknown} have no package-slice or PROD-actuals catalog entry")
    missing = [d for d in RUN_SCOPED_REQUIRED_DECISIONS if d not in decisions]
    if missing:
        reasons.append(f"owner decisions {missing} were not given up front (answer the window question instead)")
    if any(f.get("code") == "UpstreamSourceUnresolved" for f in intent.get("findings", [])):
        reasons.append("UpstreamSourceUnresolved: a slice has no catalogued PROD-derived input builder")
    if not draft.get("derivedDirections") or not draft.get("derivedSourceWindowPolicy"):
        reasons.append("the draft has no registry-derived directions or source window policy")
    sensitive = sorted(s for s in slices if catalogued.get(s, {}).get("sensitiveFields"))
    ceiling = decisions.get("costCeilingUsd")
    resolved = {
        "environment-region-and-mode": (f"DEV in {LAYOUT['repository']['defaultRegion']} (PROD read-only), observed-dev; "
                                        "PROD Transform is never invoked", ["intent-resolution"]),
        "sample-or-evidence-source": ("real PROD-derived data only: " + ", ".join(
            f"{s} = most recent complete UTC day with data, baseline {catalogued[s]['baselineKind']}, inputs from "
            f"{catalogued[s].get('inputBuilder')}" for s in slices if s in catalogued), ["owner-decisions", "prod-actuals-catalog"]),
        "sensitivity-and-handling": ("restricted; aggregates and digests only in evidence" + (
            f"; slices {sensitive} stage real sensitive fields to DEV only under the owner's sensitiveFieldStaging decision "
            f"(given: {decisions.get('sensitiveFieldStaging', 'no; those slices block until it is')})" if sensitive else ""),
            ["owner-decisions", "prod-actuals-catalog"]),
        "required-fields-and-permitted-losses": ("every fieldMap column of each slice's PROD-actuals catalog entry plus the "
                                                 "registry-derived output contracts; no permitted losses", ["prod-actuals-catalog"]),
        "consumer-and-readback": ("the target system's own records of the same events, read back read-only as PROD actuals",
                                  ["prod-actuals-catalog"]),
        "success-scale-and-cost": (f"canary of 10 real events per slice matching PROD actuals, then the full window; per-job "
                                   f"cost ceiling {ceiling if ceiling is not None else 5} USD"
                                   + ("" if ceiling is not None else " (recorded default)"), ["owner-decisions"]),
    }
    facts = []
    for fact in draft["materialFacts"]:
        if fact["state"] in {"MISSING", "AMBIGUOUS"} and fact["id"] in resolved and not reasons:
            value, evidence = resolved[fact["id"]]
            fact = {**fact, "state": "INFERRED", "value": value, "evidenceIds": evidence, "nextQuestion": None}
        facts.append(fact)
    still = [f["id"] for f in facts if f["state"] in {"MISSING", "AMBIGUOUS"}]
    if still:
        reasons.append(f"material facts still unknown: {still}")
    if reasons:
        return {"status": "BLOCKED", "promotionEligible": False, "reasons": reasons}
    digest = hashlib.sha256(json.dumps([draft["id"], mapping, slices, decisions], sort_keys=True).encode()).hexdigest()[:12]
    promoted = {**draft, "materialFacts": facts, "unresolvedFacts": [], "promotionEligible": True, "intakeState": "CONTEXT_COMPLETE"}
    shape = (intent.get("primaryDirection") or {}).get("outputShape")
    return {
        "status": "PROMOTED",
        "id": f"run-scoped-{mapping.split('@')[0]}-{digest}",
        "kind": "run-scoped-profile",
        "contractVersion": 1,
        "scope": "this validation run only; never published as a profile",
        "mapping": mapping,
        "slices": slices,
        "ownerDecisions": decisions,
        "answers": {"upstream-source": "prod-derived-input-builders"} if intent.get("upstreamSource") else {},
        "directions": draft["derivedDirections"],
        "sourceWindowPolicy": draft["derivedSourceWindowPolicy"],
        "graph": {"required": shape == "graph"},
        "validationWorkflow": {"persistPolicy": "forbidden"},
        "promotion": {"basis": ["resolved-intent", "owner-decisions", "package-slices-catalog", "prod-actuals-catalog"],
                      "sensitiveSlices": sensitive},
        "draft": promoted,
    }


def fact_question(fact_id: str) -> str:
    return {
        "environment-region-and-mode": "environment",
        "sample-or-evidence-source": "test-dataset",
        "required-directions": "direction-mode",
        "source-and-target-meaning": "mapping-choice",
    }.get(fact_id, "")


# ---------------------------------------------------------------------------
# Contract derivation (registration + language definitions) and profile checks
# ---------------------------------------------------------------------------


def output_format(mapping: Mapping, output: dict) -> dict:
    fmt_type = output.get("format") or mapping.output.get("format")
    options = {**(mapping.output.get("options") or {}), **(output.get("options") or {})}
    fmt: dict = {"type": fmt_type}
    if fmt_type == "csv":
        fmt["delimiter"] = options.get("delimiter", ",")
        fmt["header"] = bool(options.get("header", False))
    return fmt


def input_contracts(mapping: Mapping) -> list[dict]:
    out = []
    for item in mapping.inputs:
        graph = item.get("graph") or {}
        entry: dict = {"table": item["table"], "format": item.get("format", "parquet")}
        if graph:
            props = graph.get("properties") or []
            structural = [graph.get("idColumn", "~id")]
            if graph.get("kind") == "edge":
                structural += [graph.get("from", {}).get("column", "~from"), graph.get("to", {}).get("column", "~to")]
            entry.update({
                "graphKind": graph.get("kind"),
                "label": graph.get("label"),
                "requiredColumns": structural + [p["column"] for p in props if not p.get("optional")],
                "optionalColumns": [p["column"] for p in props if p.get("optional")],
            })
            if graph.get("kind") == "edge":
                entry["endpoints"] = {"from": graph.get("from", {}).get("dataset"), "to": graph.get("to", {}).get("dataset")}
        out.append(entry)
    return out


def derive_contracts(registry: Registry, mapping: Mapping) -> dict:
    """Per-output contracts derived only from the registration and the target language definition."""
    inputs = {i["table"]: i for i in input_contracts(mapping)}
    contracts, findings = [], []
    for output in mapping.outputs:
        dataset = str(output.get("dataset"))
        required = list(output.get("requiredInputs") or mapping.input_names)
        contract: dict = {"dataset": dataset, "requiredInputs": required, "format": output_format(mapping, output)}
        graph = output.get("graph")
        if mapping.output.get("shape") == "graph" or graph:
            contract.update({"shape": "graph", "columnSource": "graph-binding"})
            if graph:
                contract["graph"] = {k: graph.get(k) for k in ("kind", "label", "idColumn") if graph.get(k)}
                if graph.get("kind") == "edge":
                    contract["graph"]["endpoints"] = {"from": graph.get("from", {}).get("dataset"), "to": graph.get("to", {}).get("dataset")}
        else:
            spec = definition_fields(registry, mapping.target, dataset)
            contract["shape"] = "tabular"
            if spec is None:
                contract.update({"columnSource": "undefined", "columns": []})
                findings.append({"code": "DatasetUndefined", "dataset": dataset, "language": mapping.target})
            else:
                contract.update({"columnSource": "language-definition", "columns": list(spec["properties"])})
                if spec["required"]:
                    contract["key"] = list(spec["required"])
        for table in required:
            endpoints = (inputs.get(table) or {}).get("endpoints") or {}
            for side, endpoint in endpoints.items():
                if endpoint and endpoint not in required:
                    findings.append({"code": "EndpointDatasetNotRequired", "dataset": dataset, "edge": table,
                                     "side": side, "endpoint": endpoint})
        unknown = sorted(set(required) - set(inputs))
        if unknown:
            findings.append({"code": "RequiredInputUndeclared", "dataset": dataset, "inputs": unknown})
        contracts.append(contract)
    return {"mapping": mapping.key, "from": mapping.source, "to": mapping.target,
            "shape": mapping.output.get("shape"), "inputs": list(inputs.values()),
            "outputs": contracts, "findings": findings}


def derive_direction(registry: Registry, mapping: Mapping) -> dict:
    """A profile `directions[]` entry regenerated from the registry (no domain knowledge)."""
    derived = derive_contracts(registry, mapping)
    return {
        "id": mapping.id,
        "fromLanguage": mapping.source,
        "toLanguage": mapping.target,
        "required": True,
        "mapping": {"status": "registered", "id": mapping.id, "version": mapping.version,
                    "repository": LAYOUT["repository"]["slug"],
                    "expectedOutputDatasets": mapping.output_names, "outputDatasetMatch": "exact"},
        "outputContracts": [
            {k: v for k, v in c.items() if k in ("dataset", "requiredInputs", "format", "columnSource", "columns", "key")}
            for c in derived["outputs"] if c["shape"] == "tabular"
        ],
        "derivationFindings": derived["findings"],
    }


DERIVABLE_FIELDS = ("requiredInputs", "format", "columnSource", "columns", "key")


def check_profile(registry: Registry, profile: dict) -> dict:
    """Compare a profile's directions with their regeneration from the registry.

    A difference is accepted only when the direction's `derivationOverrides` names that
    (dataset, field); every other difference is undeclared drift, and an override that
    matches no difference is stale.
    """
    report: dict = {"profile": profile.get("id"), "directions": [], "undeclared": [], "staleOverrides": []}
    for direction in profile.get("directions", []):
        key = profile_mapping_key(direction.get("mapping", {}))
        live = registry.mappings.get(key) if key else None
        entry: dict = {"direction": direction.get("id"), "mapping": key}
        if live is None:
            entry["status"] = "NOT_IN_REGISTRY"
            report["directions"].append(entry)
            if direction.get("mapping", {}).get("status") == "registered":
                report["undeclared"].append({"direction": direction.get("id"), "field": "mapping", "detail": f"{key} not in any inspected registry"})
            continue
        derived = derive_direction(registry, live)
        overrides = {(o["dataset"], o["field"]) for o in direction.get("derivationOverrides", [])}
        used: set = set()
        differences = []
        mapping = direction["mapping"]
        expected = mapping.get("expectedOutputDatasets") or []
        match = mapping.get("outputDatasetMatch", "exact")
        live_outputs = derived["mapping"]["expectedOutputDatasets"]
        if (match == "exact" and sorted(expected) != sorted(live_outputs)) or (match == "includes" and not set(expected) <= set(live_outputs)):
            differences.append({"dataset": "*", "field": "expectedOutputDatasets", "profile": expected, "derived": live_outputs})
        derived_contracts = {c["dataset"]: c for c in derived["outputContracts"]}
        for contract in direction.get("outputContracts", []):
            dataset = contract["dataset"]
            regenerated = derived_contracts.get(dataset)
            if regenerated is None:
                differences.append({"dataset": dataset, "field": "dataset", "profile": dataset, "derived": None})
                continue
            for field_name in DERIVABLE_FIELDS:
                ours, theirs = contract.get(field_name), regenerated.get(field_name)
                if field_name == "requiredInputs":
                    ours, theirs = sorted(ours or []), sorted(theirs or [])
                if field_name == "key":
                    ours, theirs = ours or None, theirs or None
                    if ours is None:
                        continue
                if ours != theirs:
                    differences.append({"dataset": dataset, "field": field_name, "profile": contract.get(field_name), "derived": regenerated.get(field_name)})
        for diff in differences:
            if (diff["dataset"], diff["field"]) in overrides:
                diff["declaredOverride"] = True
                used.add((diff["dataset"], diff["field"]))
            else:
                diff["declaredOverride"] = False
                report["undeclared"].append({"direction": direction.get("id"), **diff})
        for dataset, field_name in sorted(overrides - used):
            report["staleOverrides"].append({"direction": direction.get("id"), "dataset": dataset, "field": field_name})
        entry.update({"status": "CHECKED", "differences": differences, "derivationFindings": derived["derivationFindings"],
                      "regenerated": derived})
        report["directions"].append(entry)
    report["derivedEqualsProfileModuloOverrides"] = not report["undeclared"] and not report["staleOverrides"]
    return report


def fetch_missing_inputs(args) -> None:
    """Populate --lexicon-root/--main-lexicon-root/--registry/--ssm-parameters from GitHub and AWS, read-only."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import fetch_validation_inputs as fetch  # noqa: PLC0415

    fetch.ECHO = sys.stderr

    workspace = Path(args.workspace)
    workspace.mkdir(parents=True, exist_ok=True)
    slug = args.lexicon_slug or LAYOUT["repository"]["slug"]
    published = LAYOUT["publishedRegistry"]

    def repo(name: str, ref: str | None, pr: int | None) -> str:
        entry = fetch.fetch_repo(argparse.Namespace(workspace=str(workspace), slug=slug, ref=ref, pr=pr,
                                                    name=name, depth=200, required_path=[LAYOUT["conceptModelPath"]]))
        return entry["path"]

    if not args.lexicon_root:
        args.lexicon_root = repo("lexicon-candidate", args.candidate_ref, args.candidate_pr)
    if not args.main_lexicon_root:
        args.main_lexicon_root = repo("lexicon-main", args.main_ref, None)
    if getattr(args, "materialize_candidate", False):
        entry = fetch.materialize(argparse.Namespace(workspace=str(workspace), name="lexicon-candidate",
                                                     command=args.materialize_command, install=args.materialize_install,
                                                     node=LAYOUT["materialize"].get("node")))
        args.registry = (args.registry or []) + [f"candidate-build={entry['path']}"]
    for spec in args.aws or []:
        label, _, profile = spec.partition("=")
        if not profile:
            raise SystemExit(f"--aws expects label=AWS_PROFILE, got {spec!r}")
        common = dict(workspace=str(workspace), label=label, profile=profile, region=args.region, environment="prod")
        registry = fetch.fetch_registry(argparse.Namespace(**common, parameter=published["uriParameter"]))
        ssm = fetch.fetch_ssm_names(argparse.Namespace(**common, path=published["parameterPath"]))
        args.registry = (args.registry or []) + [f"{label}={registry['path']}"]
        args.ssm_parameters = (args.ssm_parameters or []) + [f"{label}={ssm['path']}"]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p_parse = sub.add_parser("parse")
    p_parse.add_argument("--request", required=True)
    p_parse.add_argument("--slice-catalog", help="package-slices JSON (default: reference/package-slices.json)")
    p_promote = sub.add_parser("promote-run-profile", help="promote a draft to a run-scoped profile for a catalogued package")
    p_promote.add_argument("--draft", required=True, help="draft-profile output")
    p_promote.add_argument("--intent", required=True, help="discover output (with ownerDecisions)")
    p_promote.add_argument("--slice-catalog", help="package-slices JSON (default: reference/package-slices.json)")
    p_promote.add_argument("--prod-actuals-catalog", help="PROD-actuals catalog (default: reference/prod-actuals.json)")
    p_promote.add_argument("--out")
    for name in ("discover", "draft-profile", "contracts", "check-profile"):
        p = sub.add_parser(name)
        if name in ("discover", "draft-profile"):
            p.add_argument("--request", required=True)
        p.add_argument("--slice-catalog", help="package-slices JSON (default: reference/package-slices.json)")
        p.add_argument("--prod-actuals-catalog", help="PROD-actuals catalog (default: reference/prod-actuals.json)")
        if name == "contracts":
            p.add_argument("--mapping", required=True, help="exact id@version to derive contracts for")
        if name == "check-profile":
            p.add_argument("--profile", required=True, help="profile JSON whose directions are regenerated and compared")
        p.add_argument("--layout", help="registry layout JSON (default reference/registry-layout.json)")
        p.add_argument("--lexicon-root", help="Pinned registry candidate checkout")
        p.add_argument("--main-lexicon-root", help="Pinned registry main checkout for concept checks")
        p.add_argument("--registry", action="append", help="label=DIR of materialized transform-mappings/<id>/<version>/mapping.json")
        p.add_argument("--ssm-parameters", action="append", help="label=FILE listing language parameter names")
        p.add_argument("--profiles", action="append", help="directory of validation profiles (repeatable; none by default)")
        p.add_argument("--forbidden-concepts", default=str(DEFAULT_FORBIDDEN), help="Shared forbidden concepts, properties, and retired mappings")
        p.add_argument("--window", default="<startZ>_<endExclusiveZ>")
        p.add_argument("--out")
        p.add_argument("--workspace", help="Fetch missing inputs read-only (GitHub via gh, AWS via --aws) into this disposable directory")
        p.add_argument("--lexicon-slug", help="registry repository slug (default: the layout's repository.slug)")
        p.add_argument("--candidate-pr", type=int, help="registry pull request whose head is the candidate")
        p.add_argument("--candidate-ref", help="registry branch, tag or SHA for the candidate (default: default branch)")
        p.add_argument("--main-ref", help="registry ref used as main (default: default branch)")
        p.add_argument("--aws", action="append", help="label=AWS_PROFILE; fetches that environment's published registry and language parameter names")
        p.add_argument("--region", help="AWS region (default: the layout's repository.defaultRegion)")
        p.add_argument("--materialize-candidate", action="store_true",
                       help="Build generated mapping artifacts in the fetched candidate checkout and add them as registry candidate-build")
        p.add_argument("--materialize-command", help="default: the layout's materialize.command")
        p.add_argument("--materialize-install", action="append", default=None,
                       help="setup commands run first in the checkout (default: the layout's materialize.install)")
    args = parser.parse_args(argv)
    if args.command == "promote-run-profile":
        output = promote_run_profile(json.loads(Path(args.draft).read_text()), json.loads(Path(args.intent).read_text()),
                                     load_slice_catalog(args.slice_catalog), load_actuals_catalog(args.prod_actuals_catalog))
        text = json.dumps(output, indent=2) + "\n"
        Path(args.out).write_text(text) if args.out else sys.stdout.write(text)
        return 0 if output["status"] == "PROMOTED" else 1
    if args.command != "parse":
        layout = load_layout(args.layout)
        args.region = args.region or layout["repository"]["defaultRegion"]
        args.materialize_command = args.materialize_command or layout["materialize"]["command"]
        if args.materialize_candidate and args.materialize_install is None:
            args.materialize_install = list(layout["materialize"]["install"])
    if getattr(args, "workspace", None):
        fetch_missing_inputs(args)
    catalog = load_slice_catalog(getattr(args, "slice_catalog", None))
    if args.command == "parse":
        output = parse_request(args.request, catalog)
    else:
        registry = load_registry(args)
        if args.command == "contracts":
            if args.mapping not in registry.mappings:
                raise SystemExit(f"{args.mapping} is not in any inspected registry")
            output = derive_contracts(registry, registry.mappings[args.mapping])
        elif args.command == "check-profile":
            output = check_profile(registry, json.loads(Path(args.profile).read_text()))
        else:
            output = discover(args.request, registry, args.window, catalog, load_actuals_catalog(args.prod_actuals_catalog))
            if args.command == "draft-profile":
                output = draft_profile(args.request, output, registry)
    text = json.dumps(output, indent=2, sort_keys=False) + "\n"
    if getattr(args, "out", None):
        Path(args.out).write_text(text)
    else:
        sys.stdout.write(text)
    if args.command == "check-profile" and not output["derivedEqualsProfileModuloOverrides"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
