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
                    of every output, each omitting exactly that input
  cards    write one operation card per case with its operation digest and stop (APPROVAL_REQUIRED)
  start    start exactly the cases whose --approve digests match their cards (records the approval first)
  capture  read-only: describe-execution, history, plan.json, output files; reconcile metadata with physical rows
  regress  compare this run's captured outputs with a baseline run directory, case by case (same inputs and outputs)
  cost     read-only: Glue DPU-hours of this run's job runs and the USD estimate
  canary-gate   summarize a captured canary-stage run and its PROD-actuals comparisons for the user:
                CANARY_FAILED (stop; never offer the full run), AWAITING_APPROVAL, or PRE_APPROVED when the
                owner pre-approved the full run for a passing canary
  approve-full  record the user's explicit approval of an AWAITING_APPROVAL gate

`stage` is canary (the fixed sample of 10 real events per slice) or full (the whole confirmed window). `start`
refuses a full-stage run without an APPROVED or PRE_APPROVED canary gate, and every spec refuses a job ceiling
above `ownerCostCeilingUsd` when the owner set one.

`expected` is PASS (execution must succeed) or REJECTED (the plan must be rejected before the Transform job
starts; when `missingInput` is set, the error must name it).
"""

from __future__ import annotations

import argparse
import copy
import glob
import hashlib
import json
import time
from pathlib import Path

from silvally_io import DEFAULT_REGION, SilvallyError, aws, canonical_digest, load_layout, parse_s3, read_json, write_json

RUNTIME = load_layout()["transformRuntime"]


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


def cmd_canary_gate(args) -> int:
    """Summarize the DEV canary for the user and decide whether a full-window run may be offered."""
    run_dir = Path(args.canary_run_dir)
    spec = load_spec(str(run_dir / "run-spec.json"))
    if spec["stage"] != "canary":
        raise SilvallyError("canary-gate reads a canary-stage run directory")
    steps = read_json(run_dir / "steps.json") if (run_dir / "steps.json").exists() else []
    comparisons = [read_json(p) for p in args.comparison]
    decisions = read_json(args.owner_decisions) if args.owner_decisions else {}
    approved = [s["step"] for s in steps if (run_dir / "approvals" / f"{s['step']}.json").exists()]
    failed = ([f"{s['step']} {s['status']}" for s in steps if s.get("verdict") != "PASS" or s["status"] == "RUNNING"]
              + [f"comparison {c.get('slice')} {c['status']}" for c in comparisons if c["status"] != "PASS"]
              + [f"{s['step']} has no approval" for s in steps if s["step"] not in approved])
    if not steps:
        failed.append("no captured canary execution")
    gate = {"kind": "canary-gate", "canaryRunId": spec["runId"], "stage": "canary",
            "executions": [{"step": s["step"], "executionArn": s.get("executionArn"), "status": s["status"], "verdict": s.get("verdict"),
                            "inputs": [i["s3Uri"] for c in spec["cases"] if c["case"] == s["step"].split("-", 1)[-1]
                                       for i in c["request"].get("inputs", [])],
                            "outputPrefix": s.get("outputPrefix"),
                            "rows": {o["dataset"]: o.get("physicalRows") for o in s.get("outputs", [])}} for s in steps],
            "comparisons": [{"slice": c.get("slice"), "baselineKind": c.get("baselineKind"), "status": c["status"],
                             "checks": [{k: v for k, v in x.items() if k in {"id", "kind", "status", "devRows", "prodRows", "onlyDev",
                                                                             "onlyProd", "mismatchedByColumn", "devRejects", "prodFailures"}}
                                        for x in c.get("checks", [])]} for c in comparisons],
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


def cmd_cards(args) -> int:
    spec = load_spec(args.spec)
    run_dir = Path(args.run_dir)
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
    cards = []
    for index, case in enumerate(spec["cases"], 1):
        card = card_for(spec, index, case)
        stored = read_json(run_dir / "cards" / f"{index}-{case['case']}.json")
        if stored["operationDigest"] != card["operationDigest"]:
            raise SilvallyError(f"{index}-{case['case']}: card changed since it was presented; re-run cards")
        cards.append((index, case, card))
    unmatched = approvals - {card["operationDigest"] for _, _, card in cards}
    if unmatched:
        raise SilvallyError(f"approval digests match no card: {sorted(unmatched)}")
    if (spec.get("deployment") or {}).get("drift") and approvals:
        raise SilvallyError(spec["deployment"]["blocking"])
    gate = assert_full_run_allowed(spec, args.canary_gate) if approvals else None
    if gate:
        write_json(run_dir / "canary-gate.json", gate)
    started = 0
    for index, case, card in cards:
        if card["operationDigest"] not in approvals:
            continue
        approval = {"operationDigest": card["operationDigest"], "environment": "dev", "status": "APPROVED",
                    "approver": args.approver, "scope": args.scope,
                    "recordedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        write_json(run_dir / "approvals" / f"{index}-{case['case']}.json", {**card, "approval": approval})
        result = aws(["stepfunctions", "start-execution", "--state-machine-arn", spec["stateMachineArn"],
                      "--name", card["executionName"], "--input", json.dumps(card["request"])],
                     profile=spec["profile"], region=spec["region"], environment="dev")
        write_json(run_dir / "approvals" / f"{index}-{case['case']}.started.json", result)
        print(f"STARTED {card['executionName']}")
        started += 1
    print(f"started {started} execution(s)")
    return 0


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


def rejection_ok(describe: dict, states: list[str], error: str | None, missing: str | None) -> bool:
    if describe["status"] != "FAILED" or "RunTransformJob" in states:
        return False
    return missing is None or (error is not None and missing in error)


def cmd_capture(args) -> int:
    run_dir = Path(args.run_dir)
    spec = load_spec(str(run_dir / "run-spec.json"))
    profile, region = spec["profile"], spec["region"]
    arn_prefix = spec["stateMachineArn"].replace(":stateMachine:", ":execution:")
    bucket, _ = parse_s3(spec["outputRoot"])
    formats = spec.get("outputFormats", {})
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
        ok = describe["status"] == "SUCCEEDED" if expected == "PASS" else rejection_ok(describe, states, error, case.get("missingInput"))
        entry = {"step": f"{index}-{case['case']}", "executionArn": describe["executionArn"], "status": describe["status"],
                 "expected": expected, "verdict": "PASS" if ok else "FAIL", "states": states, "error": error,
                 "start": describe.get("startDate"), "stop": describe.get("stopDate")}
        if case.get("missingInput"):
            entry["missingInput"] = case["missingInput"]
        if plan:
            entry["planMapping"] = {k: plan["mapping"]["rule"].get(k) for k in ("sha256", "versionId")} | {"id": plan["mapping"]["id"], "version": plan["mapping"]["version"]}
            entry["executedSql"] = [{"dataset": q["dataset"], "sha256": q.get("querySha256"), "versionId": q.get("queryVersionId")} for q in plan.get("queries", [])]
            pin = spec["mappings"][case["mapping"]]
            entry["mappingPinMatches"] = entry["planMapping"]["sha256"] == pin["sha256"] and entry["planMapping"]["versionId"] == pin.get("versionId", entry["planMapping"]["versionId"])
        prefix = f"{spec['outputRoot']}{spec['runId']}/{case['case']}/{name}/"
        if describe["status"] == "SUCCEEDED":
            out_dir = run_dir / "out" / case["case"]
            aws(["s3", "sync", prefix, str(out_dir), "--quiet"], profile=profile, region=region, environment="prod", output_json=False)
            meta = read_json(out_dir / "_metadata.json") if (out_dir / "_metadata.json").exists() else {}
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


def cmd_regress(args) -> int:
    """Case-by-case comparison with a baseline run: same mapping, input URIs, outputs and expectation."""
    runs = {}
    for label, directory in (("current", Path(args.run_dir)), ("baseline", Path(args.baseline))):
        spec = read_json(directory / "run-spec.json")
        steps = {s["step"]: s for s in read_json(directory / "steps.json")}
        runs[label] = {case_signature(c): steps.get(f"{i}-{c['case']}") for i, c in enumerate(spec["cases"], 1)}
    report = {"identical": [], "changed": [], "newCases": [], "baselineOnly": []}
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
    report["pass"] = not report["changed"]
    write_json(Path(args.run_dir) / "regression.json", report)
    print(json.dumps({"identical": len(report["identical"]), "changed": len(report["changed"]),
                      "newCases": len(report["newCases"]), "baselineOnly": len(report["baselineOnly"]), "pass": report["pass"]}))
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
        for dataset in selected:
            name = first_binding.get(dataset)
            if name is None:
                continue
            for missing in outputs[dataset]:
                cases.append({"case": f"neg-{dataset.replace('_', '-')}-without-{missing}", "mapping": key, "expected": "REJECTED",
                              "missingInput": missing, "binding": name,
                              "request": req([dataset], [t for t in outputs[dataset] if t != missing], bindings[name])})
    return cases, skipped


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
    outputs_filter = args.outputs or ([d for s in slices for d in s["outputDatasets"]] or None)
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
                           "blocking": "DeploymentDrift: the environment does not serve the pinned mapping; do not start" if drift else None},
            "skipped": skipped, "cases": cases}
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
    p.add_argument("--outputs", action="append", help="restrict to these output datasets (default: all registered outputs)")
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
    p = sub.add_parser("canary-gate")
    p.add_argument("--canary-run-dir", required=True, help="the captured canary run directory")
    p.add_argument("--comparison", action="append", required=True, help="prod_actuals.py compare result for the canary (per slice)")
    p.add_argument("--owner-decisions", help="the resolver's ownerDecisions JSON (preApproveFullRunOnCanaryPass)")
    p.add_argument("--out", required=True)
    p = sub.add_parser("approve-full")
    p.add_argument("--gate", required=True)
    p.add_argument("--approver", required=True)
    p.add_argument("--scope", required=True, help="the user's approval of the full-window run, in their words")
    p = sub.add_parser("capture")
    p.add_argument("--run-dir", required=True)
    p = sub.add_parser("regress")
    p.add_argument("--run-dir", required=True)
    p.add_argument("--baseline", required=True, help="an earlier run directory (run-spec.json + steps.json)")
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
