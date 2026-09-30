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
    if transform_runs.rejection_ok(rejected, ["ResolvePlan"], "Required input dataset 'vertex-member' is missing", "vertex-member") != (True, True):
        fail("a pre-job rejection naming the omitted input was not accepted")
    if transform_runs.rejection_ok(rejected, ["ValidateRequest"], "ZodError: inputs invalid", "vertex-member") != (True, False):
        fail("a pre-job rejection with a generic error must pass (Transform error-message quality is only a flag)")
    if transform_runs.rejection_ok(rejected, ["ResolvePlan", "RunTransformJob"], "vertex-member", "vertex-member")[0]:
        fail("a failure after the Transform job started satisfied a rejection case")
    if transform_runs.rejection_ok({"status": "SUCCEEDED"}, ["ResolvePlan"], None, "vertex-member")[0]:
        fail("a succeeded execution satisfied a rejection case")
    silvally_io.write_json(tmp / "other-spec.json", {**json.loads(spec(tmp).read_text()), "runId": "20990102T000000Z"})
    reused = run_tool("transform_runs.py", "cards", "--spec", str(tmp / "other-spec.json"), "--run-dir", str(run_dir), check=False)
    if reused.returncode == 0 or "RunDirectoryReused" not in reused.stderr:
        fail("a run directory of another run was reused")
    stray = tmp / "stray-run"
    stray.mkdir()
    (stray / "prior-session.txt").write_text("x")
    leftover = run_tool("transform_runs.py", "cards", "--spec", str(spec(tmp)), "--run-dir", str(stray), check=False)
    if leftover.returncode == 0 or "RunDirectoryNotEmpty" not in leftover.stderr:
        fail("a run directory holding another session's files was used")
    results.append("transform_runs approval gate + rejection semantics + run-directory ownership")


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
    closure = run_tool("compare_datasets.py", "closure", "--slice", "*", "--vertex", f"node={v}", "--edge", f"link={e}:node:node", check=False)
    report = json.loads(closure.stdout)
    if closure.returncode == 0 or report["danglingEndpointCount"] != 1 or report["endpointCount"] != 4:
        fail(f"graph closure did not count the dangling endpoint: {report}")
    keyless = tmp / "keyless"
    keyless.mkdir()
    (keyless / "part-00000.json").write_text('{"body": "a"}\n{"body": "a"}\n')
    contracts = tmp / "keyless-contracts.json"
    contracts.write_text(json.dumps({"mapping": "m@1.0.0", "outputs": [
        {"dataset": "log_rows", "shape": "tabular", "columnSource": "language-definition", "columns": ["body"], "format": {"type": "jsonl"}}]}))
    keyless_profile = tmp / "keyless-profile.json"
    keyless_profile.write_text(json.dumps({"invariants": [{"id": "log-unique", "failureCode": "DuplicateKey",
                                                           "check": {"kind": "unique-key", "dataset": "log_rows"}}]}))
    checked = json.loads(run_tool("compare_datasets.py", "check", "--slice", "*", "--contracts", str(contracts), "--profile", str(keyless_profile),
                                  "--dataset", f"log_rows={keyless}", check=False).stdout)
    if checked["status"] != "PASS" or any(c["kind"] == "unique-key" and c["status"] != "NOT_APPLICABLE" for c in checked["checks"]):
        fail(f"a dataset that declares no key failed the duplicate-key check: {checked}")
    results.append("compare_datasets diff/parts/format/closure (csv + jsonl); keyless datasets skip the unique-key check")


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
    silvally_io.write_json(work / "upload.json", {"manifest": prefix + "manifest.json", "manifestFileSha256": "b" * 64,
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
    if "nearest UTC day with data on both sides is 2099-01-05" not in reasons(evaluate("empty-reason", [*final_run_fixture(work / "empty2", empty_slice=True),
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
    expected_negative = {"neg-ledger-summary-without-vertex-member", "neg-ledger-summary-without-vertex-ledger",
                         "neg-ledger-summary-without-edge-member-has-ledger"}
    if set(cases) != expected_positive | expected_negative:
        fail(f"derived cases wrong: {sorted(cases)}")
    if not any(s.get("case") == "neg-member-report-without-vertex-member" and "OmissionLeavesNoInputs" in s["reason"] for s in doc["skipped"]):
        fail("omitting the only required input (inputs: []) was not skipped and recorded")
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
    one_slice = tmp / "one-slice-spec.json"
    run_tool("transform_runs.py", "spec-from-intent", "--intent", str(tmp / "slice-intent.json"), "--workspace", str(ws),
             "--profile", "example-dev", "--bind", "full=s3://example-bucket/inputs/full/", "--slice", "ledgers",
             "--run-id", "20990101T000000Z", "--out", str(one_slice), env=env)
    one = json.loads(one_slice.read_text())
    if one["slices"] != ["ledgers"] or {c.get("slice") for c in one["cases"]} != {"ledgers"} or \
            not any(c["expected"] == "REJECTED" for c in one["cases"]):
        fail(f"a one-slice spec did not label every case (negatives included) with its slice: {one['cases']}")
    for outputs, expected in ((["member_report,ledger_summary"], 2), (["member_report", "ledger_summary"], 2), (["member_report"], 1)):
        target = tmp / "outputs-spec.json"
        run_tool("transform_runs.py", "spec-from-intent", "--intent", str(tmp / "intent.json"), "--workspace", str(ws), "--profile",
                 "example-dev", "--bind", "full=s3://example-bucket/inputs/full/", "--negatives", "none",
                 *[a for o in outputs for a in ("--outputs", o)], "--run-id", "20990101T000000Z", "--out", str(target), env=env)
        produced = {d for c in json.loads(target.read_text())["cases"] for d in c["request"]["outputDatasets"]}
        if len(produced) != expected:
            fail(f"--outputs {outputs} selected {sorted(produced)}")
    unknown = run_tool("transform_runs.py", "spec-from-intent", "--intent", str(tmp / "intent.json"), "--workspace", str(ws), "--profile",
                       "example-dev", "--bind", "full=s3://example-bucket/inputs/full/", "--outputs", "member_report,nope",
                       "--out", str(tmp / "unknown-spec.json"), env=env, check=False)
    if unknown.returncode == 0 or "unregistered outputs ['nope']" not in unknown.stderr:
        fail("an unknown --outputs name did not fail")
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


def test_per_slice_evaluation(tmp: Path) -> None:
    """Each slice has its own window, canary gate, full run and verdict; the overall verdict needs every slice READY."""
    work = tmp / "per-slice"
    root = "s3://example-dev-bucket/outputs/silvally-test/"
    days = {"members": "2099-01-06", "ledgers": "2099-01-04"}
    token = {n: f"{d}T000000Z_2099-01-{int(d[-2:]) + 1:02d}T000000Z" for n, d in days.items()}
    silvally_io.write_json(work / "intent.json", {
        "status": "RESOLVED", "selectedProfile": PROFILE.name, "primaryDirection": {"to": "omega", "outputShape": "tabular"},
        "workflow": {"steps": [{"mapping": "canon-to-omega@2.0.0"}]}, "findings": [],
        "conceptChecks": {"canon-to-omega@2.0.0": [{"state": "active"}]},
        "sqlScan": {"canon-to-omega@2.0.0": {"queriesScanned": 2, "forbiddenLabels": []}},
        "slices": [{"id": "members", "outputDatasets": ["member_report"]}, {"id": "ledgers", "outputDatasets": ["ledger_summary"]}],
        "ownerDecisions": {"windowSelection": "most-recent-full-utc-day-with-data-per-slice", "preApproveFullRunOnCanaryPass": True}})
    silvally_io.write_json(work / "ws" / "inputs-manifest.json", [{"kind": "repository", "name": "r", "commitSha": "c" * 40,
                                                                  "requiredPathsVerified": True}])
    silvally_io.write_json(work / "days.json", source_window.data_days({"members": {days["members"]: 5}, "ledgers": {days["ledgers"]: 3}},
                                                                        None, True, source_window.parse_utc("2099-01-08T06:00:00Z")))
    args = ["--intent", str(work / "intent.json"), "--profile", str(PROFILE), "--workspace", str(work / "ws"),
            "--slice-days", str(work / "days.json"), "--catalog", str(work / "no-catalog.json"), "--mode", "observed-dev"]

    def slice_run(name: str, canary_ok: bool, full: bool, flag: bool = False) -> list[str]:
        out = []
        for stage in ("canary", "full") if full else ("canary",):
            directory = work / f"{name}-{stage}"
            cases = [{"case": f"{name}-{stage}", "slice": name}, {"case": f"neg-{name}", "slice": name}]
            silvally_io.write_json(directory / "run-spec.json", {"stage": stage, "profile": "example-dev", "outputRoot": root,
                                                                 "slices": [name], "cases": cases,
                                                                 "bindings": {name: f"s3://example-dev-bucket/inputs/{token[name]}_{stage}_{name}_v1/"}})
            ok = canary_ok or stage == "full"
            steps = [{"step": f"1-{name}-{stage}", "status": "SUCCEEDED", "verdict": "PASS" if ok else "FAIL", "mappingPinMatches": True},
                     {"step": f"2-neg-{name}", "status": "FAILED", "verdict": "PASS", "expected": "REJECTED",
                      **({"productChangeFlag": {"id": "transform-reject-error-unnamed"}} if flag else {})}]
            silvally_io.write_json(directory / "steps.json", steps)
            for i, step in enumerate(steps):
                digest = "sha256:" + hashlib_hex(f"{name}{stage}{i}")
                silvally_io.write_json(directory / "approvals" / f"{step['step']}.json", {"approval": {
                    "operationDigest": digest, "status": "APPROVED", "kind": "owner-blanket-dev-writes", "recordedAt": "2099-01-08T07:00:00Z"}})
            out += [f"--{'canary-run-dir' if stage == 'canary' else 'run-dir'}", f"{name}={directory}"]
            report = {"slice": name, "baselineKind": "iceberg-table", "status": "PASS" if ok else "FAIL",
                      "checks": [{"id": f"prod-actuals-{name}", "status": "PASS" if ok else "FAIL"}]}
            silvally_io.write_json(work / f"{name}-{stage}-compare.json", report)
            out += [f"--{'canary-comparison' if stage == 'canary' else 'actuals-comparison'}", str(work / f"{name}-{stage}-compare.json")]
        gate = {"slice": name, "status": "PRE_APPROVED" if canary_ok else "CANARY_FAILED", "approval": {"kind": "owner-pre-approval"}}
        silvally_io.write_json(work / f"{name}-gate.json", gate)
        silvally_io.write_json(work / f"{name}-sample.json", {"slice": name, "eventsSelected": 10, "selectionDigest": "sha256:" + "1" * 64})
        silvally_io.write_json(work / f"{name}-actuals.json", {"slice": name, "baselineKind": "iceberg-table", "status": "AVAILABLE"})
        silvally_io.write_json(work / f"{name}-upload.json", {"slice": name, "manifest": f"s3://example-dev-bucket/inputs/{token[name]}_v1/manifest.json",
                                                             "manifestFileSha256": "b" * 64, "matchesLocal": True, "approvalKind": "owner-blanket-dev-writes",
                                                             "approvalOperationDigest": "sha256:" + hashlib_hex(name)})
        return out + ["--canary-gate", str(work / f"{name}-gate.json"), "--canary-sample", str(work / f"{name}-sample.json"),
                      "--prod-actuals", str(work / f"{name}-actuals.json"), "--staging-upload", str(work / f"{name}-upload.json")]

    def evaluate(label: str, extra: list[str], decisions: dict) -> dict:
        silvally_io.write_json(work / f"{label}-decisions.json", decisions)
        run_tool("evaluate_run.py", *args, *extra, "--owner-decisions", str(work / f"{label}-decisions.json"),
                 "--out", str(work / f"{label}.json"), check=False)
        return json.loads((work / f"{label}.json").read_text())

    base = {"windowSelection": "most-recent-full-utc-day-with-data-per-slice", "preApproveFullRunOnCanaryPass": True,
            "blanketDevWrites": "staging-and-executions-for-this-run"}
    both = evaluate("both", slice_run("members", True, True, flag=True) + slice_run("ledgers", True, True), base)
    if both["verdict"] != "READY" or both["slices"]["members"]["verdict"] != "READY" or both["slices"]["ledgers"]["window"]["start"] != "2099-01-04T00:00:00Z":
        fail(f"two passing slices on their own windows were not READY: {[(p['number'], p['reasons']) for p in both['phases'] if p['status'] != 'PASS']}")
    if both["productChangeFlags"] != ["transform-reject-error-unnamed"]:
        fail("a negative refused with a generic error was not flagged as a Transform product change")
    mixed = evaluate("mixed", slice_run("members", True, True) + slice_run("ledgers", False, False), base)
    reasons = " ".join(r for p in mixed["phases"] for r in p["reasons"])
    if mixed["slices"]["members"]["verdict"] != "READY" or mixed["slices"]["ledgers"]["verdict"] == "READY" or mixed["verdict"] == "READY":
        fail(f"a failed canary of one slice changed another slice's verdict or passed overall: {mixed['slices']}")
    if "[members] FAIL" in reasons or "was started although" in reasons:
        fail("a slice whose own gate was PRE_APPROVED was failed for another slice's canary")
    unapproved = evaluate("no-blanket", slice_run("members", True, True) + slice_run("ledgers", True, True),
                          {k: v for k, v in base.items() if k != "blanketDevWrites"})
    if unapproved["verdict"] == "READY" or "blanket DEV approval the owner did not give" not in json.dumps(unapproved["phases"]):
        fail("blanket DEV approvals without the owner's decision were accepted")
    catalog = tmp / "sensitive-catalog.json"
    silvally_io.write_json(catalog, {"slices": {"members": {"sensitiveFields": {"inputs": ["vertex-member.name"]}}}})
    args[args.index("--catalog") + 1] = str(catalog)
    sensitive = evaluate("sensitive", slice_run("members", True, True) + slice_run("ledgers", True, True), base)
    if sensitive["slices"]["members"]["verdict"] != "BLOCKED" or "SensitiveStagingDecisionRequired" not in json.dumps(sensitive["phases"]) \
            or sensitive["slices"]["ledgers"]["verdict"] != "READY":
        fail("a sensitive slice without the owner's staging decision was not blocked on its own")
    allowed = evaluate("sensitive-ok", slice_run("members", True, True) + slice_run("ledgers", True, True),
                       {**base, "sensitiveFieldStaging": "stage-real-values-to-dev"})
    if allowed["verdict"] != "READY":
        fail("the owner's sensitive-field staging decision did not let the sensitive slice reach READY")
    results.append("evaluate_run per-slice gates, windows and verdicts; blanket DEV approvals; sensitive staging decision; "
                   "unnamed-reject product-change flag")


def hashlib_hex(value: str) -> str:
    return __import__("hashlib").sha256(value.encode()).hexdigest()


GRAPH_CONTRACTS = {"inputs": [
    {"table": "vertex-member", "graphKind": "vertex", "label": "member", "requiredColumns": ["~id", "member_id:String", "name:String"],
     "optionalColumns": []},
    {"table": "vertex-ledger", "graphKind": "vertex", "label": "ledger", "requiredColumns": ["~id", "amount:Double"], "optionalColumns": []},
    {"table": "edge-member-has-ledger", "graphKind": "edge", "label": "member_has_ledger",
     "requiredColumns": ["~id", "~from", "~to", "created_at:DateTime", "rank:Int"], "optionalColumns": [],
     "endpoints": {"from": "vertex-member", "to": "vertex-ledger"}},
    {"table": "edge-ledger-has-artifact", "graphKind": "edge", "label": "ledger_has_artifact",
     "requiredColumns": ["~id", "~from", "~to", "uri:String", "content_sha256:String", "body_selector:String", "effective_at:DateTime"],
     "optionalColumns": [], "endpoints": {"from": "vertex-ledger", "to": "vertex-ledger"}},
    {"table": "hydrated_artifact", "format": "jsonl"}]}


def test_graph_inputs(tmp: Path) -> None:
    import graph_inputs
    body = b'{"body": "hello"}'
    digest = hashlib_hex(body.decode())
    vertices = {"m1": {"id": "m1", "label": "member", "member_id": "M1", "name": "Ann"},
                "m2": {"id": "m2", "label": "member", "member_id": "M2", "name": "Bob"},
                "l1": {"id": "l1", "label": "ledger", "amount": 1.5}, "l2": {"id": "l2", "label": "ledger", "amount": 2.0}}
    edges = [{"id": "e1", "label": "member_has_ledger", "OUT": {"id": "m1"}, "IN": {"id": "l1"}, "created_at": 4070908800000, "rank": "1"},
             {"id": "e2", "label": "member_has_ledger", "OUT": {"id": "m2"}, "IN": {"id": "l2"}, "created_at": "2099-02-01T00:00:00Z", "rank": 2},
             {"id": "a1", "label": "ledger_has_artifact", "OUT": {"id": "l1"}, "IN": {"id": "l1"}, "uri": "s3://prod-bucket/a1",
              "content_sha256": digest, "body_selector": "JSON_BODY", "effective_at": "2099-01-06T10:00:00Z"},
             {"id": "a2", "label": "ledger_has_artifact", "OUT": {"id": "l2"}, "IN": {"id": "l2"}, "uri": "s3://prod-bucket/a2",
              "content_sha256": digest, "body_selector": "TEXT", "effective_at": "2099-01-05T10:00:00Z"}]
    queries = []

    def query(gremlin: str) -> list:
        queries.append(gremlin)
        graph_inputs.assert_read_only(gremlin)
        if gremlin.startswith("g.V().hasLabel('member')"):
            wanted = set(re.findall(r"'([^']+)'", gremlin.split("within(")[1]))
            return [v for v in vertices.values() if v.get("member_id") in wanted]
        ids = set(re.findall(r"'([^']+)'", gremlin.split(")")[0]))
        label = re.search(r"(?:outE|inE)\('([^']+)'\)", gremlin).group(1)
        side, other = ("OUT", "IN") if ".outE(" in gremlin else ("IN", "OUT")
        return [{"e": e, "v": vertices[e[other]["id"]]} for e in edges if e["label"] == label and e[side]["id"] in ids]

    import re
    catalog = tmp / "graph-catalog.json"
    plan = {"root": {"dataset": "vertex-member", "keyProperty": "member_id", "actualKey": "member_id"},
            "hops": [{"edge": "edge-member-has-ledger", "from": "vertex-member", "direction": "out"},
                     {"edge": "edge-ledger-has-artifact", "from": "vertex-ledger", "direction": "out", "window": "effective_at", "prune": True}]}
    hydration = {"dataset": "hydrated_artifact", "edge": "edge-ledger-has-artifact",
                 "columns": {"artifact_uri": "uri", "content_sha256": "content_sha256", "body_selector": "body_selector"},
                 "uriColumn": "artifact_uri", "sha256Column": "content_sha256", "selectorColumn": "body_selector", "bodyColumn": "msg"}
    silvally_io.write_json(catalog, {"slices": {"members": {"graphInputs": plan, "hydration": hydration,
                                                            "sensitiveFields": {"inputs": ["hydrated_artifact.msg"]}}}})
    silvally_io.write_json(tmp / "graph-contracts.json", GRAPH_CONTRACTS)
    (tmp / "graph-events.jsonl").write_text('{"member_id": "M1"}\n{"member_id": "M2"}\n{"member_id": "M1"}\n')

    def build(label: str, decisions: dict | None, **extra) -> dict:
        silvally_io.write_json(tmp / f"graph-{label}-decisions.json", decisions or {})
        ns = __import__("argparse").Namespace(
            command="gremlin", contracts=str(tmp / "graph-contracts.json"), catalog=str(catalog), slice="members",
            events=str(tmp / "graph-events.jsonl"), keys_file=None, profile="example-prod", region="xx-test-1",
            window_start=extra.get("start"), window_end_exclusive=extra.get("end"), as_of=extra.get("as_of"),
            owner_decisions=str(tmp / f"graph-{label}-decisions.json"), max_elements=extra.get("max_elements", 1000),
            private_dir=str(tmp / f"graph-{label}-private"), out_dir=str(tmp / f"graph-{label}-pkg"), out=str(tmp / f"graph-{label}.json"))
        return graph_inputs.build(ns, source=graph_inputs.GremlinSource(query), fetch=lambda uri: body)

    try:
        build("undecided", {})
        fail("a sensitive slice was built without the owner's sensitive-field staging decision")
    except silvally_io.SilvallyError as error:
        if "SensitiveStagingDecisionRequired" not in str(error) or queries:
            fail("the sensitive-field refusal did not happen before any PROD read")
    decided = {"sensitiveFieldStaging": "stage-real-values-to-dev"}
    summary = build("window", decided, start="2099-01-06T00:00:00Z", end="2099-01-07T00:00:00Z")
    rows = {d: s["rows"] for d, s in summary["datasets"].items()}
    if summary["status"] != "BUILT" or summary["danglingEndpointCount"] != 0 or rows != {
            "vertex-member": 2, "vertex-ledger": 1, "edge-member-has-ledger": 1, "edge-ledger-has-artifact": 1, "hydrated_artifact": 1}:
        fail(f"the windowed, pruned graph build is wrong: {summary}")
    import pyarrow.parquet as pq
    edge = pq.read_table(tmp / "graph-window-pkg" / "edge-member-has-ledger" / "part-00000.parquet").to_pylist()[0]
    if edge != {"~id": "e1", "~label": "member_has_ledger", "~from": "m1", "~to": "l1", "created_at:DateTime": "2099-01-01T00:00:00.000Z", "rank:Int": 1}:
        fail(f"graph values were not copied into the Transform column shape: {edge}")
    hydrated = json.loads((tmp / "graph-window-pkg" / "hydrated_artifact" / "part-00000.jsonl").read_text())
    if hydrated["msg"] != "hello" or hydrated["artifact_uri"] != "s3://prod-bucket/a1":
        fail(f"the artifact body was not hydrated with its selector: {hydrated}")
    as_of = build("asof", decided, as_of="2099-01-15T00:00:00Z")
    if as_of["droppedAfterAsOf"].get("edge-member-has-ledger") != 1 or as_of["datasets"]["edge-member-has-ledger"]["rows"] != 1:
        fail(f"--as-of did not drop the edge created after the cutoff: {as_of}")
    try:
        build("bounded", decided, max_elements=2)
        fail("a graph read above --max-elements was accepted")
    except silvally_io.SilvallyError as error:
        if "GraphReadUnbounded" not in str(error):
            raise
    for bad in ("x') .drop() //", "a b"):
        try:
            graph_inputs.quote(bad)
            fail(f"an unsafe key {bad!r} entered a Gremlin query")
        except silvally_io.SilvallyError:
            pass
    try:
        graph_inputs.assert_read_only("g.V('a').drop()")
        fail("a mutating Gremlin step was sent")
    except silvally_io.SilvallyError:
        pass
    if graph_inputs.results_of({"data": {"results": [1]}}) != [1] or graph_inputs.results_of({"result": {"data": [2]}}) != [2]:
        fail("Persist Gremlin response shapes were not recognized")
    results.append("graph_inputs bounded read-only Gremlin build: window + prune, as-of cutoff, closure, hydration, bounds, "
                   "sensitive-field decision, injection and mutation refusals")


def test_prod_actuals_catalog(tmp: Path) -> None:
    catalog = json.loads((SKILL / "reference" / "prod-actuals.json").read_text())
    dsa = [{"last_update": f"2099-01-06T{h:02d}:00:00Z", "debt_id": f"d{h}", "delete_date": "2099-01-06" if h % 3 == 0 else None}
           for h in range(12)]
    chosen = prod_actuals.canary_select(dsa, "last_update", "debt_id", "delete_date", 10, "presence", catalog["slices"]["dsa"]["canary"]["outcomeLabels"])
    outcomes = {prod_actuals.outcome_of(e, "delete_date", "presence", {"absent": "active", "present": "deleted"}) for e in chosen}
    if outcomes != {"active", "deleted"}:
        fail(f"the DSA canary did not group by active versus deleted: {outcomes}")
    m2d = {"input": {"s3Key": "raw/k"}, "outcome": "rejected"}
    if prod_actuals.key_of(m2d, catalog["slices"]["m2d"]["canary"]["eventKeyField"]) != "raw/k" or \
            prod_actuals.key_of({"input": {"classifiedKey": "c/k", "s3Key": "raw/k"}}, ["input.classifiedKey", "input.s3Key"]) != "c/k":
        fail("the M2D canary key does not fall back from input.classifiedKey to input.s3Key")
    events = tmp / "sms-events.jsonl"
    rows = [{"sent_date": "2099-01-06 10:00:00", "vendor_tracking_code": f"t{i}", "txt_msg_vendor_id": 67, "vendor_result": "OK",
             "debt_id": f"d{i}", "phone_number": "(555) 010-0000", "msg": "m", "txt_msg_template_id": "", "txt_msg_log_id": i} for i in range(3)]
    rows += [{"sent_date": "2099-01-06 11:00:00", "vendor_tracking_code": None, "txt_msg_vendor_id": 34, "vendor_result": "Sent",
              "debt_id": "x", "txt_msg_log_id": 9}]
    rows += [{"sent_date": "2099-01-06 12:00:00", "vendor_tracking_code": None, "txt_msg_vendor_id": 67, "vendor_result": "OPTED_OUT",
              "debt_id": "d9", "phone_number": "5550100000", "msg": "stop", "txt_msg_template_id": "", "txt_msg_log_id": 12}]
    prod_actuals.write_jsonl(events, rows)
    sample = json.loads(run_tool("prod_actuals.py", "canary-sample", "--events", str(events), "--slice", "sms", "--catalog",
                                 str(SKILL / "reference" / "prod-actuals.json"), "--private-out", str(tmp / "sms-private" / "sel.jsonl"),
                                 "--out", str(tmp / "sms-sample.json")).stdout)
    if sample["eventsInPopulation"] != 4 or sample["eventsSelected"] != 4 or sample["eventsWithoutKey"] != 0:
        fail(f"the SMS canary did not keep the QUIQ vendor population with the fallback key: {sample}")
    dev = tmp / "dev-sms"
    dev.mkdir()
    header = "debt_id|phone_number|msg|sent_date|vendor_result|txt_msg_template_id|vendor_tracking_code|te_id|interaction_identifier"
    body = [f"d{i}|5550100000|m|2099-01-06T10:00:00.000Z|OK||t{i}|x|y" for i in range(3)]
    body += ["d9|5550100000|stop|2099-01-06T12:00:00.000Z|OPTED_OUT||||z", "d7|5550100000|m|2099-01-06T13:00:00.000Z|OK||t7|x|y"]
    (dev / "part-00000.csv").write_text(header + "\n" + "\n".join(body) + "\n")

    def compare(label: str, *extra: str) -> dict:
        run_tool("prod_actuals.py", "compare", "--catalog", str(SKILL / "reference" / "prod-actuals.json"), "--slice", "sms",
                 "--actual", str(events), "--dataset", f"{catalog['slices']['sms']['outputDatasets'][0]}={dev}", *extra, "--out", str(tmp / f"sms-{label}.json"), check=False)
        return json.loads((tmp / f"sms-{label}.json").read_text())["checks"][0]
    full = compare("full")
    if full["status"] != "FAIL" or full["onlyDev"] != 1 or full["keyCoverage"]["prodFallback"] != 1 or full["mismatchedByColumn"]:
        fail(f"the SMS comparison did not key by tracking code with the composite fallback and normalized dates/phones: {full}")
    canary = compare("canary", "--dev-scope", "actual-keys")
    if canary["status"] != "PASS" or canary["devRowsOutOfScope"] != 1:
        fail(f"the canary comparison did not restrict DEV rows to the sampled events: {canary}")
    silvally_io.write_json(tmp / "rows.json", {"snapshotTimestampMs": 4071081600000 + 86400000 * 30, "dataMax": "2099-01-05_12-20-52",
                                               "rows": [{"debt_id": "d1"}]})
    run_tool("prod_actuals.py", "table-summary", "--rows", str(tmp / "rows.json"), "--slice", "dsa", "--catalog",
             str(SKILL / "reference" / "prod-actuals.json"), "--end-exclusive", "2099-01-07T00:00:00Z", "--out", str(tmp / "stale.json"), check=False)
    stale = json.loads((tmp / "stale.json").read_text())
    if stale["status"] != "STALE" or stale["mostRecentCoveredDay"] != "2099-01-04" or stale["handoff"]["code"] != "ProdMirrorStale":
        fail(f"a re-committed snapshot with stale data was not STALE with the covered day and a handoff: {stale}")
    silvally_io.write_json(tmp / "rows-nodata.json", {"snapshotTimestampMs": 4102444800000, "rows": [{"debt_id": "d1"}]})
    run_tool("prod_actuals.py", "table-summary", "--rows", str(tmp / "rows-nodata.json"), "--slice", "dsa", "--catalog",
             str(SKILL / "reference" / "prod-actuals.json"), "--end-exclusive", "2099-01-07T00:00:00Z", "--out", str(tmp / "unproven.json"), check=False)
    if json.loads((tmp / "unproven.json").read_text())["status"] != "STALE":
        fail("snapshot freshness alone satisfied a catalog that declares a data timestamp column")
    covered = source_window.data_days({"dsa": {"2099-01-04": 3, "2099-01-05": 7, "2099-01-06": 2}}, None, True,
                                      source_window.parse_utc("2099-01-08T06:00:00Z"), {"dsa": "2099-01-05T12:20:52Z"})
    if covered["slices"]["dsa"]["day"] != "2099-01-04" or "handoffs" not in covered["slices"]["dsa"]:
        fail(f"the per-slice day ignored the PROD actual's data cutoff: {covered}")
    probes = tmp / "probe-count"
    env = aws_shim(tmp / "probe-bin", f"""
count = {str(probes)!r}
import os
n = int(open(count).read()) if os.path.exists(count) else 0
open(count, "w").write(str(n + 1))
assert "--no-paginate" in args, args
start = int(args[args.index("--start-time") + 1])
has = start == 4070822400000
print(json.dumps({{"events": [{{"message": "{{}}"}}] if has else [], "nextToken": None}}))""")
    run_tool("prod_actuals.py", "probe-days", "--profile", "example-prod", "--region", "xx-test-1", "--log-group", "lg", "--function-name", "f",
             "--slice", "m2d", "--now", "2099-01-03T06:00:00Z", "--out", str(tmp / "probe.json"), env=env)
    probed = json.loads((tmp / "probe.json").read_text())
    if probed != {"m2d": {"2099-01-02": 0, "2099-01-01": 0, "2098-12-31": 1}} or open(probes).read() != "3":
        fail(f"probe-days did not stop at the newest day with data: {probed}")
    results.append("prod_actuals catalog: DSA active/deleted outcomes, M2D key fallback, SMS vendor population + composite key + "
                   "normalization + canary scope, data freshness with covered day, newest-first day probe")


def test_unattended_intake(tmp: Path) -> None:
    work = tmp / "unattended"
    work.mkdir()
    catalog = work / "actuals.json"
    silvally_io.write_json(catalog, {"slices": {"members": {"inputBuilder": "graph_inputs.py", "baselineKind": "iceberg-table"},
                                                "ledgers": {"inputBuilder": "graph_inputs.py", "baselineKind": "iceberg-table"}}})
    request = ("validate canon to omega for members and ledgers; owner decisions: most recent full UTC day with data per slice; "
               "full run pre-approved if the canary passes; DEV writes approved; stage real phone numbers and message bodies to DEV")
    common = ["--request", request, "--slice-catalog", str(FIXTURE / "package-slices.json"), "--prod-actuals-catalog", str(catalog)]
    intent = resolve(work, "discover", *common)
    decisions = intent["ownerDecisions"]
    if decisions.get("blanketDevWrites") != "staging-and-executions-for-this-run" or decisions.get("sensitiveFieldStaging") != "stage-real-values-to-dev":
        fail(f"the blanket DEV-write and sensitive-staging decisions were not parsed: {decisions}")
    codes = {f["code"] for f in intent["findings"]}
    if "UpstreamSourceUnresolved" in codes or "UpstreamSourceDefaulted" not in codes or \
            any(q["id"] == "upstream-source" for q in intent["questions"]):
        fail(f"catalogued input builders did not become the default upstream source: {codes}")
    draft = resolve(work, "draft-profile", *common)
    silvally_io.write_json(work / "intent.json", intent)
    silvally_io.write_json(work / "draft.json", draft)
    promote = ["resolve-transform-intent.py", "promote-run-profile", "--draft", str(work / "draft.json"), "--slice-catalog",
               str(FIXTURE / "package-slices.json"), "--prod-actuals-catalog", str(catalog)]
    run_tool(*promote, "--intent", str(work / "intent.json"), "--out", str(work / "profile.json"))
    profile = json.loads((work / "profile.json").read_text())
    if profile["status"] != "PROMOTED" or profile["draft"]["promotionEligible"] is not True or profile["draft"]["unresolvedFacts"]:
        fail(f"owner decisions and resolved intent did not promote a run-scoped profile: {profile}")
    import jsonschema
    jsonschema.validate(profile["draft"], json.loads((SKILL / "reference" / "transform-configuration-profile-draft.schema.json").read_text()))
    silvally_io.write_json(work / "no-window.json", {**intent, "ownerDecisions": {k: v for k, v in decisions.items() if k != "windowSelection"}})
    blocked = run_tool(*promote, "--intent", str(work / "no-window.json"), "--out", str(work / "blocked.json"), check=False)
    if blocked.returncode == 0 or json.loads((work / "blocked.json").read_text())["status"] != "BLOCKED":
        fail("a run-scoped profile was promoted without the owner's window decision")
    silvally_io.write_json(work / "unknown.json", {**intent, "slices": [*intent["slices"], {"id": "other", "outputDatasets": []}]})
    if run_tool(*promote, "--intent", str(work / "unknown.json"), "--out", str(work / "unknown-out.json"), check=False).returncode == 0:
        fail("a run-scoped profile was promoted for an uncatalogued slice")
    run_tool("evaluate_run.py", "--intent", str(work / "intent.json"), "--profile", str(work / "profile.json"), "--out", str(work / "phases.json"),
             check=False)
    phase1 = json.loads((work / "phases.json").read_text())["phases"][0]
    if "run-scoped profile" not in " ".join(phase1["reasons"]) or "no selected or promoted profile" in " ".join(phase1["reasons"]):
        fail(f"phase 1 did not accept the promoted run-scoped profile: {phase1}")
    identity = build_run_package.profile_identity(str(work / "profile.json"))
    if identity["id"] != profile["id"] or identity["revision"] != "run-scoped":
        fail(f"the run package cannot identify the run-scoped profile: {identity}")
    results.append("unattended intake: owner decisions (blanket DEV writes, sensitive staging), default upstream source, "
                   "run-scoped promotion (fail-closed), phase 1 and run-package identity")


def test_run_workspace(tmp: Path) -> None:
    root = tmp / "runs"
    first = json.loads(run_tool("run_workspace.py", "new", "--root", str(root), "--label", "lexicon interprose").stdout)
    second = json.loads(run_tool("run_workspace.py", "new", "--root", str(root), "--label", "lexicon interprose").stdout)
    if first["runDir"] == second["runDir"] or not first["runId"].startswith("lexicon-interprose-"):
        fail("two runs shared a run directory")
    for run in (first, second):
        (Path(run["privateDir"]) / "rows.jsonl").write_text("{}\n")
    run_tool("run_workspace.py", "cleanup", "--run-dir", first["runDir"])
    if Path(first["privateDir"]).exists() or not (Path(second["privateDir"]) / "rows.jsonl").exists():
        fail("cleanup removed another run's private rows or kept its own")
    if run_tool("run_workspace.py", "cleanup", "--run-dir", str(root), check=False).returncode == 0:
        fail("cleanup ran on a directory that is not a run directory")
    results.append("run_workspace unique run directories and run-scoped cleanup")


def test_stage_decisions(tmp: Path) -> None:
    pkg = tmp / "sens-pkg"
    (pkg / "vertex-contact").mkdir(parents=True)
    (pkg / "vertex-contact" / "part-00000.jsonl").write_text('{"x": 1}\n')
    prefix = "s3://example-bucket/inputs/x/2099-01-06T000000Z_2099-01-07T000000Z_canary_sms_v1/"
    run_tool("stage_evidence_package.py", "manifest", "--dir", str(pkg), "--prefix", prefix)
    silvally_io.write_json(tmp / "blanket.json", {"blanketDevWrites": "staging-and-executions-for-this-run"})
    refused = run_tool("stage_evidence_package.py", "upload", "--dir", str(pkg), "--prefix", prefix, "--profile", "example-dev",
                       "--owner-decisions", str(tmp / "blanket.json"), "--slice", "sms", check=False)
    if refused.returncode == 0 or "SensitiveStagingDecisionRequired" not in refused.stderr:
        fail("SMS inputs were staged without the owner's sensitive-field staging decision")
    unapproved = run_tool("stage_evidence_package.py", "upload", "--dir", str(pkg), "--prefix", prefix, "--profile", "example-dev", check=False)
    if unapproved.returncode == 0 or "--approve" not in unapproved.stderr:
        fail("an upload without a card approval or a blanket decision was accepted")
    results.append("stage_evidence_package blanket DEV approval and sensitive-field refusal")


def test_unattended_run_findings(tmp: Path) -> None:
    """Tool gaps an unattended canon-to-omega run hit: paging, stale handoff, digests, labels, private rows,
    real stop causes, slice-scoped evidence, per-slice regression and summed cost."""
    import graph_inputs
    import re
    work = tmp / "unattended"

    # 1. Paged Persist reads merged into one dataset per table: 503s are retried, a failing page is split, shared
    #    vertices are deduplicated across pages, and the merged result has zero dangling endpoints.
    members = [f"M{i:02d}" for i in range(1, 13)]
    vertices = {f"m{i:02d}": {"id": f"m{i:02d}", "label": "member", "member_id": m, "name": f"Debtor {i}"} for i, m in enumerate(members, 1)}
    vertices.update({"l-shared": {"id": "l-shared", "label": "ledger", "amount": 912.44},
                     **{f"l{i:02d}": {"id": f"l{i:02d}", "label": "ledger", "amount": 100.0 + i} for i in range(3, 13)}})
    ledger_of = {f"m{i:02d}": ("l-shared" if i <= 2 else f"l{i:02d}") for i in range(1, 13)}
    edges = [{"id": f"e{m}", "label": "member_has_ledger", "OUT": {"id": m}, "IN": {"id": l}, "created_at": "2026-09-05T08:00:00Z", "rank": 1}
             for m, l in ledger_of.items()]
    edges += [{"id": f"a{l}", "label": "ledger_has_artifact", "OUT": {"id": l}, "IN": {"id": l}, "uri": f"s3://prod/{l}",
               "content_sha256": "0" * 64, "body_selector": "TEXT", "effective_at": "2026-09-05T12:30:00Z"} for l in sorted(set(ledger_of.values()))]
    calls = {"n": 0}

    def query(gremlin: str) -> list:
        calls["n"] += 1
        values = re.findall(r"'([^']+)'", gremlin.split("within(")[1] if "within(" in gremlin else gremlin.split(")")[0])
        if len(values) > 3 or calls["n"] == 2:
            raise graph_inputs.TransientPersistError("HTTP 503")
        if gremlin.startswith("g.V().hasLabel('member')"):
            return [v for v in vertices.values() if v.get("member_id") in values]
        label = re.search(r"(?:outE|inE)\('([^']+)'\)", gremlin).group(1)
        return [{"e": e, "v": vertices[e["IN"]["id"]]} for e in edges if e["label"] == label and e["OUT"]["id"] in values]

    catalog = work / "catalog.json"
    silvally_io.write_json(catalog, {"slices": {"sms": {"graphInputs": {
        "root": {"dataset": "vertex-member", "keyProperty": "member_id", "actualKey": "member_id"},
        "hops": [{"edge": "edge-member-has-ledger", "from": "vertex-member", "direction": "out"},
                 {"edge": "edge-ledger-has-artifact", "from": "vertex-ledger", "direction": "out", "window": "effective_at", "prune": True}]}}}})
    contracts = {"inputs": [c for c in GRAPH_CONTRACTS["inputs"] if c["table"] != "hydrated_artifact"]}
    silvally_io.write_json(work / "contracts.json", contracts)
    silvally_io.write_json(work / "decisions.json", {})
    (work / "keys.txt").write_text("\n".join(members + members[:4]) + "\n")

    def build(label: str, start: str, end: str, source) -> dict:
        ns = __import__("argparse").Namespace(
            command="gremlin", contracts=str(work / "contracts.json"), catalog=str(catalog), slice="sms", events=None,
            keys_file=str(work / "keys.txt"), window_start=start, window_end_exclusive=end, as_of=None,
            owner_decisions=str(work / "decisions.json"), max_elements=1000, private_dir=str(work / f"{label}-private"),
            out_dir=str(work / f"{label}-pkg"), out=str(work / f"{label}.json"))
        return graph_inputs.build(ns, source=source)

    source = graph_inputs.GremlinSource(query, batch_size=4, retries=2, backoff=0, sleep=lambda _: None)
    paged = build("paged", "2026-09-05T00:00:00Z", "2026-09-06T00:00:00Z", source)
    rows = {d: s["rows"] for d, s in paged["datasets"].items()}
    if paged["status"] != "BUILT" or paged["danglingEndpointCount"] != 0 or rows != {
            "vertex-member": 12, "vertex-ledger": 11, "edge-member-has-ledger": 12, "edge-ledger-has-artifact": 11}:
        fail(f"paged Persist reads were not merged into one closed dataset per table: {paged}")
    paging = paged["paging"]
    if paging["batchSize"] != 4 or paging["retries"] < 1 or paging["splits"] < 1 or paging["duplicatesMerged"] < 1:
        fail(f"paging did not retry the 503, split the failing page and deduplicate the shared ledger: {paging}")
    if any(len(list((work / "paged-pkg" / d).glob("part-*"))) != 1 for d in rows):
        fail("a paged build wrote more than one part per table")
    try:
        graph_inputs.GremlinSource(lambda _: (_ for _ in ()).throw(graph_inputs.TransientPersistError("HTTP 503")),
                                   batch_size=2, retries=1, backoff=0, sleep=lambda _: None).roots("member", "member_id", ["M01", "M02"])
        fail("a page that never recovers was accepted")
    except silvally_io.SilvallyError as error:
        if "PersistUnavailable" not in str(error):
            raise
    try:
        graph_inputs.merge({"x": {"id": "x", "properties": {"a": 1}}}, {"id": "x", "properties": {"a": 2}}, {"duplicatesMerged": 0})
        fail("two pages that disagree about one ~id were merged")
    except silvally_io.SilvallyError as error:
        if "ConflictingDuplicate" not in str(error):
            raise
    calls["n"] = 0
    empty = build("empty", "2026-09-13T00:00:00Z", "2026-09-14T00:00:00Z", graph_inputs.GremlinSource(query, 3, 2, 0, lambda _: None))
    if empty["status"] != "INPUT_EMPTY" or empty["inputEmpty"]["code"] != "UpstreamInputEmpty":
        fail(f"a window without status edges was not INPUT_EMPTY: {empty}")

    # 2 and 6. data-days: the stale-mirror handoff is emitted whenever the cutoff precedes the requested day, and a day
    #    needs rows on both the PROD-actual and the input side (Interprose mirror ends 09-06, Persist edges start 09-13).
    now = source_window.parse_utc("2026-09-30T19:00:00Z")
    actual = {"sms": {"2026-09-04": 3, "2026-09-05": 16, "2026-09-06": 1}, "dsa": {"2026-09-29": 41}}
    inputs = {"sms": {"2026-09-13": 40, "2026-09-20": 12, "2026-09-29": 7}, "dsa": {"2026-09-29": 41}}
    cutoff = {"sms": "2026-09-06T21:14:00Z"}
    no_later_rows = source_window.data_days({"sms": actual["sms"]}, None, True, now, cutoff)
    if no_later_rows["slices"]["sms"]["day"] != "2026-09-05" or \
            [h["code"] for h in no_later_rows["slices"]["sms"].get("handoffs", [])] != ["ProdMirrorStale"]:
        fail(f"a stale mirror without later rows did not record the data-platform handoff: {no_later_rows}")
    both = source_window.data_days(actual, None, True, now, cutoff, inputs)
    sms = both["slices"]["sms"]
    if both["emptySlices"] != ["sms"] or sms["status"] != "INPUT_EMPTY" or sms["inputDays"] != {"first": "2026-09-13", "last": "2026-09-29"} \
            or {h["code"] for h in sms["handoffs"]} != {"UpstreamInputEmpty", "ProdMirrorStale"} or both["slices"]["dsa"]["status"] != "HAS_DATA":
        fail(f"a slice whose actual and input days never meet was not INPUT_EMPTY with both handoffs: {both}")
    confirmed = source_window.data_days(actual, "2026-09-05", False, now, cutoff, inputs)
    if confirmed["slices"]["sms"]["status"] != "INPUT_EMPTY" or confirmed["slices"]["sms"]["inputRows"] != 0:
        fail(f"a confirmed day without input rows was not INPUT_EMPTY: {confirmed}")

    # 3 and 4. Distinct manifest digests, and datasets labelled by the directory that holds them.
    pkg = work / "stage-pkg"
    for rel, body in (("derived/message_log/message_log.jsonl", '{"vendor_tracking_code": "Q-1"}\n'),
                      ("vertex-account/part-00000.parquet", "PAR1"), ("edge-message-status-changed/day=2026-09-05/part-00000.jsonl", "{}\n")):
        (pkg / rel).parent.mkdir(parents=True, exist_ok=True)
        (pkg / rel).write_text(body)
    prefix = "s3://example-dev-bucket/inputs/lexicon-prod-derived/2026-09-05T000000Z_2026-09-06T000000Z_canary_sms_v1/"
    card = json.loads(run_tool("stage_evidence_package.py", "manifest", "--dir", str(pkg), "--prefix", prefix).stdout)
    labels = {o["key"]: o["dataset"] for o in json.loads((pkg / "manifest.json").read_text())["objects"]}
    if labels != {"derived/message_log/message_log.jsonl": "message_log", "vertex-account/part-00000.parquet": "vertex-account",
                  "edge-message-status-changed/day=2026-09-05/part-00000.jsonl": "edge-message-status-changed"}:
        fail(f"manifest datasets are not labelled by their dataset directory: {labels}")
    if "manifestSha256" in card or not card.get("manifestCanonicalSha256", "").startswith("sha256:"):
        fail(f"the staging card does not name its canonical-JSON manifest digest distinctly: {card}")
    env = aws_shim(work / "stage-bin", f"""
if args[:2] == ["s3", "cp"]:
    shutil.copy({str(pkg / 'manifest.json')!r}, args[3])
print(json.dumps({{"VersionId": "v1"}}) if args[:2] == ["s3api", "head-object"] else "{{}}")
""")
    silvally_io.write_json(work / "blanket.json", {"blanketDevWrites": "staging-and-executions-for-this-run"})
    upload = json.loads(run_tool("stage_evidence_package.py", "upload", "--dir", str(pkg), "--prefix", prefix, "--profile", "example-dev",
                                 "--owner-decisions", str(work / "blanket.json"), env=env).stdout)
    if "manifestSha256" in upload or upload["manifestFileSha256"] != silvally_io.sha256_file(pkg / "manifest.json") \
            or upload["manifestCanonicalSha256"] != card["manifestCanonicalSha256"]:
        fail(f"the upload result does not separate the file digest from the canonical digest: {upload}")

    # 5. Captured DEV output rows live under the run's private/ and are removed by cleanup.
    run = json.loads(run_tool("run_workspace.py", "new", "--root", str(work / "runs"), "--label", "lexicon interprose sms").stdout)
    run_dir = Path(run["runDir"]) / "canary-sms"
    case = {"case": "window-sms", "mapping": "canon-to-omega@2.0.0", "slice": "sms", "expected": "PASS",
            "request": {"outputDatasets": ["message_log"], "inputs": [{"table": "vertex-account", "s3Uri": prefix + "vertex-account/"}]}}
    spec = {"runId": "20260930T190000Z", "stage": "canary", "stateMachineArn": "arn:aws:states:xx-test-1:1:stateMachine:dev-transform-pipeline",
            "outputRoot": "s3://example-dev-bucket/outputs/silvally-test/", "profile": "example-dev", "region": "xx-test-1",
            "mappings": {"canon-to-omega@2.0.0": {"sha256": "a" * 64}}, "slices": ["sms"], "cases": [case],
            "outputFormats": {"message_log": {"type": "csv", "delimiter": "|", "header": True}}}
    silvally_io.write_json(run_dir / "run-spec.json", spec)
    silvally_io.write_json(run_dir / "approvals" / "1-window-sms.started.json", {})
    env = aws_shim(work / "capture-bin", """
import os
if args[:2] == ["stepfunctions", "describe-execution"]:
    print(json.dumps({"status": "SUCCEEDED", "executionArn": args[3], "startDate": "s", "stopDate": "t"}))
elif args[:2] == ["stepfunctions", "get-execution-history"]:
    print(json.dumps({"events": []}))
elif args[:2] == ["s3", "sync"]:
    table = os.path.join(args[3], "tables", "message_log")
    os.makedirs(table, exist_ok=True)
    open(os.path.join(table, "part-00000.csv"), "w").write("debt_id|phone_number|msg\\n900000101|5551234567|Your balance is due\\n")
    json.dump({"datasets": [{"dataset": "message_log", "rowCount": 1, "fileCount": 1}]}, open(os.path.join(args[3], "_metadata.json"), "w"))
else:
    print("")
""")
    run_tool("transform_runs.py", "capture", "--run-dir", str(run_dir), env=env)
    step = json.loads((run_dir / "steps.json").read_text())[0]
    private_rows = Path(run["privateDir"]) / "outputs" / spec["runId"] / "window-sms" / "tables" / "message_log" / "part-00000.csv"
    if not private_rows.exists() or (run_dir / "out").exists() or Path(step["privateOutputDir"]).resolve() != private_rows.parents[2].resolve() \
            or not (run_dir / "steps" / "1-window-sms" / "_metadata.json").exists() or step["outputs"][0]["physicalRows"] != 1:
        fail(f"captured DEV rows are not confined to the run's private/ directory: {step}")
    run_tool("run_workspace.py", "cleanup", "--run-dir", run["runDir"])
    if private_rows.exists() or not (run_dir / "steps.json").exists():
        fail("cleanup did not remove captured rows or removed sanitized evidence")
    outside = run_tool("transform_runs.py", "capture", "--run-dir", str(run_dir), "--private-dir", str(work / "rows"), env=env, check=False)
    if outside.returncode == 0 or "private/" not in outside.stderr:
        fail("captured rows were written outside a private/ directory")

    # 8. Per-slice regression, and a republished version with renamed outputs is NOT_APPLICABLE with its reason.
    def regress_run(directory: Path, digest: str, output: str) -> None:
        request = {"outputDatasets": [output], "inputs": [{"table": "vertex-account", "s3Uri": prefix + "vertex-account/"}]}
        silvally_io.write_json(directory / "run-spec.json", {"slices": ["sms"], "mappings": {"canon-to-omega@2.0.0": {"sha256": digest}},
                                                             "cases": [{"case": "sms", "mapping": "canon-to-omega@2.0.0", "request": request}]})
        silvally_io.write_json(directory / "steps.json", [{"step": "1-sms", "verdict": "PASS",
                                                           "outputs": [{"dataset": output, "physicalRows": 3, "contentSha256": "c" * 64}]}])
    regress_run(work / "reg-base", "0" * 64, "legacy_message_log")
    regress_run(work / "reg-now", "f" * 64, "message_log")
    na = json.loads(run_tool("transform_runs.py", "regress", "--run-dir", str(work / "reg-now"), "--baseline", str(work / "reg-base"),
                             "--slice", "sms").stdout)
    report = json.loads((work / "reg-now" / "regression-sms.json").read_text())
    if na["status"] != "NOT_APPLICABLE" or report["slice"] != "sms" or "MappingRepublished" not in report["reason"] \
            or "OutputNamesDiffer" not in report["reason"]:
        fail(f"a republished version with renamed outputs was not NOT_APPLICABLE with its reason: {report}")

    # 6, 7 and 8 in evaluation: the SMS stop names its real cause, unsliced checks are not spread across slices,
    #    and regression reports count per slice.
    intent = {"status": "RESOLVED", "selectedProfile": PROFILE.name, "primaryDirection": {"to": "omega", "outputShape": "tabular"},
              "workflow": {"steps": [{"mapping": "canon-to-omega@2.0.0"}]}, "findings": [],
              "slices": [{"id": "sms", "outputDatasets": ["member_report"]}, {"id": "dsa", "outputDatasets": ["ledger_summary"]}],
              "ownerDecisions": {"windowSelection": "most-recent-full-utc-day-with-data-per-slice"}}
    silvally_io.write_json(work / "intent.json", intent)
    silvally_io.write_json(work / "days.json", both)
    silvally_io.write_json(work / "unsliced-checks.json", {"checks": [{"id": "columns-message_log", "dataset": "message_log", "kind": "columns-match-contract",
                                                                       "status": "FAIL"}]})
    run_tool("evaluate_run.py", "--intent", str(work / "intent.json"), "--profile", str(PROFILE), "--catalog", str(work / "no-catalog.json"),
             "--slice-days", str(work / "days.json"), "--graph-inputs", str(work / "empty.json"),
             "--checks", str(work / "unsliced-checks.json"), "--regression", f"sms={work / 'reg-now' / 'regression-sms.json'}",
             "--out", str(work / "eval.json"), check=False)
    evaluation = json.loads((work / "eval.json").read_text())
    phase = {p["number"]: " ".join(p["reasons"]) for p in evaluation["phases"]}
    if "[sms] UpstreamInputEmpty" not in phase[9] or "[sms] UpstreamInputEmpty" not in phase[1]:
        fail(f"the empty input side was not reported: {phase[1]} | {phase[9]}")
    sms_stop = next(r for p in evaluation["phases"] if p["number"] == 10 for r in p["reasons"] if r.startswith("BLOCKED: [sms]"))
    if "no canary ran" not in sms_stop or "UpstreamInputEmpty" not in sms_stop or "the canary did not pass" in sms_stop:
        fail(f"the SMS stop did not name its real cause: {sms_stop}")
    if "columns-message_log" in phase[11] or "UnslicedComparisonEvidenceIgnored" not in evaluation["informationalFindings"] \
            or not evaluation.get("ignoredEvidence") or evaluation["slices"]["dsa"]["phases"]["11"] == "FAIL":
        fail(f"unsliced checks were spread across slices: {phase[11]} {evaluation.get('ignoredEvidence')}")
    if "[sms] regression NOT_APPLICABLE: MappingRepublished" not in phase[11] or "RegressionNotApplicable" not in evaluation["informationalFindings"]:
        fail(f"the per-slice NOT_APPLICABLE regression was not recorded with its reason: {phase[11]}")
    if run_tool("compare_datasets.py", "check", "--contracts", str(work / "contracts.json"), "--dataset", "x=y", check=False).returncode == 0:
        fail("compare_datasets.py check accepted evidence without --slice")

    # 9. The package's actual cost is the sum over every run directory.
    dirs = []
    for label, stage, usd in (("canary-sms", "canary", 0.021), ("full-sms", "full", 0.188), ("full-dsa", "full", 0.094)):
        silvally_io.write_json(work / "cost" / label / "run-spec.json", {"runId": label})
        silvally_io.write_json(work / "cost" / label / "cost.json", {"actualUsd": usd, "ceilingUsd": 5})
        dirs.append((work / "cost" / label, stage))
    total, by_run = build_run_package.package_cost(dirs)
    if total["actualUsd"] != 0.303 or [r["runId"] for r in by_run] != ["canary-sms", "full-sms", "full-dsa"]:
        fail(f"actual cost was not summed over every run directory: {total} {by_run}")
    (work / "cost" / "full-dsa" / "cost.json").unlink()
    if build_run_package.package_cost(dirs)[0]["actualUsd"] is not None:
        fail("a package with an unmeasured run reported a partial actual cost as the total")
    results.append("unattended-run fixes: paged/retried/split Persist reads merged into one closed dataset, INPUT_EMPTY; stale-mirror "
                   "handoff without later rows and two-sided data-days; distinct manifest digests; leaf dataset labels; private "
                   "capture rows; real stop cause; slice-scoped evidence; per-slice NOT_APPLICABLE regression; summed cost")


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
        test_per_slice_evaluation(tmp)
        test_graph_inputs(tmp)
        test_prod_actuals_catalog(tmp)
        test_unattended_intake(tmp)
        test_run_workspace(tmp)
        test_stage_decisions(tmp)
        test_unattended_run_findings(tmp)
    print("Silvally tool tests passed: " + "; ".join(results))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
