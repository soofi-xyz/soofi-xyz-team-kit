#!/usr/bin/env python3
"""Derive the 12 phase statuses and the readiness verdict from tool evidence (no mapping knowledge).

  evaluate_run.py --intent intent.json [--workspace WS] [--profile P.json] [--profile-check pc.json]
      [--contracts contracts.json] [--run-dir RUN] [--checks checks.json ...] [--regression regression.json]
      [--local-report report.json ...] [--closure closure.json ...] [--attest PHASE=EVIDENCE_ID ...]
      [--answer QUESTION_ID=CHOICE ...]
      --mode synthetic-local|observed-dev --out phases.json

Each phase is PASS, FAIL or BLOCKED from the evidence supplied:

  1  intake       resolver status RESOLVED and one selected (or supplied) profile
  2  discovery    every fetched repository pinned by commit with required paths verified
  3  safety       explicit operator profile, DEV-only writes, no PROD write verbs (enforced by the tools)
  4  evidence     every run binding lies under a profile validationSource with a manifest digest
  5  model        concept, forbidden-content and Lexicon-model findings of the resolver
  6  mapping      profile drift, SQL scan, endpoint/required-input findings, check-profile result
  7  spark        local Spark reports (local_mapping_run.py) or an --attest for repository tests
  8  provenance   pinned digest served by the environment, and every plan's mapping digest matches the pin
  9  runtime      every executed case met its expectation and reconciled physically
  10 graph        graph closure evidence for graph outputs; not required for tabular outputs without Persist
  11 parity       contract/invariant/oracle checks, derived-parity entries and the regression comparison
  12 package      the package itself (PASS when phases 1-11 are evaluated)

An operator answer to a resolver question (for example upstream-source=existing-graph-export) resolves the
finding that asked it. Findings attached to mappings outside the run are recorded as informational. In synthetic-local mode
phases 8 and 9 are satisfied by the local execution and the verdict is scoped to that mode.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from silvally_io import read_json, sha256_file, write_json

PHASE_NAMES = {
    1: "Intake and terminology", 2: "Repository and environment discovery", 3: "Safety and access preflight",
    4: "Evidence registry", 5: "Language and dataset model", 6: "Configuration/product boundary and directional mapping",
    7: "Static and Spark proof", 8: "Release and deployment provenance", 9: "Transform runtime proof",
    10: "Persist canary and graph closure", 11: "Export, hydration, and round-trip parity", 12: "Report, handoff, and verdict",
}
FINDING_PHASE = {
    "RemovedLexiconConcept": (5, "FAIL"), "LexiconConceptInactive": (5, "FAIL"), "ForbiddenConceptInLexicon": (5, "FAIL"),
    "ForbiddenPropertyInLexicon": (5, "FAIL"), "LexiconModelDiffersFromMain": (5, "FAIL"), "LexiconModelUnchecked": (5, "BLOCKED"),
    "LanguageDefinitionMissing": (5, "BLOCKED"),
    "ProfileOutputInputDrift": (6, "FAIL"), "OutputFormatDrift": (6, "FAIL"), "ProfileOutputDatasetDrift": (6, "FAIL"),
    "ProfileRegistrationStatusDrift": (6, "FAIL"), "ForbiddenConceptInSql": (6, "FAIL"), "HubOutputNotGraph": (6, "FAIL"),
    "EndpointDatasetNotRequired": (6, "FAIL"), "RequiredInputUndeclared": (6, "FAIL"), "UpstreamSourceUnresolved": (6, "BLOCKED"),
    "RegistrySourceDrift": (8, "BLOCKED"),
}
RANK = {"PASS": 0, "BLOCKED": 1, "FAIL": 2}


class Phases:
    def __init__(self) -> None:
        self.status = {n: None for n in PHASE_NAMES}
        self.reasons = {n: [] for n in PHASE_NAMES}
        self.evidence = {n: [] for n in PHASE_NAMES}

    def set(self, phase: int, status: str, reason: str, evidence: str | None = None) -> None:
        current = self.status[phase]
        if current is None or RANK[status] > RANK[current]:
            self.status[phase] = status
        self.reasons[phase].append(f"{status}: {reason}")
        if evidence:
            self.evidence[phase].append(evidence)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--intent", required=True)
    parser.add_argument("--workspace")
    parser.add_argument("--profile")
    parser.add_argument("--profile-check")
    parser.add_argument("--contracts")
    parser.add_argument("--run-dir")
    parser.add_argument("--checks", action="append", default=[])
    parser.add_argument("--regression")
    parser.add_argument("--local-report", action="append", default=[])
    parser.add_argument("--closure", action="append", default=[])
    parser.add_argument("--local-package", action="append", default=[],
                        help="SOURCE_ID=DIR: verify a local package's manifest.json digest and listed objects against the profile")
    parser.add_argument("--attest", action="append", default=[], help="PHASE=EVIDENCE_ID for evidence the tools cannot observe")
    parser.add_argument("--answer", action="append", default=[], help="QUESTION_ID=CHOICE the operator confirmed for a resolver question")
    parser.add_argument("--mode", choices=("synthetic-local", "observed-dev"), required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    intent = read_json(args.intent)
    profile = read_json(args.profile) if args.profile else None
    phases = Phases()
    run_keys = {s["mapping"] for s in intent.get("workflow", {}).get("steps", [])}
    informational = []

    if intent.get("status") == "RESOLVED" and (intent.get("selectedProfile") or profile):
        phases.set(1, "PASS", f"resolved {sorted(run_keys)}; profile {intent.get('selectedProfile') or profile.get('id')}", "intent-resolution")
    else:
        phases.set(1, "BLOCKED", f"resolver status {intent.get('status')}; no selected profile")

    if args.workspace and (Path(args.workspace) / "inputs-manifest.json").exists():
        repos = [e for e in read_json(Path(args.workspace) / "inputs-manifest.json") if e["kind"] == "repository"]
        bad = [r["name"] for r in repos if not r.get("requiredPathsVerified") or len(r.get("commitSha", "")) != 40]
        phases.set(2, "FAIL" if bad else "PASS", f"{len(repos)} repositories pinned" + (f"; unverified {bad}" if bad else ""), "inputs-manifest")
    elif args.mode == "synthetic-local":
        phases.set(2, "PASS", "local fixture registry; no remote repositories", "fixture-registry")
    else:
        phases.set(2, "BLOCKED", "no --workspace inputs-manifest.json")

    spec = read_json(Path(args.run_dir) / "run-spec.json") if args.run_dir else None
    if args.mode == "synthetic-local":
        phases.set(3, "PASS", "local-only writes", "synthetic-local")
    elif spec and spec.get("profile") and spec.get("outputRoot", "").startswith("s3://"):
        phases.set(3, "PASS", f"explicit operator profile, region {spec.get('region')}, writes only under {spec['outputRoot']}", "run-spec")
    else:
        phases.set(3, "BLOCKED", "no run spec with an explicit operator profile")

    sources_by_id = {s["id"]: s for s in (profile or {}).get("validationSources", [])}
    for package in args.local_package:
        source_id, _, directory = package.partition("=")
        manifest = Path(directory) / "manifest.json"
        source = sources_by_id.get(source_id, {})
        digest = sha256_file(manifest) if manifest.exists() else None
        objects = read_json(manifest).get("objects", []) if manifest.exists() else []
        bad = [o["key"] for o in objects if sha256_file(Path(directory) / o["key"]) != o["sha256"]]
        ok = digest is not None and digest == source.get("manifestSha256") and not bad
        phases.set(4, "PASS" if ok else "FAIL", f"package {source_id}: manifest digest {'matches' if ok else 'differs from'} the profile; "
                   f"{len(objects)} objects, {len(bad)} changed", source_id)
    if args.mode == "synthetic-local" and not args.local_package:
        phases.set(4, "BLOCKED", "no --local-package manifest verified")
    elif spec:
        sources = [s for s in (profile or {}).get("validationSources", []) if s.get("manifestSha256")]
        for name, prefix in (spec.get("bindings") or {}).items():
            source = next((s for s in sources if prefix.startswith(s["location"])), None)
            if source:
                phases.set(4, "PASS", f"binding {name} under manifested source {source['id']}", source["id"])
            else:
                phases.set(4, "BLOCKED", f"binding {name} is not under a manifested validationSource")

    answers = dict(a.split("=", 1) for a in args.answer)
    answered = {"UpstreamSourceUnresolved": "upstream-source"}
    findings = list(intent.get("findings", []))
    if args.contracts:
        contracts = read_json(args.contracts)
        findings += [{**f, "mapping": contracts["mapping"]} for f in contracts.get("findings", []) if f["code"] != "DatasetUndefined"]
    for finding in findings:
        placement = FINDING_PHASE.get(finding.get("code"))
        mapping = finding.get("mapping")
        if placement is None or (mapping and mapping not in run_keys):
            informational.append(finding.get("code"))
            continue
        question = answered.get(finding.get("code"))
        if question and question in answers:
            phases.set(placement[0], "PASS", f"{finding['code']} answered: {question}={answers[question]}", f"answer-{question}")
            continue
        phases.set(placement[0], placement[1], f"{finding['code']} {mapping or ''} {finding.get('dataset') or finding.get('concept') or ''}".strip())
    for key, checks in (intent.get("conceptChecks") or {}).items():
        states = sorted({c["state"] for c in checks})
        phases.set(5, "PASS", f"{key} concepts {states}", "concept-checks")
    for key, scan in (intent.get("sqlScan") or {}).items():
        phases.set(6, "PASS" if not scan["forbiddenLabels"] else "FAIL", f"{key}: {scan['queriesScanned']} queries scanned", "sql-scan")
    if args.profile_check:
        report = read_json(args.profile_check)
        ok = report["derivedEqualsProfileModuloOverrides"]
        phases.set(6, "PASS" if ok else "FAIL",
                   f"profile equals registry derivation modulo declared overrides ({len(report['undeclared'])} undeclared, {len(report['staleOverrides'])} stale)",
                   "profile-check")

    for path in args.local_report:
        report = read_json(path)
        phases.set(7, "PASS", f"{report['mapping']} ran locally on Spark {report['sparkVersion']}: "
                   + ", ".join(f"{o['dataset']}={o['rows']}" for o in report["outputs"]), Path(path).name)
    for attestation in args.attest:
        phase, _, evidence = attestation.partition("=")
        phases.set(int(phase), "PASS", f"attested by {evidence}", evidence)

    steps = read_json(Path(args.run_dir) / "steps.json") if args.run_dir else []
    if args.mode == "synthetic-local":
        phases.set(8, "PASS", "local execution of the pinned mapping; no deployment involved", "local-report")
        phases.set(9, "PASS" if args.local_report else "BLOCKED", "local execution stands in for DEV runtime (synthetic-local)", "local-report")
        for path in args.local_report:
            negatives = read_json(path).get("negativeCases", [])
            accepted = [f"{n['dataset']}-without-{n['missingInput']}" for n in negatives if not n["rejected"]]
            phases.set(9, "FAIL" if accepted else ("PASS" if negatives else "BLOCKED"),
                       f"{Path(path).name}: {len(negatives)} missing-input cases, {len(accepted)} accepted", "negative-cases")
    else:
        deployment = (spec or {}).get("deployment") or {}
        if deployment.get("drift"):
            phases.set(8, "BLOCKED", f"DeploymentDrift: {deployment['drift']}")
        mismatched = [s["step"] for s in steps if s.get("mappingPinMatches") is False]
        phases.set(8, "FAIL" if mismatched else "PASS", f"{sum('mappingPinMatches' in s for s in steps)} plans bound to the pinned digest"
                   + (f"; mismatched {mismatched}" if mismatched else ""), "plans")
        if not steps:
            phases.set(9, "BLOCKED", "no captured executions")
        for s in steps:
            status = "BLOCKED" if s["status"] == "RUNNING" else ("PASS" if s.get("verdict") == "PASS" else "FAIL")
            phases.set(9, status, f"{s['step']} {s['status']} (expected {s.get('expected')})", s.get("executionArn"))

    graph_outputs = profile and (profile.get("graph") or {}).get("required") and any(
        d.get("toLanguage") == intent.get("primaryDirection", {}).get("to") for d in profile.get("directions", []))
    persist = intent.get("workflow", {}).get("persistPolicyDefault", "forbidden")
    for path in args.closure:
        report = read_json(path)
        ok = report["danglingEndpointCount"] == 0 and report["identityUnique"]
        phases.set(10, "PASS" if ok else "FAIL", f"closure: {report['endpointCount']} endpoints, {report['danglingEndpointCount']} dangling", Path(path).name)
    if not args.closure:
        shape = intent.get("primaryDirection", {}).get("outputShape")
        if shape == "graph" or (graph_outputs and shape != "tabular"):
            phases.set(10, "BLOCKED", "graph output without closure evidence")
        else:
            phases.set(10, "PASS", f"tabular output; Persist {persist}; canary not required", "persist-policy")

    for entry in intent.get("parityDerivation", []):
        if entry.get("status") in ("FAIL", "BLOCKED"):
            covered = False
            for path in args.checks:
                covered |= any(c["dataset"] == entry["dataset"] and c["kind"] == "columns-match-contract" and c["status"] == "PASS"
                               for c in read_json(path)["checks"])
            if covered:
                phases.set(11, "PASS", f"{entry['dataset']}: {entry.get('finding')} resolved by a declared consumer contract", "checks")
            else:
                phases.set(11, entry["status"], f"{entry['dataset']}: {entry.get('finding')}")
    for path in args.checks:
        report = read_json(path)
        failing = [c["id"] for c in report["checks"] if c["status"] in ("FAIL", "BLOCKED")]
        status = "FAIL" if any(c["status"] == "FAIL" for c in report["checks"]) else ("BLOCKED" if failing else "PASS")
        phases.set(11, status, f"{Path(path).name}: {len(report['checks'])} checks" + (f"; not passing {failing}" if failing else ""), Path(path).name)
    if args.regression:
        report = read_json(args.regression)
        phases.set(11, "PASS" if report["pass"] else "FAIL",
                   f"regression: {len(report['identical'])} identical, {len(report['changed'])} changed, {len(report['newCases'])} new", "regression")
    if phases.status[11] is None:
        phases.set(11, "BLOCKED", "no parity, check or regression evidence")

    for n in range(1, 12):
        if phases.status[n] is None:
            phases.set(n, "BLOCKED", "no evidence supplied")
    phases.set(12, "PASS", "package assembled from phases 1-11", "evaluate-run")
    statuses = {phases.status[n] for n in range(1, 12)}
    verdict = "NOT_READY" if "FAIL" in statuses else ("BLOCKED" if "BLOCKED" in statuses else "READY")
    out = {"mode": args.mode, "mappings": sorted(run_keys), "verdict": verdict,
           "phases": [{"number": n, "name": PHASE_NAMES[n], "status": phases.status[n], "reasons": phases.reasons[n],
                       "evidenceIds": sorted(set(e for e in phases.evidence[n] if e)) or [f"phase-{n}"]} for n in PHASE_NAMES],
           "informationalFindings": sorted(set(informational))}
    write_json(args.out, out)
    print(json.dumps({"verdict": verdict, "phases": {n: phases.status[n] for n in PHASE_NAMES}}))
    return 0 if verdict == "READY" else 1


if __name__ == "__main__":
    raise SystemExit(main())
