#!/usr/bin/env python3
"""Derive the 12 phase statuses and the readiness verdict, per slice and overall, from tool evidence.

  evaluate_run.py --intent intent.json [--workspace WS] [--profile P.json] [--profile-check pc.json]
      [--contracts contracts.json] [--catalog prod-actuals.json] [--answer QUESTION_ID=CHOICE ...]
      [--attest PHASE=EVIDENCE_ID ...] [--owner-decisions decisions.json] [--product-change ID ...]
      [--source-window confirmed.json] [--slice-days days.json] [--prod-actuals summary.json ...]
      [--canary-run-dir [SLICE=]RUN ...] [--canary-sample summary.json ...] [--canary-comparison checks.json ...]
      [--canary-gate [SLICE=]gate.json ...] [--run-dir [SLICE=]RUN ...] [--checks checks.json ...]
      [--actuals-comparison checks.json ...] [--closure closure.json ...] [--regression [SLICE=]regression.json ...]
      [--graph-inputs summary.json ...] [--staging-upload upload.json ...] [--deployment-check [SLICE=]check.json ...]
      [--chain-step persist-evidence.json ...] [--mode observed-dev|bounded-dev-dry-run]

A chained request (intent.kind chain) passes every transform step's canary and full run directories with the chain
slice (SLICE=RUN), the source build summary as --canary-sample, the source-events baseline as --prod-actuals, the
source-baseline comparisons as --canary-comparison / --actuals-comparison, the chain gate as --canary-gate, and each
Persist load and export record as --chain-step: a missing record blocks phase 9 (canary) or 10 (full), and a Persist
load counts only under its operation-specific approval or the owner's devPersistWrites decision (never blanketDevWrites).
      --out phases.json

Every input is real data from a PROD-derived UTC window; there is no local or synthetic mode. Named package
slices are evaluated independently: each has its own window, canary, canary gate, full run, comparison and
verdict, and the overall verdict is READY only when every slice is READY. Run directories, gates and regression
reports take a SLICE= prefix (or carry the slice in their run spec, gate or report); evidence files carry their
`slice`. Comparison evidence (canary and full comparisons, checks, closure, regression) counts only for the slice it
names; unsliced comparison evidence counts only for a single-slice request and is otherwise listed as ignored.
A slice that stops before its full run reports the real cause (for example UpstreamInputEmpty from data-days
--input-days or graph_inputs.py INPUT_EMPTY), not a canary failure that never happened. Each phase is PASS,
FAIL, BLOCKED or APPROVAL_REQUIRED:

  1  intake       resolver RESOLVED with a selected profile or a promoted run-scoped profile; the window is
                  user-confirmed (source_window.py confirm) or chosen by the owner decision "most recent full UTC
                  day with real data per slice"; no slice is empty, beyond its PROD actual's data cutoff, or without input rows
  2  discovery    every fetched repository pinned by commit with required paths verified
  3  safety       explicit operator profile, DEV-only writes, each DEV staging upload under its own approval digest
                  (or the owner's blanketDevWrites, recorded per digest), a slice's sensitive fields staged only
                  under the owner's sensitiveFieldStaging decision, and no job above the per-job cost ceiling
  4  evidence     every canary and full binding lies under its slice's window staging prefix (or the run's output root)
  5  model        concept, forbidden-content and Lexicon-model findings of the resolver
  6  mapping      profile drift, SQL scan, endpoint/required-input findings, check-profile result, and every
                  PRODUCT_CHANGE item: BLOCKED unless the owner accepted it as out of scope (then recorded)
  7  actuals      one PROD-actuals baseline per slice: AVAILABLE, or NONE (schema, row-count and reject-reason
                  fallback, stated in the report); EMPTY, STALE or TRUNCATED baselines are BLOCKED
  8  provenance   every plan's mapping digest matches the pin and the environment serves it; a run whose spec records
                  the registry location also needs a verdict-time dev_redeploy.py check (--deployment-check): SERVED
                  passes, a DeploymentRace (pruned or replaced by another PR's DEV deploy) is BLOCKED, a
                  DeploymentDrift (the pinned head's own deploy serves other content) is FAIL
  9  canary       the slice's DEV canary (at most 10 real events, deterministic sample) executed under approval
                  and its comparison against the PROD actual passed
  10 full run     the slice's canary gate was approved by the user (or pre-approved by the owner for a passing
                  canary) and every full-window DEV execution of the slice ran under its own approval; a failed
                  canary never reaches that slice's full run
  11 comparison   the slice's full-window outputs match PROD actuals (or pass the declared fallback), contract
                  checks, graph closure and regression
  12 verdict      PASS only when phases 1-11 pass for the slice on its real window

READY requires phase 12 PASS. Findings attached to mappings outside the run are informational. An operator answer
to a resolver question resolves the finding that asked it. Negative cases refused with an error that does not name
the omitted input pass and are listed as productChangeFlags (Transform error-message quality).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from silvally_io import read_json, write_json
from source_window import slice_window, validate_confirmed, window_token

DEFAULT_CATALOG = Path(__file__).resolve().parent.parent / "reference" / "prod-actuals.json"
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
APPROVED_GATES = {"APPROVED", "PRE_APPROVED"}
BLANKET_DEV_WRITES = "staging-and-executions-for-this-run"
SENSITIVE_DECISION = "stage-real-values-to-dev"
DEV_PERSIST_WRITES = "dev-persist-loads-for-this-run"
ALL = None


def worse(a: str | None, b: str) -> str:
    if a is None or RANK[b] > RANK[a] or (RANK[b] == RANK[a] and b == "BLOCKED"):
        return b
    return a


class Phases:
    """Phase entries scoped to one slice or to every slice (slice None)."""

    def __init__(self) -> None:
        self.entries: list[tuple[int, str, str, str | None, str | None]] = []

    def set(self, phase: int, status: str, reason: str, evidence: str | None = None, slice: str | None = ALL) -> None:
        self.entries.append((phase, status, reason if slice is ALL else f"[{slice}] {reason}", evidence, slice))

    def status(self, phase: int, slice: str | None = ALL) -> str | None:
        result = None
        for number, status, _, _, scope in self.entries:
            if number == phase and (slice is ALL or scope in (ALL, slice)):
                result = worse(result, status)
        return result

    def first_blocker(self, phases: tuple[int, ...], slice: str | None) -> str | None:
        """The first non-PASS reason of these phases that applies to the slice (the real cause of a later stop)."""
        for wanted in phases:
            for number, status, reason, _, scope in self.entries:
                if number == wanted and status != "PASS" and (scope is ALL or scope == slice):
                    return f"phase {number} {status}: {reason}"
        return None

    def reasons(self, phase: int) -> list[str]:
        return [f"{status}: {reason}" for number, status, reason, _, _ in self.entries if number == phase]

    def evidence(self, phase: int) -> list[str]:
        return sorted({e for number, _, _, e, _ in self.entries if number == phase and e})


def scoped(values: list[str]) -> list[tuple[str | None, str]]:
    """[SLICE=]PATH arguments as (slice or None, path)."""
    out = []
    for value in values:
        name, sep, path = value.partition("=")
        out.append((name, path) if sep and not name.startswith(("/", ".", "~")) and "/" not in name else (None, value))
    return out


def approval_of(run_dir: str, step: str) -> dict:
    path = Path(run_dir) / "approvals" / f"{step}.json"
    return (read_json(path).get("approval") or {}) if path.exists() else {}


def load_runs(values: list[str]) -> list[dict]:
    runs = []
    for slice_name, directory in scoped(values):
        spec_path, steps_path = Path(directory) / "run-spec.json", Path(directory) / "steps.json"
        spec = read_json(spec_path) if spec_path.exists() else {}
        steps = read_json(steps_path) if steps_path.exists() else []
        default = slice_name or ((spec.get("slices") or [None])[0] if len(spec.get("slices") or []) == 1 else None)
        case_slice = {c["case"]: c.get("slice") or default for c in spec.get("cases", [])}
        for s in steps:
            s["slice"] = s.get("slice") or case_slice.get(s["step"].split("-", 1)[-1]) or default
        runs.append({"dir": directory, "spec": spec, "steps": steps, "slice": default})
    return runs


def evaluate_steps(phases: Phases, phase: int, label: str, run: dict, steps: list[dict], decisions: dict,
                   slice_name: str | None) -> list[str]:
    approvals = []
    for s in steps:
        status = "BLOCKED" if s["status"] == "RUNNING" else ("PASS" if s.get("verdict") == "PASS" else "FAIL")
        phases.set(phase, status, f"{label} {s['step']} {s['status']} (expected {s.get('expected')})", s.get("executionArn"), slice_name)
        approval = approval_of(run["dir"], s["step"])
        if approval.get("status") != "APPROVED":
            phases.set(phase, "BLOCKED", f"{label} {s['step']} has no recorded operation-specific approval", slice=slice_name)
        elif approval.get("kind") == "owner-blanket-dev-writes" and decisions.get("blanketDevWrites") != BLANKET_DEV_WRITES:
            phases.set(phase, "BLOCKED", f"{label} {s['step']} was approved as a blanket DEV write without the owner's decision",
                       slice=slice_name)
        else:
            approvals.append(approval["operationDigest"])
    return approvals


def comparison_status(reports: list[dict]) -> tuple[str, list[str]]:
    failing = [f"{r.get('slice')}:{c['id']}" for r in reports for c in r.get("checks", []) if c["status"] != "PASS"]
    status = "FAIL" if any(c["status"] == "FAIL" for r in reports for c in r.get("checks", [])) else ("BLOCKED" if failing else "PASS")
    return status, failing


def in_slice(record: dict, name: str | None) -> bool:
    return name is ALL or record.get("slice") in (None, "*", name)


def evidence_in_slice(record: dict, name: str | None, slice_ids: list[str]) -> bool:
    """Comparison evidence belongs to the slice it names; unsliced ('*' or absent) evidence counts only when the
    request has at most one slice, so one slice's comparison never stands in for another's."""
    scope = record.get("slice")
    return name is ALL or scope == name or (scope in (None, "*") and len(slice_ids) <= 1)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--intent", required=True)
    parser.add_argument("--workspace")
    parser.add_argument("--profile", help="the selected profile, or the promoted run-scoped profile (promote-run-profile)")
    parser.add_argument("--profile-check")
    parser.add_argument("--contracts")
    parser.add_argument("--catalog", default=str(DEFAULT_CATALOG), help="PROD-actuals catalog (sensitive fields per slice)")
    parser.add_argument("--answer", action="append", default=[], help="QUESTION_ID=CHOICE the operator confirmed for a resolver question")
    parser.add_argument("--attest", action="append", default=[], help="PHASE=EVIDENCE_ID for read-only evidence the tools cannot observe")
    parser.add_argument("--owner-decisions", help="ownerDecisions JSON given up front (default: the resolver's intent.ownerDecisions)")
    parser.add_argument("--product-change", action="append", default=[], help="ID of an unresolved PRODUCT_CHANGE boundary decision")
    parser.add_argument("--source-window", help="sourceWindowSelection JSON written by source_window.py confirm")
    parser.add_argument("--slice-days", help="source_window.py data-days result for the window (or the owner's per-slice choice)")
    parser.add_argument("--prod-actuals", action="append", default=[], help="prod_actuals.py baseline summary, one per slice")
    parser.add_argument("--canary-run-dir", action="append", default=[], help="[SLICE=]captured canary run directory (repeatable)")
    parser.add_argument("--canary-sample", action="append", default=[], help="prod_actuals.py canary-sample summary, one per slice")
    parser.add_argument("--canary-comparison", action="append", default=[], help="prod_actuals.py compare result for the canary")
    parser.add_argument("--canary-gate", action="append", default=[], help="[SLICE=]transform_runs.py canary-gate record (repeatable)")
    parser.add_argument("--run-dir", action="append", default=[], help="[SLICE=]full-window run directory (repeatable)")
    parser.add_argument("--checks", action="append", default=[], help="compare_datasets.py check result for the full run")
    parser.add_argument("--actuals-comparison", action="append", default=[], help="prod_actuals.py compare result for the full run")
    parser.add_argument("--closure", action="append", default=[], help="compare_datasets.py closure --slice --out result")
    parser.add_argument("--regression", action="append", default=[],
                        help="[SLICE=]transform_runs.py regress --slice result (repeatable, one baseline per slice)")
    parser.add_argument("--graph-inputs", action="append", default=[],
                        help="graph_inputs.py summary of a slice's canary or window inputs (INPUT_EMPTY names the real cause)")
    parser.add_argument("--staging-upload", action="append", default=[],
                        help="stage_evidence_package.py upload result for a canary or full-window DEV package")
    parser.add_argument("--deployment-check", action="append", default=[],
                        help="[SLICE=]dev_redeploy.py check result taken at verdict time (repeatable)")
    parser.add_argument("--chain-step", action="append", default=[],
                        help="chain_runs.py persist-load or persist-export evidence of a chained validation (repeatable)")
    parser.add_argument("--mode", choices=("observed-dev", "bounded-dev-dry-run"), default="observed-dev")
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    intent = read_json(args.intent)
    profile = read_json(args.profile) if args.profile else None
    decisions = read_json(args.owner_decisions) if args.owner_decisions else dict(intent.get("ownerDecisions") or {})
    catalog = read_json(args.catalog) if Path(args.catalog).exists() else {"slices": {}}
    phases = Phases()
    run_keys = {s["mapping"] for s in intent.get("workflow", {}).get("steps", []) if s.get("mapping")}
    chain = intent.get("chain") if intent.get("kind") == "chain" else None
    slice_ids = [s["id"] for s in intent.get("slices") or []]
    scopes = slice_ids or [ALL]
    informational = []

    run_scoped = bool(profile and profile.get("kind") == "run-scoped-profile")
    if run_scoped and profile.get("status") != "PROMOTED":
        phases.set(1, "BLOCKED", "the run-scoped profile was not promoted: " + "; ".join(profile.get("reasons", [])))
    elif intent.get("status") == "RESOLVED" and (intent.get("selectedProfile") or profile or chain):
        label = f"run-scoped profile {profile['id']} (owner decisions + resolved intent)" if run_scoped else \
            (f"chain {chain['id']} ({len(chain.get('steps', []))} steps)" if chain and not profile else
             f"profile {intent.get('selectedProfile') or profile.get('id')}")
        phases.set(1, "PASS", f"resolved {sorted(run_keys)}; {label}", "intent-resolution")
        if (intent.get("versionSelection") or {}).get("notice"):
            phases.set(1, "PASS", intent["versionSelection"]["notice"], "version-selection")
    else:
        phases.set(1, "BLOCKED", f"resolver status {intent.get('status')}; no selected or promoted profile")

    selection = read_json(args.source_window) if args.source_window else None
    days = read_json(args.slice_days) if args.slice_days else None
    tokens: dict[str | None, str] = {}
    windows = []
    if days and days.get("selection") == "most-recent-full-utc-day-with-data-per-slice":
        if decisions.get("windowSelection") != days["selection"]:
            phases.set(1, "BLOCKED", "SourceWindowUnconfirmed: a per-slice most-recent window needs the owner's up-front decision")
        for name, entry in days["slices"].items():
            if entry["status"] == "HAS_DATA":
                windows.append({"slice": name, **slice_window(entry)})
                tokens[name] = window_token(slice_window(entry))
                phases.set(1, "PASS", f"owner decision: most recent full UTC day with real data: {entry['day']}",
                           "owner-window-selection", name)
            informational += [h["code"] for h in entry.get("handoffs", [])]
    else:
        status, reason = validate_confirmed(selection, (profile or {}).get("sourceWindowPolicy"))
        phases.set(1, status, reason, "source-window-selection" if status == "PASS" else None)
        if status == "PASS":
            windows.append({"slice": "*", **selection["confirmedWindow"]})
            tokens[ALL] = window_token(selection["confirmedWindow"])
    if days:
        if days.get("selection") != "most-recent-full-utc-day-with-data-per-slice":
            for entry in days.get("slices", {}).values():
                informational += [h["code"] for h in entry.get("handoffs", [])]
        for name in days.get("emptySlices", []):
            entry = days["slices"][name]
            nearest = entry.get("nearestDayWithData")
            code, what = {
                "STALE_ACTUAL": ("ProdMirrorStale", "its PROD actual's data stops at " + entry.get("dataThrough", "?")),
                "INPUT_EMPTY": ("UpstreamInputEmpty", "PROD-actual rows but no Transform input rows on "
                                + (entry.get("day") or "any day with actual data")
                                + (f" (input days {entry['inputDays']['first']}..{entry['inputDays']['last']})" if entry.get("inputDays") else "")),
            }.get(entry["status"], ("EmptySliceWindow", f"no real PROD data on {entry.get('day') or 'any complete UTC day'}"))
            phases.set(1, "BLOCKED", f"{code}: {name} has {what}; "
                       + (f"nearest UTC day with data on both sides is {nearest}" if nearest else "no UTC day with data on both sides was found"),
                       slice=name)
        for name in sorted(set(slice_ids) - set(days.get("slices", {}))):
            phases.set(1, "BLOCKED", "EmptySliceWindow: no real-data day check", slice=name)
    elif slice_ids:
        phases.set(1, "BLOCKED", "EmptySliceWindow: no per-slice real-data check (source_window.py data-days) was supplied")

    def token_for(name: str | None) -> str | None:
        return tokens.get(name) or tokens.get(ALL)

    if args.workspace and (Path(args.workspace) / "inputs-manifest.json").exists():
        repos = [e for e in read_json(Path(args.workspace) / "inputs-manifest.json") if e["kind"] == "repository"]
        bad = [r["name"] for r in repos if not r.get("requiredPathsVerified") or len(r.get("commitSha", "")) != 40]
        phases.set(2, "FAIL" if bad else "PASS", f"{len(repos)} repositories pinned" + (f"; unverified {bad}" if bad else ""), "inputs-manifest")
    else:
        phases.set(2, "BLOCKED", "no --workspace inputs-manifest.json")

    canary_runs, full_runs = load_runs(args.canary_run_dir), load_runs(args.run_dir)
    ceiling = decisions.get("costCeilingUsd")
    for label, run in [("canary", r) for r in canary_runs] + [("full", r) for r in full_runs]:
        spec = run["spec"]
        if spec.get("profile") and spec.get("outputRoot", "").startswith("s3://"):
            phases.set(3, "PASS", f"{label}: explicit operator profile, region {spec.get('region')}, writes only under {spec['outputRoot']}",
                       "run-spec", run["slice"])
            if ceiling is not None and spec.get("costCeilingUsd", 0) > ceiling:
                phases.set(3, "FAIL", f"CostCeilingExceeded: {label} job ceiling {spec['costCeilingUsd']} USD is above the owner's "
                           f"{ceiling} USD", slice=run["slice"])
    if not (canary_runs or full_runs):
        phases.set(3, "BLOCKED", "no run spec with an explicit operator profile")
    uploads = [read_json(path) for path in args.staging_upload]
    for upload in uploads:
        name = upload.get("slice")
        allowed = [token_for(name)] if name else list(tokens.values())
        if not upload.get("approvalOperationDigest") or not upload.get("matchesLocal"):
            phases.set(3, "FAIL", f"staging upload {upload.get('manifest')} lacks its approval digest or a matching manifest readback", slice=name)
        elif upload.get("approvalKind") == "owner-blanket-dev-writes" and decisions.get("blanketDevWrites") != BLANKET_DEV_WRITES:
            phases.set(3, "BLOCKED", f"staging upload {upload['manifest']} used a blanket DEV approval the owner did not give", slice=name)
        elif tokens and not any(t and t in upload.get("manifest", "") for t in allowed):
            phases.set(3, "FAIL", f"FinalWindowBindingMismatch: staging upload {upload['manifest']} is outside its slice's window", slice=name)
        else:
            phases.set(3, "PASS", f"staged {upload['manifest']} under approval {upload['approvalOperationDigest']}", "staging-upload", name)
    if args.mode == "observed-dev" and not uploads:
        phases.set(3, "BLOCKED", "FinalStagingUnproven: no approved DEV staging upload record for the window's packages")
    for name in slice_ids:
        sensitive = (catalog.get("slices", {}).get(name) or {}).get("sensitiveFields")
        if not sensitive:
            continue
        if decisions.get("sensitiveFieldStaging") == SENSITIVE_DECISION:
            phases.set(3, "PASS", f"owner decided sensitiveFieldStaging {SENSITIVE_DECISION}: real {sensitive.get('inputs')} are "
                       "staged to DEV unmodified and compared directly", "owner-sensitive-field-staging", name)
        else:
            phases.set(3, "BLOCKED", f"SensitiveStagingDecisionRequired: staging {sensitive.get('inputs')} to DEV needs the owner's "
                       "decision sensitiveFieldStaging: stage-real-values-to-dev (state it up front or approve it when asked)", slice=name)

    for label, run in [("canary", r) for r in canary_runs] + [("full", r) for r in full_runs]:
        spec = run["spec"]
        allowed = [token_for(run["slice"])] if run["slice"] else list(tokens.values())
        for binding, prefix in (spec.get("bindings") or {}).items():
            if prefix.startswith(spec.get("outputRoot", "\0")) or any(t and t in prefix for t in allowed):
                phases.set(4, "PASS", f"{label} binding {binding} under its PROD-derived window", "window-binding", run["slice"])
            else:
                phases.set(4, "BLOCKED", f"FinalWindowBindingMismatch: {label} binding {binding} is not under its PROD-derived window",
                           slice=run["slice"])
    if phases.status(4) is None:
        phases.set(4, "BLOCKED", "no run bindings to register")

    answers = dict(a.split("=", 1) for a in args.answer)
    answers.update((profile or {}).get("answers") or {})
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
    flags = sorted({s["productChangeFlag"]["id"] for run in canary_runs + full_runs for s in run["steps"] if s.get("productChangeFlag")})
    accepted_changes = []
    for change in [*args.product_change, *flags]:
        if decisions.get("acceptProductChanges"):
            accepted_changes.append(change)
            phases.set(6, "PASS", f"PRODUCT_CHANGE {change} accepted by the owner as out of scope; flagged for Kecleon", "owner-accepted-product-change")
        elif change in flags:
            phases.set(6, "PASS", f"PRODUCT_CHANGE {change} flagged for Kecleon (Transform error-message quality; not a mapping defect)",
                       "product-change-flag")
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
            phases.set(7, "PASS", f"PROD actual {summary['baselineKind']} available", Path(path).stem, summary["slice"])
        elif summary["status"] == "NONE":
            phases.set(7, "PASS", f"no PROD actual ({summary.get('reason')}); schema, row-count and reject-reason "
                       "checks only, stated in the report", "prod-actuals-fallback", summary["slice"])
        else:
            phases.set(7, "BLOCKED", f"ProdActualsUnavailable: baseline is {summary['status']} for the window"
                       + (f"; {summary['handoff']['detail']}" if summary.get("handoff") else ""), slice=summary["slice"])
    for name in slice_ids or (["*"] if not baselines else []):
        if name not in baselines:
            phases.set(7, "BLOCKED", "ProdActualsUnavailable: no PROD-actuals baseline", slice=None if name == "*" else name)

    for label, run in [("canary", r) for r in canary_runs] + [("full", r) for r in full_runs]:
        deployment = run["spec"].get("deployment") or {}
        if deployment.get("drift") and not deployment.get("location"):
            phases.set(8, "BLOCKED", f"DeploymentDrift ({label}): {deployment['drift']}", slice=run["slice"])
        mismatched = [s["step"] for s in run["steps"] if s.get("mappingPinMatches") is False]
        if run["steps"]:
            phases.set(8, "FAIL" if mismatched else "PASS", f"{label}: {sum('mappingPinMatches' in s for s in run['steps'])} plans bound "
                       "to the pinned digest" + (f"; mismatched {mismatched}" if mismatched else ""), "plans", run["slice"])
    verdict_checks = {name: read_json(path) for name, path in scoped(args.deployment_check)}
    for label, run in [("canary", r) for r in canary_runs] + [("full", r) for r in full_runs]:
        if not (run["spec"].get("deployment") or {}).get("location"):
            continue
        check = verdict_checks.get(run["slice"]) or verdict_checks.get(None)
        if not check:
            phases.set(8, "BLOCKED", f"DeploymentUnverifiedAtVerdict ({label}): re-check the served digest with dev_redeploy.py check",
                       slice=run["slice"])
        elif check["status"] == "SERVED":
            phases.set(8, "PASS", f"{label}: DEV still serves the pinned {check['mapping']} at verdict time", "deployment-check",
                       run["slice"])
        elif check.get("classification") == "DeploymentDrift":
            phases.set(8, "FAIL", f"DeploymentDrift ({label}): {check.get('detail')}", slice=run["slice"])
        else:
            phases.set(8, "BLOCKED", f"DeploymentRace ({label}): DEV {check['status'].lower().replace('_', ' ')} the pinned "
                       f"{check['mapping']} at verdict time; {check.get('detail') or 'classify with --slug --head-sha'}",
                       slice=run["slice"])
    if phases.status(8) is None:
        phases.set(8, "BLOCKED", "no captured plans")

    samples = [read_json(p) for p in args.canary_sample]
    canary_reports = [read_json(p) for p in args.canary_comparison]
    full_reports = [read_json(p) for p in args.actuals_comparison]
    gates = []
    for name, path in scoped(args.canary_gate):
        gate = read_json(path)
        gates.append({**gate, "slice": name or gate.get("slice")})
    canary_approvals, full_approvals = [], []
    fallback = {n for n, b in baselines.items() if b["status"] == "NONE"}
    per_slice_gate = {}
    for path in args.graph_inputs:
        built = read_json(path)
        name = built.get("slice")
        if built.get("status") == "INPUT_EMPTY":
            empty = built.get("inputEmpty") or {}
            phases.set(9, "BLOCKED", f"{empty.get('code', 'UpstreamInputEmpty')}: the PROD graph inputs have no rows in "
                       f"{empty.get('datasets')} ({empty.get('detail', '')}); nothing to run", Path(path).stem, name)
        elif built.get("status") != "BUILT":
            phases.set(9, "FAIL", f"graph inputs {built.get('status')}: {built.get('danglingEndpointCount')} dangling endpoints, "
                       f"hydration failures {[(d, s.get('hydrationFailures')) for d, s in built.get('datasets', {}).items() if s.get('hydrationFailures')]}",
                       slice=name)
    for name in scopes:
        for run in canary_runs:
            if run["spec"].get("stage") not in (None, "canary"):
                phases.set(9, "FAIL", "the canary run directory is not a canary-stage run", slice=run["slice"])
            steps = [s for s in run["steps"] if in_slice(s, name)]
            canary_approvals += evaluate_steps(phases, 9, "canary", run, steps, decisions, name)
        if not any(in_slice(s, name) for run in canary_runs for s in run["steps"]):
            phases.set(9, "BLOCKED", "CanaryRequired: no captured canary execution", slice=name)
        for sample in (s for s in samples if in_slice(s, name)):
            ok = 0 < sample["eventsSelected"] <= CANARY_EVENTS_PER_SLICE and sample.get("selectionDigest")
            phases.set(9, "PASS" if ok else "FAIL", f"{sample['eventsSelected']} real events selected deterministically "
                       f"{sample.get('byOutcome') or ''}", "canary-sample", name)
        if name is not ALL and not any(s["slice"] == name for s in samples):
            phases.set(9, "BLOCKED", "CanaryRequired: no canary sample", slice=name)
        reports = [r for r in canary_reports if evidence_in_slice(r, name, slice_ids)]
        if reports:
            status, failing = comparison_status(reports)
            phases.set(9, status, "canary compared with PROD actuals" + (f"; not passing {failing}" if failing else ""),
                       "canary-comparison", name)
        else:
            phases.set(9, "BLOCKED", "CanaryRequired: no canary comparison against PROD actuals", slice=name)

        gate = next((g for g in gates if g.get("slice") == name), None) or next((g for g in gates if g.get("slice") is None), None)
        per_slice_gate[name] = gate
        full_steps = [(run, [s for s in run["steps"] if in_slice(s, name)]) for run in full_runs]
        started = any(steps for _, steps in full_steps)
        if phases.status(9, name) != "PASS":
            canary_ran = any(in_slice(s, name) for run in canary_runs for s in run["steps"])
            cause = phases.first_blocker((1, 3, 7, 9) if not canary_ran else (9,), name)
            phases.set(10, "BLOCKED", ("FullRunNotStarted: the canary did not pass; the full-window run is not offered" if canary_ran
                                       else "FullRunNotStarted: no canary ran") + (f" (cause: {cause})" if cause else ""), slice=name)
            if started:
                phases.set(10, "FAIL", "a full-window run was started although this slice's canary did not pass", slice=name)
        elif not gate or gate.get("status") not in APPROVED_GATES:
            phases.set(10, "APPROVAL_REQUIRED", "CanaryGateAwaitingApproval: show the canary result and ask before the full-window run",
                       slice=name)
            if started:
                phases.set(10, "FAIL", "a full-window run was started without this slice's approved canary gate", slice=name)
        else:
            kind = (gate.get("approval") or {}).get("kind")
            phases.set(10, "PASS", f"full-window run {'pre-approved by the owner' if kind == 'owner-pre-approval' else 'approved by the user'} "
                       "after a passing canary", "canary-gate", name)
            for run, steps in full_steps:
                if run["spec"].get("stage") not in (None, "full"):
                    phases.set(10, "FAIL", "the full run directory is not a full-stage run", slice=name)
                full_approvals += evaluate_steps(phases, 10, "full", run, steps, decisions, name)
            if not started:
                phases.set(10, "BLOCKED", "no captured full-window execution", slice=name)

        reports = [r for r in full_reports if evidence_in_slice(r, name, slice_ids)]
        if reports:
            status, failing = comparison_status(reports)
            phases.set(11, status, "full window compared with PROD actuals" + (f"; not passing {failing}" if failing else ""),
                       "actuals-comparison", name)
            for report in reports:
                if report.get("devScope", "all") != "all":
                    phases.set(11, "BLOCKED", "a full-window comparison restricted DEV rows to the actual's keys", slice=name)
        elif name is not ALL and name in baselines and name not in fallback:
            phases.set(11, "BLOCKED", "ProdActualsComparisonMissing: a PROD actual but no full-window comparison", slice=name)
        if phases.status(10, name) != "PASS":
            phases.set(11, "BLOCKED", "no approved full-window run to compare", slice=name)
    chain_steps = [read_json(p) for p in args.chain_step]
    persist_approvals = []
    if chain:
        chain_slice = chain.get("slice")
        persist_ids = [s["id"] for s in chain.get("steps", []) if s["kind"] in ("persist-load", "persist-export")]
        for stage, phase in (("canary", 9), ("full", 10)):
            for step_id in persist_ids:
                records = [r for r in chain_steps if r.get("step") == step_id and r.get("stage") == stage]
                if not records:
                    phases.set(phase, "BLOCKED", f"ChainStepEvidenceMissing: no {stage} evidence of chain step {step_id}",
                               slice=chain_slice)
                    continue
                for record in records:
                    detail = record.get("executionStatus") or (record.get("scopeCheck") or {}).get("code") or ""
                    phases.set(phase, record.get("status", "FAIL"), f"chain {stage} {step_id} {record.get('status')} {detail}".strip(),
                               record.get("executionArn") or f"chain-{step_id}", chain_slice)
                    approval = record.get("approval")
                    if record.get("stepKind") != "persist-load":
                        continue
                    if not approval or approval.get("status") != "APPROVED":
                        phases.set(3, "BLOCKED", f"DevPersistWriteApprovalRequired: {stage} {step_id} has no recorded approval",
                                   slice=chain_slice)
                    elif approval.get("kind") == "owner-dev-persist-writes" and decisions.get("devPersistWrites") != DEV_PERSIST_WRITES:
                        phases.set(3, "BLOCKED", f"{stage} {step_id} was approved as an owner DEV Persist write without the "
                                   "owner's devPersistWrites decision", slice=chain_slice)
                    else:
                        persist_approvals.append(approval["operationDigest"])
                        phases.set(3, "PASS", f"{stage} {step_id}: DEV Persist load under approval {approval['operationDigest']} "
                                   f"({approval.get('kind')}); PROD Persist never written", "dev-persist-approval", chain_slice)
    for name in (set(baselines) - fallback) - {r.get("slice") for r in full_reports} - set(slice_ids):
        phases.set(11, "BLOCKED", f"ProdActualsComparisonMissing: slice {name} has a PROD actual but no full-window comparison")
    def evidence_scope(report: dict, path: str, kind: str):
        """(True, slice-or-ALL) for evidence that names its slice; unsliced evidence of a multi-slice request is ignored."""
        scope = report.get("slice")
        if scope not in (None, "*"):
            return True, scope
        if len(slice_ids) <= 1:
            return True, ALL
        informational.append("UnslicedComparisonEvidenceIgnored")
        ignored.append(f"{kind} {Path(path).name}: no slice; re-run it with --slice")
        return False, None

    ignored: list[str] = []
    checks = [(p, read_json(p)) for p in args.checks]
    checked = {s for p, r in checks for ok, s in [evidence_scope(r, p, "checks")] if ok}
    for name in fallback:
        if not (checked & {name, ALL}):
            phases.set(11, "BLOCKED", "no PROD actual and no schema/row-count checks for this slice", slice=None if name == "*" else name)
    for entry in intent.get("parityDerivation", []):
        if entry.get("status") in ("FAIL", "BLOCKED"):
            covered = any(c["dataset"] == entry["dataset"] and c["kind"] == "columns-match-contract" and c["status"] == "PASS"
                          for path in args.checks for c in read_json(path)["checks"])
            owner = next((s["id"] for s in intent.get("slices") or [] if entry["dataset"] in s["outputDatasets"]), None)
            phases.set(11, "PASS" if covered else entry["status"], f"{entry['dataset']}: {entry.get('finding')}"
                       + (" resolved by a declared consumer contract" if covered else ""), "checks" if covered else None, owner)
    for path, report in checks:
        applies, scope = evidence_scope(report, path, "checks")
        if not applies:
            continue
        failing = [c["id"] for c in report["checks"] if c["status"] in ("FAIL", "BLOCKED")]
        status = "FAIL" if any(c["status"] == "FAIL" for c in report["checks"]) else ("BLOCKED" if failing else "PASS")
        phases.set(11, status, f"{Path(path).name}: {len(report['checks'])} schema/contract checks" + (f"; not passing {failing}" if failing else ""),
                   Path(path).stem, scope)
    for path in args.closure:
        report = read_json(path)
        applies, scope = evidence_scope(report, path, "closure")
        if not applies:
            continue
        ok = report["danglingEndpointCount"] == 0 and report["identityUnique"]
        phases.set(11, "PASS" if ok else "FAIL", f"closure: {report['endpointCount']} endpoints, {report['danglingEndpointCount']} dangling",
                   Path(path).stem, scope)
    graph_outputs = profile and (profile.get("graph") or {}).get("required") and any(
        d.get("toLanguage") == intent.get("primaryDirection", {}).get("to") for d in profile.get("directions", []))
    shape = intent.get("primaryDirection", {}).get("outputShape")
    if not args.closure and (shape == "graph" or (graph_outputs and shape != "tabular")):
        phases.set(11, "BLOCKED", "graph output without closure evidence")
    for prefix, path in scoped(args.regression):
        report = read_json(path)
        report = {**report, "slice": prefix or report.get("slice")}
        applies, scope = evidence_scope(report, path, "regression")
        if not applies:
            continue
        counts = f"{len(report['identical'])} identical, {len(report['changed'])} changed, {len(report['newCases'])} new"
        status = report.get("status") or ("PASS" if report["pass"] else "FAIL")
        if status == "NOT_APPLICABLE":
            informational.append("RegressionNotApplicable")
            phases.set(11, "PASS", f"regression NOT_APPLICABLE: {report.get('reason') or 'no comparable baseline case'} ({counts}); "
                       "the PROD-actuals comparison is the gate", "regression", scope)
        else:
            phases.set(11, status, f"regression {status}: {counts}", "regression", scope)
    if phases.status(11) is None:
        phases.set(11, "BLOCKED", "no comparison evidence")

    for n in range(1, 12):
        if phases.status(n) is None:
            phases.set(n, "BLOCKED", "no evidence supplied")
    slice_results = {}
    for name in scopes:
        scoped_status = {phases.status(n, name) for n in range(1, 12)}
        result = "FAIL" if "FAIL" in scoped_status else ("BLOCKED" if scoped_status - {"PASS"} else "PASS")
        if args.mode != "observed-dev":
            phases.set(12, "BLOCKED", "FinalProdDerivedValidationRequired: a dry run proves the approval gates only", slice=name)
        elif result != "PASS":
            phases.set(12, result, "FinalProdDerivedValidationRequired: READY needs a real window, a passing DEV canary and an "
                       "approved full-window DEV run that matches PROD actuals", slice=name)
        else:
            phases.set(12, "PASS", "canary and approved full-window DEV execution(s) matched PROD actuals",
                       "final-prod-derived-validation", name)
        if name is not ALL:
            statuses = {phases.status(n, name) for n in PHASE_NAMES}
            gate = per_slice_gate.get(name) or {}
            slice_results[name] = {
                "verdict": "NOT_READY" if "FAIL" in statuses else ("BLOCKED" if statuses - {"PASS"} else "READY"),
                "window": next(({k: w[k] for k in ("start", "endExclusive", "completeUtcDays")} for w in windows
                                if w["slice"] in (name, "*")), None),
                "canaryGate": gate.get("status", "ABSENT"),
                "phases": {n: phases.status(n, name) for n in PHASE_NAMES}}
    statuses = {phases.status(n) for n in PHASE_NAMES}
    verdict = "NOT_READY" if "FAIL" in statuses else ("BLOCKED" if statuses - {"PASS"} else "READY")
    gate_statuses = {(g or {}).get("status", "ABSENT") for g in per_slice_gate.values()}
    gate_kinds = {((g or {}).get("approval") or {}).get("kind") for g in per_slice_gate.values()}
    final = {"kind": "prod-derived-dev", "status": phases.status(12), "prodAccess": "read-only",
             "sourceWindow": {k: windows[0][k] for k in ("start", "endExclusive", "completeUtcDays")} if len(windows) == 1 else None,
             "sliceWindows": windows,
             "stagingApprovalDigests": sorted({u["approvalOperationDigest"] for u in uploads if u.get("approvalOperationDigest")}),
             "executionApprovalDigests": sorted(set(canary_approvals) | set(full_approvals) | set(persist_approvals)),
             "inputManifestSha256s": sorted({"sha256:" + u["manifestFileSha256"] for u in uploads if u.get("manifestFileSha256")}),
             "canary": {"status": phases.status(9), "eventsPerSlice": CANARY_EVENTS_PER_SLICE,
                        "executionApprovalDigests": sorted(set(canary_approvals))},
             "fullRunApproval": {"status": next(iter(gate_statuses)) if len(gate_statuses) == 1 else
                                 ("APPROVED" if gate_statuses <= APPROVED_GATES else "AWAITING_APPROVAL"),
                                 "kind": next(iter(gate_kinds)) if len(gate_kinds) == 1 else "user"},
             "baseline": [{"slice": n, "baselineKind": b["baselineKind"], "status": b["status"] if b["status"] != "TRUNCATED" else "EMPTY"}
                          for n, b in sorted(baselines.items())],
             "evidenceIds": ["final-prod-derived-validation"]}
    out = {"mode": args.mode, "mappings": sorted(run_keys), "verdict": verdict, "slices": slice_results,
           "modeScopedResult": "FAIL" if "FAIL" in {phases.status(n) for n in range(1, 12)} else
           ("BLOCKED" if {phases.status(n) for n in range(1, 12)} - {"PASS"} else "PASS"),
           "finalValidation": final, "ownerDecisions": decisions, "acceptedProductChanges": accepted_changes,
           "productChangeFlags": flags,
           "phases": [{"number": n, "name": PHASE_NAMES[n], "status": phases.status(n), "reasons": phases.reasons(n),
                       "evidenceIds": phases.evidence(n) or [f"phase-{n}"]} for n in PHASE_NAMES],
           "informationalFindings": sorted(set(informational))}
    if ignored:
        out["ignoredEvidence"] = ignored
    if profile:
        out["profile"] = {"id": profile.get("id"), "kind": profile.get("kind", "profile")}
    if intent.get("versionSelection"):
        out["versionSelection"] = intent["versionSelection"]
    write_json(args.out, out)
    print(json.dumps({"verdict": verdict, "slices": {n: r["verdict"] for n, r in slice_results.items()},
                      "phases": {n: phases.status(n) for n in PHASE_NAMES}}))
    return 0 if verdict == "READY" else 1


if __name__ == "__main__":
    raise SystemExit(main())
