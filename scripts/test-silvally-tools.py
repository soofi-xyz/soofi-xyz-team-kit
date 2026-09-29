#!/usr/bin/env python3
"""Offline tests for the Silvally validation tools (no AWS, no GitHub).

Every mapping, language, dataset and field comes from the synthetic registry fixture
(skills/validate-transform-configuration/fixtures/synthetic-registry). Runs with the standard
library plus jsonschema; pyarrow-backed and Spark-backed cases run when those packages are
importable and are reported as skipped otherwise.
"""

from __future__ import annotations

import importlib.util
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
FIXTURE = SKILL / "fixtures" / "synthetic-registry"
CANDIDATE = FIXTURE / "candidate"
PROFILE = FIXTURE / "profiles" / "synthetic-alpha-omega.json"
FORWARD = CANDIDATE / "mappings" / "alpha-to-canon" / "1.0.0" / "registration.json"
PROJECTION = CANDIDATE / "mappings" / "canon-to-omega" / "2.0.0" / "registration.json"
RESOLVER_ARGS = ["--layout", str(FIXTURE / "layout.json"), "--lexicon-root", str(CANDIDATE), "--main-lexicon-root", str(CANDIDATE),
                 "--forbidden-concepts", str(FIXTURE / "forbidden-concepts.json"), "--profiles", str(FIXTURE / "profiles")]
sys.path.insert(0, str(SCRIPTS))

import silvally_io  # noqa: E402
import transform_runs  # noqa: E402
import compare_datasets  # noqa: E402
import build_run_package  # noqa: E402
import fetch_validation_inputs  # noqa: E402

results: list[str] = []


def fail(message: str) -> None:
    raise SystemExit(f"Silvally tool tests failed: {message}")


def run_tool(script: str, *args: str, env: dict | None = None, check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run([sys.executable, str(SCRIPTS / script), *args], capture_output=True, text=True,
                            env={**os.environ, **(env or {})})
    if check and result.returncode != 0:
        fail(f"{script} {' '.join(args[:2])}: {result.stderr[-800:]}")
    return result


def spark_available() -> bool:
    return importlib.util.find_spec("pyspark") is not None and (shutil.which("java") is not None or bool(os.environ.get("JAVA_HOME")))


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


def test_bridge(tmp: Path) -> None:
    if importlib.util.find_spec("pyarrow") is None:
        results.append("graph_export_bridge SKIPPED (pyarrow not installed)")
        return
    import pyarrow as pa
    import pyarrow.parquet as pq

    src = tmp / "neptune"
    (src / "vertices" / "vertex-node").mkdir(parents=True)
    (src / "edges").mkdir()
    (src / "vertices" / "vertex-node" / "part-0.csv").write_text("~id,~label,name:String,count:Int\nn2,node,Beta,2\nn1,node,Alpha,\n")
    (src / "edges" / "part-0.csv").write_text("~id,~label,~from,~to,active:Bool\nx1,node_links_node,n1,n2,true\n")
    out = tmp / "graph"
    manifest = json.loads(run_tool("graph_export_bridge.py", "neptune-csv", "--source", str(src), "--out", str(out),
                                   "--created-at", "2099-01-01T00:00:00Z").stdout)
    names = {d["dataset"] for d in manifest["datasets"]}
    if names != {"vertex-node", "edge-node-links-node"}:
        fail(f"bridge dataset names wrong: {names}")
    nodes = pq.read_table(out / "vertex-node").to_pylist()
    if [r["~id"] for r in nodes] != ["n1", "n2"] or nodes[0]["count:Int"] is not None or nodes[1]["count:Int"] != 2:
        fail("bridge did not type or order vertex rows")
    if nodes[0]["created_at:DateTime"] != "2099-01-01T00:00:00.000Z" or nodes[1]["created_at:DateTime"] != "2099-01-01T00:00:00.001Z":
        fail("synthesized created_at is not deterministic base + rank")
    edge = pq.read_table(out / "edge-node-links-node").to_pylist()[0]
    if edge["active:Bool"] is not True or edge["~from"] != "n1":
        fail("bridge did not type edge properties")
    raw = tmp / "raw.parquet"
    pq.write_table(pa.table({"~id": ["a"], "effective_at:DateTime": pa.array([1790620251113], pa.int64()),
                             "due:Date": pa.array([1790553600000], pa.int64())}), raw)
    iso = json.loads(run_tool("graph_export_bridge.py", "iso-dates", "--source", str(raw), "--out", str(tmp / "iso")).stdout)
    row = pq.read_table(tmp / "iso").to_pylist()[0]
    if set(iso["convertedColumns"]) != {"effective_at:DateTime", "due:Date"} or row["effective_at:DateTime"] != "2026-09-28T18:30:51.113Z" or row["due:Date"] != "2026-09-28":
        fail(f"epoch-millis conversion wrong: {row}")
    results.append("graph_export_bridge neptune-csv/iso-dates")


def resolve(tmp: Path, command: str, *extra: str) -> dict:
    out = tmp / f"{command}.json"
    result = run_tool("resolve-transform-intent.py", command, *RESOLVER_ARGS, *extra, "--out", str(out), check=False)
    if command != "check-profile" and result.returncode != 0:
        fail(f"resolver {command}: {result.stderr[-600:]}")
    return json.loads(out.read_text())


def test_synthetic_end_to_end(tmp: Path) -> None:
    """The whole generic flow on the synthetic registry: resolve, derive, run, check, evaluate -> READY."""
    if not spark_available() or importlib.util.find_spec("pyarrow") is None:
        results.append("synthetic end-to-end SKIPPED (pyspark/java/pyarrow not installed)")
        return
    work = tmp / "e2e"
    work.mkdir()
    intent = resolve(work, "discover", "--request", "test canon (alpha) to omega ledger summary")
    if intent["status"] != "RESOLVED" or intent["selectedProfile"] != PROFILE.name:
        fail(f"synthetic request did not resolve to the fixture profile: {intent['status']} {intent.get('selectedProfile')}")
    check = resolve(work, "check-profile", "--profile", str(PROFILE))
    if not check["derivedEqualsProfileModuloOverrides"]:
        fail(f"fixture profile differs from its registry derivation: {check['undeclared']} {check['staleOverrides']}")
    run_tool("local_mapping_run.py", "--mapping", str(FORWARD), "--negatives", "--out", str(work / "step1"),
             *[f"--input={t}={FIXTURE / 'inputs' / t}" for t in ("members", "ledgers", "rates")])
    run_tool("graph_export_bridge.py", "neptune-csv", "--source", str(work / "step1"), "--out", str(work / "graph"))
    closure = run_tool("compare_datasets.py", "closure", "--vertex", f"vertex-member={work / 'graph' / 'vertex-member'}",
                       "--vertex", f"vertex-ledger={work / 'graph' / 'vertex-ledger'}",
                       "--edge", f"edge-member-has-ledger={work / 'graph' / 'edge-member-has-ledger'}:vertex-member:vertex-ledger").stdout
    (work / "closure.json").write_text(closure)
    run_tool("local_mapping_run.py", "--mapping", str(PROJECTION), "--negatives", "--out", str(work / "step2"),
             *[f"--input={t}={work / 'graph' / t}" for t in ("vertex-member", "vertex-ledger", "edge-member-has-ledger")])
    resolve(work, "contracts", "--mapping", "canon-to-omega@2.0.0")
    checked = run_tool("compare_datasets.py", "check", "--contracts", str(work / "contracts.json"), "--profile", str(PROFILE),
                       "--dataset", f"member_report={work / 'step2' / 'member_report'}", "--dataset", f"ledger_summary={work / 'step2' / 'ledger_summary'}",
                       "--oracle", f"member-report-spec={FIXTURE / 'expected' / 'member_report.csv'}",
                       "--oracle", f"ledger-summary-spec={FIXTURE / 'expected' / 'ledger_summary.jsonl'}", "--out", str(work / "checks.json"), check=False)
    report = json.loads((work / "checks.json").read_text())
    if checked.returncode != 0:
        fail(f"synthetic checks failed: {[c for c in report['checks'] if c['status'] != 'PASS']}")
    loss = next(c for c in report["checks"] if c["id"] == "member-report-oracle")
    if loss["permittedLosses"] != {"tier": {"loss": "tier-outside-enum", "rows": 1}}:
        fail(f"the declared allowed loss was not the only explained difference: {loss}")
    evaluation = run_tool("evaluate_run.py", "--intent", str(work / "discover.json"), "--profile", str(PROFILE),
                          "--profile-check", str(work / "check-profile.json"), "--contracts", str(work / "contracts.json"),
                          "--checks", str(work / "checks.json"), "--local-report", str(work / "step1" / "report.json"),
                          "--local-report", str(work / "step2" / "report.json"), "--closure", str(work / "closure.json"),
                          "--local-package", f"synthetic-inputs={FIXTURE / 'inputs'}", "--mode", "synthetic-local",
                          "--out", str(work / "phases.json"), check=False)
    phases = json.loads((work / "phases.json").read_text())
    if evaluation.returncode != 0 or phases["verdict"] != "READY":
        fail(f"synthetic validation is not READY: {[(p['number'], p['status'], p['reasons']) for p in phases['phases'] if p['status'] != 'PASS']}")
    negatives = json.loads((work / "step2" / "report.json").read_text())["negativeCases"]
    if len(negatives) != 4 or not all(n["rejected"] for n in negatives):
        fail("every required input of every projection output must yield one rejected negative case")
    typed_null = json.loads((work / "step2" / "report.json").read_text())
    if any(o["rows"] != 3 for o in typed_null["outputs"]):
        fail("absent optional graph property or null-key filtering changed the projection row count")

    broken = json.loads((work / "checks.json").read_text())
    tampered_profile = json.loads(PROFILE.read_text())
    tampered_profile["allowedLosses"] = [{**tampered_profile["allowedLosses"][0], "column": "display_name"}]
    (work / "no-loss.json").write_text(json.dumps(tampered_profile))
    strict = run_tool("compare_datasets.py", "check", "--contracts", str(work / "contracts.json"), "--profile", str(work / "no-loss.json"),
                      "--dataset", f"member_report={work / 'step2' / 'member_report'}",
                      "--oracle", f"member-report-spec={FIXTURE / 'expected' / 'member_report.csv'}", check=False)
    if strict.returncode == 0 or broken["status"] != "PASS":
        fail("an undeclared loss passed the oracle comparison")
    results.append("synthetic registry end to end: resolve, check-profile, 2 local runs, 10 negatives, closure, checks, READY")


def test_evaluate_rules(tmp: Path) -> None:
    work = tmp / "evaluate"
    work.mkdir()
    intent = {"status": "RESOLVED", "selectedProfile": PROFILE.name, "primaryDirection": {"to": "omega", "outputShape": "tabular"},
              "workflow": {"steps": [{"mapping": "canon-to-omega@2.0.0"}], "persistPolicyDefault": "forbidden"},
              "findings": [{"code": "EndpointDatasetNotRequired", "mapping": "canon-to-omega@2.0.0", "dataset": "ledger_summary"},
                           {"code": "RetiredMappingInRegistry", "mapping": "alpha-to-omega@0.9.0"}]}
    silvally_io.write_json(work / "intent.json", intent)
    silvally_io.write_json(work / "report.json", {"mapping": "canon-to-omega@2.0.0", "sparkVersion": "3.3.0", "outputs": [],
                                                 "negativeCases": [{"dataset": "member_report", "missingInput": "vertex-member", "rejected": False}]})
    run_tool("evaluate_run.py", "--intent", str(work / "intent.json"), "--local-report", str(work / "report.json"),
             "--mode", "synthetic-local", "--out", str(work / "phases.json"), check=False)
    phases = {p["number"]: p for p in json.loads((work / "phases.json").read_text())["phases"]}
    verdict = json.loads((work / "phases.json").read_text())["verdict"]
    if phases[6]["status"] != "FAIL" or phases[9]["status"] != "FAIL" or verdict != "NOT_READY":
        fail("an endpoint finding or an accepted missing-input run did not fail its phase")
    if "RetiredMappingInRegistry" not in json.loads((work / "phases.json").read_text())["informationalFindings"]:
        fail("a finding on a mapping outside the run was not kept informational")
    if phases[4]["status"] != "BLOCKED" or phases[11]["status"] != "BLOCKED":
        fail("missing package or parity evidence did not block")
    results.append("evaluate_run phase rules")


def test_run_package(tmp: Path) -> None:
    if build_run_package.verdict_of([{"status": "PASS"}, {"status": "FAIL"}, {"status": "BLOCKED"}]) != "NOT_READY":
        fail("FAIL must yield NOT_READY")
    if build_run_package.verdict_of([{"status": "PASS"}, {"status": "APPROVAL_REQUIRED"}]) != "BLOCKED":
        fail("APPROVAL_REQUIRED must yield BLOCKED")
    if build_run_package.verdict_of([{"status": "PASS"}] * 12) != "READY":
        fail("all PASS must yield READY")
    run_dir = tmp / "pkg-run"
    run_dir.mkdir()
    spec_path = tmp / "package-spec.json"
    phases = [{"number": n, "status": "PASS", "evidenceIds": ["synthetic-local"]} for n in range(1, 13)]
    identity = {"id": "x", "revision": "0" * 40, "sha256": "sha256:" + "0" * 64}
    silvally_io.write_json(spec_path, {
        "profile": {"id": PROFILE.name, "revision": "0" * 40, "sha256": "sha256:" + "0" * 64},
        "discoveryTrace": [{"repository": "example/repo", "selectionMethod": "requested-ref", "materialization": "isolated-checkout",
                            "selectedCommitSha": "0" * 40, "pullRequestNumber": None, "requiredPathsVerified": True, "rejectedCandidateCommitShas": []}],
        "configurationPackage": {"id": "canon-to-omega", "version": "2.0.0",
                                 "transformProduct": {"name": "Transform", "version": "0" * 40, "sha256": "sha256:" + "0" * 64},
                                 "directions": [{"id": "canon-to-omega", "sourceLanguage": identity, "targetLanguage": identity,
                                                 "mapping": identity, "evidenceIds": ["synthetic-local"]}],
                                 "lexicon": identity, "sourceRevisions": [{"slug": "example/repo", "commitSha": "0" * 40}],
                                 "dependencies": [], "testEvidenceIds": ["synthetic-local"], "deployedDigest": "sha256:" + "0" * 64,
                                 "unresolvedProductChangeHandoffs": [], "marketplaceRegistrationReady": False},
        "environment": {"name": "local", "accountHash": "sha256:" + "0" * 64, "region": "xx-test-1", "writePolicy": "local-only"},
        "sensitivity": {"classification": "public", "sanitization": "aggregates-and-digests-only", "containsRawPii": False, "containsSecrets": False},
        "graph": {"required": False, "identityUnique": True, "endpointCount": 0, "danglingEndpointCount": 0},
        "runtime": {"sparkVersion": "3.3.0", "transformRevision": "0" * 40, "deploymentDigest": "sha256:" + "0" * 64, "executionMode": "synthetic-local"},
        "persistCanary": {"required": False, "status": "PASS", "evidenceIds": ["persist-not-invoked"]},
        "exporterHydration": {"required": False, "status": "PASS", "evidenceIds": ["synthetic-local"]},
        "roundTrip": {"required": False, "status": "PASS", "evidenceIds": ["synthetic-local"], "comparedFields": 3, "mismatchCount": 0},
        "phases": phases,
        "boundaryDecisions": [{"id": "fixture", "proposedChange": "Synthetic fixture mapping", "classification": "CONFIGURATION",
                               "evidenceIds": ["synthetic-local"], "resolved": True, "handoffOwner": None}],
    })
    local = ["--local-output", f"member_report={FIXTURE / 'expected' / 'member_report.csv'}"]
    result = run_tool("build_run_package.py", "--run-dir", str(run_dir), "--package-spec", str(spec_path), *local, check=False)
    if result.returncode != 0:
        fail(f"a schema-valid synthetic package was rejected: {result.stderr[-800:]}")
    if json.loads(result.stdout)["verdict"] != "READY":
        fail("synthetic package verdict is not READY")
    doc = json.loads(spec_path.read_text())
    doc["phases"][8]["status"] = "FAIL"
    doc["verdict"] = "READY"
    spec_path.write_text(json.dumps(doc))
    wrong = run_tool("build_run_package.py", "--run-dir", str(run_dir), "--package-spec", str(spec_path), *local, check=False)
    if wrong.returncode == 0:
        fail("a READY verdict with a FAIL phase was accepted")
    results.append("build_run_package verdict + schema")


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


def test_stage_package(tmp: Path) -> None:
    pkg = tmp / "pkg"
    shutil.copytree(FIXTURE / "inputs", pkg, ignore=shutil.ignore_patterns("manifest.json", "*.parquet"))
    prefix = "s3://example-bucket/inputs/alpha-synthetic/20990101T000000Z-fixture_v1/"
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
        test_bridge(tmp)
        test_synthetic_end_to_end(tmp)
        test_evaluate_rules(tmp)
        test_run_package(tmp)
        test_fetch_registry_with_shim(tmp)
        test_stage_package(tmp)
        test_spec_from_intent(tmp)
        test_regress(tmp)
    print("Silvally tool tests passed: " + "; ".join(results))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
