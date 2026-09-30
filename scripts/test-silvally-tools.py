#!/usr/bin/env python3
"""Offline unit tests for the Silvally AWS helper tools (no AWS, no GitHub).

The tools only ever read PROD, stage to DEV and drive DEV Transform; these tests exercise their
decision logic against a fake aws CLI and small inline records. Mapping registrations, languages and
profiles come from the test registry (scripts/testdata/silvally-registry). Nothing here runs a mapping.
Runs with the standard library plus jsonschema.
"""

from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills" / "validate-transform-configuration"
SCRIPTS = SKILL / "scripts"
FIXTURE = ROOT / "scripts" / "testdata" / "silvally-registry"
CANDIDATE = FIXTURE / "candidate"
PROFILE = FIXTURE / "profiles" / "test-alpha-omega.json"
PROJECTION = CANDIDATE / "mappings" / "canon-to-omega" / "2.0.0" / "registration.json"
RESOLVER_ARGS = ["--layout", str(FIXTURE / "layout.json"), "--lexicon-root", str(CANDIDATE), "--main-lexicon-root", str(CANDIDATE),
                 "--forbidden-concepts", str(FIXTURE / "forbidden-concepts.json"), "--profiles", str(FIXTURE / "profiles")]
sys.path.insert(0, str(SCRIPTS))

import silvally_io  # noqa: E402
import transform_runs  # noqa: E402
import compare_datasets  # noqa: E402
import build_run_package  # noqa: E402
import fetch_validation_inputs  # noqa: E402
import source_window  # noqa: E402
import prod_actuals  # noqa: E402

results: list[str] = []


def fail(message: str) -> None:
    raise SystemExit(f"Silvally tool tests failed: {message}")


def run_tool(script: str, *args: str, env: dict | None = None, check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run([sys.executable, str(SCRIPTS / script), *args], capture_output=True, text=True,
                            env={**os.environ, **(env or {})})
    if check and result.returncode != 0:
        fail(f"{script} {' '.join(args[:2])}: {result.stderr[-800:]}")
    return result


def aws_shim(directory: Path, body: str) -> dict:
    directory.mkdir(parents=True, exist_ok=True)
    shim = directory / "aws"
    shim.write_text(f"#!{sys.executable}\nimport json, shutil, sys\nargs = sys.argv[1:]\n{body}\n")
    shim.chmod(shim.stat().st_mode | stat.S_IEXEC)
    return {"PATH": f"{directory}{os.pathsep}{os.environ['PATH']}"}


def test_io_guards() -> None:
    try:
        silvally_io.aws(["stepfunctions", "start-execution", "--name", "x"], profile="p", environment="prod")
        fail("PROD write verb was not refused")
    except silvally_io.SilvallyError:
        pass
    try:
        silvally_io.aws(["s3", "cp", "local.txt", "s3://bucket/key"], profile="p", environment="prod")
        fail("PROD s3 upload was not refused")
    except silvally_io.SilvallyError:
        pass
    try:
        silvally_io.aws(["sts", "get-caller-identity"], profile="")
        fail("missing profile was accepted")
    except silvally_io.SilvallyError:
        pass
    if silvally_io.canonical_digest({"b": 1, "a": [1, 2]}) != silvally_io.canonical_digest({"a": [1, 2], "b": 1}):
        fail("canonical digest depends on key order")
    userinfo = ":".join(["user", "pw"]) + "@"
    if silvally_io.credential_free("https://" + userinfo + "host/p?sig=1#x") != "https://host/p":
        fail("credential_free kept user-info or query")
    results.append("io guards")


def spec(tmp: Path) -> Path:
    path = tmp / "spec.json"
    request = {"contractVersion": 2, "from": "canon", "to": "omega", "mappingVersion": "2.0.0"}
    silvally_io.write_json(path, {
        "runId": "20990101T000000Z", "stateMachineArn": "arn:aws:states:xx-test-1:000000000000:stateMachine:Example",
        "outputRoot": "s3://example-bucket/outputs/silvally-example/", "profile": "example-dev",
        "mappings": {"canon-to-omega@2.0.0": {"sha256": "0" * 64, "versionId": "v1"}},
        "cases": [{"case": "full", "mapping": "canon-to-omega@2.0.0", "expected": "PASS",
                   "request": {**request, "inputs": [{"table": "vertex-member", "s3Uri": "s3://example-bucket/inputs/vertex-member/"}]}},
                  {"case": "missing-input", "mapping": "canon-to-omega@2.0.0", "expected": "REJECTED", "missingInput": "vertex-member",
                   "request": {**request, "inputs": []}}],
    })
    return path


def test_transform_runs_cards(tmp: Path) -> None:
    run_dir = tmp / "run"
    out = run_tool("transform_runs.py", "cards", "--spec", str(spec(tmp)), "--run-dir", str(run_dir)).stdout
    cards = sorted((run_dir / "cards").glob("*.json"))
    if len(cards) != 2 or out.count("APPROVAL_REQUIRED") != 2:
        fail("cards did not stop at APPROVAL_REQUIRED for every case")
    card = json.loads(cards[0].read_text())
    if not card["request"]["output"]["s3Prefix"].endswith("/20990101T000000Z/full/"):
        fail("output prefix is not scoped to runId/case")
    stored = {k: v for k, v in card.items() if k not in ("operationDigest", "status")}
    if silvally_io.canonical_digest(stored) != card["operationDigest"]:
        fail("operation digest does not bind the card")
    if json.loads(cards[1].read_text()).get("missingInput") != "vertex-member":
        fail("a negative card does not name the omitted input")
    none = run_tool("transform_runs.py", "start", "--run-dir", str(run_dir), "--approver", "t", "--scope", "t").stdout
    if "started 0" not in none:
        fail("start without approvals started something")
    bad = run_tool("transform_runs.py", "start", "--run-dir", str(run_dir), "--approver", "t", "--scope", "t",
                   "--approve", "sha256:" + "f" * 64, check=False)
    if bad.returncode == 0 or "match no card" not in bad.stderr:
        fail("an approval digest that matches no card was accepted")
    tampered = json.loads(cards[0].read_text())
    tampered["operationDigest"] = "sha256:" + "a" * 64
    cards[0].write_text(json.dumps(tampered))
    changed = run_tool("transform_runs.py", "start", "--run-dir", str(run_dir), "--approver", "t", "--scope", "t",
                       "--approve", "sha256:" + "a" * 64, check=False)
    if changed.returncode == 0 or "card changed" not in changed.stderr:
        fail("a card that changed after presentation was not refused")
    rejected = {"status": "FAILED"}
    if not transform_runs.rejection_ok(rejected, ["ResolvePlan"], "Required input dataset 'vertex-member' is missing", "vertex-member"):
        fail("a pre-job rejection naming the omitted input was not accepted")
    if transform_runs.rejection_ok(rejected, ["ResolvePlan"], "Some other failure", "vertex-member"):
        fail("a rejection for an unrelated reason satisfied a missing-input case")
    if transform_runs.rejection_ok(rejected, ["ResolvePlan", "RunTransformJob"], "vertex-member", "vertex-member"):
        fail("a failure after the Transform job started satisfied a rejection case")
    results.append("transform_runs approval gate + rejection semantics")


def test_compare(tmp: Path) -> None:
    a, b = tmp / "a", tmp / "b"
    for d, rows in ((a, ["k;v;w", "1;x;p", "2;y;q"]), (b, ["k;v;w", "2;y;q", "1;;p"])):
        d.mkdir()
        (d / "part-00000.csv").write_text("\n".join(rows) + "\n")
    diff = json.loads(run_tool("compare_datasets.py", "--delimiter", ";", "diff", str(a), str(b), "--key", "k").stdout)
    if diff["identical"] or diff["changedByColumn"] != {"v": 1} or diff["onlyLeft"] or diff["onlyRight"]:
        fail(f"keyed diff miscounted: {diff}")
    emptied = json.loads(run_tool("compare_datasets.py", "--delimiter", ";", "diff", str(b), str(a), "--key", "k").stdout)
    if emptied["emptiedByColumn"] != {"v": 1} or diff["emptiedByColumn"]:
        fail(f"an output value emptied against the oracle was not counted as emptied: {emptied}")
    same = json.loads(run_tool("compare_datasets.py", "--delimiter", ";", "diff", str(a), str(a), "--expect-identical").stdout)
    if not same["identical"]:
        fail("identical datasets reported different")
    fmt = json.loads(run_tool("compare_datasets.py", "--delimiter", ";", "format", str(a), "--header", "k", "v", "w").stdout)
    bad = run_tool("compare_datasets.py", "--delimiter", ";", "format", str(a), "--header", "k", "v", check=False)
    if not fmt["pass"] or bad.returncode == 0:
        fail("CSV format check did not accept the right header or reject the wrong one")
    parts = run_tool("compare_datasets.py", "parts", str(a), str(b), check=False)
    if parts.returncode == 0 or json.loads(parts.stdout)["partShaMultisetEqual"]:
        fail("different part bytes compared equal")
    j1, j2 = tmp / "j1", tmp / "j2"
    for d, rows in ((j1, ['{"k": "1", "n": 2}', '{"k": "2", "n": 3}']), (j2, ['{"n": 3, "k": "2"}', '{"k": "1", "n": 2}'])):
        d.mkdir()
        (d / "part-00000.json").write_text("\n".join(rows) + "\n")
    jsonl = json.loads(run_tool("compare_datasets.py", "diff", str(j1), str(j2), "--format", "jsonl", "--expect-identical").stdout)
    if not jsonl["identical"]:
        fail("JSONL rows with different key order compared unequal")
    v, e = tmp / "v", tmp / "e"
    v.mkdir()
    e.mkdir()
    (v / "part-00000.csv").write_text("~id,~label\nn1,node\nn2,node\n")
    (e / "part-00000.csv").write_text("~id,~from,~to\ne1,n1,n2\ne2,n1,missing\n")
    closure = run_tool("compare_datasets.py", "closure", "--vertex", f"node={v}", "--edge", f"link={e}:node:node", check=False)
    report = json.loads(closure.stdout)
    if closure.returncode == 0 or report["danglingEndpointCount"] != 1 or report["endpointCount"] != 4:
        fail(f"graph closure did not count the dangling endpoint: {report}")
    results.append("compare_datasets diff/parts/format/closure (csv + jsonl)")


def resolve(tmp: Path, command: str, *extra: str) -> dict:
    out = tmp / f"{command}.json"
    result = run_tool("resolve-transform-intent.py", command, *RESOLVER_ARGS, *extra, "--out", str(out), check=False)
    if command != "check-profile" and result.returncode != 0:
        fail(f"resolver {command}: {result.stderr[-600:]}")
    return json.loads(out.read_text())


def test_resolve_fixture(tmp: Path) -> None:
    work = tmp / "resolve"
    work.mkdir()
    intent = resolve(work, "discover", "--request", "test canon (alpha) to omega ledger summary")
    if intent["status"] != "RESOLVED" or intent["selectedProfile"] != PROFILE.name:
        fail(f"the request did not resolve to the test profile: {intent['status']} {intent.get('selectedProfile')}")
    options = {o["id"] for q in intent.get("questions", []) for o in q["options"]}
    if options & {"synthetic-local", "synthetic-fixture", "sanitized-edge-cases"}:
        fail(f"the resolver still offers a local or synthetic option: {sorted(options)}")
    if any(r["kind"] != "proposed-prod-derived" for r in intent.get("datasetRecommendations", []) if r["kind"].startswith("proposed")):
        fail("a proposed dataset is not PROD-derived")
    check = resolve(work, "check-profile", "--profile", str(PROFILE))
    if not check["derivedEqualsProfileModuloOverrides"]:
        fail(f"test profile differs from its registry derivation: {check['undeclared']} {check['staleOverrides']}")
    results.append("resolver on the test registry: RESOLVED, PROD-derived datasets only, profile equals derivation")


VERSION_SELECTION = {"requested": None, "mappingId": "canon-to-omega", "candidates": [{"version": "1.0.0", "publishedIn": ["dev"]},
                     {"version": "2.0.0", "publishedIn": ["dev"]}], "chosen": "canon-to-omega@2.0.0", "rule": "latest-published-semver",
                     "notice": "Resolved canon-to-omega@2.0.0 — latest published of 1.0.0, 2.0.0; add @x.y.z to pick another.",
                     "pin": {"source": "published-registry", "label": "dev", "path": "transform-mappings/canon-to-omega/2.0.0/mapping.json",
                             "sha256": "c" * 64}}


def test_evaluate_rules(tmp: Path) -> None:
    work = tmp / "evaluate"
    work.mkdir()
    intent = {"status": "RESOLVED", "selectedProfile": PROFILE.name, "primaryDirection": {"to": "omega", "outputShape": "tabular"},
              "workflow": {"steps": [{"mapping": "canon-to-omega@2.0.0"}], "persistPolicyDefault": "forbidden"},
              "findings": [{"code": "EndpointDatasetNotRequired", "mapping": "canon-to-omega@2.0.0", "dataset": "ledger_summary"},
                           {"code": "RetiredMappingInRegistry", "mapping": "alpha-to-omega@0.9.0"}],
              "versionSelection": VERSION_SELECTION}
    silvally_io.write_json(work / "intent.json", intent)
    run_tool("evaluate_run.py", "--intent", str(work / "intent.json"), "--out", str(work / "phases.json"), check=False)
    evaluated = json.loads((work / "phases.json").read_text())
    phases = {p["number"]: p for p in evaluated["phases"]}
    if phases[6]["status"] != "FAIL" or evaluated["verdict"] != "NOT_READY":
        fail("an endpoint finding did not fail phase 6")
    if evaluated.get("versionSelection") != VERSION_SELECTION or VERSION_SELECTION["notice"] not in " ".join(phases[1]["reasons"]):
        fail("evaluate_run did not carry the defaulted version selection and its notice into phase 1")
    if "RetiredMappingInRegistry" not in evaluated["informationalFindings"]:
        fail("a finding on a mapping outside the run was not kept informational")
    if any(phases[n]["status"] != "BLOCKED" for n in (4, 7, 9, 11)):
        fail("missing binding, PROD-actuals, canary or comparison evidence did not block")
    if "synthetic-local" in run_tool("evaluate_run.py", "--help").stdout:
        fail("evaluate_run still offers a synthetic-local mode")
    intent["findings"] = [{"code": "UpstreamSourceUnresolved", "mapping": "canon-to-omega@2.0.0"}]
    silvally_io.write_json(work / "intent.json", intent)
    for answer, expected in ((None, "BLOCKED"), ("upstream-source=existing-graph-export", "PASS")):
        extra = ["--answer", answer] if answer else []
        run_tool("evaluate_run.py", "--intent", str(work / "intent.json"), *extra, "--out", str(work / "answered.json"), check=False)
        status = next(p["status"] for p in json.loads((work / "answered.json").read_text())["phases"] if p["number"] == 6)
        if status != expected:
            fail(f"an upstream-source answer of {answer!r} left phase 6 {status}, expected {expected}")
    results.append("evaluate_run phase rules")


WINDOW = {"start": "2099-01-06T00:00:00Z", "endExclusive": "2099-01-07T00:00:00Z", "completeUtcDays": 1}
WINDOW_TOKEN = "2099-01-06T000000Z_2099-01-07T000000Z"


def day_candidates(days: int = 7, overrides: dict | None = None) -> list[dict]:
    out = []
    for d in range(days):
        start = f"2099-01-{d + 1:02d}T00:00:00Z"
        end = f"2099-01-{d + 2:02d}T00:00:00Z"
        out.append({"start": start, "endExclusive": end, "sourceFamiliesPresent": ["ledgers", "members", "rates"],
                    "coverageSignals": {"ledgers-rows-present": 6, "members-rows-present": 4, "rates-rows-present": 3},
                    "rowCount": 13, "byteCount": 2048, "estimatedCostUsd": 0.02, "immutableEvidence": True, **(overrides or {}).get(d, {})})
    return out


def test_source_window(tmp: Path) -> None:
    profile = json.loads(PROFILE.read_text())
    bare = {k: v for k, v in profile.items() if k != "sourceWindowPolicy"}
    derived = source_window.derive_policy(bare, None)
    if derived != profile["sourceWindowPolicy"]:
        fail(f"a profile without a policy did not derive the recorded default policy: {derived}")
    intent = {"parityDerivation": [{"dataset": "members", "coverageTargets": [{"field": "tier", "values": ["gold", "silver"]}]}]}
    if "members-tier-values-covered" not in source_window.derive_policy(bare, intent)["requiredCoverageSignals"]:
        fail("enum coverage targets did not become required coverage signals")
    policy = profile["sourceWindowPolicy"]
    now = source_window.parse_utc("2099-01-08T06:00:00Z")
    partial_today = {"start": "2099-01-08T00:00:00Z", "endExclusive": "2099-01-09T00:00:00Z"}
    candidates = day_candidates(overrides={6: {"sourceFamiliesPresent": ["ledgers", "members"]}}) + [
        {**day_candidates(1)[0], **partial_today}]
    selection, summary = source_window.recommend(policy, candidates, now, None, None, 7)
    if selection["status"] != "NEEDS_CONFIRMATION" or selection["recommendedWindow"] != WINDOW or selection["confirmedWindow"] is not None:
        fail(f"the most recent complete UTC day was not recommended: {summary}")
    if {c["start"] for c in selection["candidateComparisons"] if not c["complete"]} != {"2099-01-07T00:00:00Z", "2099-01-08T00:00:00Z"}:
        fail("a day missing a source family or a day that has not ended was treated as complete")
    for label, cands, kwargs in (
        ("fewer than seven candidates", day_candidates(3), {}),
        ("no immutable evidence", day_candidates(overrides={d: {"immutableEvidence": False} for d in range(7)}), {}),
        ("unmet coverage signal", day_candidates(overrides={d: {"coverageSignals": {"ledgers-rows-present": 0}} for d in range(7)}), {}),
        ("above the row bound", day_candidates(), {"max_rows": 5}),
        ("above the cost ceiling", day_candidates(), {"cost_ceiling": 0.01}),
    ):
        blocked, _ = source_window.recommend(policy, cands, now, kwargs.get("max_rows"), kwargs.get("cost_ceiling"), 7)
        if blocked["status"] != "BLOCKED" or blocked["recommendedWindow"] is not None:
            fail(f"{label}: an incomplete source window was recommended")
    confirmed = source_window.confirm(selection, policy, WINDOW["start"], WINDOW["endExclusive"])
    if confirmed["status"] != "CONFIRMED" or confirmed["confirmedWindow"] != WINDOW or source_window.window_token(WINDOW) != WINDOW_TOKEN:
        fail("the user's confirmation of the recommended window was not recorded")
    longer = source_window.confirm(selection, policy, "2099-01-04T00:00:00Z", WINDOW["endExclusive"])
    if longer["confirmedWindow"]["completeUtcDays"] != 3:
        fail("a longer contiguous complete range was not accepted when allowLongerRange is true")
    for label, start, end, pol in (
        ("partial day", "2099-01-06T00:00:00Z", "2099-01-06T12:00:00Z", policy),
        ("range including an incomplete day", "2099-01-06T00:00:00Z", "2099-01-08T00:00:00Z", policy),
        ("longer range when forbidden", "2099-01-05T00:00:00Z", WINDOW["endExclusive"], {**policy, "allowLongerRange": False}),
    ):
        try:
            source_window.confirm(selection, pol, start, end)
        except silvally_io.SilvallyError:
            continue
        fail(f"{label} was confirmed")
    try:
        source_window.confirm(confirmed, policy, WINDOW["start"], WINDOW["endExclusive"])
        fail("an already confirmed selection was confirmed again")
    except silvally_io.SilvallyError:
        pass
    for sel, expected in ((None, "BLOCKED"), (selection, "BLOCKED"), ({**selection, "status": "BLOCKED"}, "BLOCKED"), (confirmed, "PASS")):
        if source_window.validate_confirmed(sel, policy)[0] != expected:
            fail(f"validate_confirmed({sel and sel['status']}) is not {expected}")
    if source_window.validate_confirmed(confirmed, None)[0] != "BLOCKED":
        fail("a profile without a source window policy did not block")
    silvally_io.write_json(tmp / "window-selection.json", selection)
    silvally_io.write_json(tmp / "window-confirmed.json", confirmed)
    results.append("source_window policy derivation, recommendation, confirmation and refusals")


def final_run_fixture(work: Path, *, binding_token: str = WINDOW_TOKEN, approved: bool = True, canary: str = "PASS",
                      gate: str | None = "APPROVED", baseline: str = "AVAILABLE", empty_slice: bool = False,
                      full_run: bool = True) -> list[str]:
    """A canary-first observed-dev run on the confirmed window; returns evaluate_run arguments (without --source-window)."""
    work.mkdir(parents=True, exist_ok=True)
    root = "s3://example-dev-bucket/outputs/silvally-test/"
    prefix = f"s3://example-dev-bucket/inputs/alpha-prod-derived/{binding_token}_v1/"
    canary_prefix = f"s3://example-dev-bucket/inputs/alpha-prod-derived/{binding_token}_canary_v1/"
    profile = json.loads(PROFILE.read_text())
    silvally_io.write_json(work / "profile.json", profile)
    silvally_io.write_json(work / "intent.json", {
        "status": "RESOLVED", "selectedProfile": PROFILE.name, "primaryDirection": {"to": "omega", "outputShape": "tabular"},
        "workflow": {"steps": [{"mapping": "canon-to-omega@2.0.0"}], "persistPolicyDefault": "forbidden"}, "findings": [],
        "slices": [{"id": "members", "outputDatasets": ["member_report"]}],
        "conceptChecks": {"canon-to-omega@2.0.0": [{"state": "active"}]},
        "sqlScan": {"canon-to-omega@2.0.0": {"queriesScanned": 2, "forbiddenLabels": []}}})
    silvally_io.write_json(work / "ws" / "inputs-manifest.json", [{"kind": "repository", "name": "registry", "commitSha": "c" * 40,
                                                                  "requiredPathsVerified": True}])
    arn = "arn:aws:states:xx-test-1:000000000000:execution:t:silvally-"
    for stage, directory, bound, digest in (("canary", work / "canary", canary_prefix, "d" * 64), ("full", work / "run", prefix, "f" * 64)):
        if stage == "full" and not full_run:
            continue
        silvally_io.write_json(directory / "run-spec.json", {"stage": stage, "profile": "example-dev", "region": "xx-test-1",
                                                             "outputRoot": root, "costCeilingUsd": 5, "bindings": {"members": bound}})
        verdict = "PASS" if stage == "full" or canary == "PASS" else "FAIL"
        silvally_io.write_json(directory / "steps.json", [{"step": f"1-{stage}", "status": "SUCCEEDED", "verdict": verdict, "expected": "PASS",
                                                          "mappingPinMatches": True, "executionArn": f"{arn}{stage}"}])
        ok = approved or stage == "canary"
        silvally_io.write_json(directory / "approvals" / f"1-{stage}.json", {"operationDigest": "sha256:" + digest, "approval": {
            "operationDigest": "sha256:" + digest, "environment": "dev", "status": "APPROVED" if ok else "APPROVAL_REQUIRED",
            "recordedAt": "2099-01-08T07:00:00Z"}})
    silvally_io.write_json(work / "upload.json", {"manifest": prefix + "manifest.json", "manifestSha256": "b" * 64,
                                                  "manifestVersionId": "v1", "matchesLocal": True,
                                                  "approvalOperationDigest": "sha256:" + "e" * 64})
    silvally_io.write_json(work / "checks.json", {"checks": [{"id": "member-report-contract", "dataset": "member_report",
                                                              "kind": "columns-match-contract", "status": "PASS"}]})
    silvally_io.write_json(work / "slice-days.json", source_window.data_days(
        {"members": {"2099-01-05": 12} if empty_slice else {"2099-01-06": 13}}, "2099-01-06", False,
        source_window.parse_utc("2099-01-08T06:00:00Z")))
    silvally_io.write_json(work / "actuals.json", {"slice": "members", "baselineKind": "iceberg-table", "status": baseline,
                                                   **({"reason": "no PROD table holds this output"} if baseline == "NONE" else {})})
    silvally_io.write_json(work / "sample.json", {"slice": "members", "eventsSelected": 10, "byOutcome": {"accepted": 8, "rejected": 2},
                                                  "selectionDigest": "sha256:" + "1" * 64})
    compare = {"slice": "members", "baselineKind": "iceberg-table", "status": canary,
               "checks": [{"id": "prod-actuals-member_report", "status": canary, "devRows": 10, "prodRows": 10}]}
    silvally_io.write_json(work / "canary-compare.json", compare)
    silvally_io.write_json(work / "actuals-compare.json", {**compare, "status": "PASS", "checks": [{**compare["checks"][0], "status": "PASS"}]})
    args = ["--intent", str(work / "intent.json"), "--profile", str(work / "profile.json"), "--workspace", str(work / "ws"),
            "--canary-run-dir", str(work / "canary"), "--canary-sample", str(work / "sample.json"),
            "--canary-comparison", str(work / "canary-compare.json"), "--prod-actuals", str(work / "actuals.json"),
            "--slice-days", str(work / "slice-days.json"), "--checks", str(work / "checks.json"),
            "--staging-upload", str(work / "upload.json"), "--mode", "observed-dev"]
    if gate:
        silvally_io.write_json(work / "gate.json", {"status": gate, "approval": {"kind": "owner-pre-approval" if gate == "PRE_APPROVED" else "user"}})
        args += ["--canary-gate", str(work / "gate.json")]
    if full_run:
        args += ["--run-dir", str(work / "run")]
    if baseline != "NONE":
        args += ["--actuals-comparison", str(work / "actuals-compare.json")]
    return args


def test_final_prod_derived_validation(tmp: Path) -> None:
    work = tmp / "final"
    confirmed = tmp / "window-confirmed.json"

    def evaluate(label: str, args: list[str]) -> dict:
        out = tmp / f"final-{label}.json"
        run_tool("evaluate_run.py", *args, "--out", str(out), check=False)
        return json.loads(out.read_text())

    def reasons(result: dict, number: int) -> str:
        return " ".join(next(p["reasons"] for p in result["phases"] if p["number"] == number))

    ready = evaluate("ready", [*final_run_fixture(work / "ready"), "--source-window", str(confirmed)])
    final = ready["finalValidation"]
    if ready["verdict"] != "READY" or final["status"] != "PASS" or final["sourceWindow"] != WINDOW:
        fail(f"a passing canary plus an approved full run was not READY: {[(p['number'], p['reasons']) for p in ready['phases'] if p['status'] != 'PASS']}")
    if final["executionApprovalDigests"] != ["sha256:" + "d" * 64, "sha256:" + "f" * 64] or final["canary"]["status"] != "PASS":
        fail("the final validation did not record the canary and full-run approval digests")
    if final["fullRunApproval"] != {"status": "APPROVED", "kind": "user"} or final["baseline"] != [
            {"slice": "members", "baselineKind": "iceberg-table", "status": "AVAILABLE"}]:
        fail(f"the final validation did not record the user's approval and the PROD-actuals baseline: {final}")
    cases = (
        ("no-window", final_run_fixture(work / "no-window"), {1: "BLOCKED", 12: "BLOCKED"}),
        ("unconfirmed", [*final_run_fixture(work / "unconfirmed"), "--source-window", str(tmp / "window-selection.json")], {1: "BLOCKED"}),
        ("other-window", [*final_run_fixture(work / "other", binding_token="2099-01-01T000000Z_2099-01-02T000000Z"),
                          "--source-window", str(confirmed)], {3: "FAIL", 4: "BLOCKED"}),
        ("unapproved-full", [*final_run_fixture(work / "unapproved", approved=False), "--source-window", str(confirmed)], {10: "BLOCKED"}),
        ("awaiting-approval", [*final_run_fixture(work / "awaiting", gate="AWAITING_APPROVAL", full_run=False), "--source-window", str(confirmed)],
         {9: "PASS", 10: "APPROVAL_REQUIRED", 11: "BLOCKED", 12: "BLOCKED"}),
        ("no-gate", [*final_run_fixture(work / "no-gate", gate=None, full_run=False), "--source-window", str(confirmed)], {10: "APPROVAL_REQUIRED"}),
        ("stale-actuals", [*final_run_fixture(work / "stale", baseline="STALE"), "--source-window", str(confirmed)], {7: "BLOCKED"}),
        ("empty-slice", [*final_run_fixture(work / "empty", empty_slice=True), "--source-window", str(confirmed)], {1: "BLOCKED"}),
    )
    for label, args, expected in cases:
        result = evaluate(label, args)
        statuses = {p["number"]: p["status"] for p in result["phases"]}
        if result["verdict"] == "READY" or any(statuses[n] != s for n, s in expected.items()):
            fail(f"{label}: expected {expected}, got verdict {result['verdict']} and {statuses}")
    if "nearest UTC day with data is 2099-01-05" not in reasons(evaluate("empty-reason", [*final_run_fixture(work / "empty2", empty_slice=True),
                                                                                         "--source-window", str(confirmed)]), 1):
        fail("an empty slice did not suggest the nearest UTC day with real data")
    failed = evaluate("canary-failed", [*final_run_fixture(work / "canary-failed", canary="FAIL", gate=None, full_run=False),
                                        "--source-window", str(confirmed)])
    statuses = {p["number"]: p["status"] for p in failed["phases"]}
    if failed["verdict"] != "NOT_READY" or statuses[9] != "FAIL" or "FullRunNotStarted" not in reasons(failed, 10):
        fail(f"a failed canary did not stop NOT_READY before the full run: {statuses}")
    sneaked = evaluate("canary-failed-full", [*final_run_fixture(work / "sneaked", canary="FAIL", gate="APPROVED"), "--source-window", str(confirmed)])
    if {p["number"]: p["status"] for p in sneaked["phases"]}[10] != "FAIL":
        fail("a full run started after a failed canary was not a FAIL")
    pre = evaluate("pre-approved", [*final_run_fixture(work / "pre", gate="PRE_APPROVED"), "--source-window", str(confirmed)])
    if pre["verdict"] != "READY" or pre["finalValidation"]["fullRunApproval"]["kind"] != "owner-pre-approval":
        fail("an owner-pre-approved full run after a passing canary was not READY")
    fallback = evaluate("no-actual", [*final_run_fixture(work / "none", baseline="NONE"), "--source-window", str(confirmed)])
    if fallback["verdict"] != "READY" or "schema, row-count and reject-reason" not in reasons(fallback, 7):
        fail(f"a slice without a PROD actual did not fall back to stated schema/row-count checks: {fallback['verdict']}")
    no_upload = [a for a in final_run_fixture(work / "no-upload") if a not in ("--staging-upload", str(work / "no-upload" / "upload.json"))]
    result = evaluate("no-upload", [*no_upload, "--source-window", str(confirmed)])
    if result["verdict"] == "READY" or {p["number"]: p["status"] for p in result["phases"]}[3] != "BLOCKED":
        fail("a final run without an approved staging upload record was not BLOCKED")

    decisions = tmp / "owner-decisions.json"
    change = ["--product-change", "transform-reject-column"]
    blocked = evaluate("product-change", [*final_run_fixture(work / "pc"), "--source-window", str(confirmed), *change])
    silvally_io.write_json(decisions, {"acceptProductChanges": True})
    accepted = evaluate("product-change-accepted", [*final_run_fixture(work / "pc2"), "--source-window", str(confirmed), *change,
                                                    "--owner-decisions", str(decisions)])
    if blocked["verdict"] != "BLOCKED" or "UnacceptedProductChange" not in reasons(blocked, 6):
        fail("an unaccepted PRODUCT_CHANGE did not block")
    if accepted["verdict"] != "READY" or accepted["acceptedProductChanges"] != ["transform-reject-column"]:
        fail("an owner-accepted PRODUCT_CHANGE did not allow READY with the change flagged")
    silvally_io.write_json(decisions, {"costCeilingUsd": 1})
    over = evaluate("cost", [*final_run_fixture(work / "cost"), "--source-window", str(confirmed), "--owner-decisions", str(decisions)])
    if {p["number"]: p["status"] for p in over["phases"]}[3] != "FAIL":
        fail("a job ceiling above the owner's per-job cost ceiling did not fail phase 3")
    recent = source_window.data_days({"members": {"2099-01-05": 7, "2099-01-06": 13, "2099-01-08": 2}}, None, True,
                                     source_window.parse_utc("2099-01-08T06:00:00Z"))
    if recent["slices"]["members"]["day"] != "2099-01-06":
        fail(f"the most recent full UTC day with data ignored the day that has not ended: {recent}")
    days = work / "recent-days.json"
    silvally_io.write_json(days, recent)
    per_slice = [a for a in final_run_fixture(work / "recent") if a != str(work / "recent" / "slice-days.json")]
    per_slice[per_slice.index("--slice-days")] = "--slice-days=" + str(days)
    unasked = evaluate("recent-unasked", per_slice)
    silvally_io.write_json(decisions, {"windowSelection": "most-recent-full-utc-day-with-data-per-slice"})
    asked = evaluate("recent-asked", [*per_slice, "--owner-decisions", str(decisions)])
    if {p["number"]: p["status"] for p in unasked["phases"]}[1] != "BLOCKED":
        fail("a per-slice most-recent window without the owner's decision was not BLOCKED")
    if asked["verdict"] != "READY" or asked["finalValidation"]["sliceWindows"][0]["start"] != WINDOW["start"]:
        fail(f"the owner's per-slice window selection did not reach READY: {[(p['number'], p['reasons']) for p in asked['phases'] if p['status'] != 'PASS']}")
    results.append("evaluate_run canary-first validation: READY only after a passing canary, an approved full run and PROD-actuals comparison; "
                   "owner decisions for pre-approval, PRODUCT_CHANGE acceptance, cost ceiling and per-slice window")


def package_spec() -> dict:
    identity = {"id": "x", "revision": "0" * 40, "sha256": "sha256:" + "0" * 64}
    return {
        "profile": {"id": PROFILE.name, "revision": "0" * 40, "sha256": "sha256:" + "0" * 64},
        "discoveryTrace": [{"repository": "example/repo", "selectionMethod": "requested-ref", "materialization": "isolated-checkout",
                            "selectedCommitSha": "0" * 40, "pullRequestNumber": None, "requiredPathsVerified": True, "rejectedCandidateCommitShas": []}],
        "configurationPackage": {"id": "canon-to-omega", "version": "2.0.0",
                                 "transformProduct": {"name": "Transform", "version": "0" * 40, "sha256": "sha256:" + "0" * 64},
                                 "directions": [{"id": "canon-to-omega", "sourceLanguage": identity, "targetLanguage": identity,
                                                 "mapping": identity, "evidenceIds": ["plans"]}],
                                 "lexicon": identity, "sourceRevisions": [{"slug": "example/repo", "commitSha": "0" * 40}],
                                 "dependencies": [], "testEvidenceIds": ["repository-ci"], "deployedDigest": "sha256:" + "0" * 64,
                                 "unresolvedProductChangeHandoffs": [], "marketplaceRegistrationReady": False},
        "environment": {"name": "dev", "accountHash": "sha256:" + "0" * 64, "region": "xx-test-1", "writePolicy": "approval-required"},
        "sensitivity": {"classification": "public", "sanitization": "aggregates-and-digests-only", "containsRawPii": False, "containsSecrets": False},
        "datasets": [{"name": "member_report", "schemaSha256": "sha256:" + "2" * 64, "rowCount": 3, "contentSha256": "sha256:" + "3" * 64,
                      "location": "s3://example-dev-bucket/outputs/silvally-test/1/full/tables/member_report/"}],
        "graph": {"required": False, "identityUnique": True, "endpointCount": 0, "danglingEndpointCount": 0},
        "runtime": {"sparkVersion": "3.3.0", "transformRevision": "0" * 40, "deploymentDigest": "sha256:" + "0" * 64, "executionMode": "observed-dev"},
        "persistCanary": {"required": False, "status": "PASS", "evidenceIds": ["persist-not-invoked"]},
        "exporterHydration": {"required": False, "status": "PASS", "evidenceIds": ["not-required"]},
        "roundTrip": {"required": False, "status": "PASS", "evidenceIds": ["one-way"], "comparedFields": 3, "mismatchCount": 0},
        "phases": [{"number": n, "status": "PASS", "evidenceIds": ["final-prod-derived-validation"]} for n in range(1, 13)],
        "boundaryDecisions": [{"id": "mapping", "proposedChange": "Mapping configuration only", "classification": "CONFIGURATION",
                               "evidenceIds": ["plans"], "resolved": True, "handoffOwner": None}],
    }


def test_run_package(tmp: Path) -> None:
    if build_run_package.verdict_of([{"status": "PASS"}, {"status": "FAIL"}, {"status": "BLOCKED"}]) != "NOT_READY":
        fail("FAIL must yield NOT_READY")
    if build_run_package.verdict_of([{"status": "PASS"}, {"status": "APPROVAL_REQUIRED"}]) != "BLOCKED":
        fail("APPROVAL_REQUIRED must yield BLOCKED")
    if build_run_package.verdict_of([{"status": "PASS"}] * 12) != "READY":
        fail("all PASS must yield READY")
    empty_dir = tmp / "pkg-empty"
    empty_dir.mkdir()
    spec_path = tmp / "package-spec.json"

    def build(doc: dict, run_dir: Path, *extra: str) -> subprocess.CompletedProcess:
        spec_path.write_text(json.dumps(doc))
        return run_tool("build_run_package.py", "--run-dir", str(run_dir), "--package-spec", str(spec_path), *extra, check=False)

    unproven = build(package_spec(), empty_dir)
    if unproven.returncode == 0 or "READY requires the final PROD-derived DEV validation" not in unproven.stderr:
        fail("an all-PASS package without a canary and full run was accepted as READY")
    doc = package_spec()
    doc["phases"][11]["status"] = "BLOCKED"
    doc["remediations"] = [{"id": "run-final-prod-derived-validation", "findingCode": "FinalProdDerivedValidationRequired",
                            "status": "BLOCKED", "classification": "ACCESS_OR_EVIDENCE", "owner": "Silvally operator", "repository": None,
                            "locations": ["sourceWindowSelection"], "locationEvidenceIds": ["final-prod-derived-validation"],
                            "recommendedChange": "Confirm the PROD-derived window, run the canary, approve the full run, then rerun.",
                            "regressionEvidence": ["Approved DEV executions on the confirmed window match PROD actuals."],
                            "rerunPhases": [1, 9, 10, 11, 12], "rerunDirections": ["canon-to-omega"]}]
    result = build(doc, empty_dir)
    if result.returncode != 0 or json.loads(result.stdout)["verdict"] != "BLOCKED":
        fail(f"a package awaiting the final validation was not BLOCKED: {result.stderr[-800:]}")

    digest_d, digest_e, digest_f = ("sha256:" + c * 64 for c in "def")
    canary_dir, final_dir = tmp / "pkg-canary", tmp / "pkg-final"
    for directory, step, digest in ((canary_dir, "1-canary", digest_d), (final_dir, "1-full", digest_f)):
        silvally_io.write_json(directory / "steps.json", [{"step": step, "status": "SUCCEEDED", "verdict": "PASS",
                                                           "executionArn": f"arn:aws:states:xx-test-1:000000000000:execution:t:silvally-{step}",
                                                           "outputPrefix": f"s3://example-dev-bucket/outputs/silvally-test/{step}/", "outputs": []}])
        silvally_io.write_json(directory / "approvals" / f"{step}.json", {"operationDigest": digest, "mappingPin": {"mapping": "canon-to-omega@2.0.0"},
                                                                         "approval": {"operationDigest": digest, "status": "APPROVED",
                                                                                      "recordedAt": "2099-01-08T07:00:00Z"}})
        silvally_io.write_json(directory / "steps" / step / "history.json", {"events": []})
    final = package_spec()
    final["inputManifests"] = {"full": "sha256:" + "b" * 64, "canary": "sha256:" + "a" * 64}
    final["sourceWindowSelection"] = json.loads((tmp / "window-confirmed.json").read_text())
    final["finalValidation"] = {"kind": "prod-derived-dev", "status": "PASS", "prodAccess": "read-only", "sourceWindow": WINDOW,
                                "stagingApprovalDigests": [digest_e], "executionApprovalDigests": [digest_d, digest_f],
                                "inputManifestSha256s": ["sha256:" + "b" * 64],
                                "canary": {"status": "PASS", "eventsPerSlice": 10, "executionApprovalDigests": [digest_d]},
                                "fullRunApproval": {"status": "APPROVED", "kind": "user"},
                                "baseline": [{"slice": "members", "baselineKind": "iceberg-table", "status": "AVAILABLE"}],
                                "evidenceIds": ["final-prod-derived-validation"]}
    canary_arg = ["--canary-run-dir", str(canary_dir)]
    built = build(final, final_dir, *canary_arg)
    if built.returncode != 0 or json.loads(built.stdout)["verdict"] != "READY":
        fail(f"a canary-first PROD-derived package was not READY: {built.stderr[-800:]}")
    stages = [s["stage"] for s in json.loads((final_dir / "run.json").read_text())["executionSteps"]]
    if stages != ["canary", "full"]:
        fail(f"the run package did not record the canary and full stages: {stages}")
    if build(final, final_dir).returncode == 0:
        fail("a READY package without its canary executions was accepted")
    for label, patch in (("unapproved full run", {"fullRunApproval": {"status": "AWAITING_APPROVAL", "kind": None}}),
                         ("stale baseline", {"baseline": [{"slice": "members", "baselineKind": "iceberg-table", "status": "STALE"}]}),
                         ("missing approval digest", {"executionApprovalDigests": [digest_f]})):
        broken = json.loads(json.dumps(final))
        broken["finalValidation"].update(patch)
        if build(broken, final_dir, *canary_arg).returncode == 0:
            fail(f"a READY package with {label} was accepted")
    change = {"id": "transform-reject-column", "proposedChange": "Add a reject column in Transform", "classification": "PRODUCT_CHANGE",
              "evidenceIds": ["plans"], "resolved": False, "handoffOwner": "Kecleon"}
    unaccepted = json.loads(json.dumps(final))
    unaccepted["boundaryDecisions"].append(change)
    if build(unaccepted, final_dir, *canary_arg).returncode == 0:
        fail("a READY package with an unaccepted PRODUCT_CHANGE was accepted")
    unaccepted["boundaryDecisions"][-1]["ownerAccepted"] = True
    unaccepted["ownerDecisions"] = {"acceptProductChanges": True}
    unaccepted["acceptedProductChanges"] = ["transform-reject-column"]
    if build(unaccepted, final_dir, *canary_arg).returncode != 0:
        fail("a READY package with an owner-accepted PRODUCT_CHANGE was refused")
    final["versionSelection"] = VERSION_SELECTION
    built = build(final, final_dir, *canary_arg)
    if built.returncode != 0 or json.loads((final_dir / "run.json").read_text()).get("versionSelection") != VERSION_SELECTION:
        fail(f"the run package did not record the version selection: {built.stderr[-800:]}")
    final["versionSelection"] = {**VERSION_SELECTION, "pin": {"source": "published-registry"}}
    if build(final, final_dir, *canary_arg).returncode == 0:
        fail("a run package whose version selection has no digest pin was accepted")
    doc = package_spec()
    doc["phases"][8]["status"] = "FAIL"
    doc["verdict"] = "READY"
    if build(doc, empty_dir).returncode == 0:
        fail("a READY verdict with a FAIL phase was accepted")
    results.append("build_run_package verdict + schema + canary/full stages + PRODUCT_CHANGE acceptance + versionSelection")


def test_fetch_registry_with_shim(tmp: Path) -> None:
    """fetch_validation_inputs registry/ssm-names against a fake aws CLI (no network), parameters from --layout."""
    published = tmp / "published" / "canon-to-omega"
    shutil.copytree(CANDIDATE / "mappings" / "canon-to-omega", published)
    for version in published.iterdir():
        (version / "registration.json").rename(version / "mapping.json")
    env = aws_shim(tmp / "bin", f"""
if args[:2] == ["ssm", "get-parameter"]:
    assert args[args.index("--name") + 1] == "/registry/mappings-uri", args
    print(json.dumps({{"Parameter": {{"Value": "s3://example-registry/transform-mappings/"}}}}))
elif args[:2] == ["ssm", "get-parameters-by-path"]:
    assert args[args.index("--path") + 1] == "/registry", args
    print(json.dumps({{"Parameters": [{{"Name": "/registry/mappings-uri"}}, {{"Name": "/registry/omega-data-uri"}}]}}))
elif args[:2] == ["s3", "sync"]:
    shutil.copytree({str(published.parent)!r}, args[3], dirs_exist_ok=True)
elif args[:2] == ["s3api", "head-object"]:
    print(json.dumps({{"VersionId": "shim-version", "LastModified": "2099-01-01T00:00:00Z"}}))
else:
    sys.exit("unexpected aws call: " + " ".join(args))""")
    ws = tmp / "ws"
    layout = ["--layout", str(FIXTURE / "layout.json")]
    reg = json.loads(run_tool("fetch_validation_inputs.py", *layout, "registry", "--workspace", str(ws), "--label", "dev", "--profile", "example-dev", env=env).stdout)
    names = json.loads(run_tool("fetch_validation_inputs.py", *layout, "ssm-names", "--workspace", str(ws), "--label", "dev", "--profile", "example-dev", env=env).stdout)
    expected = sorted(f"canon-to-omega@{v.name}" for v in published.iterdir())
    if [m["mapping"] for m in reg["mappings"]] != expected or any(m["versionId"] != "shim-version" or len(m["sha256"]) != 64 for m in reg["mappings"]):
        fail(f"registry snapshot not pinned by sha256 + VersionId: {reg['mappings']}")
    if names["count"] != 2 or len(json.loads((ws / "inputs-manifest.json").read_text())) != 2:
        fail("ssm names or the inputs manifest were not recorded")
    results.append("fetch_validation_inputs registry/ssm-names from layout (shimmed aws)")


def test_canary_gate(tmp: Path) -> None:
    """transform_runs canary stage: the gate summarizes the canary, asks, and the full run refuses to start without it."""
    canary_dir, full_dir = tmp / "gate-canary", tmp / "gate-full"
    doc = json.loads(spec(tmp).read_text())
    silvally_io.write_json(tmp / "canary-spec.json", {**doc, "stage": "canary"})
    silvally_io.write_json(tmp / "full-spec.json", {**doc, "stage": "full"})
    run_tool("transform_runs.py", "cards", "--spec", str(tmp / "canary-spec.json"), "--run-dir", str(canary_dir))
    run_tool("transform_runs.py", "cards", "--spec", str(tmp / "full-spec.json"), "--run-dir", str(full_dir))
    card = json.loads(sorted((canary_dir / "cards").glob("1-*.json"))[0].read_text())
    if card["stage"] != "canary":
        fail("a canary card does not carry its stage")
    silvally_io.write_json(canary_dir / "steps.json", [{"step": "1-full", "status": "SUCCEEDED", "verdict": "PASS", "executionArn": "arn:x",
                                                        "outputPrefix": "s3://example-bucket/outputs/x/", "outputs": [{"dataset": "member_report", "physicalRows": 10}]}])
    silvally_io.write_json(canary_dir / "approvals" / "1-full.json", {**card, "approval": {"status": "APPROVED"}})
    passing, failing = tmp / "cmp-pass.json", tmp / "cmp-fail.json"
    silvally_io.write_json(passing, {"slice": "members", "baselineKind": "iceberg-table", "status": "PASS",
                                     "checks": [{"id": "prod-actuals-member_report", "status": "PASS", "devRows": 10, "prodRows": 10}]})
    silvally_io.write_json(failing, {"slice": "members", "baselineKind": "iceberg-table", "status": "FAIL",
                                     "checks": [{"id": "prod-actuals-member_report", "status": "FAIL", "devRows": 10, "prodRows": 9}]})

    def gate(label: str, comparison: Path, *extra: str) -> tuple[int, dict]:
        out = tmp / f"gate-{label}.json"
        result = run_tool("transform_runs.py", "canary-gate", "--canary-run-dir", str(canary_dir), "--comparison", str(comparison),
                          *extra, "--out", str(out), check=False)
        return result.returncode, json.loads(out.read_text())

    code, asked = gate("ask", passing)
    if code != 0 or asked["status"] != "AWAITING_APPROVAL" or asked["executions"][0]["rows"] != {"member_report": 10}:
        fail(f"a passing canary did not stop to ask with its execution, rows and comparison: {asked}")
    code, failed = gate("fail", failing)
    if code == 0 or failed["status"] != "CANARY_FAILED":
        fail("a failing canary comparison did not produce CANARY_FAILED")
    silvally_io.write_json(tmp / "decisions.json", {"preApproveFullRunOnCanaryPass": True})
    _, pre = gate("pre", passing, "--owner-decisions", str(tmp / "decisions.json"))
    _, pre_failed = gate("pre-fail", failing, "--owner-decisions", str(tmp / "decisions.json"))
    if pre["status"] != "PRE_APPROVED" or pre_failed["status"] != "CANARY_FAILED":
        fail("owner pre-approval must apply to a passing canary only")
    if run_tool("transform_runs.py", "approve-full", "--gate", str(tmp / "gate-fail.json"), "--approver", "t", "--scope", "t", check=False).returncode == 0:
        fail("a CANARY_FAILED gate was approved")
    shutil.copy(tmp / "gate-ask.json", tmp / "gate-awaiting.json")
    run_tool("transform_runs.py", "approve-full", "--gate", str(tmp / "gate-ask.json"), "--approver", "owner", "--scope", "run the full day")
    approved = json.loads((tmp / "gate-ask.json").read_text())
    if approved["status"] != "APPROVED" or approved["approval"]["kind"] != "user":
        fail("the user's approval of the full run was not recorded")
    digest = json.loads(sorted((full_dir / "cards").glob("1-*.json"))[0].read_text())["operationDigest"]
    start = ["transform_runs.py", "start", "--run-dir", str(full_dir), "--approver", "t", "--scope", "t", "--approve", digest]
    for label, extra, message in (("no gate", [], "CanaryRequired"), ("failed gate", ["--canary-gate", str(tmp / "gate-fail.json")], "CanaryGateNotApproved"),
                                  ("awaiting gate", ["--canary-gate", str(tmp / "gate-awaiting.json")], "CanaryGateNotApproved")):
        refused = run_tool(*start, *extra, check=False)
        if refused.returncode == 0 or message not in refused.stderr:
            fail(f"a full-window start with {label} was not refused")
    tampered = {**approved, "canaryRunId": "other"}
    silvally_io.write_json(tmp / "gate-tampered.json", tampered)
    if "CanaryGateNotApproved" not in run_tool(*start, "--canary-gate", str(tmp / "gate-tampered.json"), check=False).stderr:
        fail("a gate changed after approval was accepted")
    env = aws_shim(tmp / "gate-bin", """
if args[:2] == ["stepfunctions", "start-execution"]:
    print(json.dumps({"executionArn": "arn:x"}))
else:
    sys.exit("unexpected aws call: " + " ".join(args))""")
    if run_tool(*start, "--canary-gate", str(tmp / "gate-ask.json"), env=env).stdout.count("STARTED") != 1:
        fail("an approved canary gate did not allow the approved full-window execution")
    silvally_io.write_json(tmp / "cost-spec.json", {**doc, "ownerCostCeilingUsd": 1})
    over = run_tool("transform_runs.py", "cards", "--spec", str(tmp / "cost-spec.json"), "--run-dir", str(tmp / "cost-run"), check=False)
    if over.returncode == 0 or "CostCeilingExceeded" not in over.stderr:
        fail("a job ceiling above the owner's per-job cost ceiling was accepted")
    results.append("transform_runs canary gate: ask, CANARY_FAILED stop, owner pre-approval, full start refused without an approved gate, cost ceiling")


def test_prod_actuals(tmp: Path) -> None:
    function = "example-upload"

    def event(execution: str, eid: int, prev: int, kind: str, details: dict, ts: int = 4070995200000) -> dict:
        return {"execution_arn": execution, "id": str(eid), "previous_event_id": str(prev), "type": kind,
                "event_timestamp": str(ts), "details": details}
    messages = [
        event("e1", 5, 4, "LambdaFunctionScheduled", {"resource": f"arn:aws:lambda:xx:0:function:{function}", "input": json.dumps({"s3Key": "k1"})}),
        event("e1", 6, 5, "LambdaFunctionStarted", {}),
        event("e1", 7, 6, "LambdaFunctionSucceeded", {"output": json.dumps({"id": "r1", "value": "v1", "nested": {"note": "n1"}})}),
        event("e2", 5, 4, "LambdaFunctionScheduled", {"resource": f"arn:aws:lambda:xx:0:function:{function}", "input": json.dumps({"s3Key": "k2"})}),
        event("e2", 6, 5, "LambdaFunctionStarted", {}),
        event("e2", 7, 6, "LambdaFunctionFailed", {"error": "RuntimeError"}),
        event("e3", 5, 4, "LambdaFunctionScheduled", {"resource": "arn:aws:lambda:xx:0:function:other", "input": "{}"}),
        event("e3", 7, 5, "LambdaFunctionSucceeded", {"output": "{}"}),
    ]
    rows = prod_actuals.pair_outcomes(messages, function)
    if [(r["outcome"], r["input"]["s3Key"]) for r in rows] != [("accepted", "k1"), ("rejected", "k2")] or rows[1]["error"] != "RuntimeError":
        fail(f"Lambda results were not paired with their scheduled inputs of the named function: {rows}")
    if rows[0]["actual"]["nested"]["note"] != "n1" or prod_actuals.dig(rows[0], "actual.nested.note") != "n1":
        fail("the Lambda output was not parsed into a navigable actual")
    events = [{"eventTime": f"2099-01-06T{h:02d}:00:00Z", "outcome": "rejected" if h % 5 == 0 else "accepted", "input": {"s3Key": f"k{h}"}}
              for h in range(24)]
    first = prod_actuals.canary_select(events, "eventTime", "input.s3Key", "outcome", 10)
    again = prod_actuals.canary_select(list(reversed(events)), "eventTime", "input.s3Key", "outcome", 10)
    if first != again or len(first) != 10:
        fail("the canary sample is not deterministic or not 10 events")
    outcomes = [e["outcome"] for e in first]
    if outcomes.count("rejected") != 5 or outcomes[:2] != ["accepted", "rejected"]:
        fail(f"the canary did not mix accepted and rejected outcomes round-robin: {outcomes}")
    if len(prod_actuals.canary_select(events[:3], "eventTime", "input.s3Key", "outcome", 10)) != 3:
        fail("a window with fewer than 10 events did not select all of them")
    private = tmp / "actuals-private"
    prod_actuals.private_dir(private)
    prod_actuals.write_jsonl(private / "events.jsonl", rows)
    catalog = {"slices": {"upload": {"baselineKind": "state-machine-lambda-outcomes", "outputDatasets": ["report", "report_rejects"],
                                     "key": {"dataset": ["id"], "actual": ["id"]}, "fieldMap": {"id": "id", "value": "value", "note": "nested.note"},
                                     "rejects": {"dataset": "report_rejects", "key": "s3_key_sha256", "actualOutcome": "rejected"}}}}
    silvally_io.write_json(tmp / "catalog.json", catalog)
    report, rejects = tmp / "dev-report", tmp / "dev-rejects"
    report.mkdir()
    rejects.mkdir()
    (report / "part-00000.csv").write_text("id|value|note\nr1|v1|n1\n")
    k2 = __import__("hashlib").sha256(b"k2").hexdigest()
    (rejects / "part-00000.csv").write_text(f"s3_key_sha256|reason\n{k2}|MISSING_S3_KEY\n")

    def compare(label: str, *extra: str) -> tuple[int, dict]:
        out = tmp / f"actuals-{label}.json"
        result = run_tool("prod_actuals.py", "compare", "--catalog", str(tmp / "catalog.json"), "--slice", "upload",
                          "--actual", str(private / "events.jsonl"), "--dataset", f"report={report}",
                          "--dataset", f"report_rejects={rejects}", *extra, "--out", str(out), check=False)
        return result.returncode, json.loads(out.read_text())
    code, matched = compare("match")
    if code != 0 or [c["kind"] for c in matched["checks"]] != ["matches-prod-actuals", "rejects-cover-prod-failures"]:
        fail(f"DEV outputs equal to what PROD did were not a PASS: {matched}")
    (report / "part-00000.csv").write_text("id|value|note\nr1|v1|changed\nr9|v9|n9\n")
    code, differs = compare("differs")
    check = differs["checks"][0]
    if code == 0 or check["mismatchedByColumn"] != {"note": 1} or check["onlyDev"] != 1:
        fail(f"a DEV value or row that PROD did not produce was not reported: {check}")
    (rejects / "part-00000.csv").write_text("s3_key_sha256|reason\n")
    code, missed = compare("missed-reject")
    if code == 0 or missed["checks"][1]["prodFailuresNotRejected"] != 1:
        fail("a PROD failure without a DEV reject was not reported")
    (report / "part-00000.csv").write_text("id|value|note\nr1|v1|changed\n")
    (rejects / "part-00000.csv").write_text(f"s3_key_sha256|reason\n{k2}|MISSING_S3_KEY\n")
    code, allowed = compare("allowed", "--allow-column", "note=recorded owner exception")
    if code != 0 or allowed["checks"][0]["allowedColumns"] != {"note": "recorded owner exception"}:
        fail("an allowed column was not excluded and recorded")
    selected = tmp / "selected.jsonl"
    prod_actuals.write_jsonl(selected, [{"input": {"s3Key": "k1", "debt": ""}, "actual": {"resolved": "d1"}}])
    run_tool("prod_actuals.py", "inputs", "--events", str(selected), "--bind", "debt=actual.resolved", "--out-dir", str(tmp / "canary-inputs"))
    staged = json.loads((tmp / "canary-inputs" / "part-00000.jsonl").read_text())
    if staged != {"s3Key": "k1", "debt": "d1"}:
        fail(f"the canary input did not take the value PROD resolved for an empty field: {staged}")
    days = source_window.data_days({"a": {"2099-01-04": 3, "2099-01-07": 1}, "b": {"2099-01-06": 9}}, "2099-01-06", False,
                                   source_window.parse_utc("2099-01-08T06:00:00Z"))
    if days["emptySlices"] != ["a"] or days["slices"]["a"]["nearestDayWithData"] != "2099-01-07":
        fail(f"an empty slice did not get the nearest UTC day with data: {days}")
    results.append("prod_actuals Lambda pairing, deterministic mixed canary, keyed comparison with rejects, bound inputs; data-days")


def test_stage_package(tmp: Path) -> None:
    pkg = tmp / "pkg"
    (pkg / "members").mkdir(parents=True)
    (pkg / "members" / "part-00000.jsonl").write_text("".join(json.dumps({"member_id": f"m{i}"}) + "\n" for i in range(4)))
    prefix = "s3://example-bucket/inputs/alpha-prod-derived/20990106T000000Z_20990107T000000Z_canary_v1/"
    card = json.loads(run_tool("stage_evidence_package.py", "manifest", "--dir", str(pkg), "--prefix", prefix).stdout)
    manifest = json.loads((pkg / "manifest.json").read_text())
    members = next(o for o in manifest["objects"] if o["dataset"] == "members")
    if card["status"] != "APPROVAL_REQUIRED" or members["rows"] != 4:
        fail(f"staging manifest or card wrong: {card} {manifest}")
    wrong = run_tool("stage_evidence_package.py", "upload", "--dir", str(pkg), "--prefix", prefix, "--profile", "example-dev",
                     "--approve", "sha256:" + "0" * 64, check=False)
    if wrong.returncode == 0 or "does not match" not in wrong.stderr:
        fail("upload with a non-matching approval digest was not refused")
    (pkg / "members" / "extra.jsonl").write_text('{"member_id":"m9"}\n')
    changed = run_tool("stage_evidence_package.py", "upload", "--dir", str(pkg), "--prefix", prefix, "--profile", "example-dev",
                       "--approve", card["operationDigest"], check=False)
    if changed.returncode == 0 or "package changed" not in changed.stderr:
        fail("upload of a package changed after its manifest was not refused")
    results.append("stage_evidence_package manifest + refusals")


def test_spec_from_intent(tmp: Path) -> None:
    """Cases come from the registration: per-output positives per binding, full runs, one negative per required input."""
    env = aws_shim(tmp / "spec-bin", """
if args[:2] == ["stepfunctions", "list-state-machines"]:
    print(json.dumps({"stateMachines": [{"name": "Example-transform-pipeline", "stateMachineArn": "arn:aws:states:xx-test-1:000000000000:stateMachine:Example-transform-pipeline"}]}))
elif args[:2] == ["s3", "ls"]:
    tables = {"s3://example-bucket/inputs/full/": ["vertex-member", "vertex-ledger", "edge-member-has-ledger"],
              "s3://example-bucket/inputs/members-only/": ["vertex-member"],
              "s3://example-bucket/inputs/empty/": []}[args[2]]
    print("\\n".join("                           PRE " + t + "/" for t in tables))
else:
    sys.exit("unexpected aws call: " + " ".join(args))""")
    ws = tmp / "spec-ws"
    registry = ws / "registry-dev" / "canon-to-omega" / "2.0.0"
    registry.mkdir(parents=True)
    shutil.copy(PROJECTION, registry / "mapping.json")
    silvally_io.write_json(ws / "inputs-manifest.json", [
        {"kind": "materialized", "name": "candidate", "path": str(ws / "registry-dev"), "mappings": [{"mapping": "canon-to-omega@2.0.0", "sha256": "a" * 64}]},
        {"kind": "registry", "name": "dev", "path": str(ws / "registry-dev"), "mappings": [{"mapping": "canon-to-omega@2.0.0", "sha256": "b" * 64, "versionId": "old"}]},
    ])
    silvally_io.write_json(tmp / "intent.json", {"status": "RESOLVED", "selectedProfile": None, "selection": {"selected": "canon-to-omega@2.0.0"}})
    out = tmp / "derived-spec.json"
    run_tool("transform_runs.py", "spec-from-intent", "--intent", str(tmp / "intent.json"), "--workspace", str(ws), "--profile", "example-dev",
             "--bind", "full=s3://example-bucket/inputs/full/", "--bind", "members-only=s3://example-bucket/inputs/members-only",
             "--bind", "empty=s3://example-bucket/inputs/empty/", "--run-id", "20990101T000000Z", "--out", str(out), env=env)
    doc = json.loads(out.read_text())
    cases = {c["case"]: c for c in doc["cases"]}
    expected_positive = {"full-full", "full-member-report-only", "full-ledger-summary-only", "members-only-member-report-only"}
    expected_negative = {"neg-member-report-without-vertex-member", "neg-ledger-summary-without-vertex-member",
                         "neg-ledger-summary-without-vertex-ledger", "neg-ledger-summary-without-edge-member-has-ledger"}
    if set(cases) != expected_positive | expected_negative:
        fail(f"derived cases wrong: {sorted(cases)}")
    negative = cases["neg-ledger-summary-without-vertex-ledger"]
    if negative["missingInput"] != "vertex-ledger" or {i["table"] for i in negative["request"]["inputs"]} != {"vertex-member", "edge-member-has-ledger"}:
        fail("a negative case must omit exactly its missing input")
    if cases["full-full"]["request"]["outputDatasets"] != ["ledger_summary", "member_report"]:
        fail("the full case must request every registered output")
    if doc["outputFormats"] != {"member_report": {"type": "csv", "delimiter": ";", "header": True}, "ledger_summary": {"type": "jsonl"}}:
        fail(f"output formats not taken from the registration: {doc['outputFormats']}")
    if not any(s.get("binding") == "empty" for s in doc["skipped"]) or not any(s.get("dataset") == "ledger_summary" and s["binding"] == "members-only" for s in doc["skipped"]):
        fail(f"bindings that cannot run an output were not reported: {doc['skipped']}")
    if doc["outputRoot"] != "s3://example-bucket/outputs/silvally-canon-to-omega/":
        fail("default output root is not derived from the binding bucket and mapping id")
    if doc["deployment"]["drift"] != "digest-differs":
        fail("a published digest that differs from the candidate build was not reported as drift")
    run_dir = tmp / "drift-run"
    run_tool("transform_runs.py", "cards", "--spec", str(out), "--run-dir", str(run_dir))
    digest = json.loads(sorted((run_dir / "cards").glob("1-*.json"))[0].read_text())["operationDigest"]
    blocked = run_tool("transform_runs.py", "start", "--run-dir", str(run_dir), "--approver", "t", "--scope", "t", "--approve", digest, check=False)
    if blocked.returncode == 0 or "DeploymentDrift" not in blocked.stderr:
        fail("start was not refused under deployment drift")
    silvally_io.write_json(tmp / "slice-intent.json", {
        "status": "RESOLVED", "selectedProfile": None, "selection": {"selected": "canon-to-omega@2.0.0"},
        "slices": [{"id": "members", "outputDatasets": ["member_report"]},
                   {"id": "ledgers", "outputDatasets": ["ledger_summary"]}],
    })
    slice_out = tmp / "slice-spec.json"
    run_tool("transform_runs.py", "spec-from-intent", "--intent", str(tmp / "slice-intent.json"), "--workspace", str(ws),
             "--profile", "example-dev", "--bind", "full=s3://example-bucket/inputs/full/", "--negatives", "none",
             "--run-id", "20990101T000000Z", "--out", str(slice_out), env=env)
    slice_cases = {c["case"]: c for c in json.loads(slice_out.read_text())["cases"]}
    if set(slice_cases) != {"full-members", "full-ledgers"}:
        fail(f"named slices derived a full-package run or per-output cases: {sorted(slice_cases)}")
    if slice_cases["full-members"]["request"]["outputDatasets"] != ["member_report"]:
        fail("the members slice did not request only its datasets")
    if slice_cases["full-ledgers"]["request"]["outputDatasets"] != ["ledger_summary"]:
        fail("the ledgers slice did not request only its datasets")
    prod_spec = json.loads(out.read_text())
    prod_spec["environment"] = "prod"
    prod_spec["deployment"] = {"registry": "dev", "drift": None}
    silvally_io.write_json(tmp / "prod-spec.json", prod_spec)
    prod_dir = tmp / "prod-run"
    run_tool("transform_runs.py", "cards", "--spec", str(tmp / "prod-spec.json"), "--run-dir", str(prod_dir))
    digest = json.loads(sorted((prod_dir / "cards").glob("1-*.json"))[0].read_text())["operationDigest"]
    refused = run_tool("transform_runs.py", "start", "--run-dir", str(prod_dir), "--approver", "t", "--scope", "t",
                       "--approve", digest, check=False)
    if refused.returncode == 0 or "PROD Transform is never invoked" not in refused.stderr:
        fail("a PROD Transform start was not refused")
    results.append("transform_runs spec-from-intent: registration-derived cases, automatic negatives, drift refusal")


def test_regress(tmp: Path) -> None:
    def run(directory: Path, rows: int, digest: str, name: str) -> None:
        request = {"contractVersion": 2, "outputDatasets": ["member_report"], "inputs": [{"table": "vertex-member", "s3Uri": "s3://b/in/vertex-member/"}]}
        silvally_io.write_json(directory / "run-spec.json", {"cases": [{"case": name, "mapping": "canon-to-omega@2.0.0", "expected": "PASS", "request": request}]})
        silvally_io.write_json(directory / "steps.json", [{"step": f"1-{name}", "verdict": "PASS",
                                                           "outputs": [{"dataset": "member_report", "physicalRows": rows, "contentSha256": digest}]}])
    base, same, changed = tmp / "base", tmp / "same", tmp / "changed"
    run(base, 3, "a" * 64, "old-name")
    run(same, 3, "a" * 64, "new-name")
    run(changed, 3, "c" * 64, "new-name")
    ok = run_tool("transform_runs.py", "regress", "--run-dir", str(same), "--baseline", str(base), check=False)
    bad = run_tool("transform_runs.py", "regress", "--run-dir", str(changed), "--baseline", str(base), check=False)
    if ok.returncode != 0 or json.loads(ok.stdout)["identical"] != 1:
        fail("a renamed but identical case did not match its baseline by inputs and outputs")
    if bad.returncode == 0 or json.loads(bad.stdout)["changed"] != 1:
        fail("a changed output digest was not reported as a regression")
    results.append("transform_runs regress by case signature")


def main() -> int:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        test_io_guards()
        test_transform_runs_cards(tmp)
        test_compare(tmp)
        test_canary_gate(tmp)
        test_prod_actuals(tmp)
        test_resolve_fixture(tmp)
        test_evaluate_rules(tmp)
        test_source_window(tmp)
        test_final_prod_derived_validation(tmp)
        test_run_package(tmp)
        test_fetch_registry_with_shim(tmp)
        test_stage_package(tmp)
        test_spec_from_intent(tmp)
        test_regress(tmp)
    print("Silvally tool tests passed: " + "; ".join(results))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
