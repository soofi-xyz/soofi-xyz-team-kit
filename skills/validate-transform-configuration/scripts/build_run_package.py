#!/usr/bin/env python3
"""Assemble and validate the transform-configuration-run package (run.json).

  build_run_package.py --run-dir RUN [--run-dir RUN ...] --evaluation evaluation.json --intent intent.json
      --workspace WS --profile-doc profile.json [--canary-run-dir RUN ...] [--handoffs data-days.json ...]
      [--graph-inputs summary.json ...] [--catalog prod-actuals.json]
      [--transform-revision SHA --transform-deployment-digest SHA256 --spark-version X.Y]
      [--package-spec override.json] [--write-package-spec RUN/package-spec.json] [--out RUN/run.json]

RUN is a transform_runs.py run directory (steps.json, approvals/, cost.json). The package spec (profile identity,
discoveryTrace, configurationPackage, environment, sensitivity, graph, runtime, persistCanary, exporterHydration,
roundTrip, phases, boundaryDecisions, failures, remediations) is generated from the run directories and the run's own
records: the resolver's --workspace inputs-manifest.json (pinned repositories) and --intent (languages, slices, pin,
versionSelection), the selected or run-scoped --profile-doc, evaluate_run.py's --evaluation (phases, per-slice
verdicts, finalValidation, owner decisions, product-change flags), the run-spec (DEV account and region),
graph_inputs.py summaries, and the remediation handoffs recorded by source_window.py data-days (--handoffs), a graph
summary's joinCoverage handoff and the catalog's blockedHandoffs. What no record holds is never invented: the Transform revision, its deployed Glue script
digest and the Spark version come from --transform-revision, --transform-deployment-digest and --spark-version (without
them runtime is UNAVAILABLE, which cannot be READY), and a FAIL/BLOCKED phase whose cause has no recorded handoff
stops with PackageSpecIncomplete naming the codes. --package-spec is an optional override: its top-level keys replace
the generated ones (configurationPackage is merged key by key), for example remediations the records do not hold.
--write-package-spec keeps the effective spec for review. This tool adds executionSteps, approvals, dataset evidence from
captured outputs and cost, computes the verdict from phase statuses (any FAIL -> NOT_READY,
else any BLOCKED/APPROVAL_REQUIRED -> BLOCKED, else READY), rejects a verdict that
disagrees, refuses READY unless finalValidation proves a real-data window (user-confirmed, or the
owner's "most recent full UTC day with real data per slice"), a passing DEV canary, an approved
(or owner pre-approved) full-window DEV run, and a comparison against PROD actuals for every slice,
requires a remediation for every FAIL/BLOCKED phase, and validates the result against
reference/transform-configuration-run.schema.json (needs jsonschema). --canary-run-dir adds the
canary executions as executionSteps with stage canary; both flags repeat (one run directory per slice).
--evaluation copies evaluate_run.py's phases, finalValidation, per-slice verdicts, owner decisions and
product-change flags into the package when the spec does not state them. --profile-doc derives the profile
identity (id, revision, sha256) from the profile document itself, so a promoted run-scoped profile
(resolve-transform-intent.py promote-run-profile) identifies the package without a published profile.
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import re
from pathlib import Path

from run_workspace import MARKER as RUN_MARKER
from silvally_io import SilvallyError, load_layout, read_json, sha256_bytes, sha256_file, write_json

SCHEMA = Path(__file__).resolve().parent.parent / "reference" / "transform-configuration-run.schema.json"
DEFAULT_CATALOG = Path(__file__).resolve().parent.parent / "reference" / "prod-actuals.json"
KEBAB = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
REASON = re.compile(r"^(?P<status>FAIL|BLOCKED|APPROVAL_REQUIRED): (?:\[(?P<slice>[^\]]+)\] )?(?:(?P<code>[A-Z][A-Za-z0-9]+): )?(?P<message>.+)$")
GENERATED_KEYS = ("profile", "discoveryTrace", "configurationPackage", "environment", "sensitivity", "graph", "runtime",
                  "persistCanary", "exporterHydration", "roundTrip", "boundaryDecisions", "failures", "remediations")
SELECTION_METHODS = {"pull-request": "requested-ref", "requested-ref": "requested-ref", "default-branch": "default-branch",
                     "matching-open-pull-request": "matching-open-pull-request"}


def verdict_of(phases: list[dict]) -> str:
    statuses = {p["status"] for p in phases}
    if "FAIL" in statuses:
        return "NOT_READY"
    if statuses & {"BLOCKED", "APPROVAL_REQUIRED"}:
        return "BLOCKED"
    return "READY"


def final_validation_gaps(run: dict) -> list[str]:
    """Reasons a package cannot be READY: READY requires the canary-first PROD-derived DEV validation."""
    final = run.get("finalValidation") or {}
    selection = run.get("sourceWindowSelection") or {}
    decisions = run.get("ownerDecisions") or {}
    runtime = run.get("runtime") or {}
    steps = run.get("executionSteps") or []
    full = [s for s in steps if s.get("stage", "full") == "full"]
    canary = [s for s in steps if s.get("stage") == "canary"]
    gaps = []
    if final.get("status") != "PASS":
        gaps.append("finalValidation is absent or not PASS")
    per_slice = decisions.get("windowSelection") == "most-recent-full-utc-day-with-data-per-slice" and final.get("sliceWindows")
    if not per_slice:
        if selection.get("status") != "CONFIRMED" or not selection.get("confirmedWindow"):
            gaps.append("no user-confirmed PROD-derived source window")
        elif final.get("sourceWindow") != selection["confirmedWindow"]:
            gaps.append("finalValidation window differs from the confirmed window")
    if runtime.get("executionMode") != "observed-dev":
        gaps.append("runtime executionMode is not observed-dev")
    if not final.get("stagingApprovalDigests"):
        gaps.append("no approval digest for the DEV staging of the window")
    if (final.get("canary") or {}).get("status") != "PASS" or not canary or any(s["status"] != "PASS" for s in canary):
        gaps.append("no passing DEV canary")
    if (final.get("fullRunApproval") or {}).get("status") not in {"APPROVED", "PRE_APPROVED"}:
        gaps.append("the full-window run was not approved after the canary")
    if not final.get("baseline") or any(b["status"] not in {"AVAILABLE", "NONE"} for b in final["baseline"]):
        gaps.append("no usable PROD-actuals baseline for every slice")
    if not full or any(s["environment"] != "dev" or s["status"] != "PASS" for s in full):
        gaps.append("the full-window run has no passing DEV execution steps")
    elif {s["approvalOperationDigest"] for s in steps} - set(final.get("executionApprovalDigests") or []):
        gaps.append("an execution step lacks its own approval digest in finalValidation")
    not_ready = [v["slice"] for v in run.get("sliceVerdicts") or [] if v["verdict"] != "READY"]
    if not_ready:
        gaps.append(f"slices {not_ready} are not READY")
    return gaps


def profile_identity(path: str) -> dict:
    doc = read_json(path)
    revision = doc.get("revision") or ("run-scoped" if doc.get("kind") == "run-scoped-profile" else "local")
    return {"id": doc["id"], "revision": revision, "sha256": "sha256:" + sha256_file(path)}


def from_evaluation(spec: dict, evaluation: dict) -> dict:
    spec = dict(spec)
    spec.setdefault("phases", [{"number": p["number"], "status": p["status"],
                                "evidenceIds": [e for e in p["evidenceIds"] if KEBAB.match(e)] or [f"phase-{p['number']}"]}
                               for p in evaluation["phases"]])
    for key in ("finalValidation", "ownerDecisions", "acceptedProductChanges", "versionSelection", "productChangeFlags"):
        if key in evaluation and key not in spec:
            spec[key] = evaluation[key]
    if evaluation.get("slices") and "sliceVerdicts" not in spec:
        spec["sliceVerdicts"] = [{"slice": name, "verdict": r["verdict"], "window": r.get("window"), "canaryGate": r["canaryGate"]}
                                 for name, r in sorted(evaluation["slices"].items())]
    return spec


def kebab(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def digest(value: str | None) -> str | None:
    return None if value is None else (value if value.startswith("sha256:") else "sha256:" + value)


class SpecGenerator:
    """Derive each package-spec key from the run's own records; a key no record supports raises SilvallyError."""

    def __init__(self, args, run_dirs: list[Path], evaluation: dict):
        self.args, self.run_dirs, self.evaluation = args, run_dirs, evaluation
        self.intent = read_json(args.intent) if args.intent else None
        self.profile_doc = read_json(args.profile_doc) if args.profile_doc else {}
        self.manifest = read_json(Path(args.workspace) / "inputs-manifest.json") if args.workspace else None
        self.catalog = read_json(args.catalog or DEFAULT_CATALOG)
        self.handoff_docs = [read_json(p) for p in args.handoffs]
        self.graph_summaries = [read_json(p) for p in args.graph_inputs]
        dirs = [*run_dirs, *(Path(d) for d in args.canary_run_dir)]
        self.run_spec = next((read_json(d / "run-spec.json") for d in dirs if (d / "run-spec.json").exists()), {})
        self.override_package: dict = {}

    def need(self, value, flag: str):
        if not value:
            raise SilvallyError(f"needs {flag}")
        return value

    @property
    def repositories(self) -> list[dict]:
        repos = [e for e in self.need(self.manifest, "--workspace") if e.get("kind") == "repository"]
        return self.need(repos, "a pinned repository in the workspace inputs-manifest.json")

    @property
    def mapping_key(self) -> str:
        keys = self.evaluation.get("mappings") or [((self.need(self.intent, "--intent").get("selection") or {}).get("selected"))]
        return self.need(keys[0], "the evaluated mapping (--evaluation mappings or --intent selection)")

    @property
    def slices(self) -> list[str]:
        return sorted(self.evaluation.get("slices") or {}) or [s["id"] for s in (self.intent or {}).get("slices") or []]

    def direction_ids(self, slices: list[str] | None = None) -> list[str]:
        mapping_id = self.mapping_key.split("@")[0]
        chosen = self.slices if slices is None else slices
        return [kebab(f"{mapping_id}-{s}") for s in chosen] or [kebab(mapping_id)]

    def commits(self) -> tuple[dict, dict]:
        candidate = next((e for e in self.repositories if e.get("selectionMethod") != "default-branch"), self.repositories[0])
        main = next((e for e in self.repositories if e.get("selectionMethod") == "default-branch"
                     and e.get("slug") == candidate.get("slug")), candidate)
        return candidate, main

    @property
    def chain(self) -> dict | None:
        return (self.intent or {}).get("chain") if (self.intent or {}).get("kind") == "chain" else None

    def profile(self) -> dict:
        if not self.args.profile_doc and self.chain and self.chain.get("catalog"):
            entry = (read_json(self.chain["catalog"]).get("chains") or {}).get(self.chain["id"])
            self.need(entry, f"chain {self.chain['id']} in {self.chain['catalog']}")
            return {"id": self.chain["id"], "revision": "chain-catalog",
                    "sha256": "sha256:" + sha256_bytes(json.dumps(entry, sort_keys=True, separators=(",", ":")).encode())}
        return profile_identity(self.need(self.args.profile_doc, "--profile-doc"))

    def discoveryTrace(self) -> list[dict]:
        trace = []
        for e in self.repositories:
            if e.get("requiredPathsVerified") is not True:
                raise SilvallyError(f"repository {e.get('name')} has unverified required paths {e.get('missingRequiredPaths')}")
            trace.append({"repository": e["slug"], "selectionMethod": SELECTION_METHODS.get(e.get("selectionMethod"), "requested-ref"),
                          "materialization": "isolated-checkout" if e.get("path") else "github-api",
                          "selectedCommitSha": e["commitSha"], "pullRequestNumber": e.get("pullRequestNumber"),
                          "requiredPathsVerified": True, "rejectedCandidateCommitShas": e.get("rejectedCandidateCommitShas", [])})
        return trace

    def transform_product(self) -> dict:
        if self.override_package.get("transformProduct"):
            return self.override_package["transformProduct"]
        revision, deployed = self.args.transform_revision, digest(self.args.transform_deployment_digest)
        if not (revision and deployed):
            raise SilvallyError("the Transform revision and its deployed Glue script digest are in no run record: pass "
                                "--transform-revision and --transform-deployment-digest (or configurationPackage.transformProduct)")
        return {"name": "Transform", "version": revision, "sha256": deployed}

    def configurationPackage(self) -> dict:
        intent = self.need(self.intent, "--intent")
        mapping_id, version = self.mapping_key.split("@")
        candidate, main = self.commits()
        languages = intent.get("languages") or {}

        def language(name: str, revision: str) -> dict:
            definition = (languages.get(name) or {}).get("definition") or {}
            return {"id": name, "revision": revision, "sha256": digest(self.need(definition.get("sha256"), f"a pinned {name} definition in --intent"))}
        pin = ((intent.get("versionSelection") or {}).get("pin") or {}).get("sha256") \
            or ((self.run_spec.get("mappings") or {}).get(self.mapping_key) or {}).get("sha256")
        mapping = {"id": self.mapping_key, "revision": candidate["commitSha"], "sha256": digest(self.need(pin, "the mapping pin"))}
        source, target = intent["primaryDirection"]["from"], intent["primaryDirection"]["to"]
        hub = load_layout(self.args.layout)["hubLanguage"]
        evidence = sorted({e for p in self.evaluation.get("phases", []) if p["number"] in (9, 10, 11) and p["status"] == "PASS"
                           for e in p.get("evidenceIds", []) if KEBAB.match(e)}) or ["intent-resolution"]
        accepted = set(self.evaluation.get("acceptedProductChanges") or [])
        slices = self.slices
        directions = [{"id": d, "sourceLanguage": language(source, candidate["commitSha"]),
                       "targetLanguage": language(target, candidate["commitSha"]), "mapping": mapping,
                       "evidenceIds": ["intent-resolution"] + ([kebab(f"{s}-slice")] if s else [])}
                      for d, s in zip(self.direction_ids(), slices or [None])]
        if self.chain:
            directions = []
            for step in (s for s in self.chain["steps"] if s["kind"] == "transform"):
                step_pin = ((step.get("versionSelection") or {}).get("pin") or {}).get("sha256")
                directions.append({"id": kebab(f"{self.chain['id']}-{step['id']}"),
                                   "sourceLanguage": language(step["from"], candidate["commitSha"]),
                                   "targetLanguage": language(step["to"], candidate["commitSha"]),
                                   "mapping": {"id": step["mapping"], "revision": candidate["commitSha"],
                                               "sha256": digest(self.need(step_pin, f"the pin of chain step {step['id']}"))},
                                   "evidenceIds": ["intent-resolution", kebab(f"chain-{step['id']}")]})
            last = [s for s in self.chain["steps"] if s["kind"] == "transform"][-1]
            mapping_id, version = self.chain["id"], last["mapping"].split("@")[-1]
        return {"id": kebab("-".join([mapping_id, *slices])), "version": version, "transformProduct": self.transform_product(),
                "directions": directions,
                "lexicon": language(hub, main["commitSha"]),
                "sourceRevisions": [{"slug": s, "commitSha": c} for s, c in dict.fromkeys((e["slug"], e["commitSha"]) for e in self.repositories)],
                "dependencies": [{"product": "Lexicon", "version": main["commitSha"], "sha256": language(hub, main["commitSha"])["sha256"],
                                  "role": "concept model and language definitions"}],
                "testEvidenceIds": evidence, "deployedDigest": mapping["sha256"],
                "unresolvedProductChangeHandoffs": sorted(kebab(f) for f in self.evaluation.get("productChangeFlags") or [] if f not in accepted),
                "marketplaceRegistrationReady": False}

    def environment(self) -> dict:
        arn = self.need(self.run_spec.get("stateMachineArn"), "a run-spec.json with the DEV state machine")
        return {"name": "dev", "accountHash": "sha256:" + sha256_bytes(arn.split(":")[4].encode()),
                "region": self.run_spec.get("region") or arn.split(":")[3], "writePolicy": "approval-required"}

    def sensitivity(self) -> dict:
        sensitive = set((self.profile_doc.get("promotion") or {}).get("sensitiveSlices") or []) | {
            s for s in self.slices if ((self.catalog.get("slices") or {}).get(s) or {}).get("sensitiveFields")}
        return {"classification": "restricted" if sensitive else "confidential", "sanitization": "aggregates-and-digests-only",
                "containsRawPii": False, "containsSecrets": False}

    def graph(self) -> dict:
        exports = [r for r in getattr(self.args, "chain_records", []) if r.get("stepKind") == "persist-export"]
        if exports:
            return {"required": True, "identityUnique": all(r.get("status") == "PASS" for r in exports),
                    "endpointCount": sum((r.get("rootsFound") or 0) + sum(h.get("endpointVertices") or 0 for h in r.get("hops", []))
                                         for r in exports),
                    "danglingEndpointCount": sum(r.get("danglingEndpointCount") or 0 for r in exports)}
        if self.graph_summaries:
            return {"required": True, "identityUnique": all(s.get("status") in ("BUILT", "JOIN_COVERAGE_GAP") for s in self.graph_summaries),
                    "endpointCount": sum((s.get("rootsFound") or 0) + sum(h.get("endpointVertices") or 0 for h in s.get("hops", []))
                                         for s in self.graph_summaries),
                    "danglingEndpointCount": sum(s.get("danglingEndpointCount") or 0 for s in self.graph_summaries)}
        if (self.profile_doc.get("graph") or {}).get("required"):
            return {"availability": "UNAVAILABLE", "subject": "graph", "reason": "the profile requires graph evidence but no "
                    "graph_inputs.py summary was supplied (--graph-inputs)", "evidenceIds": ["graph-inputs"]}
        return {"required": False, "identityUnique": True, "endpointCount": 0, "danglingEndpointCount": 0}

    def runtime(self) -> dict:
        a = self.args
        if a.transform_revision and a.transform_deployment_digest and a.spark_version:
            return {"sparkVersion": a.spark_version, "transformRevision": a.transform_revision,
                    "deploymentDigest": digest(a.transform_deployment_digest), "executionMode": self.evaluation.get("mode") or "observed-dev"}
        return {"availability": "UNAVAILABLE", "subject": "runtime", "reason": "the Transform revision, deployed Glue script digest "
                "and Spark version were not supplied (--transform-revision, --transform-deployment-digest, --spark-version)",
                "evidenceIds": ["runtime-provenance"]}

    def chain_status(self, kind: str) -> str | None:
        records = [r for r in getattr(self.args, "chain_records", []) if r.get("stepKind") == kind]
        if not records:
            return None
        statuses = {r.get("status") for r in records}
        stages = {r.get("stage") for r in records if r.get("status") == "PASS"}
        return "FAIL" if "FAIL" in statuses else ("PASS" if {"canary", "full"} <= stages else "BLOCKED")

    def persistCanary(self) -> dict:
        policy = (self.profile_doc.get("validationWorkflow") or {}).get("persistPolicy") \
            or ((self.intent or {}).get("workflow") or {}).get("persistPolicyDefault") or "forbidden"
        if policy == "forbidden":
            return {"required": False, "status": "PASS", "evidenceIds": ["persist-policy-forbidden"]}
        status = self.chain_status("persist-load")
        if status:
            return {"required": True, "status": status, "evidenceIds": ["chain-persist-load"]}
        return {"required": True, "status": "BLOCKED", "evidenceIds": ["persist-canary-not-recorded"]}

    def exporterHydration(self) -> dict:
        status = self.chain_status("persist-export")
        if status:
            return {"required": True, "status": status, "evidenceIds": ["chain-persist-export"]}
        return {"required": False, "status": "PASS", "evidenceIds": ["exporter-hydration-not-required"]}

    def roundTrip(self) -> dict:
        directions = [d for d in self.profile_doc.get("directions", []) if d.get("required", True)]
        pairs = {(d.get("fromLanguage"), d.get("toLanguage")) for d in directions}
        if any((b, a) in pairs for a, b in pairs):
            return {"required": True, "status": "BLOCKED", "evidenceIds": ["round-trip-not-recorded"], "comparedFields": 0, "mismatchCount": 0}
        return {"required": False, "status": "PASS", "evidenceIds": ["one-way-package"], "comparedFields": 0, "mismatchCount": 0}

    def boundaryDecisions(self) -> list[dict]:
        accepted = set(self.evaluation.get("acceptedProductChanges") or [])
        decisions = [{"id": kebab(f"{self.mapping_key.split('@')[0]}-configuration"),
                      "proposedChange": f"Validate {self.mapping_key} as mapping configuration within existing Transform behavior",
                      "classification": "CONFIGURATION", "evidenceIds": ["intent-resolution"], "resolved": True, "handoffOwner": None}]
        for change in sorted(accepted | set(self.evaluation.get("productChangeFlags") or [])):
            decisions.append({"id": kebab(change), "proposedChange": f"Transform product change {change}, flagged for Kecleon",
                              "classification": "PRODUCT_CHANGE", "evidenceIds": ["owner-accepted-product-change" if change in accepted else "plans"],
                              "resolved": False, "handoffOwner": "kecleon", "ownerAccepted": change in accepted})
        return decisions

    def reasons(self) -> list[dict]:
        out = []
        for phase in self.evaluation.get("phases", []):
            for reason in phase.get("reasons", []):
                match = REASON.match(reason)
                if match:
                    out.append({"phase": phase["number"], **match.groupdict()})
        return out

    def failures(self) -> list[dict]:
        seen, out = set(), []
        for r in self.reasons():
            code = r["code"] or ("PhaseFailed" if r["status"] == "FAIL" else "PhaseBlocked")
            message = (f"[{r['slice']}] " if r["slice"] else "") + r["message"]
            if (r["phase"], code, message) not in seen:
                seen.add((r["phase"], code, message))
                out.append({"phase": r["phase"], "code": code, "message": message})
        return out

    def remediations(self) -> list[dict]:
        """One remediation per recorded handoff of a slice that is not READY: data-days handoffs, then the catalog's
        blockedHandoffs whose code the evaluation reported."""
        reported = set(self.evaluation.get("informationalFindings") or []) | {r["code"] for r in self.reasons() if r["code"]}
        slices = self.evaluation.get("slices") or {}
        found: dict[str, dict] = {}
        for name, result in sorted(slices.items()):
            if result.get("verdict") == "READY":
                continue
            recorded = [h for doc in self.handoff_docs for h in (((doc.get("slices") or {}).get(name) or {}).get("handoffs") or [])]
            recorded += [s["joinCoverage"]["handoff"] for s in self.graph_summaries
                         if s.get("slice") == name and (s.get("joinCoverage") or {}).get("handoff")]
            recorded += [h for h in ((self.catalog.get("slices") or {}).get(name) or {}).get("blockedHandoffs") or [] if h["code"] in reported]
            open_phases = sorted(int(n) for n, s in (result.get("phases") or {}).items() if s not in (None, "PASS"))
            for h in recorded:
                entry = found.setdefault(h["code"], {"handoff": h, "slices": [], "phases": set()})
                if name not in entry["slices"]:
                    entry["slices"].append(name)
                entry["phases"] |= set(open_phases)
        status = {p["number"]: p["status"] for p in self.evaluation.get("phases", [])}
        evidence = {p["number"]: [e for e in p.get("evidenceIds", []) if KEBAB.match(e)] for p in self.evaluation.get("phases", [])}
        out = []
        for code, entry in found.items():
            h, phases = entry["handoff"], sorted(entry["phases"]) or [1]
            out.append({"id": kebab(f"{'-'.join(entry['slices'])}-{code}"), "findingCode": code,
                        "status": "FAIL" if any(status.get(p) == "FAIL" for p in phases) else "BLOCKED",
                        "classification": h.get("classification", "ACCESS_OR_EVIDENCE"), "owner": h["owner"],
                        "repository": h.get("repository"),
                        "locations": h.get("locations") or [f"{self.catalog.get('id', 'prod-actuals.json')}#slices.{s}" for s in entry["slices"]],
                        "locationEvidenceIds": evidence.get(phases[0]) or [f"phase-{phases[0]}"],
                        "recommendedChange": h["detail"],
                        "regressionEvidence": [f"evaluate_run.py reports phases {phases} PASS for slice(s) {entry['slices']}"],
                        "rerunPhases": phases, "rerunDirections": self.direction_ids(entry["slices"])})
        open_codes = sorted({f["code"] for f in self.failures()})
        if open_codes and not out:
            raise SilvallyError(f"no recorded handoff explains {open_codes}: pass --handoffs (source_window.py data-days output) or "
                                "remediations in --package-spec")
        return out


def generate_spec(args, run_dirs: list[Path], override: dict) -> dict:
    """The effective package spec: override keys first, then evaluation keys, then every derivable key."""
    evaluation = read_json(args.evaluation) if args.evaluation else {}
    spec = from_evaluation(dict(override), evaluation) if evaluation else dict(override)
    generator, missing = SpecGenerator(args, run_dirs, evaluation), []
    generator.override_package = spec.get("configurationPackage") or {}
    for key in GENERATED_KEYS:
        if key in spec and key != "configurationPackage":
            continue
        try:
            value = getattr(generator, key)()
        except (SilvallyError, KeyError, TypeError) as error:
            if key not in spec:
                missing.append(f"{key} ({error})")
            continue
        spec[key] = {**value, **spec[key]} if key in spec else value
    if "phases" not in spec:
        missing.append("phases (needs --evaluation)")
    if missing:
        raise SilvallyError("PackageSpecIncomplete: " + "; ".join(missing))
    if "id" not in spec:
        root = next((p for p in [run_dirs[0].resolve(), *run_dirs[0].resolve().parents] if (p / RUN_MARKER).exists()), run_dirs[0].resolve())
        spec["id"] = "validation-" + hashlib.sha256(root.name.encode()).hexdigest()[:24]
    return spec


def execution_steps(run_dir: Path, steps: list[dict], spec: dict, stage: str, start: int = 1) -> list[dict]:
    manifests = spec.get("inputManifests", {})
    out = []
    for i, s in enumerate(steps, start):
        case = s["step"].split("-", 1)[1]
        approval = read_json(run_dir / "approvals" / f"{s['step']}.json")
        glue = sorted({e.get("taskSucceededEventDetails", {}).get("output") and json.loads(e["taskSucceededEventDetails"]["output"]).get("Id")
                       for e in read_json(run_dir / "steps" / s["step"] / "history.json").get("events", [])
                       if e.get("taskSucceededEventDetails", {}).get("resourceType") == "glue"} - {None, ""})
        entry = {"sequence": i, "stage": stage, "mapping": approval["mappingPin"]["mapping"], "environment": "dev",
                 "status": s.get("verdict", "BLOCKED") if s["status"] != "RUNNING" else "BLOCKED",
                 "approvalOperationDigest": approval["operationDigest"], "executionArn": s.get("executionArn"),
                 "inputManifestSha256": manifests.get(case), "outputLocation": s.get("outputPrefix"),
                 "executedSqlSha256s": ["sha256:" + q["sha256"] for q in s.get("executedSql", []) if q.get("sha256")],
                 "logLocations": spec.get("logGroups", []) + [f"/aws-glue/jobs/{k}:{g}" for g in glue for k in ("output", "error")]}
        if (run_dir / "steps" / s["step"] / "plan.json").exists():
            entry["planSha256"] = "sha256:" + sha256_file(run_dir / "steps" / s["step"] / "plan.json")
        meta = run_dir / "steps" / s["step"] / "_metadata.json"
        if meta.exists():
            entry["metadataSha256"] = "sha256:" + sha256_file(meta)
        out.append(entry)
    return out


def package_cost(runs: list[tuple[Path, str]]) -> tuple[dict, list[dict]]:
    """actualUsd summed over every run directory's cost.json; null when any run has no measured cost."""
    by_run, ceiling = [], 0.0
    for directory, stage in runs:
        cost = read_json(directory / "cost.json") if (directory / "cost.json").exists() else {}
        spec = read_json(directory / "run-spec.json") if (directory / "run-spec.json").exists() else {}
        by_run.append({"runId": str(spec.get("runId") or directory.name), "stage": stage, "actualUsd": cost.get("actualUsd")})
        ceiling += cost.get("ceilingUsd") or 0
    known = [r["actualUsd"] for r in by_run]
    total = round(sum(known), 3) if known and None not in known else None
    return {"actualUsd": total, "ceilingUsd": ceiling}, by_run


def sequence(runs: list[tuple[Path, list[dict], str]], spec: dict) -> list[dict]:
    out = []
    for directory, steps, stage in runs:
        out += execution_steps(directory, steps, spec, stage, len(out) + 1)
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run-dir", required=True, action="append", help="full-window run directory (repeatable, one per slice)")
    parser.add_argument("--package-spec", help="optional override: its keys replace the generated ones")
    parser.add_argument("--write-package-spec", help="write the effective (generated plus override) package spec here")
    parser.add_argument("--out")
    parser.add_argument("--canary-run-dir", action="append", default=[], help="captured canary-stage run directory (repeatable)")
    parser.add_argument("--evaluation", help="evaluate_run.py output: phases, finalValidation and per-slice verdicts")
    parser.add_argument("--profile-doc", help="the selected or run-scoped profile document; its identity is derived")
    parser.add_argument("--intent", help="resolve-transform-intent.py discover output (languages, slices, pin, versionSelection)")
    parser.add_argument("--workspace", help="the resolver's workspace (inputs-manifest.json: pinned repositories)")
    parser.add_argument("--catalog", help="PROD-actuals catalog (default reference/prod-actuals.json): blockedHandoffs, sensitiveFields")
    parser.add_argument("--handoffs", action="append", default=[], help="source_window.py data-days output with per-slice handoffs (repeatable)")
    parser.add_argument("--graph-inputs", action="append", default=[], help="graph_inputs.py summary (repeatable)")
    parser.add_argument("--transform-revision", help="Transform commit SHA the DEV pipeline runs")
    parser.add_argument("--transform-deployment-digest", help="SHA-256 of the deployed Transform Glue script")
    parser.add_argument("--spark-version", help="Spark version of the DEV Transform Glue job, for example 3.3")
    parser.add_argument("--layout", help="registry layout JSON (default reference/registry-layout.json)")
    parser.add_argument("--chain-step", action="append", default=[],
                        help="chain_runs.py persist-load or persist-export evidence (repeatable): Persist cost, approvals, graph proof")
    parser.add_argument("--chain-summary", help="chain_runs.py summary: per-step status and cost of a chained validation")
    args = parser.parse_args(argv)
    args.chain_records = [read_json(p) for p in args.chain_step]
    run_dirs = [Path(d) for d in args.run_dir]
    spec = generate_spec(args, run_dirs, read_json(args.package_spec) if args.package_spec else {})
    if args.write_package_spec:
        write_json(args.write_package_spec, spec)
    full = [(d, read_json(d / "steps.json") if (d / "steps.json").exists() else []) for d in run_dirs]
    steps = [s for _, st in full for s in st]
    cost, by_run = package_cost([(Path(d), "canary") for d in args.canary_run_dir] + [(d, "full") for d in run_dirs])
    for record in args.chain_records:
        if record.get("stepKind") != "persist-load":
            continue
        spent = (record.get("cost") or {}).get("actualUsd")
        by_run.append({"runId": f"{record['step']}-{record['stage']}", "stage": record["stage"], "actualUsd": spent})
        cost["ceilingUsd"] += (record.get("cost") or {}).get("ceilingUsd") or 0
        cost["actualUsd"] = None if spent is None or cost["actualUsd"] is None else round(cost["actualUsd"] + spent, 3)

    datasets = list(spec.get("datasets", []))
    for s in steps:
        for o in s.get("outputs", []):
            if "contentSha256" in o:
                datasets.append({"name": o["dataset"], "schemaSha256": "sha256:" + hashlib.sha256(o["headers"][0].encode()).hexdigest(),
                                 "rowCount": o["physicalRows"], "contentSha256": "sha256:" + o["contentSha256"],
                                 "location": s["outputPrefix"] + f"tables/{o['dataset']}/"})
    if not datasets:
        datasets.append({"availability": "UNAVAILABLE", "subject": "datasets", "reason": "no captured DEV output dataset in the run directories",
                         "evidenceIds": ["capture"]})
    canary = [(Path(d), read_json(Path(d) / "steps.json") if (Path(d) / "steps.json").exists() else []) for d in args.canary_run_dir]
    approvals = []
    for directory in [d for d, _ in canary] + run_dirs:
        for f in sorted(glob.glob(str(directory / "approvals" / "*.json"))):
            if f.endswith(".started.json"):
                continue
            a = read_json(f)["approval"]
            approvals.append({"operationDigest": a["operationDigest"], "environment": "dev", "status": a["status"], "recordedAt": a["recordedAt"]})
    for record in args.chain_records:
        a = record.get("approval")
        if a:
            approvals.append({"operationDigest": a["operationDigest"], "environment": "dev", "status": a["status"], "recordedAt": a["recordedAt"]})

    computed = verdict_of(spec["phases"])
    if spec.get("verdict") and spec["verdict"] != computed:
        raise SilvallyError(f"declared verdict {spec['verdict']} disagrees with phase statuses ({computed})")
    blocking = [p["number"] for p in spec["phases"] if p["status"] != "PASS"]
    if blocking and not spec.get("remediations"):
        raise SilvallyError(f"phases {blocking} are not PASS but no remediation is recorded")

    keys = ("profile", "discoveryTrace", "configurationPackage", "environment", "sensitivity", "graph", "runtime",
            "persistCanary", "exporterHydration", "roundTrip")
    run = {"id": spec.get("id") or "validation-" + hashlib.sha256(str(run_dirs[0].resolve().name).encode()).hexdigest()[:16],
           "contractVersion": 1, **{k: spec[k] for k in keys}, "datasets": datasets,
           "executionSteps": sequence([(d, st, "canary") for d, st in canary] + [(d, st, "full") for d, st in full], spec),
           "phases": spec["phases"],
           "boundaryDecisions": spec["boundaryDecisions"], "approvals": approvals,
           "cost": {"ceilingUsd": spec.get("costCeilingUsd", cost.get("ceilingUsd", 0)), "estimatedUsd": spec.get("estimatedUsd", 0),
                    "actualUsd": cost.get("actualUsd"), "actualUsdByRun": by_run},
           "failures": spec.get("failures", []), "remediations": spec.get("remediations", []), "verdict": computed}
    for optional in ("intentResolution", "parityDerivation", "sourceWindowSelection", "finalValidation", "versionSelection",
                     "ownerDecisions", "acceptedProductChanges", "prodActuals", "sliceVerdicts", "productChangeFlags"):
        if optional in spec:
            run[optional] = spec[optional]
    if args.chain_summary:
        summary = read_json(args.chain_summary)
        run["chain"] = {"id": summary["chain"], "slice": summary["slice"], "status": summary["status"],
                        "steps": [{k: e[k] for k in ("stage", "step", "kind", "status", "actualUsd")} for e in summary["steps"]],
                        "missingSteps": summary["missingSteps"], "actualUsd": summary["cost"]["actualUsd"],
                        "residue": summary.get("residue") or []}
    gaps = final_validation_gaps(run) if computed == "READY" else []
    if gaps:
        raise SilvallyError("READY requires the final PROD-derived DEV validation: " + "; ".join(gaps)
                            + " (set phase 12 BLOCKED with FinalProdDerivedValidationRequired instead)")
    try:
        import jsonschema
    except ImportError as error:
        raise SystemExit("jsonschema is required to validate run.json (scripts/requirements-silvally.txt)") from error
    jsonschema.Draft202012Validator(read_json(SCHEMA), format_checker=jsonschema.FormatChecker()).validate(run)
    target = Path(args.out) if args.out else run_dirs[0] / "run.json"
    write_json(target, run)
    print(json.dumps({"runPackage": str(target), "verdict": computed, "executionSteps": len(run["executionSteps"]),
                      "approvals": len(approvals), "sha256": sha256_file(target)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
