#!/usr/bin/env python3
"""Assemble and validate the transform-configuration-run package (run.json).

  build_run_package.py --run-dir RUN [--run-dir RUN ...] --package-spec package-spec.json [--out RUN/run.json]
      [--canary-run-dir RUN ...] [--evaluation phases.json] [--profile-doc profile.json]

RUN is a transform_runs.py run directory (steps.json, approvals/, cost.json). The package
spec supplies what only the validator can judge: profile identity, discoveryTrace,
configurationPackage, environment, sensitivity, graph, runtime, persistCanary,
exporterHydration, roundTrip, phases, boundaryDecisions, failures, remediations and
optional extra datasets and versionSelection (copied from the resolver). This tool adds executionSteps, approvals, dataset evidence from
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

from silvally_io import SilvallyError, read_json, sha256_file, write_json

SCHEMA = Path(__file__).resolve().parent.parent / "reference" / "transform-configuration-run.schema.json"
KEBAB = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


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
    parser.add_argument("--package-spec", required=True)
    parser.add_argument("--out")
    parser.add_argument("--canary-run-dir", action="append", default=[], help="captured canary-stage run directory (repeatable)")
    parser.add_argument("--evaluation", help="evaluate_run.py output: phases, finalValidation and per-slice verdicts")
    parser.add_argument("--profile-doc", help="the selected or run-scoped profile document; its identity is derived")
    args = parser.parse_args(argv)
    run_dirs = [Path(d) for d in args.run_dir]
    spec = read_json(args.package_spec)
    if args.evaluation:
        spec = from_evaluation(spec, read_json(args.evaluation))
    if args.profile_doc and "profile" not in spec:
        spec["profile"] = profile_identity(args.profile_doc)
    full = [(d, read_json(d / "steps.json") if (d / "steps.json").exists() else []) for d in run_dirs]
    steps = [s for _, st in full for s in st]
    cost, by_run = package_cost([(Path(d), "canary") for d in args.canary_run_dir] + [(d, "full") for d in run_dirs])

    datasets = list(spec.get("datasets", []))
    for s in steps:
        for o in s.get("outputs", []):
            if "contentSha256" in o:
                datasets.append({"name": o["dataset"], "schemaSha256": "sha256:" + hashlib.sha256(o["headers"][0].encode()).hexdigest(),
                                 "rowCount": o["physicalRows"], "contentSha256": "sha256:" + o["contentSha256"],
                                 "location": s["outputPrefix"] + f"tables/{o['dataset']}/"})
    canary = [(Path(d), read_json(Path(d) / "steps.json") if (Path(d) / "steps.json").exists() else []) for d in args.canary_run_dir]
    approvals = []
    for directory in [d for d, _ in canary] + run_dirs:
        for f in sorted(glob.glob(str(directory / "approvals" / "*.json"))):
            if f.endswith(".started.json"):
                continue
            a = read_json(f)["approval"]
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
