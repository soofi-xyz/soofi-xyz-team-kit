#!/usr/bin/env python3
"""Assemble and validate the transform-configuration-run package (run.json).

  build_run_package.py --run-dir RUN --package-spec package-spec.json [--out RUN/run.json]

RUN is a transform_runs.py run directory (steps.json, approvals/, cost.json). The package
spec supplies what only the validator can judge: profile identity, discoveryTrace,
configurationPackage, environment, sensitivity, graph, runtime, persistCanary,
exporterHydration, roundTrip, phases, boundaryDecisions, failures, remediations and
optional extra datasets. This tool adds executionSteps, approvals, dataset evidence from
captured outputs and cost, computes the verdict from phase statuses (any FAIL -> NOT_READY,
else any BLOCKED/APPROVAL_REQUIRED -> BLOCKED, else READY), rejects a verdict that
disagrees, requires a remediation for every FAIL/BLOCKED phase, and validates the result
against reference/transform-configuration-run.schema.json (needs jsonschema).
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


def execution_steps(run_dir: Path, steps: list[dict], spec: dict) -> list[dict]:
    manifests = spec.get("inputManifests", {})
    out = []
    for i, s in enumerate(steps, 1):
        case = s["step"].split("-", 1)[1]
        approval = read_json(run_dir / "approvals" / f"{s['step']}.json")
        glue = sorted({e.get("taskSucceededEventDetails", {}).get("output") and json.loads(e["taskSucceededEventDetails"]["output"]).get("Id")
                       for e in read_json(run_dir / "steps" / s["step"] / "history.json").get("events", [])
                       if e.get("taskSucceededEventDetails", {}).get("resourceType") == "glue"} - {None, ""})
        entry = {"sequence": i, "mapping": approval["mappingPin"]["mapping"], "environment": "dev",
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
    parser.add_argument("--local-output", action="append", help="DATASET=PATH of a synthetic-local CSV output to record as dataset evidence")
    parser.add_argument("--local-label", default="synthetic-local", help="logical label used in local:// dataset locations")
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
    for local in args.local_output or []:
        name, _, path = local.partition("=")
        files = sorted(glob.glob(str(Path(path) / "part-*"))) if Path(path).is_dir() else [path]
        header, rows = None, []
        for f in files:
            lines = Path(f).read_text(encoding="utf-8").split("\n")
            header = header or lines[0]
            rows += [line for line in lines[1:] if line]
        datasets.append({"name": name, "schemaSha256": "sha256:" + hashlib.sha256((header or "").encode()).hexdigest(),
                         "rowCount": len(rows), "contentSha256": "sha256:" + hashlib.sha256("\n".join(sorted(rows)).encode()).hexdigest(),
                         "location": f"local://{args.local_label}/{name}"})
    approvals = []
    for f in sorted(glob.glob(str(run_dir / "approvals" / "*.json"))):
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
           "executionSteps": execution_steps(run_dir, steps, spec), "phases": spec["phases"],
           "boundaryDecisions": spec["boundaryDecisions"], "approvals": approvals,
           "cost": {"ceilingUsd": spec.get("costCeilingUsd", cost.get("ceilingUsd", 0)), "estimatedUsd": spec.get("estimatedUsd", 0),
                    "actualUsd": cost.get("actualUsd")},
           "failures": spec.get("failures", []), "remediations": spec.get("remediations", []), "verdict": computed}
    for optional in ("intentResolution", "parityDerivation", "sourceWindowSelection"):
        if optional in spec:
            run[optional] = spec[optional]
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
