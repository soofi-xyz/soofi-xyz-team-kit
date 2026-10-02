#!/usr/bin/env python3
"""Exercise the Transform configuration API helper without network or AWS calls."""

import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
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

    def run_cli(self, argv, status=200):
        calls = []

        def fake_request(method, url, region, body=None):
            calls.append((method, url, region, body))
            return status, {"ok": 200 <= status < 300, "data": {}}

        out = io.StringIO()
        with mock.patch.object(transform_api, "request", fake_request), redirect_stdout(out):
            code = transform_api.main(["--api-url", "https://api.example/v1", *argv])
        return code, calls, json.loads(out.getvalue())

    def test_bundle_sets_query_digests_and_sends_rule_and_queries(self):
        code, calls, _ = self.run_cli(["validate", self.tmp.name])
        self.assertEqual(code, 0)
        method, url, region, body = calls[0]
        self.assertEqual((method, url, region), ("POST", "https://api.example/v1/transform/mappings/validate", "us-east-2"))
        self.assertEqual(body["queries"], {"queries/member.sql": SQL})
        digest = hashlib.sha256(SQL.encode()).hexdigest()
        self.assertEqual(body["rule"]["outputs"][0]["queries"][0]["sha256"], digest)

    def test_register_puts_each_version_and_fails_on_conflict(self):
        code, calls, result = self.run_cli(["register", self.tmp.name], status=409)
        self.assertEqual(code, 1)
        self.assertEqual(calls[0][:2], ("PUT", "https://api.example/v1/transform/mappings/alpha-to-canon/versions/1.0.0"))
        self.assertEqual(result["status"], 409)

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
