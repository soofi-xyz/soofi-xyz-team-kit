#!/usr/bin/env python3
"""Chained (multi-step) validations: plan, DEV Persist load and export, chain canary gate, per-step evidence and cost.

A chain (reference/chains.json, selected by resolve-transform-intent.py as intent.chain) is an ordered list of steps:
source-events (source_events.py: PROD events read-only, staged to DEV), transform (transform_runs.py, one run directory
per step and stage, its own mapping pin and deployment digest checks), persist-load (this tool: DEV
PersistNeptuneCsvWorkflow on the previous transform's output), persist-export (this tool: a bounded read-only DEV Persist
Gremlin read of exactly this run's ids, written as the next mapping's graph inputs plus hydrated bodies) and compare
(compare_datasets.py source-baseline). The whole chain runs a canary first, then (after the chain gate) the full window.

  chain_runs.py plan --intent intent.json [--chains chains.json] --day YYYY-MM-DD --dev-bucket NAME [--run-id ID] --out plan.json
      The run's prefixes per stage and step and the ordered commands; read-only.
  chain_runs.py persist-card --plan plan.json --stage canary|full --forward-run-dir RUN --profile <dev-profile>
      [--cost-ceiling 5] [--owner-cost-ceiling N] --run-dir DIR
      One operation card for the DEV PersistNeptuneCsvWorkflow start on the forward step's committed output (account,
      state machine and request checked to be DEV), with its operation digest; stops APPROVAL_REQUIRED.
  chain_runs.py persist-load --run-dir DIR (--approve sha256:... | --owner-decisions decisions.json) --approver A --scope S
      [--canary-gate gate.json] [--wait] [--poll-seconds 60] [--max-wait-minutes 240]
      Starts exactly the carded execution. Only an operation-specific approval or the owner's devPersistWrites decision
      approves it; blanketDevWrites never does. A full-stage load needs the approved chain canary gate. With --wait,
      polls describe-execution and records sanitized evidence (status, rehash job, index catch-up, cost, residue).
  chain_runs.py persist-export --plan plan.json --stage canary|full --load-evidence persist-load.json
      --contracts projection-contracts.json --forward-output-dir DIR --forward-metadata _metadata.json --profile <dev-profile>
      [--batch-size 50] [--max-elements 2000000] --private-dir DIR --package-dir PKG --out export.json
      Roots the read at the key column of the forward output's key dataset (catalog keysOutput) and follows the catalog
      hops (never the whole DEV graph), writes one Parquet dataset per graph input of the projection mapping, hydrates
      bodies from the artifact edges (DEV S3, SHA-256 verified) and requires every exported dataset's rows to equal the
      forward step's metadata rowCount (ExportScopeMismatch otherwise) and zero dangling endpoints.
  chain_runs.py gate --plan plan.json --step STEP=EVIDENCE ... --owner-decisions decisions.json --out gate.json
      The chain canary gate over every step's canary evidence (source build summary, transform run directories,
      Persist load and export evidence, the source-baseline comparison): CANARY_FAILED, AWAITING_APPROVAL or
      PRE_APPROVED; approve with transform_runs.py approve-full. The gate is valid for every full-stage step.
  chain_runs.py summary --plan plan.json --step STAGE:STEP=EVIDENCE ... --out chain.json
      Per-step status, approvals, deployment checks and cost summed across steps (build_run_package.py --chain).

PROD Persist is never written: every Persist operation checks the profile's account against the chain's DEV account and
refuses the PROD account or a PROD-named state machine. Loaded DEV vertices and edges remain (no delete-by-id); the
evidence reports them as residue.
"""

from __future__ import annotations

import argparse
import csv
import glob
import hashlib
import io
import json
import time
from datetime import datetime, timedelta
from pathlib import Path

from graph_inputs import (GremlinSource, close_endpoints, collect, dataset_rows, hydrate, persist_query_fn, write_parquet)
from silvally_io import (DEFAULT_REGION, SilvallyError, account_id, aws, canonical_digest, load_layout, private_dir,
                         read_json, sha256_file, write_json)
from source_window import window_token
from transform_runs import gate_digest

DEFAULT_CHAINS = Path(__file__).resolve().parent.parent / "reference" / "chains.json"
DEV_PERSIST_WRITES = "dev-persist-loads-for-this-run"
APPROVED_GATES = {"APPROVED", "PRE_APPROVED"}


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def load_chain(path: str | Path | None, chain_id: str) -> dict:
    chains = read_json(path or DEFAULT_CHAINS).get("chains") or {}
    if chain_id not in chains:
        raise SilvallyError(f"chain {chain_id!r} is not in {path or DEFAULT_CHAINS}")
    return {"id": chain_id, **chains[chain_id]}


def step_of(chain: dict, kind: str, step_id: str | None = None) -> dict:
    found = [s for s in chain["steps"] if s["kind"] == kind and (step_id is None or s["id"] == step_id)]
    if len(found) != 1:
        raise SilvallyError(f"chain {chain['id']} declares {len(found)} {kind} steps{f' named {step_id}' if step_id else ''}")
    return found[0]


def assert_dev(chain: dict, profile: str, region: str, arn: str | None = None) -> str:
    """The profile, and the ARN when given, must be the chain's DEV account; PROD Persist and Transform are never written."""
    environments = chain.get("environments") or {}
    dev, prod = (environments.get("dev") or {}).get("account"), (environments.get("prod") or {}).get("account")
    account = account_id(profile, region)
    if account == prod:
        raise SilvallyError("PROD Persist is never written: the profile resolves to the PROD account")
    if dev and account != dev:
        raise SilvallyError(f"the profile's account is not the chain's DEV account ({dev})")
    if arn:
        parts = arn.split(":")
        name = parts[-1].lower()
        if len(parts) < 7 or parts[4] != account or name.startswith("prod") or name.endswith("-prod") or "-prod-" in name:
            raise SilvallyError("PROD Persist is never written: the state machine is not in the DEV account or is PROD-named")
    return account


def cmd_plan(args) -> int:
    intent = read_json(args.intent)
    resolved = intent.get("chain") or {}
    if intent.get("status") != "RESOLVED" or not resolved.get("id"):
        raise SilvallyError("the intent is not a RESOLVED chain request (resolve-transform-intent.py discover)")
    chain = load_chain(args.chains or resolved.get("catalog"), resolved["id"])
    run_id = args.run_id or time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    start = f"{args.day}T00:00:00Z"
    end = (datetime.fromisoformat(args.day) + timedelta(days=1)).strftime("%Y-%m-%dT00:00:00Z")
    token = window_token({"start": start, "endExclusive": end})
    pins = {s["id"]: s for s in resolved.get("steps", [])}
    stages = {}
    for stage in ("canary", "full"):
        base = f"s3://{args.dev_bucket}/inputs/silvally-{chain['id']}/{token}/{run_id}/{stage}/"
        entries = {}
        for step in chain["steps"]:
            entry = {"kind": step["kind"]}
            if step["kind"] in ("source-events", "persist-export"):
                entry["stagingPrefix"] = f"{base}{step['id']}/"
            if step["kind"] == "transform":
                entry.update({"mapping": (pins.get(step["id"]) or {}).get("mapping"),
                              "outputRoot": f"s3://{args.dev_bucket}/outputs/silvally-{chain['id']}/",
                              "runId": f"{run_id}-{stage}-{step['id']}",
                              "bind": f"{step['input']['step']}=<{step['input']['step']} stagingPrefix or output>",
                              "outputDatasets": step.get("outputDatasets")})
            entries[step["id"]] = entry
        stages[stage] = entries
    plan = {"kind": "chain-plan", "chain": chain["id"], "slice": chain["slice"], "runId": run_id, "day": args.day,
            "window": {"start": start, "endExclusive": end, "completeUtcDays": 1}, "windowToken": token,
            "environments": chain.get("environments"), "persistPolicy": chain.get("persistPolicy"),
            "steps": [{"id": s["id"], "kind": s["kind"], "mapping": (pins.get(s["id"]) or {}).get("mapping"),
                       "versionSelection": (pins.get(s["id"]) or {}).get("versionSelection")} for s in chain["steps"]],
            "stages": stages, "ownerDecisions": intent.get("ownerDecisions") or {},
            "order": [f"{stage}:{s['id']}" for stage in ("canary", "full") for s in chain["steps"]],
            "gate": "chain_runs.py gate after every canary step; the full stage starts only with an APPROVED or PRE_APPROVED gate"}
    plan["planDigest"] = canonical_digest(plan)
    write_json(args.out, plan)
    print(json.dumps({"out": args.out, "chain": chain["id"], "runId": run_id, "steps": [s["id"] for s in chain["steps"]],
                      "windowToken": token}, indent=1))
    return 0


def forward_output(run_dir: Path) -> tuple[str, dict]:
    steps = read_json(run_dir / "steps.json") if (run_dir / "steps.json").exists() else []
    passing = [s for s in steps if s.get("expected", "PASS") == "PASS" and s.get("verdict") == "PASS" and s.get("outputPrefix")]
    if len(passing) != 1:
        raise SilvallyError(f"the forward run {run_dir} needs exactly one captured passing execution (found {len(passing)})")
    return passing[0]["outputPrefix"], passing[0]


def persist_card(plan: dict, chain: dict, stage: str, s3_uri: str, arn: str, ceiling: float, residue: dict,
                 profile: str, region: str) -> dict:
    load = step_of(chain, "persist-load")
    request = {**load["workflow"]["request"], "s3_uri": s3_uri.rstrip("/"), "costCeilingUsd": ceiling}
    name = f"silvally-{plan['runId']}-{stage}-{load['id']}"[:80]
    card = {"operation": "states:StartExecution", "environment": "dev", "kind": "persist-load", "chain": chain["id"],
            "slice": chain["slice"], "stage": stage, "step": load["id"], "stateMachineArn": arn, "executionName": name,
            "profile": profile, "region": region, "request": request, "reads": [request["s3_uri"] + "/"],
            "writes": ["shared DEV Neptune graph: the forward output's vertices and edges (merged by content hash)",
                       "Persist bulk-load bucket workflow-rehash/<execution>/ and workflow-summaries/<execution>/"],
            "expectedElements": residue, "costCeilingUsd": ceiling,
            "containment": (load.get("isolation") or {}).get("identity", ""),
            "residue": (load.get("isolation") or {}).get("residue", ""), "prod": "refused"}
    card["operationDigest"] = card_digest(card)
    return card


def cmd_persist_card(args) -> int:
    plan = read_json(args.plan)
    chain = load_chain(args.chains, plan["chain"])
    if args.owner_cost_ceiling is not None and args.cost_ceiling > args.owner_cost_ceiling:
        raise SilvallyError(f"CostCeilingExceeded: {args.cost_ceiling} USD is above the owner's {args.owner_cost_ceiling} USD per job")
    load = step_of(chain, "persist-load")
    prefix, step = forward_output(Path(args.forward_run_dir))
    machines = aws(["stepfunctions", "list-state-machines"], profile=args.profile, region=args.region, environment="prod")
    found = [m["stateMachineArn"] for m in machines.get("stateMachines", [])
             if m["name"].startswith(load["workflow"]["stateMachineNamePrefix"])]
    if len(found) != 1:
        raise SilvallyError(f"expected one DEV state machine named {load['workflow']['stateMachineNamePrefix']}*, found {len(found)}")
    assert_dev(chain, args.profile, args.region, found[0])
    residue = {o["dataset"]: o.get("metadataRows") for o in step.get("outputs", [])}
    card = persist_card(plan, chain, args.stage, prefix, found[0], args.cost_ceiling, residue, args.profile, args.region)
    run_dir = Path(args.run_dir)
    write_json(run_dir / "cards" / f"{args.stage}-{load['id']}.json", {**card, "status": "APPROVAL_REQUIRED"})
    print(f"APPROVAL_REQUIRED {args.stage}-{load['id']} {card['operationDigest']}")
    return 0


def card_digest(card: dict) -> str:
    return canonical_digest({k: v for k, v in card.items() if k not in ("operationDigest", "status")})


def cmd_persist_load(args) -> int:
    run_dir = Path(args.run_dir)
    cards = sorted((run_dir / "cards").glob("*-persist-load.json")) or sorted((run_dir / "cards").glob("*.json"))
    if len(cards) != 1:
        raise SilvallyError(f"{run_dir}/cards must hold exactly one Persist load card (found {len(cards)})")
    card = read_json(cards[0])
    if card_digest(card) != card["operationDigest"]:
        raise SilvallyError("the Persist load card changed since it was presented; re-run persist-card")
    decisions = read_json(args.owner_decisions) if args.owner_decisions else {}
    owner = decisions.get("devPersistWrites") == DEV_PERSIST_WRITES
    if args.approve is None and not owner:
        reason = (" (blanketDevWrites covers staging and Transform executions, never a Persist write)"
                  if decisions.get("blanketDevWrites") else "")
        raise SilvallyError("DevPersistWriteApprovalRequired: pass --approve with this card's digest, or the owner's "
                            "devPersistWrites decision" + reason)
    if args.approve is not None and args.approve != card["operationDigest"]:
        raise SilvallyError("the approval digest does not match the Persist load card")
    if card["stage"] == "full":
        if not args.canary_gate:
            raise SilvallyError("CanaryRequired: a full-stage Persist load needs the approved chain canary gate (--canary-gate)")
        gate = read_json(args.canary_gate)
        if gate.get("status") not in APPROVED_GATES or gate.get("gateDigest") != gate_digest(gate):
            raise SilvallyError(f"CanaryGateNotApproved: chain gate status {gate.get('status')}; never proceed to the full run")
    chain = load_chain(args.chains, card["chain"])
    assert_dev(chain, card["profile"], card["region"], card["stateMachineArn"])
    approval = {"operationDigest": card["operationDigest"], "environment": "dev", "status": "APPROVED",
                "kind": "operation" if args.approve else "owner-dev-persist-writes", "approver": args.approver,
                "scope": args.scope, "recordedAt": now()}
    write_json(run_dir / "approvals" / f"{card['stage']}-{card['step']}.json", {**card, "approval": approval})
    started = aws(["stepfunctions", "start-execution", "--state-machine-arn", card["stateMachineArn"], "--name", card["executionName"],
                   "--input", json.dumps(card["request"])], profile=card["profile"], region=card["region"], environment="dev")
    write_json(run_dir / "approvals" / f"{card['stage']}-{card['step']}.started.json", started)
    print(f"STARTED {card['executionName']}")
    if not args.wait:
        return 0
    deadline = time.time() + args.max_wait_minutes * 60
    while True:
        describe = aws(["stepfunctions", "describe-execution", "--execution-arn", started["executionArn"]],
                       profile=card["profile"], region=card["region"], environment="prod")
        if describe["status"] != "RUNNING" or time.time() > deadline:
            break
        time.sleep(args.poll_seconds)
    evidence = load_evidence(card, approval, describe)
    write_json(run_dir / f"persist-load-{card['stage']}.json", evidence)
    print(json.dumps(evidence, indent=1))
    return 0 if evidence["status"] == "PASS" else 1


def load_evidence(card: dict, approval: dict, describe: dict) -> dict:
    output = json.loads(describe.get("output") or "{}")
    rehash = output.get("rehashResult") or {}
    catchup = output.get("indexCatchupStatus") or {}
    rate = load_layout()["transformRuntime"]["glueUsdPerDpuHour"]
    dpu_seconds = rehash.get("DPUSeconds")
    status = {"SUCCEEDED": "PASS", "RUNNING": "BLOCKED"}.get(describe["status"], "FAIL")
    if status == "PASS" and card["request"].get("waitForIndexCatchup") and not catchup.get("caughtUp"):
        status = "FAIL"
    return {"kind": "chain-step", "step": card["step"], "stepKind": "persist-load", "chain": card["chain"], "slice": card["slice"],
            "stage": card["stage"], "status": status, "executionArn": describe.get("executionArn"),
            "executionStatus": describe["status"], "approval": {k: approval[k] for k in ("operationDigest", "kind", "status", "recordedAt")},
            "request": card["request"], "rehash": {"jobRunState": rehash.get("JobRunState"), "dpuSeconds": dpu_seconds},
            "indexCatchup": {"caughtUp": catchup.get("caughtUp"), "targetWatermark": catchup.get("targetWatermark"),
                             "checkpoint": catchup.get("checkpoint")},
            "costEstimate": (output.get("costEstimate") or {}).get("estimatedCostUsd"),
            "cost": {"actualUsd": round(dpu_seconds / 3600 * rate, 3) if dpu_seconds is not None else None,
                     "ceilingUsd": card["costCeilingUsd"], "basis": "Persist rehash Glue DPU-seconds x Transform layout rate"},
            "residue": {"datasets": card.get("expectedElements"), "detail": card.get("residue")},
            "startedAt": describe.get("startDate"), "stoppedAt": describe.get("stopDate")}


def forward_keys(directory: Path, label: str, column: str) -> list[str]:
    """Key values of one label in a forward graph output (Neptune CSV groups holding several labels)."""
    keys = set()
    for path in sorted(glob.glob(str(directory / "**" / "*.csv"), recursive=True)):
        reader = csv.DictReader(io.StringIO(Path(path).read_text(encoding="utf-8")))
        for row in reader:
            if row.get("~label") == label and (row.get(column) or "").strip():
                keys.add(row[column].strip())
    return sorted(keys)


def dev_fetcher(profile: str, region: str, work: Path):
    def fetch(uri: str) -> bytes:
        if not uri.startswith("s3://"):
            raise SilvallyError("ArtifactNotS3")
        target = private_dir(work) / hashlib.sha256(uri.encode()).hexdigest()
        aws(["s3", "cp", uri, str(target), "--quiet"], profile=profile, region=region, environment="prod", output_json=False)
        data = target.read_bytes()
        target.unlink()
        return data
    return fetch


def cmd_persist_export(args, source=None, fetch=None) -> int:
    plan = read_json(args.plan)
    chain = load_chain(args.chains, plan["chain"])
    export = step_of(chain, "persist-export")
    forward = next(s for s in chain["steps"] if s["id"] == export["keysFrom"]["step"])
    loaded = read_json(args.load_evidence)
    if loaded.get("stepKind") != "persist-load" or loaded.get("stage") != args.stage or loaded.get("status") != "PASS":
        raise SilvallyError("persist-export needs this stage's passing persist-load evidence (the export reads what this run loaded)")
    if source is None:
        assert_dev(chain, args.profile, args.region)
        source = GremlinSource(persist_query_fn(args.profile, args.region, args.timeout_seconds), args.batch_size,
                               args.retries, args.backoff_seconds)
        fetch = dev_fetcher(args.profile, args.region, Path(args.private_dir) / "artifacts")
    spec = forward["keysOutput"]
    keys = forward_keys(Path(args.forward_output_dir), spec["label"], spec["column"])
    if not keys:
        raise SilvallyError(f"the forward output holds no {spec['label']} {spec['column']} values; nothing of this run to export")
    contracts = read_json(args.contracts)
    data, stats = collect(source, contracts, export["plan"], keys, (None, None), args.max_elements)
    dangling = close_endpoints(data, contracts)
    out = private_dir(args.package_dir)
    datasets = {}
    for contract in contracts["inputs"]:
        if contract.get("graphKind") not in ("vertex", "edge"):
            continue
        columns, rows = dataset_rows(contract, data.get(contract["table"], {}))
        write_parquet(out / contract["table"], columns, rows)
        datasets[contract["table"]] = {"rows": len(rows), "sha256": "sha256:" + sha256_file(out / contract["table"] / "part-00000.parquet")}
    failures = {}
    hydration = export.get("hydration")
    if hydration:
        rows, failures = hydrate(hydration, data.get(hydration["edge"], {}), fetch)
        target = out / hydration["dataset"]
        target.mkdir(parents=True, exist_ok=True)
        (target / "part-00000.jsonl").write_text("".join(json.dumps(r, sort_keys=True) + "\n" for r in rows), encoding="utf-8")
        datasets[hydration["dataset"]] = {"rows": len(rows), "sha256": "sha256:" + sha256_file(target / "part-00000.jsonl"),
                                          "hydrationFailures": failures}
    forward_counts = {d["dataset"]: int(d.get("rowCount") or 0) for d in read_json(args.forward_metadata).get("datasets", [])}
    scope = {name: {"exported": info["rows"], "forward": forward_counts[name]}
             for name, info in datasets.items() if name in forward_counts}
    mismatched = sorted(n for n, s in scope.items() if s["exported"] != s["forward"])
    status = "FAIL" if dangling or failures or mismatched else "PASS"
    evidence = {"kind": "chain-step", "step": export["id"], "stepKind": "persist-export", "chain": chain["id"], "slice": chain["slice"],
                "stage": args.stage, "status": status, "devAccess": "read-only", "rootKeys": len(keys), "rootsFound": stats["roots"],
                "hops": stats["hops"], "datasets": datasets, "danglingEndpointCount": dangling,
                "scopeCheck": {"byDataset": scope, "mismatched": mismatched,
                               "code": "ExportScopeMismatch" if mismatched else None},
                "paging": {**getattr(source, "stats", {}), "duplicatesMerged": stats["duplicatesMerged"]},
                "packageDir": str(out), "loadExecutionArn": loaded.get("executionArn"),
                "next": "stage_evidence_package.py manifest/upload --dir <package> --prefix <plan stagingPrefix>"}
    write_json(args.out, evidence)
    print(json.dumps(evidence, indent=1))
    return 0 if status == "PASS" else 1


def step_status(kind: str, path: str, stage: str) -> tuple[str, str, dict]:
    """(status, detail, cost) of one step's evidence for a stage."""
    target = Path(path)
    if kind == "transform":
        steps = read_json(target / "steps.json") if (target / "steps.json").exists() else []
        spec = read_json(target / "run-spec.json") if (target / "run-spec.json").exists() else {}
        cost = read_json(target / "cost.json") if (target / "cost.json").exists() else {}
        approved = all((target / "approvals" / f"{s['step']}.json").exists() for s in steps)
        if spec.get("stage") != stage:
            return "FAIL", f"run {target.name} is a {spec.get('stage')}-stage run, not {stage}", cost
        ok = steps and approved and all(s.get("verdict") == "PASS" and s.get("status") != "RUNNING" for s in steps)
        return ("PASS" if ok else ("BLOCKED" if not steps else "FAIL"),
                f"{len(steps)} executions, approvals {'recorded' if approved else 'missing'}", cost)
    record = read_json(target)
    if record.get("stage") not in (None, stage):
        return "FAIL", f"evidence of stage {record.get('stage')}, not {stage}", {}
    if kind == "source-events":
        built = record.get("status") == "BUILT"
        return ("PASS" if built else "BLOCKED"), f"{record.get('accepted')} accepted, quarantine {record.get('quarantine')}", {}
    if kind == "compare":
        return record.get("status", "FAIL"), f"{[(c['id'], c['status']) for c in record.get('checks', [])]}", {}
    return record.get("status", "FAIL"), record.get("executionStatus") or record.get("scopeCheck", {}).get("code") or "", record.get("cost") or {}


def cmd_gate(args) -> int:
    plan = read_json(args.plan)
    chain = load_chain(args.chains, plan["chain"])
    evidence = dict(s.split("=", 1) for s in args.step)
    decisions = read_json(args.owner_decisions) if args.owner_decisions else {}
    failures, steps = [], []
    for step in chain["steps"]:
        if step["id"] not in evidence:
            failures.append(f"{step['id']}: no canary evidence")
            continue
        status, detail, _ = step_status(step["kind"], evidence[step["id"]], "canary")
        steps.append({"step": step["id"], "kind": step["kind"], "status": status, "detail": detail, "evidence": evidence[step["id"]]})
        if status != "PASS":
            failures.append(f"{step['id']} {status}: {detail}")
    gate = {"kind": "canary-gate", "chain": chain["id"], "canaryRunId": plan["runId"], "stage": "canary", "slice": chain["slice"],
            "executions": steps, "comparisons": [], "productChangeFlags": [], "failures": failures}
    if failures:
        gate["status"] = "CANARY_FAILED"
    elif decisions.get("preApproveFullRunOnCanaryPass"):
        gate["status"] = "PRE_APPROVED"
        gate["approval"] = {"kind": "owner-pre-approval", "recordedAt": now()}
    else:
        gate["status"] = "AWAITING_APPROVAL"
    gate["gateDigest"] = gate_digest(gate)
    write_json(args.out, gate)
    print(json.dumps(gate, indent=1))
    return 0 if gate["status"] != "CANARY_FAILED" else 1


def cmd_summary(args) -> int:
    plan = read_json(args.plan)
    chain = load_chain(args.chains, plan["chain"])
    kinds = {s["id"]: s["kind"] for s in chain["steps"]}
    entries, total, known = [], 0.0, True
    for value in args.step:
        stage_step, _, path = value.partition("=")
        stage, _, step = stage_step.partition(":")
        if step not in kinds:
            raise SilvallyError(f"{step} is not a step of chain {chain['id']}")
        status, detail, cost = step_status(kinds[step], path, stage)
        read_only = kinds[step] in ("source-events", "persist-export", "compare")
        actual = cost.get("actualUsd") if cost else (0.0 if read_only else None)
        known = known and actual is not None
        total += actual or 0.0
        entries.append({"stage": stage, "step": step, "kind": kinds[step], "status": status, "detail": detail,
                        "actualUsd": actual, "evidence": path})
    missing = [f"{stage}:{s['id']}" for stage in ("canary", "full") for s in chain["steps"]
               if not any(e["stage"] == stage and e["step"] == s["id"] for e in entries)]
    summary = {"kind": "chain-summary", "chain": chain["id"], "slice": chain["slice"], "runId": plan["runId"], "day": plan["day"],
               "steps": entries, "missingSteps": missing,
               "status": "FAIL" if any(e["status"] == "FAIL" for e in entries) else ("PASS" if not missing and all(
                   e["status"] == "PASS" for e in entries) else "BLOCKED"),
               "cost": {"actualUsd": round(total, 3) if known else None, "byStep": [
                   {"runId": f"{e['step']}-{e['stage']}", "stage": e["stage"], "actualUsd": e["actualUsd"]} for e in entries]},
               "residue": [read_json(e["evidence"]).get("residue") for e in entries if e["kind"] == "persist-load"]}
    write_json(args.out, summary)
    print(json.dumps({k: summary[k] for k in ("chain", "status", "missingSteps", "cost")}, indent=1))
    return 0 if summary["status"] == "PASS" else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--chains", help="chain catalog (default reference/chains.json)")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("plan")
    p.add_argument("--intent", required=True)
    p.add_argument("--day", required=True)
    p.add_argument("--dev-bucket", required=True, help="the DEV Transform data bucket (staging and outputs)")
    p.add_argument("--run-id")
    p.add_argument("--out", required=True)
    p = sub.add_parser("persist-card")
    p.add_argument("--plan", required=True)
    p.add_argument("--stage", choices=("canary", "full"), required=True)
    p.add_argument("--forward-run-dir", required=True, help="the captured forward transform run directory of this stage")
    p.add_argument("--profile", required=True, help="operator's DEV profile")
    p.add_argument("--region", default=DEFAULT_REGION)
    p.add_argument("--cost-ceiling", type=float, default=5)
    p.add_argument("--owner-cost-ceiling", type=float)
    p.add_argument("--run-dir", required=True)
    p = sub.add_parser("persist-load")
    p.add_argument("--run-dir", required=True)
    p.add_argument("--approve")
    p.add_argument("--owner-decisions", help="ownerDecisions JSON; devPersistWrites approves this run's Persist loads")
    p.add_argument("--approver", required=True)
    p.add_argument("--scope", required=True)
    p.add_argument("--canary-gate")
    p.add_argument("--wait", action="store_true")
    p.add_argument("--poll-seconds", type=float, default=60)
    p.add_argument("--max-wait-minutes", type=float, default=240)
    p = sub.add_parser("persist-export")
    p.add_argument("--plan", required=True)
    p.add_argument("--stage", choices=("canary", "full"), required=True)
    p.add_argument("--load-evidence", required=True)
    p.add_argument("--contracts", required=True, help="resolve-transform-intent.py contracts of the projection mapping")
    p.add_argument("--forward-output-dir", required=True, help="the forward step's captured privateOutputDir")
    p.add_argument("--forward-metadata", required=True, help="the forward step's captured _metadata.json")
    p.add_argument("--profile", required=True, help="operator's DEV profile")
    p.add_argument("--region", default=DEFAULT_REGION)
    p.add_argument("--batch-size", type=int, default=50)
    p.add_argument("--retries", type=int, default=4)
    p.add_argument("--backoff-seconds", type=float, default=2.0)
    p.add_argument("--timeout-seconds", type=float, default=60.0)
    p.add_argument("--max-elements", type=int, default=2000000)
    p.add_argument("--private-dir", required=True)
    p.add_argument("--package-dir", required=True)
    p.add_argument("--out", required=True)
    p = sub.add_parser("gate")
    p.add_argument("--plan", required=True)
    p.add_argument("--step", action="append", required=True, help="STEP=EVIDENCE (a run directory for transform steps)")
    p.add_argument("--owner-decisions")
    p.add_argument("--out", required=True)
    p = sub.add_parser("summary")
    p.add_argument("--plan", required=True)
    p.add_argument("--step", action="append", required=True, help="STAGE:STEP=EVIDENCE (repeatable)")
    p.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    handlers = {"plan": cmd_plan, "persist-card": cmd_persist_card, "persist-load": cmd_persist_load,
                "persist-export": cmd_persist_export, "gate": cmd_gate, "summary": cmd_summary}
    return handlers[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
