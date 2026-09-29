#!/usr/bin/env python3
"""Approval-gated DEV Transform executions and sanitized evidence capture.

A run spec (JSON) lists the cases to execute:

  {
    "runId": "20260929T140056Z",                 # optional; default is now (UTC)
    "stateMachineArn": "arn:aws:states:...:stateMachine:TransformPipelineStack-transform-pipeline",
    "outputRoot": "s3://<transform-data-bucket>/outputs/silvally-<profile-id>/",
    "profile": "<dev-profile>", "region": "us-east-2", "costCeilingUsd": 5,
    "mappings": {"lexicon-to-interprose@4.0.0": {"sha256": "...", "versionId": "..."}},
    "cases": [{"case": "v2-full", "mapping": "lexicon-to-interprose@4.0.0", "expected": "PASS",
               "request": {"contractVersion": 2, "from": "lexicon", "to": "interprose", "mappingVersion": "4.0.0",
                           "outputDatasets": ["form_1281"], "inputs": [{"table": "...", "s3Uri": "s3://.../"}]}}]
  }

Commands (all write evidence only under --run-dir):

  cards    write one operation card per case with its operation digest and stop (APPROVAL_REQUIRED)
  start    start exactly the cases whose --approve digests match their cards (records the approval first)
  capture  read-only: describe-execution, history, plan.json, output files; reconcile metadata with physical rows
  cost     read-only: Glue DPU-hours of this run's job runs and the USD estimate

`expected` is PASS (execution must succeed) or REJECTED (ResolvePlan must reject before Glue starts).
"""

from __future__ import annotations

import argparse
import copy
import glob
import hashlib
import json
import time
from pathlib import Path

from silvally_io import DEFAULT_REGION, SilvallyError, aws, canonical_digest, parse_s3, read_json, write_json

GLUE_USD_PER_DPU_HOUR = 0.44


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
    return spec


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
        "costCeilingUsd": request["costCeilingUsd"], "expected": case.get("expected", "PASS"),
        "containment": "new unique execution name and output prefix; nothing overwritten; no deletes; Persist not invoked",
    }
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


def cmd_start(args) -> int:
    run_dir = Path(args.run_dir)
    spec = load_spec(str(run_dir / "run-spec.json"))
    approvals = set(args.approve or [])
    started = 0
    for index, case in enumerate(spec["cases"], 1):
        card = card_for(spec, index, case)
        stored = read_json(run_dir / "cards" / f"{index}-{case['case']}.json")
        if stored["operationDigest"] != card["operationDigest"]:
            raise SilvallyError(f"{index}-{case['case']}: card changed since it was presented; re-run cards")
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
    unmatched = approvals - {card_for(spec, i, c)["operationDigest"] for i, c in enumerate(spec["cases"], 1)}
    if unmatched:
        raise SilvallyError(f"approval digests match no card: {sorted(unmatched)}")
    print(f"started {started} execution(s)")
    return 0


def _csv_rows(files: list[str]) -> tuple[set[str], list[str]]:
    headers, rows = set(), []
    for f in files:
        lines = Path(f).read_text(encoding="utf-8").split("\n")
        headers.add(lines[0])
        rows += [line for line in lines[1:] if line]
    return headers, rows


def cmd_capture(args) -> int:
    run_dir = Path(args.run_dir)
    spec = load_spec(str(run_dir / "run-spec.json"))
    profile, region = spec["profile"], spec["region"]
    arn_prefix = spec["stateMachineArn"].replace(":stateMachine:", ":execution:")
    bucket, _ = parse_s3(spec["outputRoot"])
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
        plan_uri = f"s3://{bucket}/runs/{name}/plan.json"
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
        ok = describe["status"] == "SUCCEEDED" if expected == "PASS" else (describe["status"] == "FAILED" and "RunTransformJob" not in states)
        entry = {"step": f"{index}-{case['case']}", "executionArn": describe["executionArn"], "status": describe["status"],
                 "expected": expected, "verdict": "PASS" if ok else "FAIL", "states": states, "error": error,
                 "start": describe.get("startDate"), "stop": describe.get("stopDate")}
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
                files = sorted(glob.glob(str(out_dir / "tables" / dataset["dataset"] / "part-*.csv")))
                if not files:
                    outputs.append({"dataset": dataset["dataset"], "metadataRows": dataset.get("rowCount")})
                    continue
                headers, rows = _csv_rows(files)
                outputs.append({"dataset": dataset["dataset"], "metadataRows": dataset.get("rowCount"), "physicalRows": len(rows),
                                "files": len(files), "headers": sorted(headers),
                                "reconciled": dataset.get("rowCount") == len(rows) and dataset.get("fileCount", len(files)) == len(files),
                                "contentSha256": hashlib.sha256("\n".join(sorted(rows)).encode()).hexdigest()})
            entry["outputPrefix"] = prefix
            entry["outputs"] = outputs
        summary.append(entry)
    write_json(run_dir / "steps.json", summary)
    for s in summary:
        print(s["step"], s["status"], s.get("verdict", ""), (s.get("error") or "")[:100],
              [(o["dataset"], o.get("physicalRows", o.get("metadataRows")), o.get("reconciled")) for o in s.get("outputs", [])])
    return 0


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
    cost = {"glueRuns": len(mine), "dpuHours": round(dpu_hours, 3), "usdPerDpuHour": GLUE_USD_PER_DPU_HOUR,
            "actualUsd": round(dpu_hours * GLUE_USD_PER_DPU_HOUR, 3), "ceilingUsd": spec["costCeilingUsd"] * max(1, len(spec["cases"]))}
    write_json(run_dir / "cost.json", cost)
    print(json.dumps(cost))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("cards")
    p.add_argument("--spec", required=True)
    p.add_argument("--run-dir", required=True)
    p = sub.add_parser("start")
    p.add_argument("--run-dir", required=True)
    p.add_argument("--approve", action="append", help="operation digest the approver accepted (repeatable)")
    p.add_argument("--approver", required=True)
    p.add_argument("--scope", required=True, help="the approval scope in the approver's words")
    p = sub.add_parser("capture")
    p.add_argument("--run-dir", required=True)
    p = sub.add_parser("cost")
    p.add_argument("--run-dir", required=True)
    p.add_argument("--job-name", required=True, help="Transform Glue job name (see the Transform stack outputs)")
    p.add_argument("--max-runs", type=int, default=2000)
    args = parser.parse_args(argv)
    return {"cards": cmd_cards, "start": cmd_start, "capture": cmd_capture, "cost": cmd_cost}[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
