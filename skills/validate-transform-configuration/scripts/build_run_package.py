#!/usr/bin/env python3
"""Assemble and validate the transform-configuration-run package (run.json).

  build_run_package.py --run-dir RUN --package-spec package-spec.json [--out RUN/run.json]

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
canary executions as executionSteps with stage canary.
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
from pathlib import Path

from silvally_io import SilvallyError, read_json, sha256_file, write_json

SCHEMA = Path(__file__).resolve().parent.parent / "reference" / "transform-configuration-run.schema.json"


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
    return gaps


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
        meta = run_dir / "out" / case / "_metadata.json"
        if meta.exists():
            entry["metadataSha256"] = "sha256:" + sha256_file(meta)
        out.append(entry)
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--package-spec", required=True)
    parser.add_argument("--out")
    parser.add_argument("--canary-run-dir", help="the captured canary-stage run directory")
    args = parser.parse_args(argv)
    run_dir = Path(args.run_dir)
    spec = read_json(args.package_spec)
    steps = read_json(run_dir / "steps.json") if (run_dir / "steps.json").exists() else []
    cost = read_json(run_dir / "cost.json") if (run_dir / "cost.json").exists() else {"actualUsd": None}

    datasets = list(spec.get("datasets", []))
    for s in steps:
        for o in s.get("outputs", []):
            if "contentSha256" in o:
                datasets.append({"name": o["dataset"], "schemaSha256": "sha256:" + hashlib.sha256(o["headers"][0].encode()).hexdigest(),
                                 "rowCount": o["physicalRows"], "contentSha256": "sha256:" + o["contentSha256"],
                                 "location": s["outputPrefix"] + f"tables/{o['dataset']}/"})
    canary_dir = Path(args.canary_run_dir) if args.canary_run_dir else None
    canary_steps = read_json(canary_dir / "steps.json") if canary_dir and (canary_dir / "steps.json").exists() else []
    approvals = []
    for f in sorted(glob.glob(str(run_dir / "approvals" / "*.json"))
                    + (glob.glob(str(canary_dir / "approvals" / "*.json")) if canary_dir else [])):
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
    run = {"id": spec.get("id") or "validation-" + hashlib.sha256(str(run_dir.resolve().name).encode()).hexdigest()[:16],
           "contractVersion": 1, **{k: spec[k] for k in keys}, "datasets": datasets,
           "executionSteps": (execution_steps(canary_dir, canary_steps, spec, "canary") if canary_dir else [])
           + execution_steps(run_dir, steps, spec, "full", len(canary_steps) + 1), "phases": spec["phases"],
           "boundaryDecisions": spec["boundaryDecisions"], "approvals": approvals,
           "cost": {"ceilingUsd": spec.get("costCeilingUsd", cost.get("ceilingUsd", 0)), "estimatedUsd": spec.get("estimatedUsd", 0),
                    "actualUsd": cost.get("actualUsd")},
           "failures": spec.get("failures", []), "remediations": spec.get("remediations", []), "verdict": computed}
    for optional in ("intentResolution", "parityDerivation", "sourceWindowSelection", "finalValidation", "versionSelection",
                     "ownerDecisions", "acceptedProductChanges", "prodActuals"):
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
    target = Path(args.out) if args.out else run_dir / "run.json"
    write_json(target, run)
    print(json.dumps({"runPackage": str(target), "verdict": computed, "executionSteps": len(run["executionSteps"]),
                      "approvals": len(approvals), "sha256": sha256_file(target)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
