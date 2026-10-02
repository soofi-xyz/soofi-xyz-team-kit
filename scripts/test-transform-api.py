#!/usr/bin/env python3
"""Exercise the Transform configuration API helper without network or AWS calls."""

import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills" / "configure-transform-product" / "scripts" / "transform_api.py"
spec = importlib.util.spec_from_file_location("transform_api", SCRIPT)
transform_api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transform_api)

SQL = "SELECT 1 AS id\n"
RULE = {
    "id": "alpha-to-canon",
    "version": "1.0.0",
    "status": "ENABLED",
    "from": "alpha",
    "to": "canon",
    "outputs": [{"dataset": "member", "queries": [{"path": "queries/member.sql"}]}],
}


class TransformApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        version_dir = Path(self.tmp.name) / "mappings" / "alpha-to-canon" / "1.0.0"
        (version_dir / "queries").mkdir(parents=True)
        (version_dir / "mapping.json").write_text(json.dumps(RULE))
        (version_dir / "queries" / "member.sql").write_text(SQL)

    def tearDown(self):
        self.tmp.cleanup()

    def add_version(self, version, sql):
        version_dir = Path(self.tmp.name) / "mappings" / "alpha-to-canon" / version
        (version_dir / "queries").mkdir(parents=True)
        (version_dir / "mapping.json").write_text(json.dumps({**RULE, "version": version}))
        (version_dir / "queries" / "member.sql").write_text(sql)

    def run_cli(self, argv, status=200, responses=None):
        calls = []
        replies = list(responses or [])

        def fake_request(method, url, region, body=None):
            calls.append((method, url, region, body))
            if replies:
                return replies.pop(0)
            return status, {"ok": 200 <= status < 300, "data": {}}

        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(transform_api, "request", fake_request), redirect_stdout(out), redirect_stderr(err):
            code = transform_api.main(["--api-url", "https://api.example/v1", *argv])
        self.stderr = err.getvalue()
        return code, calls, json.loads(out.getvalue())

    def registered(self, rule, sql):
        files = [
            {"path": "mapping.json", "sha256": hashlib.sha256(json.dumps(rule, separators=(",", ":")).encode()).hexdigest()},
            {"path": "queries/member.sql", "sha256": hashlib.sha256(sql.encode()).hexdigest()},
        ]
        return {"ok": True, "data": {"mapping_id": rule["id"], "version": rule["version"], "files": files, "rule": rule}}

    def test_bundle_sets_query_digests_and_sends_rule_and_queries(self):
        code, calls, _ = self.run_cli(["validate", self.tmp.name])
        self.assertEqual(code, 0)
        method, url, region, body = calls[0]
        self.assertEqual((method, url, region), ("POST", "https://api.example/v1/transform/mappings/validate", "us-east-2"))
        self.assertEqual(body["queries"], {"queries/member.sql": SQL})
        digest = hashlib.sha256(SQL.encode()).hexdigest()
        self.assertEqual(body["rule"]["outputs"][0]["queries"][0]["sha256"], digest)

    def test_validate_reports_server_digests(self):
        expected = self.registered(RULE, SQL)
        code, _, result = self.run_cli(["validate", self.tmp.name], responses=[(200, expected)])
        self.assertEqual(code, 0)
        self.assertEqual(result["outcome"], "valid")
        self.assertEqual(result["files"], expected["data"]["files"])
        self.assertIn("alpha-to-canon@1.0.0: valid", self.stderr)
        self.assertIn(f"mapping.json sha256={expected['data']['files'][0]['sha256']} (digest of the stored compact JSON)", self.stderr)

    def test_register_reports_created_unchanged_and_conflict(self):
        self.add_version("1.1.0", SQL)
        self.add_version("1.2.0", "SELECT 2 AS id\n")
        conflict = {"ok": False, "error": {"type": "MappingVersionConflict", "message": "different content"}}
        responses = [(201, self.registered(RULE, SQL)), (200, self.registered(RULE, SQL)), (409, conflict)]
        code, calls, results = self.run_cli(["register", self.tmp.name], responses=responses)
        self.assertEqual(code, 1)
        self.assertEqual(calls[0][:2], ("PUT", "https://api.example/v1/transform/mappings/alpha-to-canon/versions/1.0.0"))
        self.assertEqual([r["outcome"] for r in results], ["created", "unchanged", "failed"])
        self.assertEqual(results[0]["files"][1]["path"], "queries/member.sql")
        self.assertEqual(results[2]["files"], [])
        self.assertIn("alpha-to-canon@1.0.0: created", self.stderr)
        self.assertIn("alpha-to-canon@1.1.0: unchanged", self.stderr)
        self.assertIn("alpha-to-canon@1.2.0: failed: HTTP 409 MappingVersionConflict: different content", self.stderr)
        self.assertIn("publish a new version", self.stderr)

    def test_register_succeeds_when_every_version_is_created_or_unchanged(self):
        self.add_version("1.1.0", SQL)
        responses = [(201, self.registered(RULE, SQL)), (200, self.registered(RULE, SQL))]
        code, _, results = self.run_cli(["register", self.tmp.name], responses=responses)
        self.assertEqual(code, 0)
        self.assertEqual([r["outcome"] for r in results], ["created", "unchanged"])

    def test_get_root_matches_reformatted_mapping_json(self):
        version_dir = Path(self.tmp.name) / "mappings" / "alpha-to-canon" / "1.0.0"
        (version_dir / "mapping.json").write_text(json.dumps(RULE, indent=4, sort_keys=True) + "\n")
        stored_rule = json.loads(json.dumps(RULE))
        stored_rule["outputs"][0]["queries"][0]["sha256"] = hashlib.sha256(SQL.encode()).hexdigest()
        code, calls, result = self.run_cli(
            ["get", "alpha-to-canon", "1.0.0", "--root", self.tmp.name],
            responses=[(200, self.registered(stored_rule, SQL))],
        )
        self.assertEqual(code, 0)
        self.assertEqual(calls[0][:2], ("GET", "https://api.example/v1/transform/mappings/alpha-to-canon/versions/1.0.0"))
        self.assertEqual([(r["path"], r["result"]) for r in result["comparison"]],
                         [("mapping.json", "content matches"), ("queries/member.sql", "content matches")])
        self.assertIn("mapping.json: content matches (compared by parsed JSON content)", self.stderr)

    def test_get_root_reports_changed_sql(self):
        stored_rule = json.loads(json.dumps(RULE))
        stored_rule["outputs"][0]["queries"][0]["sha256"] = hashlib.sha256(SQL.encode()).hexdigest()
        version_dir = Path(self.tmp.name) / "mappings" / "alpha-to-canon" / "1.0.0"
        (version_dir / "queries" / "member.sql").write_text("SELECT 1 AS id -- edited\n")
        code, _, result = self.run_cli(
            ["get", "alpha-to-canon", "1.0.0", "--root", self.tmp.name],
            responses=[(200, self.registered(stored_rule, SQL))],
        )
        self.assertEqual(code, 1)
        rows = {r["path"]: r["result"] for r in result["comparison"]}
        self.assertEqual(rows, {"mapping.json": "content differs", "queries/member.sql": "content differs"})
        self.assertIn("queries/member.sql: content differs (compared by sha256 of file bytes)", self.stderr)

    def test_get_without_root_keeps_plain_output(self):
        code, _, result = self.run_cli(["get", "alpha-to-canon", "1.0.0"])
        self.assertEqual(code, 0)
        self.assertEqual(set(result), {"target", "status", "response"})
        self.assertEqual(self.stderr, "")

    def test_run_routes(self):
        request_file = Path(self.tmp.name) / "request.json"
        request_file.write_text(json.dumps({"requestContractVersion": 2}))
        _, calls, _ = self.run_cli(["start", str(request_file), "--transaction-id", "run-1"], status=202)
        self.assertEqual(calls[0][3]["transaction_id"], "run-1")
        _, calls, _ = self.run_cli(["status", "run-1"])
        self.assertEqual(calls[0][:2], ("GET", "https://api.example/v1/transform/runs/run-1"))
        _, calls, _ = self.run_cli(["approve", "run-1", "--reject", "--reviewed-by", "reviewer"])
        self.assertEqual(calls[0][1], "https://api.example/v1/transform/runs/run-1/approval")
        self.assertEqual(calls[0][3], {"approved": False, "reviewedBy": "reviewer"})

    def test_missing_api_url_exits(self):
        with mock.patch.dict("os.environ", {}, clear=True), self.assertRaises(SystemExit):
            transform_api.main(["list", "alpha-to-canon"])


if __name__ == "__main__":
    unittest.main()
