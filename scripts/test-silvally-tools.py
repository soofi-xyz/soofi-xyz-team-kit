#!/usr/bin/env python3
"""Offline tests for the Silvally validation tools (no AWS, no GitHub).

Runs with the standard library plus jsonschema; pyarrow-backed and Spark-backed
cases run when those packages are importable and are reported as skipped otherwise.
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
FIXTURE = SKILL / "fixtures" / "new-mapping-example"
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
        fail(f"{script} {' '.join(args[:2])}: {result.stderr[-600:]}")
    return result


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
    if silvally_io.credential_free("https://user:pw@host/p?sig=1#x") != "https://host/p":
        fail("credential_free kept user-info or query")
    results.append("io guards")


def spec(tmp: Path) -> Path:
    path = tmp / "spec.json"
    silvally_io.write_json(path, {
        "runId": "20990101T000000Z", "stateMachineArn": "arn:aws:states:us-east-2:000000000000:stateMachine:Example",
        "outputRoot": "s3://example-bucket/outputs/silvally-example/", "profile": "example-dev",
        "mappings": {"example-to-summary@0.1.0": {"sha256": "0" * 64, "versionId": "v1"}},
        "cases": [{"case": "full", "mapping": "example-to-summary@0.1.0", "expected": "PASS",
                   "request": {"contractVersion": 2, "from": "example", "to": "summary", "mappingVersion": "0.1.0",
                               "inputs": [{"table": "people", "s3Uri": "s3://example-bucket/inputs/people/"}]}},
                  {"case": "missing-input", "mapping": "example-to-summary@0.1.0", "expected": "REJECTED",
                   "request": {"contractVersion": 2, "from": "example", "to": "summary", "mappingVersion": "0.1.0", "inputs": []}}],
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
    # No approvals: nothing starts and AWS is never called.
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
    results.append("transform_runs approval gate")


def test_compare(tmp: Path) -> None:
    a = tmp / "a"
    b = tmp / "b"
    for d, rows in ((a, ["k|v|w", "1|x|p", "2|y|q"]), (b, ["k|v|w", "2|y|q", "1|z|p"])):
        d.mkdir()
        (d / "part-00000.csv").write_text("\n".join(rows) + "\n")
    diff = json.loads(run_tool("compare_datasets.py", "diff", str(a), str(b), "--key", "k").stdout)
    if diff["identical"] or diff["changedByColumn"] != {"v": 1} or diff["onlyLeft"] or diff["onlyRight"]:
        fail(f"keyed diff miscounted: {diff}")
    same = json.loads(run_tool("compare_datasets.py", "diff", str(a), str(a), "--expect-identical").stdout)
    if not same["identical"]:
        fail("identical datasets reported different")
    fmt = json.loads(run_tool("compare_datasets.py", "format", str(a), "--header", "k", "v", "w").stdout)
    bad = run_tool("compare_datasets.py", "format", str(a), "--header", "k", "v", check=False)
    if not fmt["pass"] or bad.returncode == 0:
        fail("CSV format check did not accept the right header or reject the wrong one")
    v = tmp / "v"
    e = tmp / "e"
    v.mkdir()
    e.mkdir()
    (v / "part-00000.csv").write_text("~id|~label\nd1|debt\nd2|debt\n")
    (e / "part-00000.csv").write_text("~id|~from|~to\ne1|d1|d2\ne2|d1|missing\n")
    closure = run_tool("compare_datasets.py", "closure", "--vertex", f"debt={v}", "--edge", f"link={e}:debt:debt", check=False)
    report = json.loads(closure.stdout)
    if closure.returncode == 0 or report["danglingEndpointCount"] != 1 or report["endpointCount"] != 4:
        fail(f"graph closure did not count the dangling endpoint: {report}")
    results.append("compare_datasets diff/format/closure")


def test_bridge(tmp: Path) -> None:
    if importlib.util.find_spec("pyarrow") is None:
        results.append("graph_export_bridge SKIPPED (pyarrow not installed)")
        return
    import pyarrow as pa
    import pyarrow.parquet as pq

    src = tmp / "neptune"
    (src / "vertices").mkdir(parents=True)
    (src / "edges").mkdir()
    (src / "vertices" / "part-0.csv").write_text("~id,~label,name:String,count:Int\nc2,company,Beta,2\nc1,company,Alpha,\n")
    (src / "edges" / "part-0.csv").write_text("~id,~label,~from,~to,active:Bool\nx1,company_represents_debt,c1,c2,true\n")
    out = tmp / "graph"
    manifest = json.loads(run_tool("graph_export_bridge.py", "neptune-csv", "--source", str(src), "--out", str(out),
                                   "--created-at", "2026-01-01T00:00:00Z").stdout)
    names = {d["dataset"] for d in manifest["datasets"]}
    if names != {"vertex-company", "edge-company-represents-debt"}:
        fail(f"bridge dataset names wrong: {names}")
    company = pq.read_table(out / "vertex-company").to_pylist()
    if [r["~id"] for r in company] != ["c1", "c2"] or company[0]["count:Int"] is not None or company[1]["count:Int"] != 2:
        fail("bridge did not type or order vertex rows")
    if company[0]["created_at:DateTime"] != "2026-01-01T00:00:00.000Z" or company[1]["created_at:DateTime"] != "2026-01-01T00:00:00.001Z":
        fail("synthesized created_at is not deterministic base + rank")
    edge = pq.read_table(out / "edge-company-represents-debt").to_pylist()[0]
    if edge["active:Bool"] is not True or edge["~from"] != "c1":
        fail("bridge did not type edge properties")
    raw = tmp / "raw.parquet"
    pq.write_table(pa.table({"~id": ["a"], "effective_at:DateTime": pa.array([1790620251113], pa.int64()),
                             "due:Date": pa.array([1790553600000], pa.int64())}), raw)
    iso = json.loads(run_tool("graph_export_bridge.py", "iso-dates", "--source", str(raw), "--out", str(tmp / "iso")).stdout)
    row = pq.read_table(tmp / "iso").to_pylist()[0]
    if set(iso["convertedColumns"]) != {"effective_at:DateTime", "due:Date"} or row["effective_at:DateTime"] != "2026-09-28T18:30:51.113Z" or row["due:Date"] != "2026-09-28":
        fail(f"epoch-millis conversion wrong: {row}")
    results.append("graph_export_bridge neptune-csv/iso-dates")


def test_local_run(tmp: Path) -> None:
    if importlib.util.find_spec("pyspark") is None or shutil.which("java") is None and not os.environ.get("JAVA_HOME"):
        results.append("local_mapping_run SKIPPED (pyspark/java not installed)")
        return
    mapping = FIXTURE / "transform-mappings" / "example-to-summary" / "0.1.0" / "mapping.json"
    out = tmp / "local-out"
    run_tool("local_mapping_run.py", "--mapping", str(mapping), "--input", f"people={FIXTURE / 'inputs' / 'people'}", "--out", str(out))
    report = json.loads((out / "report.json").read_text())
    if report["outputs"][0]["rows"] != 3:
        fail("fixture mapping did not drop the null-key row")
    diff = json.loads(run_tool("compare_datasets.py", "diff", str(out / "person_summary"), str(FIXTURE / "expected" / "person_summary.csv"),
                               "--expect-identical").stdout)
    if not diff["identical"]:
        fail(f"fixture output differs from the specification oracle: {diff}")
    missing = run_tool("local_mapping_run.py", "--mapping", str(mapping), "--output", "person_summary", "--out", str(tmp / "neg"), check=False)
    if missing.returncode == 0:
        fail("a run missing a required input was not rejected")
    results.append("local_mapping_run fixture + negative")


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
        "profile": {"id": "example.json", "revision": "0" * 40, "sha256": "sha256:" + "0" * 64},
        "discoveryTrace": [{"repository": "example/repo", "selectionMethod": "requested-ref", "materialization": "isolated-checkout",
                            "selectedCommitSha": "0" * 40, "pullRequestNumber": None, "requiredPathsVerified": True, "rejectedCandidateCommitShas": []}],
        "configurationPackage": {"id": "example-to-summary", "version": "0.1.0",
                                 "transformProduct": {"name": "Transform", "version": "0" * 40, "sha256": "sha256:" + "0" * 64},
                                 "directions": [{"id": "example-to-summary", "sourceLanguage": identity, "targetLanguage": identity,
                                                 "mapping": identity, "evidenceIds": ["synthetic-local"]}],
                                 "lexicon": identity, "sourceRevisions": [{"slug": "example/repo", "commitSha": "0" * 40}],
                                 "dependencies": [], "testEvidenceIds": ["synthetic-local"], "deployedDigest": "sha256:" + "0" * 64,
                                 "unresolvedProductChangeHandoffs": [], "marketplaceRegistrationReady": False},
        "environment": {"name": "local", "accountHash": "sha256:" + "0" * 64, "region": "us-east-2", "writePolicy": "local-only"},
        "sensitivity": {"classification": "public", "sanitization": "aggregates-and-digests-only", "containsRawPii": False, "containsSecrets": False},
        "graph": {"required": False, "identityUnique": True, "endpointCount": 0, "danglingEndpointCount": 0},
        "runtime": {"sparkVersion": "3.3.0", "transformRevision": "0" * 40, "deploymentDigest": "sha256:" + "0" * 64, "executionMode": "synthetic-local"},
        "persistCanary": {"required": False, "status": "PASS", "evidenceIds": ["persist-not-invoked"]},
        "exporterHydration": {"required": False, "status": "PASS", "evidenceIds": ["synthetic-local"]},
        "roundTrip": {"required": False, "status": "PASS", "evidenceIds": ["synthetic-local"], "comparedFields": 4, "mismatchCount": 0},
        "phases": phases,
        "boundaryDecisions": [{"id": "fixture", "proposedChange": "Synthetic fixture mapping", "classification": "CONFIGURATION",
                               "evidenceIds": ["synthetic-local"], "resolved": True, "handoffOwner": None}],
    })
    local = ["--local-output", f"person_summary={FIXTURE / 'expected' / 'person_summary.csv'}"]
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
    """fetch_validation_inputs registry/ssm-names against a fake aws CLI (no network)."""
    registry_src = tmp / "published" / "example-to-summary"
    shutil.copytree(FIXTURE / "transform-mappings" / "example-to-summary", registry_src)
    shim_dir = tmp / "bin"
    shim_dir.mkdir()
    shim = shim_dir / "aws"
    shim.write_text(f"""#!{sys.executable}
import json, shutil, sys
args = sys.argv[1:]
if args[:2] == ["ssm", "get-parameter"]:
    print(json.dumps({{"Parameter": {{"Value": "s3://example-lexicon/transform-mappings/"}}}}))
elif args[:2] == ["ssm", "get-parameters-by-path"]:
    print(json.dumps({{"Parameters": [{{"Name": "/lexicon/transform-mappings-uri"}}, {{"Name": "/lexicon/example-data-uri"}}]}}))
elif args[:2] == ["s3", "sync"]:
    shutil.copytree({str(registry_src.parent)!r}, args[3], dirs_exist_ok=True)
elif args[:2] == ["s3api", "head-object"]:
    print(json.dumps({{"VersionId": "shim-version", "LastModified": "2099-01-01T00:00:00Z"}}))
else:
    sys.exit("unexpected aws call: " + " ".join(args))
""")
    shim.chmod(shim.stat().st_mode | stat.S_IEXEC)
    env = {"PATH": f"{shim_dir}{os.pathsep}{os.environ['PATH']}"}
    ws = tmp / "ws"
    reg = json.loads(run_tool("fetch_validation_inputs.py", "registry", "--workspace", str(ws), "--label", "dev", "--profile", "example-dev", env=env).stdout)
    names = json.loads(run_tool("fetch_validation_inputs.py", "ssm-names", "--workspace", str(ws), "--label", "dev", "--profile", "example-dev", env=env).stdout)
    if reg["mappings"] != [{"mapping": "example-to-summary@0.1.0", "sha256": silvally_io.sha256_file(registry_src / "0.1.0" / "mapping.json"),
                            "versionId": "shim-version", "lastModified": "2099-01-01T00:00:00Z"}]:
        fail(f"registry snapshot not pinned by sha256 + VersionId: {reg['mappings']}")
    if names["count"] != 2 or len(json.loads((ws / "inputs-manifest.json").read_text())) != 2:
        fail("ssm names or the inputs manifest were not recorded")
    results.append("fetch_validation_inputs registry/ssm-names (shimmed aws)")


def test_stage_package(tmp: Path) -> None:
    pkg = tmp / "pkg"
    shutil.copytree(FIXTURE / "inputs", pkg)
    prefix = "s3://example-bucket/inputs/example-synthetic/20990101T000000Z-fixture_v1/"
    card = json.loads(run_tool("stage_evidence_package.py", "manifest", "--dir", str(pkg), "--prefix", prefix).stdout)
    manifest = json.loads((pkg / "manifest.json").read_text())
    if card["status"] != "APPROVAL_REQUIRED" or manifest["objects"][0]["rows"] != 4 or manifest["objects"][0]["dataset"] != "people":
        fail(f"staging manifest or card wrong: {card} {manifest}")
    wrong = run_tool("stage_evidence_package.py", "upload", "--dir", str(pkg), "--prefix", prefix, "--profile", "example-dev",
                     "--approve", "sha256:" + "0" * 64, check=False)
    if wrong.returncode == 0 or "does not match" not in wrong.stderr:
        fail("upload with a non-matching approval digest was not refused")
    (pkg / "people" / "extra.jsonl").write_text('{"person_id":"p-9"}\n')
    changed = run_tool("stage_evidence_package.py", "upload", "--dir", str(pkg), "--prefix", prefix, "--profile", "example-dev",
                       "--approve", card["operationDigest"], check=False)
    if changed.returncode == 0 or "package changed" not in changed.stderr:
        fail("upload of a package changed after its manifest was not refused")
    results.append("stage_evidence_package manifest + refusals")


def main() -> int:
    with tempfile.TemporaryDirectory() as raw:
        tmp = Path(raw)
        test_io_guards()
        test_transform_runs_cards(tmp)
        test_compare(tmp)
        test_bridge(tmp)
        test_local_run(tmp)
        test_run_package(tmp)
        test_fetch_registry_with_shim(tmp)
        test_stage_package(tmp)
    print("Silvally tool tests passed: " + "; ".join(results))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
