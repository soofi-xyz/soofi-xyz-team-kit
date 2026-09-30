#!/usr/bin/env python3
"""Approval-gated DEV Transform executions and sanitized evidence capture.

A run spec (JSON) lists the cases to execute:

  {
    "runId": "<yyyymmddThhmmssZ>",                # optional; default is now (UTC)
    "stateMachineArn": "arn:aws:states:<region>:<account>:stateMachine:<name>",
    "outputRoot": "s3://<dev-transform-data-bucket>/outputs/silvally-<profile-or-mapping>/",
    "profile": "<dev-profile>", "region": "<region>", "costCeilingUsd": 5,
    "mappings": {"<id>@<version>": {"sha256": "...", "versionId": "..."}},
    "outputFormats": {"<dataset>": {"type": "csv", "delimiter": ",", "header": true}},
    "cases": [{"case": "<binding>-<dataset>-only", "mapping": "<id>@<version>", "expected": "PASS",
               "request": {"contractVersion": 2, "from": "<source>", "to": "<target>", "mappingVersion": "<x.y.z>",
                           "outputDatasets": ["<dataset>"], "inputs": [{"table": "<table>", "s3Uri": "s3://.../<table>/"}]}}]
  }

Commands (all write evidence only under --run-dir):

  spec-from-intent  derive a run spec from resolver output and the mapping registration (read-only discovery):
                    per input binding, one case per output whose requiredInputs are all present, a full case
                    when one binding covers every output, and (default) one REJECTED case per required input
                    of every output, each omitting exactly that input. An omission that would leave no input
                    (`inputs: []`) is skipped and recorded: Transform's request schema refuses an empty input
                    list before planning, so that case says nothing about the mapping. --slice restricts the
                    spec to named package slices (one run directory per slice and window).
  cards    write one operation card per case with its operation digest and stop (APPROVAL_REQUIRED)
  start    start exactly the cases whose --approve digests match their cards (records the approval first), or
           every card of the run when --owner-decisions carries blanketDevWrites (recorded per card digest). When the
           spec records the registry location, the served mapping.json SHA-256 is re-read right before each
           StartExecution (deployment-checks/) and a pruned or replaced pin stops the start (DeploymentRace); after
           dev_redeploy.py republishes it, the same spec starts again
  capture  read-only: describe-execution, history, plan.json, output files; reconcile metadata with physical rows.
           Output rows go to <run>/private/outputs/<runId>/<case>/ (removed by run_workspace.py cleanup; the step
           records it as privateOutputDir); only sanitized summaries (steps.json, _metadata.json) stay in RUN
  regress  compare this run's captured outputs with a baseline run directory, case by case (same inputs and outputs),
           per slice with --slice. Status PASS, FAIL, or NOT_APPLICABLE with the reason when no case is comparable
           (for example MappingRepublished: the same version republished with another digest and output names)
  cost     read-only: Glue DPU-hours of this run's job runs and the USD estimate
  canary-gate   summarize a captured canary-stage run and its PROD-actuals comparisons for the user, per slice
                with --slice: CANARY_FAILED (stop; never offer that slice's full run), AWAITING_APPROVAL, or
                PRE_APPROVED when the owner pre-approved the full run for a passing canary
  approve-full  record the user's explicit approval of an AWAITING_APPROVAL gate

`stage` is canary (the fixed sample of 10 real events per slice) or full (the whole confirmed window). `start`
refuses a full-stage run without an APPROVED or PRE_APPROVED canary gate of the same slice, and every spec refuses
a job ceiling above `ownerCostCeilingUsd` when the owner set one.

`expected` is PASS (execution must succeed) or REJECTED (the request must be refused before the Transform job
starts). A refusal whose error does not name `missingInput` still passes; it is recorded as the Transform
PRODUCT_CHANGE flag `transform-reject-error-unnamed` (error-message quality is Transform's, never a canary failure).
"""

from __future__ import annotations

import argparse
import copy
import glob
import hashlib
import json
import time
from pathlib import Path

from dev_redeploy import served_status
from run_workspace import MARKER as RUN_MARKER
from silvally_io import DEFAULT_REGION, SilvallyError, aws, canonical_digest, load_layout, parse_s3, private_dir, read_json, write_json

RUNTIME = load_layout()["transformRuntime"]
BLANKET_DEV_WRITES = "staging-and-executions-for-this-run"
UNNAMED_REJECT_FLAG = {"id": "transform-reject-error-unnamed", "classification": "PRODUCT_CHANGE", "owner": "Kecleon",
                       "detail": "Transform refused the request before planning, but its error does not name the omitted input"}


def load_spec(path: str) -> dict:
    spec = read_json(path)
    for key in ("stateMachineArn", "outputRoot", "profile", "mappings", "cases"):
        if key not in spec:
            raise SilvallyError(f"run spec lacks {key}")
    if not spec["outputRoot"].startswith("s3://") or not spec["outputRoot"].endswith("/"):
        raise SilvallyError("outputRoot must be an s3:// prefix ending in /")
    spec.setdefault("runId", time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()))
    spec.setdefault("region", DEFAULT_REGION)
    spec.setdefault("costCeilingUsd", 5)
    spec.setdefault("stage", "full")
    check_cost_ceiling(spec)
    return spec


def check_cost_ceiling(spec: dict) -> None:
    ceiling = spec.get("ownerCostCeilingUsd")
    if ceiling is None:
        return
    over = [c["case"] for c in spec["cases"] if (c.get("request") or {}).get("costCeilingUsd", spec["costCeilingUsd"]) > ceiling]
    if spec["costCeilingUsd"] > ceiling or over:
        raise SilvallyError(f"CostCeilingExceeded: a job ceiling is above the owner's {ceiling} USD per job ({over or 'costCeilingUsd'})")


def gate_digest(gate: dict) -> str:
    return canonical_digest({k: v for k, v in gate.items() if k not in {"status", "approval", "gateDigest"}})


def case_slices(spec: dict) -> dict[str, str | None]:
    """step case name -> the package slice it belongs to (a spec restricted to one slice labels every case)."""
    default = spec["slices"][0] if len(spec.get("slices") or []) == 1 else None
    return {c["case"]: c.get("slice") or default for c in spec["cases"]}


def cmd_canary_gate(args) -> int:
    """Summarize the DEV canary for the user and decide whether a full-window run may be offered."""
    run_dir = Path(args.canary_run_dir)
    spec = load_spec(str(run_dir / "run-spec.json"))
    if spec["stage"] != "canary":
        raise SilvallyError("canary-gate reads a canary-stage run directory")
    steps = read_json(run_dir / "steps.json") if (run_dir / "steps.json").exists() else []
    comparisons = [read_json(p) for p in args.comparison]
    if args.slice:
        slices = case_slices(spec)
        steps = [s for s in steps if slices.get(s["step"].split("-", 1)[-1]) in (args.slice, None)]
        other = sorted({c.get("slice") for c in comparisons} - {args.slice})
        if other:
            raise SilvallyError(f"the {args.slice} gate was given comparisons of other slices {other}")
    decisions = read_json(args.owner_decisions) if args.owner_decisions else {}
    approved = [s["step"] for s in steps if (run_dir / "approvals" / f"{s['step']}.json").exists()]
    failed = ([f"{s['step']} {s['status']}" for s in steps if s.get("verdict") != "PASS" or s["status"] == "RUNNING"]
              + [f"comparison {c.get('slice')} {c['status']}" for c in comparisons if c["status"] != "PASS"]
              + [f"{s['step']} has no approval" for s in steps if s["step"] not in approved])
    if not steps:
        failed.append("no captured canary execution")
    if not comparisons:
        failed.append("no canary comparison against the PROD actual")
    gate = {"kind": "canary-gate", "canaryRunId": spec["runId"], "stage": "canary", "slice": args.slice,
            "executions": [{"step": s["step"], "executionArn": s.get("executionArn"), "status": s["status"], "verdict": s.get("verdict"),
                            "inputs": [i["s3Uri"] for c in spec["cases"] if c["case"] == s["step"].split("-", 1)[-1]
                                       for i in c["request"].get("inputs", [])],
                            "outputPrefix": s.get("outputPrefix"),
                            "rows": {o["dataset"]: o.get("physicalRows") for o in s.get("outputs", [])}} for s in steps],
            "comparisons": [{"slice": c.get("slice"), "baselineKind": c.get("baselineKind"), "status": c["status"],
                             "checks": [{k: v for k, v in x.items() if k in {"id", "kind", "status", "devRows", "prodRows", "onlyDev",
                                                                             "onlyProd", "mismatchedByColumn", "devRejects", "prodFailures"}}
                                        for x in c.get("checks", [])]} for c in comparisons],
            "productChangeFlags": sorted({s["productChangeFlag"]["id"] for s in steps if s.get("productChangeFlag")}),
            "failures": failed}
    if failed:
        gate["status"] = "CANARY_FAILED"
    elif decisions.get("preApproveFullRunOnCanaryPass"):
        gate["status"] = "PRE_APPROVED"
        gate["approval"] = {"kind": "owner-pre-approval", "recordedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    else:
        gate["status"] = "AWAITING_APPROVAL"
    gate["gateDigest"] = gate_digest(gate)
    write_json(args.out, gate)
    print(json.dumps(gate, indent=1))
    return 0 if gate["status"] != "CANARY_FAILED" else 1


def cmd_approve_full(args) -> int:
    gate = read_json(args.gate)
    if gate.get("status") != "AWAITING_APPROVAL" or gate.get("gateDigest") != gate_digest(gate):
        raise SilvallyError(f"only an unchanged AWAITING_APPROVAL canary gate can be approved (status {gate.get('status')})")
    gate["status"] = "APPROVED"
    gate["approval"] = {"kind": "user", "approver": args.approver, "scope": args.scope, "operationDigest": gate["gateDigest"],
                        "recordedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    write_json(args.gate, gate)
    print(json.dumps({"status": gate["status"], "gateDigest": gate["gateDigest"]}))
    return 0


def assert_full_run_allowed(spec: dict, gate_path: str | None) -> dict | None:
    if spec["stage"] != "full":
        return None
    if not gate_path:
        raise SilvallyError("CanaryRequired: a full-window run needs a passed DEV canary and an approved --canary-gate")
    gate = read_json(gate_path)
    if gate.get("status") not in {"APPROVED", "PRE_APPROVED"} or gate.get("gateDigest") != gate_digest(gate):
        raise SilvallyError(f"CanaryGateNotApproved: canary gate status {gate.get('status')}; never proceed to the full run")
    uncovered = sorted(set(spec.get("slices") or []) - {gate["slice"]}) if gate.get("slice") else []
    if uncovered:
        raise SilvallyError(f"CanaryGateNotApproved: the gate covers slice {gate['slice']}, not {uncovered}")
    return gate


def execution_name(spec: dict, index: int, case: dict) -> str:
    return f"silvally-{spec['runId']}-{index}-{case['case']}"[:80]


def card_for(spec: dict, index: int, case: dict) -> dict:
    request = copy.deepcopy(case["request"])
    request["output"] = {"s3Prefix": f"{spec['outputRoot']}{spec['runId']}/{case['case']}/"}
    request.setdefault("costCeilingUsd", spec["costCeilingUsd"])
    pin = spec["mappings"].get(case["mapping"])
    if not pin:
        raise SilvallyError(f"case {case['case']}: mapping {case['mapping']} is not pinned in the spec")
    name = execution_name(spec, index, case)
    card = {
        "operation": "states:StartExecution", "environment": "dev", "region": spec["region"],
        "stateMachineArn": spec["stateMachineArn"], "executionName": name, "request": request,
        "reads": [i["s3Uri"] for i in request.get("inputs", [])],
        "mappingPin": {"mapping": case["mapping"], **pin},
        "writes": [request["output"]["s3Prefix"] + name + "/", "Transform-owned runs/<execution>/ plan and reservation"],
        "costCeilingUsd": request["costCeilingUsd"], "expected": case.get("expected", "PASS"), "stage": spec.get("stage", "full"),
        "containment": "new unique execution name and output prefix; nothing overwritten; no deletes; Persist not invoked",
    }
    if case.get("missingInput"):
        card["missingInput"] = case["missingInput"]
    card["operationDigest"] = canonical_digest(card)
    return card


def assert_own_run_dir(run_dir: Path, spec: dict) -> None:
    """A run directory belongs to exactly one run: never mix evidence with another run or session."""
    if not run_dir.exists() or not any(run_dir.iterdir()):
        return
    existing = run_dir / "run-spec.json"
    if not existing.exists():
        raise SilvallyError(f"RunDirectoryNotEmpty: {run_dir} holds files of another session; use a new run directory "
                            "(run_workspace.py new)")
    if read_json(existing).get("runId") != spec["runId"]:
        raise SilvallyError(f"RunDirectoryReused: {run_dir} belongs to run {read_json(existing).get('runId')}; use a new run directory")


def cmd_cards(args) -> int:
    spec = load_spec(args.spec)
    run_dir = Path(args.run_dir)
    assert_own_run_dir(run_dir, spec)
    for index, case in enumerate(spec["cases"], 1):
        card = card_for(spec, index, case)
        write_json(run_dir / "cards" / f"{index}-{case['case']}.json", {**card, "status": "APPROVAL_REQUIRED"})
        print(f"APPROVAL_REQUIRED {index}-{case['case']} {card['operationDigest']}")
    write_json(run_dir / "run-spec.json", spec)
    return 0


def assert_dev_transform(spec: dict) -> None:
    """Refuse any Transform start that targets PROD. Execution proof is DEV only."""
    env = str(spec.get("environment") or "dev").lower()
    if env in {"prod", "production"}:
        raise SilvallyError("PROD Transform is never invoked; execution proof is DEV")
    label = str((spec.get("deployment") or {}).get("registry") or "").lower()
    if label in {"prod", "production"}:
        raise SilvallyError("PROD Transform is never invoked; execution proof is DEV")
    name = (spec.get("stateMachineArn") or "").rsplit(":", 1)[-1].lower()
    if name.startswith("prod-") or name.endswith("-prod") or "-prod-" in name:
        raise SilvallyError("PROD Transform is never invoked; execution proof is DEV")


def cmd_start(args) -> int:
    run_dir = Path(args.run_dir)
    spec = load_spec(str(run_dir / "run-spec.json"))
    assert_dev_transform(spec)
    approvals = set(args.approve or [])
    decisions = read_json(args.owner_decisions) if args.owner_decisions else {}
    blanket = decisions.get("blanketDevWrites") == BLANKET_DEV_WRITES
    if args.owner_decisions and not blanket:
        raise SilvallyError("--owner-decisions has no blanketDevWrites decision; approve each card digest with --approve")
    cards = []
    for index, case in enumerate(spec["cases"], 1):
        card = card_for(spec, index, case)
        stored = read_json(run_dir / "cards" / f"{index}-{case['case']}.json")
        if stored["operationDigest"] != card["operationDigest"]:
            raise SilvallyError(f"{index}-{case['case']}: card changed since it was presented; re-run cards")
        cards.append((index, case, card))
    if blanket:
        approvals |= {card["operationDigest"] for _, _, card in cards}
    unmatched = approvals - {card["operationDigest"] for _, _, card in cards}
    if unmatched:
        raise SilvallyError(f"approval digests match no card: {sorted(unmatched)}")
    deployment = spec.get("deployment") or {}
    live = bool(deployment.get("location")) and bool(approvals)
    if deployment.get("drift") and approvals and not live:
        raise SilvallyError(deployment["blocking"])
    gate = assert_full_run_allowed(spec, args.canary_gate) if approvals else None
    if gate:
        write_json(run_dir / "canary-gate.json", gate)
    started = 0
    for index, case, card in cards:
        if card["operationDigest"] not in approvals:
            continue
        approval = {"operationDigest": card["operationDigest"], "environment": "dev", "status": "APPROVED",
                    "kind": "owner-blanket-dev-writes" if blanket else "operation", "approver": args.approver, "scope": args.scope,
                    "recordedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        if live:
            assert_served(spec, run_dir, index, case)
        write_json(run_dir / "approvals" / f"{index}-{case['case']}.json", {**card, "approval": approval})
        result = aws(["stepfunctions", "start-execution", "--state-machine-arn", spec["stateMachineArn"],
                      "--name", card["executionName"], "--input", json.dumps(card["request"])],
                     profile=spec["profile"], region=spec["region"], environment="dev")
        write_json(run_dir / "approvals" / f"{index}-{case['case']}.started.json", result)
        print(f"STARTED {card['executionName']}")
        started += 1
    print(f"started {started} execution(s)")
    return 0


def assert_served(spec: dict, run_dir: Path, index: int, case: dict) -> None:
    """Right before StartExecution: DEV must still serve the pinned mapping.json (latest-PR-wins deploys prune it)."""
    pin = spec["mappings"][case["mapping"]]["sha256"]
    check = served_status(spec["deployment"]["location"], case["mapping"], pin, spec["profile"], spec.get("region", DEFAULT_REGION))
    write_json(run_dir / "deployment-checks" / f"{index}-{case['case']}.json", check)
    if check["status"] != "SERVED":
        raise SilvallyError(f"DeploymentRace: DEV {check['status'].lower().replace('_', ' ')} {case['mapping']} right before "
                            "StartExecution; classify it with dev_redeploy.py check --slug --head-sha and, with the owner's "
                            "devRedeployPinned decision, republish it with dev_redeploy.py redeploy, then start again")


def data_files(directory: Path) -> list[str]:
    return sorted(f for f in glob.glob(str(directory / "part-*")) if not f.endswith((".crc", ".json")))


def summarize_output(files: list[str], fmt: dict) -> dict:
    """Physical row count and content digests of one output dataset, in its registered format."""
    kind = fmt.get("type", "csv")
    parts = sorted(hashlib.sha256(Path(f).read_bytes()).hexdigest() for f in files)
    out: dict = {"files": len(files), "partSha256": parts}
    if kind in ("csv", "jsonl"):
        headers, rows = set(), []
        for f in files:
            lines = Path(f).read_text(encoding="utf-8").split("\n")
            if kind == "csv" and fmt.get("header", False):
                headers.add(lines[0])
                lines = lines[1:]
            rows += [line for line in lines if line]
        out.update({"physicalRows": len(rows), "contentSha256": hashlib.sha256("\n".join(sorted(rows)).encode()).hexdigest()})
        if headers:
            out["headers"] = sorted(headers)
        return out
    try:
        import pyarrow.parquet as pq
    except ImportError:
        out["physicalRows"] = None
        return out
    rows = [json.dumps(r, sort_keys=True, default=str) for f in files for r in pq.read_table(f).to_pylist()]
    out.update({"physicalRows": len(rows), "contentSha256": hashlib.sha256("\n".join(sorted(rows)).encode()).hexdigest()})
    return out


def rejection_ok(describe: dict, states: list[str], error: str | None, missing: str | None) -> tuple[bool, bool]:
    """(refused before the Transform job started, the error names the omitted input)."""
    refused = describe["status"] == "FAILED" and "RunTransformJob" not in states
    return refused, refused and (missing is None or (error is not None and missing in error))


def capture_rows_dir(run_dir: Path, spec: dict, explicit: str | None) -> Path:
    """Where captured DEV output rows go: <run>/private/outputs/<runId>/ of the enclosing run_workspace.py run,
    so run_workspace.py cleanup removes them; only sanitized summaries stay in the run directory. An explicit
    --private-dir must lie inside some run's private/ directory."""
    if explicit:
        target = Path(explicit).expanduser().resolve()
        owner = next((p.parent for p in [target, *target.parents] if p.name == "private" and (p.parent / RUN_MARKER).exists()), None)
        if owner is None:
            raise SilvallyError("captured DEV output rows are restricted: --private-dir must lie inside a run_workspace.py "
                                "run's private/ directory (removed by cleanup)")
        return target
    marker = next((p for p in [run_dir.resolve(), *run_dir.resolve().parents] if (p / RUN_MARKER).exists()), None)
    if marker is None:
        raise SilvallyError("CapturePrivateDirRequired: the run directory is not inside a run_workspace.py run; "
                            "pass --private-dir <run>/private/...")
    return marker / "private" / "outputs" / spec["runId"]


def cmd_capture(args) -> int:
    run_dir = Path(args.run_dir)
    spec = load_spec(str(run_dir / "run-spec.json"))
    profile, region = spec["profile"], spec["region"]
    arn_prefix = spec["stateMachineArn"].replace(":stateMachine:", ":execution:")
    bucket, _ = parse_s3(spec["outputRoot"])
    formats = spec.get("outputFormats", {})
    rows_root = capture_rows_dir(run_dir, spec, args.private_dir)
    summary = []
    for index, case in enumerate(spec["cases"], 1):
        if not (run_dir / "approvals" / f"{index}-{case['case']}.started.json").exists():
            continue
        name = execution_name(spec, index, case)
        step_dir = run_dir / "steps" / f"{index}-{case['case']}"
        describe = aws(["stepfunctions", "describe-execution", "--execution-arn", f"{arn_prefix}:{name}"], profile=profile, region=region, environment="prod")
        write_json(step_dir / "describe-execution.json", describe)
        if describe["status"] == "RUNNING":
            summary.append({"step": f"{index}-{case['case']}", "status": "RUNNING"})
            continue
        history = aws(["stepfunctions", "get-execution-history", "--execution-arn", f"{arn_prefix}:{name}", "--max-items", "500"],
                      profile=profile, region=region, environment="prod")
        write_json(step_dir / "history.json", history)
        states = [e["stateEnteredEventDetails"]["name"] for e in history.get("events", []) if "stateEnteredEventDetails" in e]
        plan_uri = f"s3://{bucket}/" + RUNTIME["planKey"].format(executionName=name)
        plan = None
        if aws(["s3", "ls", plan_uri], profile=profile, region=region, environment="prod", check=False).strip():
            aws(["s3", "cp", plan_uri, str(step_dir / "plan.json"), "--quiet"], profile=profile, region=region, environment="prod", output_json=False)
            plan = read_json(step_dir / "plan.json")
        cause = describe.get("cause") or ""
        try:
            error = json.loads(cause).get("ErrorMessage") or cause[:300]
        except ValueError:
            error = cause[:300] or None
        expected = case.get("expected", "PASS")
        named = True
        if expected == "PASS":
            ok = describe["status"] == "SUCCEEDED"
        else:
            ok, named = rejection_ok(describe, states, error, case.get("missingInput"))
        entry = {"step": f"{index}-{case['case']}", "executionArn": describe["executionArn"], "status": describe["status"],
                 "expected": expected, "verdict": "PASS" if ok else "FAIL", "states": states, "error": error,
                 "start": describe.get("startDate"), "stop": describe.get("stopDate")}
        if case.get("slice"):
            entry["slice"] = case["slice"]
        if case.get("missingInput"):
            entry["missingInput"] = case["missingInput"]
            entry["errorNamesMissingInput"] = named
            if ok and not named:
                entry["productChangeFlag"] = UNNAMED_REJECT_FLAG
        if plan:
            entry["planMapping"] = {k: plan["mapping"]["rule"].get(k) for k in ("sha256", "versionId")} | {"id": plan["mapping"]["id"], "version": plan["mapping"]["version"]}
            entry["executedSql"] = [{"dataset": q["dataset"], "sha256": q.get("querySha256"), "versionId": q.get("queryVersionId")} for q in plan.get("queries", [])]
            pin = spec["mappings"][case["mapping"]]
            entry["mappingPinMatches"] = entry["planMapping"]["sha256"] == pin["sha256"] and entry["planMapping"]["versionId"] == pin.get("versionId", entry["planMapping"]["versionId"])
        prefix = f"{spec['outputRoot']}{spec['runId']}/{case['case']}/{name}/"
        if describe["status"] == "SUCCEEDED":
            out_dir = private_dir(rows_root) / case["case"]
            aws(["s3", "sync", prefix, str(out_dir), "--quiet"], profile=profile, region=region, environment="prod", output_json=False)
            meta = read_json(out_dir / "_metadata.json") if (out_dir / "_metadata.json").exists() else {}
            if meta:
                write_json(step_dir / "_metadata.json", meta)
            entry["privateOutputDir"] = str(out_dir)
            outputs = []
            for dataset in meta.get("datasets", []):
                files = data_files(out_dir / RUNTIME["outputTablesDir"] / dataset["dataset"])
                if not files:
                    outputs.append({"dataset": dataset["dataset"], "metadataRows": dataset.get("rowCount")})
                    continue
                observed = summarize_output(files, formats.get(dataset["dataset"], {"type": "csv", "header": True}))
                observed["reconciled"] = (observed["physicalRows"] is not None and dataset.get("rowCount") == observed["physicalRows"]
                                          and dataset.get("fileCount", len(files)) == len(files))
                outputs.append({"dataset": dataset["dataset"], "metadataRows": dataset.get("rowCount"), **observed})
            entry["outputPrefix"] = prefix
            entry["outputs"] = outputs
            if outputs and not all(o.get("reconciled") for o in outputs):
                entry["verdict"] = "FAIL"
        summary.append(entry)
    write_json(run_dir / "steps.json", summary)
    for s in summary:
        print(s["step"], s["status"], s.get("verdict", ""), (s.get("error") or "")[:100],
              [(o["dataset"], o.get("physicalRows", o.get("metadataRows")), o.get("reconciled")) for o in s.get("outputs", [])])
    return 0


def case_signature(case: dict) -> tuple:
    request = case["request"]
    return (case["mapping"], frozenset(i["s3Uri"] for i in request.get("inputs", [])),
            tuple(sorted(request.get("outputDatasets") or [])), case.get("expected", "PASS"))


def not_comparable_reason(specs: dict, steps: dict) -> str:
    """Why no current case has a baseline counterpart: a republished mapping version, renamed outputs, other inputs."""
    reasons = []
    for key in sorted(set(specs["current"]["mappings"]) & set(specs["baseline"]["mappings"])):
        mine, theirs = specs["current"]["mappings"][key].get("sha256"), specs["baseline"]["mappings"][key].get("sha256")
        if mine != theirs:
            reasons.append(f"MappingRepublished: {key} was republished (baseline digest {str(theirs)[:12]}, current {str(mine)[:12]})")
    outputs = {label: sorted({o["dataset"] for s in steps[label] for o in s.get("outputs", [])}) for label in steps}
    if outputs["current"] != outputs["baseline"]:
        reasons.append(f"OutputNamesDiffer: baseline outputs {outputs['baseline']}, current {outputs['current']}")
    if not reasons:
        reasons.append("NoMatchingCase: no current case has the same mapping, input URIs, outputs and expectation as a baseline case")
    return "; ".join(reasons)


def cmd_regress(args) -> int:
    """Case-by-case comparison with a baseline run: same mapping, input URIs, outputs and expectation."""
    runs, specs, all_steps = {}, {}, {}
    for label, directory in (("current", Path(args.run_dir)), ("baseline", Path(args.baseline))):
        spec = read_json(directory / "run-spec.json")
        steps = {s["step"]: s for s in read_json(directory / "steps.json")}
        slices = case_slices(spec)
        cases = [(i, c) for i, c in enumerate(spec["cases"], 1) if not args.slice or slices.get(c["case"]) in (args.slice, None)]
        runs[label] = {case_signature(c): steps.get(f"{i}-{c['case']}") for i, c in cases}
        specs[label], all_steps[label] = spec, [s for s in runs[label].values() if s]
    report = {"slice": args.slice, "identical": [], "changed": [], "newCases": [], "baselineOnly": []}
    for signature, step in runs["current"].items():
        base = runs["baseline"].get(signature)
        if step is None:
            continue
        if base is None:
            report["newCases"].append(step["step"])
            continue
        mine = {o["dataset"]: (o.get("physicalRows"), o.get("contentSha256")) for o in step.get("outputs", [])}
        theirs = {o["dataset"]: (o.get("physicalRows"), o.get("contentSha256")) for o in base.get("outputs", [])}
        same = step.get("verdict") == base.get("verdict") and mine == theirs
        row = {"step": step["step"], "baselineStep": base["step"], "verdict": [step.get("verdict"), base.get("verdict")],
               "outputs": {d: {"rows": [mine.get(d, (None,))[0], theirs.get(d, (None,))[0]],
                               "contentEqual": mine.get(d) == theirs.get(d)} for d in sorted(set(mine) | set(theirs))}}
        report["identical" if same else "changed"].append(row)
    report["baselineOnly"] = sorted(s["step"] for sig, s in runs["baseline"].items() if s and sig not in runs["current"])
    if report["changed"]:
        report["status"] = "FAIL"
    elif report["identical"]:
        report["status"] = "PASS"
    else:
        report["status"] = "NOT_APPLICABLE"
        report["reason"] = not_comparable_reason(specs, all_steps)
    report["pass"] = report["status"] != "FAIL"
    target = Path(args.out) if args.out else Path(args.run_dir) / (f"regression-{args.slice}.json" if args.slice else "regression.json")
    write_json(target, report)
    print(json.dumps({"slice": args.slice, "status": report["status"], "identical": len(report["identical"]),
                      "changed": len(report["changed"]), "newCases": len(report["newCases"]),
                      "baselineOnly": len(report["baselineOnly"]), **({"reason": report["reason"]} if "reason" in report else {})}))
    return 0 if report["pass"] else 1


def cmd_cost(args) -> int:
    run_dir = Path(args.run_dir)
    spec = load_spec(str(run_dir / "run-spec.json"))
    runs, token = [], None
    while True:
        call = ["glue", "get-job-runs", "--job-name", args.job_name, "--max-results", "200"]
        if token:
            call += ["--next-token", token]
        page = aws(call, profile=spec["profile"], region=spec["region"], environment="prod")
        runs += page.get("JobRuns", [])
        token = page.get("NextToken")
        if not token or len(runs) > args.max_runs:
            break
    mine = [r for r in runs if str((r.get("Arguments") or {}).get("--EXECUTION_ID", "")).startswith(f"silvally-{spec['runId']}-")]
    dpu_hours = sum(r.get("ExecutionTime", 0) * (r.get("MaxCapacity") or 0) for r in mine) / 3600
    rate = RUNTIME["glueUsdPerDpuHour"]
    cost = {"glueRuns": len(mine), "dpuHours": round(dpu_hours, 3), "usdPerDpuHour": rate,
            "actualUsd": round(dpu_hours * rate, 3), "ceilingUsd": spec["costCeilingUsd"] * max(1, len(spec["cases"]))}
    write_json(run_dir / "cost.json", cost)
    print(json.dumps(cost))
    return 0


def locate_mapping(manifest: list[dict], key: str, label: str) -> tuple[dict | None, dict | None, Path | None]:
    """The pinned (materialized first) and deployed registry records of one mapping, plus its mapping.json."""
    mapping_id, version = key.split("@")
    built = next((m for e in manifest if e["kind"] == "materialized" for m in e["mappings"] if m["mapping"] == key), None)
    deployed = next((m for e in manifest if e["kind"] == "registry" and e["name"] == label for m in e["mappings"] if m["mapping"] == key), None)
    path = None
    for kind in ("materialized", "registry"):
        for entry in manifest:
            if entry["kind"] == kind and path is None:
                found = sorted(Path(entry["path"]).glob(f"**/{mapping_id}/{version}/mapping.json"))
                path = found[0] if found else None
    return built or deployed, deployed, path


def present_tables(prefix: str, profile: str, region: str) -> set[str]:
    listing = aws(["s3", "ls", prefix], profile=profile, region=region, environment="prod", check=False)
    return {line.split()[-1].rstrip("/") for line in listing.splitlines() if line.strip().startswith("PRE ")}


def derive_cases(mapping: dict, key: str, bindings: dict[str, str], present: dict[str, set[str]],
                 outputs_filter: list[str] | None, negatives: bool,
                 slices: list[dict] | None = None) -> tuple[list[dict], list[dict]]:
    """Cases from the registration alone: per-output positives, full runs, one negative per required input.

    When `slices` is set, emit one PASS case per named slice (its outputDatasets together) and no
    undifferentiated full-package run.
    """
    outputs = {o["dataset"]: list(o.get("requiredInputs") or [i["table"] for i in mapping["inputs"]]) for o in mapping["outputs"]}
    slice_specs = [s for s in (slices or []) if s.get("outputDatasets")]
    selected = [d for d in outputs if not outputs_filter or d in outputs_filter]

    def req(names: list[str], tables: list[str], base: str) -> dict:
        return {"contractVersion": 2, "from": mapping["from"], "to": mapping["to"], "mappingVersion": mapping["version"],
                "outputDatasets": names, "inputs": [{"table": t, "s3Uri": f"{base}{t}/"} for t in sorted(tables)]}

    cases, skipped, first_binding = [], [], {}
    for name, base in bindings.items():
        runnable = [d for d in selected if set(outputs[d]) <= present[name]]
        if not runnable:
            skipped.append({"binding": name, "reason": "no selected output has all its requiredInputs under this prefix"})
            continue
        if slice_specs:
            for spec in slice_specs:
                needed = list(spec["outputDatasets"])
                if set(needed) <= set(runnable):
                    tables = sorted({t for d in needed for t in outputs[d]})
                    cases.append({"case": f"{name}-{spec['id']}", "mapping": key, "expected": "PASS",
                                  "binding": name, "slice": spec["id"],
                                  "request": req(needed, tables, base)})
                else:
                    skipped.append({"binding": name, "slice": spec["id"],
                                    "missingDatasets": sorted(set(needed) - set(runnable))})
            for dataset in runnable:
                first_binding.setdefault(dataset, name)
        else:
            if set(runnable) == set(outputs) and len(outputs) > 1:
                tables = sorted({t for d in outputs for t in outputs[d]})
                cases.append({"case": f"{name}-full", "mapping": key, "expected": "PASS", "binding": name, "request": req(sorted(outputs), tables, base)})
            for dataset in runnable:
                first_binding.setdefault(dataset, name)
                cases.append({"case": f"{name}-{dataset.replace('_', '-')}-only", "mapping": key, "expected": "PASS",
                              "binding": name, "request": req([dataset], outputs[dataset], base)})
        for dataset in sorted(set(selected) - set(runnable)):
            skipped.append({"binding": name, "dataset": dataset, "missingInputs": sorted(set(outputs[dataset]) - present[name])})
    if not slice_specs and not any(c["case"].endswith("-full") for c in cases) and len(outputs) > 1:
        skipped.append({"case": "full", "reason": "no binding holds every output's requiredInputs; full run not derivable"})
    if negatives:
        slice_of = {d: s["id"] for s in slice_specs for d in s["outputDatasets"]}
        for dataset in selected:
            name = first_binding.get(dataset)
            if name is None:
                continue
            for missing in outputs[dataset]:
                label = f"neg-{dataset.replace('_', '-')}-without-{missing}"
                remaining = [t for t in outputs[dataset] if t != missing]
                if not remaining:
                    skipped.append({"case": label, "reason": "OmissionLeavesNoInputs: omitting the only required input sends "
                                    "inputs: [], which Transform's request schema refuses before planning; the case proves "
                                    "nothing about the mapping"})
                    continue
                case = {"case": label, "mapping": key, "expected": "REJECTED", "missingInput": missing, "binding": name,
                        "request": req([dataset], remaining, bindings[name])}
                if dataset in slice_of:
                    case["slice"] = slice_of[dataset]
                cases.append(case)
    return cases, skipped


def output_filter(values: list[str] | None, registered: list[str]) -> list[str] | None:
    """--outputs accepts repeated and comma-separated names; an unknown name is an error, never an empty selection."""
    names = [n.strip() for v in values or [] for n in v.split(",") if n.strip()]
    unknown = sorted(set(names) - set(registered))
    if unknown:
        raise SilvallyError(f"--outputs names unregistered outputs {unknown}; registered: {sorted(registered)}")
    return names or None


def cmd_spec_from_intent(args) -> int:
    """Derive a run spec from resolver output and the mapping registration (read-only AWS discovery)."""
    intent = read_json(args.intent)
    if intent.get("status") != "RESOLVED":
        raise SilvallyError("intent is not RESOLVED; answer the resolver's questions first")
    manifest = read_json(Path(args.workspace) / "inputs-manifest.json")
    mapping_key = args.mapping or intent["selection"]["selected"]
    pin, served, mapping_path = locate_mapping(manifest, mapping_key, args.label)
    if not pin or mapping_path is None:
        raise SilvallyError(f"{mapping_key} is neither materialized from the candidate nor published in {args.label}")
    mapping = read_json(mapping_path)
    drift = None if served and served["sha256"] == pin["sha256"] else ("absent" if not served else "digest-differs")
    bindings = dict(b.split("=", 1) for b in args.bind or [])
    profile = None
    if intent.get("selectedProfile") and args.profiles:
        candidates = [Path(d) / intent["selectedProfile"] for d in args.profiles]
        profile = next((read_json(c) for c in candidates if c.exists()), None)
    if not bindings and profile:
        direction_ids = {d["id"] for d in profile["directions"]
                         if f"{d['mapping'].get('id')}@{d['mapping'].get('version')}" == mapping_key}
        for source in profile.get("validationSources", []):
            if source.get("kind") == "existing-dev-artifact" and direction_ids & set(source.get("appliesTo", [])) and source.get("artifactStatus") == "ready":
                bindings[source["id"]] = source["location"]
    if not bindings:
        raise SilvallyError("no input binding: pass --bind NAME=s3://<prefix>/ (a prefix holding one <table>/ directory per input)")
    bindings = {n: (u if u.endswith("/") else u + "/") for n, u in bindings.items()}
    present = {n: present_tables(u, args.profile, args.region) for n, u in bindings.items()}
    slices = [s for s in (intent.get("slices") or []) if s.get("outputDatasets")]
    if args.slice:
        unknown = sorted(set(args.slice) - {s["id"] for s in slices})
        if unknown:
            raise SilvallyError(f"--slice {unknown} is not a slice of the resolved request {[s['id'] for s in slices]}")
        slices = [s for s in slices if s["id"] in args.slice]
    registered = [o["dataset"] for o in mapping["outputs"]]
    outputs_filter = output_filter(args.outputs, registered) or ([d for s in slices for d in s["outputDatasets"]] or None)
    cases, skipped = derive_cases(mapping, mapping_key, bindings, present, outputs_filter,
                                  args.negatives == "all", slices=slices)
    machines = aws(["stepfunctions", "list-state-machines"], profile=args.profile, region=args.region, environment="prod")["stateMachines"]
    suffix = args.state_machine_suffix or RUNTIME["stateMachineSuffix"]
    arn = next((m["stateMachineArn"] for m in machines if m["name"].endswith(suffix)), None)
    if not arn:
        raise SilvallyError(f"no state machine ending {suffix}")
    label = (intent.get("selectedProfile") or mapping["id"]).removesuffix(".json")
    bucket, _ = parse_s3(next(iter(bindings.values())))
    formats = {}
    for o in mapping["outputs"]:
        fmt_type = o.get("format") or mapping["output"].get("format")
        options = {**(mapping["output"].get("options") or {}), **(o.get("options") or {})}
        formats[o["dataset"]] = {"type": fmt_type, **({"delimiter": options.get("delimiter", ","), "header": bool(options.get("header", False))} if fmt_type == "csv" else {})}
    spec = {"stateMachineArn": arn, "outputRoot": args.output_root or f"s3://{bucket}/outputs/silvally-{label}/",
            "profile": args.profile, "region": args.region, "costCeilingUsd": args.cost_ceiling, "stage": args.stage,
            "mappings": {mapping_key: {"sha256": pin["sha256"], "versionId": (served or {}).get("versionId")}},
            "outputFormats": formats, "bindings": bindings,
            "presentInputs": {n: sorted(t) for n, t in present.items()},
            "deployment": {"registry": args.label, "served": bool(served), "drift": drift,
                           "location": next((e.get("location") for e in manifest if e.get("kind") == "registry"
                                             and e.get("name") == args.label), None),
                           "blocking": ("DeploymentDrift: the environment does not serve the pinned mapping; do not start"
                                        " (with a registry location, start re-checks it live)") if drift else None},
            "skipped": skipped, "cases": cases}
    if slices:
        spec["slices"] = [s["id"] for s in slices]
    if args.run_id:
        spec["runId"] = args.run_id
    if args.owner_cost_ceiling is not None:
        spec["ownerCostCeilingUsd"] = args.owner_cost_ceiling
    check_cost_ceiling(spec)
    write_json(args.out, spec)
    print(json.dumps({"out": args.out, "cases": len(cases), "negatives": sum(c["expected"] == "REJECTED" for c in cases),
                      "stateMachine": arn.split(":")[-1], "drift": drift, "skipped": skipped}, indent=1))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("spec-from-intent")
    p.add_argument("--intent", required=True, help="resolve-transform-intent.py discover output")
    p.add_argument("--workspace", required=True, help="the resolver's --workspace (inputs-manifest.json)")
    p.add_argument("--mapping", help="id@version to run (default: the resolver's selection)")
    p.add_argument("--profiles", action="append", help="profile directory; supplies default bindings from validationSources")
    p.add_argument("--bind", action="append", help="NAME=s3://prefix/ holding one <table>/ directory per mapping input (repeatable)")
    p.add_argument("--outputs", action="append",
                   help="restrict to these output datasets, repeated or comma-separated (default: all registered outputs)")
    p.add_argument("--slice", action="append", help="restrict to this named package slice of the request (repeatable)")
    p.add_argument("--negatives", choices=("all", "none"), default="all", help="one REJECTED case per required input of each output")
    p.add_argument("--label", default="dev", help="registry label the executions run against")
    p.add_argument("--profile", required=True, help="operator's DEV AWS profile")
    p.add_argument("--region", default=DEFAULT_REGION)
    p.add_argument("--run-id", help="run id (default: now, UTC); the output prefix is <output-root><run-id>/")
    p.add_argument("--output-root", help="s3:// prefix ending in / (default: <first binding bucket>/outputs/silvally-<profile-or-mapping>/)")
    p.add_argument("--state-machine-suffix", help="default: the layout's transformRuntime.stateMachineSuffix")
    p.add_argument("--cost-ceiling", type=float, default=5)
    p.add_argument("--owner-cost-ceiling", type=float, help="owner's per-job costCeilingUsd decision; no case may exceed it")
    p.add_argument("--stage", choices=("canary", "full"), default="full",
                   help="canary: the fixed 10-events-per-slice sample; full: the whole confirmed window (needs --canary-gate at start)")
    p.add_argument("--out", required=True)
    p = sub.add_parser("cards")
    p.add_argument("--spec", required=True)
    p.add_argument("--run-dir", required=True)
    p = sub.add_parser("start")
    p.add_argument("--run-dir", required=True)
    p.add_argument("--approve", action="append", help="operation digest the approver accepted (repeatable)")
    p.add_argument("--approver", required=True)
    p.add_argument("--scope", required=True, help="the approval scope in the approver's words")
    p.add_argument("--canary-gate", help="canary-gate record (APPROVED or PRE_APPROVED); required for a full-stage run")
    p.add_argument("--owner-decisions", help="ownerDecisions JSON; blanketDevWrites approves every card of this run (recorded per digest)")
    p = sub.add_parser("canary-gate")
    p.add_argument("--canary-run-dir", required=True, help="the captured canary run directory")
    p.add_argument("--slice", help="gate one package slice: only its executions and comparison count")
    p.add_argument("--comparison", action="append", required=True, help="prod_actuals.py compare result for the canary (per slice)")
    p.add_argument("--owner-decisions", help="the resolver's ownerDecisions JSON (preApproveFullRunOnCanaryPass)")
    p.add_argument("--out", required=True)
    p = sub.add_parser("approve-full")
    p.add_argument("--gate", required=True)
    p.add_argument("--approver", required=True)
    p.add_argument("--scope", required=True, help="the user's approval of the full-window run, in their words")
    p = sub.add_parser("capture")
    p.add_argument("--run-dir", required=True)
    p.add_argument("--private-dir", help="where output rows go (default: <run>/private/outputs/<runId>/ of the enclosing run)")
    p = sub.add_parser("regress")
    p.add_argument("--run-dir", required=True)
    p.add_argument("--baseline", required=True, help="an earlier run directory (run-spec.json + steps.json)")
    p.add_argument("--slice", help="compare only this package slice's cases (the report records the slice)")
    p.add_argument("--out", help="default: RUN/regression[-<slice>].json")
    p = sub.add_parser("cost")
    p.add_argument("--run-dir", required=True)
    p.add_argument("--job-name", required=True, help="Transform Glue job name (see the Transform stack outputs)")
    p.add_argument("--max-runs", type=int, default=2000)
    args = parser.parse_args(argv)
    return {"spec-from-intent": cmd_spec_from_intent, "cards": cmd_cards, "start": cmd_start, "capture": cmd_capture,
            "regress": cmd_regress, "cost": cmd_cost, "canary-gate": cmd_canary_gate,
            "approve-full": cmd_approve_full}[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
