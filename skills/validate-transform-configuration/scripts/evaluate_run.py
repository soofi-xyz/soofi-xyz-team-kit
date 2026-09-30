#!/usr/bin/env python3
"""Derive the 12 phase statuses and the readiness verdict from tool evidence (no mapping knowledge).

  evaluate_run.py --intent intent.json [--workspace WS] [--profile P.json] [--profile-check pc.json]
      [--contracts contracts.json] [--answer QUESTION_ID=CHOICE ...] [--attest PHASE=EVIDENCE_ID ...]
      [--owner-decisions decisions.json] [--product-change ID ...]
      [--source-window confirmed.json] [--slice-days days.json] [--prod-actuals summary.json ...]
      [--canary-run-dir RUN] [--canary-sample summary.json ...] [--canary-comparison checks.json ...]
      [--canary-gate gate.json] [--run-dir RUN] [--checks checks.json ...] [--actuals-comparison checks.json ...]
      [--closure closure.json ...] [--regression regression.json] [--staging-upload upload.json ...]
      [--mode observed-dev|bounded-dev-dry-run] --out phases.json

Every input is real data from a PROD-derived UTC window; there is no local or synthetic mode. Each phase is
PASS, FAIL, BLOCKED or APPROVAL_REQUIRED from the evidence supplied:

  1  intake       resolver RESOLVED with one profile; the window is user-confirmed (source_window.py confirm) or
                  chosen by the owner decision "most recent full UTC day with real data per slice"; no slice is
                  empty on it (source_window.py data-days suggests the nearest day with data)
  2  discovery    every fetched repository pinned by commit with required paths verified
  3  safety       explicit operator profile, DEV-only writes, each DEV staging upload under its own approval
                  digest, and no job above the owner's per-job cost ceiling
  4  evidence     every canary and full binding lies under the confirmed window's staging prefix (or the run's
                  own output root)
  5  model        concept, forbidden-content and Lexicon-model findings of the resolver
  6  mapping      profile drift, SQL scan, endpoint/required-input findings, check-profile result, and every
                  PRODUCT_CHANGE item: BLOCKED unless the owner accepted it as out of scope (then recorded)
  7  actuals      one PROD-actuals baseline per slice: AVAILABLE, or NONE (schema, row-count and reject-reason
                  fallback, stated in the report); EMPTY or STALE baselines are BLOCKED
  8  provenance   every plan's mapping digest matches the pin and the environment serves it
  9  canary       the DEV canary (at most 10 real events per slice, deterministic sample) executed under approval
                  and its comparison against PROD actuals passed
  10 full run     the canary gate was approved by the user (or pre-approved by the owner for a passing canary)
                  and every full-window DEV execution ran under its own approval; a failed canary never reaches
                  the full run
  11 comparison   the full-window outputs match PROD actuals (or pass the declared fallback), contract checks,
                  graph closure and regression
  12 verdict      PASS only when phases 1-11 pass on the confirmed real window

READY requires phase 12 PASS. Findings attached to mappings outside the run are informational. An operator answer to
a resolver question resolves the finding that asked it.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from silvally_io import read_json, write_json
from source_window import slice_window, validate_confirmed, window_token

PHASE_NAMES = {
    1: "Intake, terminology and real-data window", 2: "Repository and environment discovery", 3: "Safety and access preflight",
    4: "Evidence registry", 5: "Language and dataset model", 6: "Configuration/product boundary and directional mapping",
    7: "PROD actuals baseline", 8: "Release and deployment provenance", 9: "DEV canary on real events",
    10: "Canary gate and full-window DEV run", 11: "Comparison with PROD actuals", 12: "Report, handoff, and verdict",
}
FINDING_PHASE = {
    "RemovedLexiconConcept": (5, "FAIL"), "LexiconConceptInactive": (5, "FAIL"), "ForbiddenConceptInLexicon": (5, "FAIL"),
    "ForbiddenPropertyInLexicon": (5, "FAIL"), "LexiconModelDiffersFromMain": (5, "FAIL"), "LexiconModelUnchecked": (5, "BLOCKED"),
    "LanguageDefinitionMissing": (5, "BLOCKED"),
    "ProfileOutputInputDrift": (6, "FAIL"), "OutputFormatDrift": (6, "FAIL"), "ProfileOutputDatasetDrift": (6, "FAIL"),
    "ProfileRegistrationStatusDrift": (6, "FAIL"), "ForbiddenConceptInSql": (6, "FAIL"), "HubOutputNotGraph": (6, "FAIL"),
    "EndpointDatasetNotRequired": (6, "FAIL"), "RequiredInputUndeclared": (6, "FAIL"), "UpstreamSourceUnresolved": (6, "BLOCKED"),
    "SliceOutputsMissing": (6, "FAIL"),
    "RegistrySourceDrift": (8, "BLOCKED"),
}
RANK = {"PASS": 0, "APPROVAL_REQUIRED": 1, "BLOCKED": 1, "FAIL": 2}
CANARY_EVENTS_PER_SLICE = 10


class Phases:
    def __init__(self) -> None:
        self.status = {n: None for n in PHASE_NAMES}
        self.reasons = {n: [] for n in PHASE_NAMES}
        self.evidence = {n: [] for n in PHASE_NAMES}

    def set(self, phase: int, status: str, reason: str, evidence: str | None = None) -> None:
        current = self.status[phase]
        if current is None or RANK[status] > RANK[current] or (RANK[status] == RANK[current] and status == "BLOCKED"):
            self.status[phase] = status
        self.reasons[phase].append(f"{status}: {reason}")
        if evidence:
            self.evidence[phase].append(evidence)


def execution_approval(run_dir: str | None, step: str) -> str | None:
    path = Path(run_dir) / "approvals" / f"{step}.json" if run_dir else None
    approval = read_json(path).get("approval") or {} if path and path.exists() else {}
    return approval.get("operationDigest") if approval.get("status") == "APPROVED" else None


def run_parts(run_dir: str | None) -> tuple[dict | None, list[dict]]:
    if not run_dir:
        return None, []
    spec_path, steps_path = Path(run_dir) / "run-spec.json", Path(run_dir) / "steps.json"
    return (read_json(spec_path) if spec_path.exists() else None), (read_json(steps_path) if steps_path.exists() else [])


def evaluate_steps(phases: Phases, phase: int, label: str, run_dir: str | None, steps: list[dict]) -> list[str]:
    approvals = []
    if not steps:
        phases.set(phase, "BLOCKED", f"no captured {label} executions")
    for s in steps:
        status = "BLOCKED" if s["status"] == "RUNNING" else ("PASS" if s.get("verdict") == "PASS" else "FAIL")
        phases.set(phase, status, f"{label} {s['step']} {s['status']} (expected {s.get('expected')})", s.get("executionArn"))
        digest = execution_approval(run_dir, s["step"])
        if digest is None:
            phases.set(phase, "BLOCKED", f"{label} {s['step']} has no recorded operation-specific approval")
        else:
            approvals.append(digest)
    return approvals


def comparison_status(paths: list[str]) -> tuple[str, list[str], list[dict]]:
    reports = [read_json(p) for p in paths]
    failing = [f"{r.get('slice')}:{c['id']}" for r in reports for c in r.get("checks", []) if c["status"] != "PASS"]
    status = "FAIL" if any(c["status"] == "FAIL" for r in reports for c in r.get("checks", [])) else ("BLOCKED" if failing else "PASS")
    return status, failing, reports


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--intent", required=True)
    parser.add_argument("--workspace")
    parser.add_argument("--profile")
    parser.add_argument("--profile-check")
    parser.add_argument("--contracts")
    parser.add_argument("--answer", action="append", default=[], help="QUESTION_ID=CHOICE the operator confirmed for a resolver question")
    parser.add_argument("--attest", action="append", default=[], help="PHASE=EVIDENCE_ID for read-only evidence the tools cannot observe")
    parser.add_argument("--owner-decisions", help="ownerDecisions JSON given up front (default: the resolver's intent.ownerDecisions)")
    parser.add_argument("--product-change", action="append", default=[], help="ID of an unresolved PRODUCT_CHANGE boundary decision")
    parser.add_argument("--source-window", help="sourceWindowSelection JSON written by source_window.py confirm")
    parser.add_argument("--slice-days", help="source_window.py data-days result for the window (or the owner's per-slice choice)")
    parser.add_argument("--prod-actuals", action="append", default=[], help="prod_actuals.py baseline summary, one per slice")
    parser.add_argument("--canary-run-dir")
    parser.add_argument("--canary-sample", action="append", default=[], help="prod_actuals.py canary-sample summary, one per slice")
    parser.add_argument("--canary-comparison", action="append", default=[], help="prod_actuals.py compare result for the canary")
    parser.add_argument("--canary-gate", help="transform_runs.py canary-gate record")
    parser.add_argument("--run-dir", help="the full-window run directory")
    parser.add_argument("--checks", action="append", default=[], help="compare_datasets.py check result for the full run")
    parser.add_argument("--actuals-comparison", action="append", default=[], help="prod_actuals.py compare result for the full run")
    parser.add_argument("--closure", action="append", default=[])
    parser.add_argument("--regression")
    parser.add_argument("--staging-upload", action="append", default=[],
                        help="stage_evidence_package.py upload result for a canary or full-window DEV package")
    parser.add_argument("--mode", choices=("observed-dev", "bounded-dev-dry-run"), default="observed-dev")
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    intent = read_json(args.intent)
    profile = read_json(args.profile) if args.profile else None
    decisions = read_json(args.owner_decisions) if args.owner_decisions else dict(intent.get("ownerDecisions") or {})
    phases = Phases()
    run_keys = {s["mapping"] for s in intent.get("workflow", {}).get("steps", [])}
    slice_ids = [s["id"] for s in intent.get("slices") or []]
    informational = []

    if intent.get("status") == "RESOLVED" and (intent.get("selectedProfile") or profile):
        phases.set(1, "PASS", f"resolved {sorted(run_keys)}; profile {intent.get('selectedProfile') or profile.get('id')}", "intent-resolution")
        if (intent.get("versionSelection") or {}).get("notice"):
            phases.set(1, "PASS", intent["versionSelection"]["notice"], "version-selection")
    else:
        phases.set(1, "BLOCKED", f"resolver status {intent.get('status')}; no selected profile")

    selection = read_json(args.source_window) if args.source_window else None
    days = read_json(args.slice_days) if args.slice_days else None
    tokens: set[str] = set()
    windows = []
    if days and days.get("selection") == "most-recent-full-utc-day-with-data-per-slice":
        if decisions.get("windowSelection") != days["selection"]:
            phases.set(1, "BLOCKED", "SourceWindowUnconfirmed: a per-slice most-recent window needs the owner's up-front decision")
        for name, entry in days["slices"].items():
            if entry["status"] == "HAS_DATA":
                windows.append({"slice": name, **slice_window(entry)})
                tokens.add(window_token(slice_window(entry)))
        if not days["emptySlices"]:
            phases.set(1, "PASS", "owner decision: most recent full UTC day with real data per slice: "
                       + ", ".join(f"{w['slice']}={w['start'][:10]}" for w in windows), "owner-window-selection")
    else:
        status, reason = validate_confirmed(selection, (profile or {}).get("sourceWindowPolicy"))
        phases.set(1, status, reason, "source-window-selection" if status == "PASS" else None)
        if status == "PASS":
            windows.append({"slice": "*", **selection["confirmedWindow"]})
            tokens.add(window_token(selection["confirmedWindow"]))
    if days:
        for name in days.get("emptySlices", []):
            nearest = days["slices"][name].get("nearestDayWithData")
            phases.set(1, "BLOCKED", f"EmptySliceWindow: {name} has no real PROD data on {days['slices'][name]['day']}; "
                       + (f"nearest UTC day with data is {nearest}" if nearest else "no UTC day with data was found"))
        missing = sorted(set(slice_ids) - set(days.get("slices", {})))
        if missing:
            phases.set(1, "BLOCKED", f"EmptySliceWindow: no real-data day check for slices {missing}")
    elif slice_ids:
        phases.set(1, "BLOCKED", "EmptySliceWindow: no per-slice real-data check (source_window.py data-days) was supplied")

    if args.workspace and (Path(args.workspace) / "inputs-manifest.json").exists():
        repos = [e for e in read_json(Path(args.workspace) / "inputs-manifest.json") if e["kind"] == "repository"]
        bad = [r["name"] for r in repos if not r.get("requiredPathsVerified") or len(r.get("commitSha", "")) != 40]
        phases.set(2, "FAIL" if bad else "PASS", f"{len(repos)} repositories pinned" + (f"; unverified {bad}" if bad else ""), "inputs-manifest")
    else:
        phases.set(2, "BLOCKED", "no --workspace inputs-manifest.json")

    canary_spec, canary_steps = run_parts(args.canary_run_dir)
    full_spec, full_steps = run_parts(args.run_dir)
    ceiling = decisions.get("costCeilingUsd")
    for label, spec in (("canary", canary_spec), ("full", full_spec)):
        if spec and spec.get("profile") and spec.get("outputRoot", "").startswith("s3://"):
            phases.set(3, "PASS", f"{label}: explicit operator profile, region {spec.get('region')}, writes only under {spec['outputRoot']}", "run-spec")
            if ceiling is not None and spec.get("costCeilingUsd", 0) > ceiling:
                phases.set(3, "FAIL", f"CostCeilingExceeded: {label} job ceiling {spec['costCeilingUsd']} USD is above the owner's {ceiling} USD")
    if not (canary_spec or full_spec):
        phases.set(3, "BLOCKED", "no run spec with an explicit operator profile")
    uploads = [read_json(path) for path in args.staging_upload]
    for upload in uploads:
        if not upload.get("approvalOperationDigest") or not upload.get("matchesLocal"):
            phases.set(3, "FAIL", f"staging upload {upload.get('manifest')} lacks its approval digest or a matching manifest readback")
        elif tokens and not any(t in upload.get("manifest", "") for t in tokens):
            phases.set(3, "FAIL", f"FinalWindowBindingMismatch: staging upload {upload['manifest']} is outside the confirmed window")
        else:
            phases.set(3, "PASS", f"staged {upload['manifest']} under approval {upload['approvalOperationDigest']}", "staging-upload")
    if args.mode == "observed-dev" and not uploads:
        phases.set(3, "BLOCKED", "FinalStagingUnproven: no approved DEV staging upload record for the window's packages")

    for label, spec in (("canary", canary_spec), ("full", full_spec)):
        for name, prefix in ((spec or {}).get("bindings") or {}).items():
            if prefix.startswith(spec.get("outputRoot", "\0")) or any(t in prefix for t in tokens):
                phases.set(4, "PASS", f"{label} binding {name} under the confirmed PROD-derived window", "window-binding")
            else:
                phases.set(4, "BLOCKED", f"FinalWindowBindingMismatch: {label} binding {name} is not under the confirmed PROD-derived window")
    if phases.status[4] is None:
        phases.set(4, "BLOCKED", "no run bindings to register")

    answers = dict(a.split("=", 1) for a in args.answer)
    answered = {"UpstreamSourceUnresolved": "upstream-source"}
    findings = list(intent.get("findings", []))
    if args.contracts:
        contracts = read_json(args.contracts)
        findings += [{**f, "mapping": contracts["mapping"]} for f in contracts.get("findings", []) if f["code"] != "DatasetUndefined"]
    for finding in findings:
        placement = FINDING_PHASE.get(finding.get("code"))
        mapping = finding.get("mapping")
        if finding.get("severity") == "informational" or placement is None or (mapping and mapping not in run_keys):
            informational.append(finding.get("code"))
            continue
        question = answered.get(finding.get("code"))
        if question and question in answers:
            phases.set(placement[0], "PASS", f"{finding['code']} answered: {question}={answers[question]}", f"answer-{question}")
            continue
        phases.set(placement[0], placement[1], f"{finding['code']} {mapping or ''} {finding.get('dataset') or finding.get('concept') or ''}".strip())
    for key, checks in (intent.get("conceptChecks") or {}).items():
        phases.set(5, "PASS", f"{key} concepts {sorted({c['state'] for c in checks})}", "concept-checks")
    for key, scan in (intent.get("sqlScan") or {}).items():
        phases.set(6, "PASS" if not scan["forbiddenLabels"] else "FAIL", f"{key}: {scan['queriesScanned']} queries scanned", "sql-scan")
    if args.profile_check:
        report = read_json(args.profile_check)
        ok = report["derivedEqualsProfileModuloOverrides"]
        phases.set(6, "PASS" if ok else "FAIL",
                   f"profile equals registry derivation modulo declared overrides ({len(report['undeclared'])} undeclared, {len(report['staleOverrides'])} stale)",
                   "profile-check")
    accepted_changes = []
    for change in args.product_change:
        if decisions.get("acceptProductChanges"):
            accepted_changes.append(change)
            phases.set(6, "PASS", f"PRODUCT_CHANGE {change} accepted by the owner as out of scope; flagged for Kecleon", "owner-accepted-product-change")
        else:
            phases.set(6, "BLOCKED", f"UnacceptedProductChange: {change} needs a Kecleon handoff or the owner's acceptance as out of scope")
    for attestation in args.attest:
        phase, _, evidence = attestation.partition("=")
        phases.set(int(phase), "PASS", f"attested by {evidence}", evidence)

    baselines = {}
    for path in args.prod_actuals:
        summary = read_json(path)
        baselines[summary["slice"]] = summary
        if summary["status"] == "AVAILABLE":
            phases.set(7, "PASS", f"{summary['slice']}: PROD actual {summary['baselineKind']} available", Path(path).stem)
        elif summary["status"] == "NONE":
            phases.set(7, "PASS", f"{summary['slice']}: no PROD actual ({summary.get('reason')}); schema, row-count and reject-reason "
                       "checks only, stated in the report", "prod-actuals-fallback")
        else:
            phases.set(7, "BLOCKED", f"ProdActualsUnavailable: {summary['slice']} baseline is {summary['status']} for the window")
    for name in slice_ids or (["*"] if not baselines else []):
        if name not in baselines:
            phases.set(7, "BLOCKED", f"ProdActualsUnavailable: no PROD-actuals baseline for slice {name}")

    for label, spec, steps in (("canary", canary_spec, canary_steps), ("full", full_spec, full_steps)):
        deployment = (spec or {}).get("deployment") or {}
        if deployment.get("drift"):
            phases.set(8, "BLOCKED", f"DeploymentDrift ({label}): {deployment['drift']}")
        mismatched = [s["step"] for s in steps if s.get("mappingPinMatches") is False]
        if steps:
            phases.set(8, "FAIL" if mismatched else "PASS", f"{label}: {sum('mappingPinMatches' in s for s in steps)} plans bound to the "
                       "pinned digest" + (f"; mismatched {mismatched}" if mismatched else ""), "plans")
    if phases.status[8] is None:
        phases.set(8, "BLOCKED", "no captured plans")

    if canary_spec and canary_spec.get("stage") != "canary":
        phases.set(9, "FAIL", "the canary run directory is not a canary-stage run")
    canary_approvals = evaluate_steps(phases, 9, "canary", args.canary_run_dir, canary_steps)
    for path in args.canary_sample:
        sample = read_json(path)
        ok = 0 < sample["eventsSelected"] <= CANARY_EVENTS_PER_SLICE and sample.get("selectionDigest")
        phases.set(9, "PASS" if ok else "FAIL", f"{sample['slice']}: {sample['eventsSelected']} real events selected deterministically "
                   f"{sample.get('byOutcome') or ''}", "canary-sample")
    sampled = {read_json(p)["slice"] for p in args.canary_sample}
    for name in slice_ids:
        if name not in sampled:
            phases.set(9, "BLOCKED", f"CanaryRequired: no canary sample for slice {name}")
    canary_status, canary_failing, _ = comparison_status(args.canary_comparison)
    if args.canary_comparison:
        phases.set(9, canary_status, f"canary compared with PROD actuals" + (f"; not passing {canary_failing}" if canary_failing else ""),
                   "canary-comparison")
    else:
        phases.set(9, "BLOCKED", "CanaryRequired: no canary comparison against PROD actuals")

    gate = read_json(args.canary_gate) if args.canary_gate else None
    full_approvals = []
    if phases.status[9] != "PASS":
        phases.set(10, "BLOCKED", "FullRunNotStarted: the canary did not pass; the full-window run is not offered")
        if full_steps:
            phases.set(10, "FAIL", "a full-window run was started although the canary did not pass")
    elif not gate or gate.get("status") not in {"APPROVED", "PRE_APPROVED"}:
        phases.set(10, "APPROVAL_REQUIRED", "CanaryGateAwaitingApproval: show the canary result and ask the user before the full-window run")
        if full_steps:
            phases.set(10, "FAIL", "a full-window run was started without an approved canary gate")
    else:
        kind = (gate.get("approval") or {}).get("kind")
        phases.set(10, "PASS", f"full-window run {'pre-approved by the owner' if kind == 'owner-pre-approval' else 'approved by the user'} "
                   "after a passing canary", "canary-gate")
        if full_spec and full_spec.get("stage") != "full":
            phases.set(10, "FAIL", "the full run directory is not a full-stage run")
        full_approvals = evaluate_steps(phases, 10, "full", args.run_dir, full_steps)

    fallback = {n for n, b in baselines.items() if b["status"] == "NONE"}
    actual_status, actual_failing, reports = comparison_status(args.actuals_comparison)
    compared = {r.get("slice") for r in reports}
    if args.actuals_comparison:
        phases.set(11, actual_status, "full window compared with PROD actuals" + (f"; not passing {actual_failing}" if actual_failing else ""),
                   "actuals-comparison")
    for name in (set(baselines) - fallback) - compared:
        phases.set(11, "BLOCKED", f"ProdActualsComparisonMissing: slice {name} has a PROD actual but no full-window comparison")
    if fallback and not args.checks:
        phases.set(11, "BLOCKED", f"slices {sorted(fallback)} have no PROD actual and no schema/row-count checks")
    for entry in intent.get("parityDerivation", []):
        if entry.get("status") in ("FAIL", "BLOCKED"):
            covered = any(c["dataset"] == entry["dataset"] and c["kind"] == "columns-match-contract" and c["status"] == "PASS"
                          for path in args.checks for c in read_json(path)["checks"])
            phases.set(11, "PASS" if covered else entry["status"], f"{entry['dataset']}: {entry.get('finding')}"
                       + (" resolved by a declared consumer contract" if covered else ""), "checks" if covered else None)
    for path in args.checks:
        report = read_json(path)
        failing = [c["id"] for c in report["checks"] if c["status"] in ("FAIL", "BLOCKED")]
        status = "FAIL" if any(c["status"] == "FAIL" for c in report["checks"]) else ("BLOCKED" if failing else "PASS")
        phases.set(11, status, f"{Path(path).name}: {len(report['checks'])} schema/contract checks" + (f"; not passing {failing}" if failing else ""),
                   Path(path).stem)
    for path in args.closure:
        report = read_json(path)
        ok = report["danglingEndpointCount"] == 0 and report["identityUnique"]
        phases.set(11, "PASS" if ok else "FAIL", f"closure: {report['endpointCount']} endpoints, {report['danglingEndpointCount']} dangling", Path(path).stem)
    graph_outputs = profile and (profile.get("graph") or {}).get("required") and any(
        d.get("toLanguage") == intent.get("primaryDirection", {}).get("to") for d in profile.get("directions", []))
    shape = intent.get("primaryDirection", {}).get("outputShape")
    if not args.closure and (shape == "graph" or (graph_outputs and shape != "tabular")):
        phases.set(11, "BLOCKED", "graph output without closure evidence")
    if args.regression:
        report = read_json(args.regression)
        phases.set(11, "PASS" if report["pass"] else "FAIL",
                   f"regression: {len(report['identical'])} identical, {len(report['changed'])} changed, {len(report['newCases'])} new", "regression")
    if phases.status[10] != "PASS":
        phases.set(11, "BLOCKED", "no approved full-window run to compare")
    if phases.status[11] is None:
        phases.set(11, "BLOCKED", "no comparison evidence")

    for n in range(1, 12):
        if phases.status[n] is None:
            phases.set(n, "BLOCKED", "no evidence supplied")
    scoped = {phases.status[n] for n in range(1, 12)}
    mode_scoped = "FAIL" if "FAIL" in scoped else ("BLOCKED" if scoped - {"PASS"} else "PASS")
    final = {"kind": "prod-derived-dev", "status": "BLOCKED", "prodAccess": "read-only",
             "sourceWindow": {k: windows[0][k] for k in ("start", "endExclusive", "completeUtcDays")} if len(windows) == 1 else None,
             "sliceWindows": windows,
             "stagingApprovalDigests": sorted({u["approvalOperationDigest"] for u in uploads if u.get("approvalOperationDigest")}),
             "executionApprovalDigests": sorted(set(canary_approvals) | set(full_approvals)),
             "inputManifestSha256s": sorted({"sha256:" + u["manifestSha256"] for u in uploads if u.get("manifestSha256")}),
             "canary": {"status": phases.status[9], "eventsPerSlice": CANARY_EVENTS_PER_SLICE,
                        "executionApprovalDigests": sorted(set(canary_approvals))},
             "fullRunApproval": {"status": (gate or {}).get("status", "ABSENT"), "kind": ((gate or {}).get("approval") or {}).get("kind")},
             "baseline": [{"slice": n, "baselineKind": b["baselineKind"], "status": b["status"]} for n, b in sorted(baselines.items())],
             "evidenceIds": ["final-prod-derived-validation"]}
    if args.mode != "observed-dev":
        phases.set(12, "BLOCKED", "FinalProdDerivedValidationRequired: a dry run proves the approval gates only")
    elif mode_scoped != "PASS":
        phases.set(12, "FAIL" if mode_scoped == "FAIL" else "BLOCKED",
                   "FinalProdDerivedValidationRequired: READY needs a confirmed real window, a passing DEV canary and an approved "
                   "full-window DEV run that matches PROD actuals")
    else:
        phases.set(12, "PASS", f"canary and {len(full_steps)} approved full-window DEV execution(s) matched PROD actuals", "final-prod-derived-validation")
    final["status"] = phases.status[12]
    statuses = {phases.status[n] for n in PHASE_NAMES}
    verdict = "NOT_READY" if "FAIL" in statuses else ("BLOCKED" if statuses - {"PASS"} else "READY")
    out = {"mode": args.mode, "mappings": sorted(run_keys), "verdict": verdict, "modeScopedResult": mode_scoped,
           "finalValidation": final, "ownerDecisions": decisions, "acceptedProductChanges": accepted_changes,
           "phases": [{"number": n, "name": PHASE_NAMES[n], "status": phases.status[n], "reasons": phases.reasons[n],
                       "evidenceIds": sorted(set(e for e in phases.evidence[n] if e)) or [f"phase-{n}"]} for n in PHASE_NAMES],
           "informationalFindings": sorted(set(informational))}
    if intent.get("versionSelection"):
        out["versionSelection"] = intent["versionSelection"]
    write_json(args.out, out)
    print(json.dumps({"verdict": verdict, "phases": {n: phases.status[n] for n in PHASE_NAMES}}))
    return 0 if verdict == "READY" else 1


if __name__ == "__main__":
    raise SystemExit(main())
