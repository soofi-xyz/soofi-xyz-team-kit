#!/usr/bin/env python3
"""Exercise Registeel's publish-through-Build script without network, AWS or a real build."""

import datetime
import hashlib
import importlib.util
import io
import json
import os
import re
import subprocess
import tempfile
import unittest
import zipfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills" / "operate-marketplace" / "scripts" / "publish_via_build.py"
spec = importlib.util.spec_from_file_location("publish_via_build", SCRIPT)
pvb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pvb)

KEY = "test-shared-key-value-0123456789"
BUILD = "https://build.example/dev"
MARKETPLACE = pvb.DEFAULT_MARKETPLACE_BASE_URL
ARTIFACT_URL = "https://artifacts.example/cloud-assembly.zip?X-Amz-Signature=ARTIFACTSECRET"
BUNDLE_URL = "https://bucket.s3.us-east-2.amazonaws.com/uploads/x.zip?X-Amz-Signature=BUNDLESECRET"
PRODUCT_ID = "11111111-2222-4333-8444-555555555555"
MANIFEST = {
    "component_id": "thing",
    "component_name": "Thing",
    "bundle_type": "SERVICE",
    "context_schema_version": "1",
    "stacks": ["Thing"],
}
FINDINGS = {"critical": 0, "high": 0, "moderate": 0, "low": 0, "nag_errors": 0, "nag_warnings": 2}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def builder_token(claims):
    head = pvb.b64url(json.dumps({"alg": "none", "typ": "JWT"}).encode())
    return f"{head}.{pvb.b64url(json.dumps(claims).encode())}."


def artifact_zip(stack_names, resources=True, product=True):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        if product:
            archive.writestr("marketplace.product.json", json.dumps(MANIFEST))
        archive.writestr("build/build.manifest.json", json.dumps({"cloudFormationStackNames": stack_names}))
        archive.writestr("cdk.out/manifest.json", json.dumps({"artifacts": {}}))
        archive.writestr("cdk.out/Thing.template.json", json.dumps({"Resources": {"A": {}}} if resources else {}))
    return buffer.getvalue()


def form_fields(body):
    fields = dict(re.findall(rb'name="([^"]+)"\r\n\r\n([^\r]*)\r\n', body))
    file_part = body.split(b'name="file"', 1)[1].split(b"\r\n\r\n", 1)[1].rsplit(b"\r\n--", 1)[0]
    return {k.decode(): v.decode() for k, v in fields.items()}, file_part


def scan_result(severity="LOW", stack_names=("Thing-review",)):
    return {
        "scanners": ["pnpm-audit@10.14.0", "cdk-nag@2.38.2"],
        "severity_label": severity,
        "findings": FINDINGS,
        "nag": [],
        "stack_names": list(stack_names),
        "nag_from_product": True,
    }


def build_status(build_id, artifact, source_sha, comply, **overrides):
    manifest = zipfile.ZipFile(io.BytesIO(artifact)).read("build/build.manifest.json")
    claims = {
        "iss": "build",
        "sub": build_id,
        "iat": 1,
        "artifact_kind": "CDK_CLOUD_ASSEMBLY",
        "deployer_contract_version": "1",
        "component_id": "thing",
        "source_hash": f"sha256:{source_sha}",
        "assembly_hash": "sha256:" + "a" * 64,
        "artifact_hash": f"sha256:{sha(artifact)}",
        "cloud_assembly": {"stacks": ["Thing"]},
        "deployment_parameters": {},
        "lambda_asset_policy": {"minified": True, "obfuscated": True, "source_maps": False},
        "service_comply_sha256": sha(comply.encode()),
        **overrides,
    }
    return {
        "build_id": build_id,
        "build_status": "SUCCEEDED",
        "artifact_url": ARTIFACT_URL,
        "provenance": {
            "artifact_sha256": sha(artifact),
            "build_manifest_sha256": sha(manifest),
            "source_sha256": source_sha,
            "service_comply": "PRESENT",
            "service_builder": builder_token(claims),
            "artifact_metadata_keys": ["service-builder", "service-comply"],
        },
        "runner": {"kind": "CODEBUILD", "artifact_built": True},
        "asset_policy": {"outcome": "PASSED", "lambda_assets": [{"obfuscated": True, "framework": False}]},
    }


class FakeServices:
    """Build, Marketplace and both presigned S3 POST targets."""

    def __init__(self, stack_names=("Thing-review",), key_status=404, settings_status=200, review="SUCCEEDED"):
        self.calls = []
        self.headers = []
        self.artifact = artifact_zip(list(stack_names))
        self.key_status = key_status
        self.settings_status = settings_status
        self.review = review
        self.polls = 0
        self.comply = None
        self.source_sha = None
        self.marketplace_upload = None
        self.put_body = None

    def __call__(self, method, url, headers, body, label, timeout=60):
        self.calls.append((method, url))
        self.headers.append(headers)
        reply = lambda status, data: (status, json.dumps(data).encode())
        if url == f"{BUILD}/information":
            return reply(200, {"service": "build", "stage": "dev", "capabilities": list(pvb.REQUIRED_CAPABILITIES)})
        if url == f"{BUILD}/builds/{pvb.NULL_BUILD_ID}":
            return reply(self.key_status, {"error": {"tag": "BuildNotFound"}})
        if url == f"{BUILD}/sources":
            return reply(201, {"source_id": "src_1", "upload": {"url": "https://source-upload.example/", "fields": {"key": "k"}}})
        if url == "https://source-upload.example/":
            fields, data = form_fields(body)
            self.comply, self.source_sha = fields["x-amz-meta-service-comply"], sha(data)
            return 204, b""
        if url == f"{BUILD}/builds":
            return reply(202, {"build_id": "bld_1", "build_status": "QUEUED", "transaction_id": "txn_1"})
        if url == f"{BUILD}/builds/bld_1":
            self.polls += 1
            if self.polls == 1:
                return reply(200, {"build_id": "bld_1", "build_status": "BUILDING"})
            return reply(200, build_status("bld_1", self.artifact, self.source_sha, self.comply))
        if url == ARTIFACT_URL:
            return 200, self.artifact
        if url == f"{BUILD}/builds/bld_1/manifest":
            return 200, zipfile.ZipFile(io.BytesIO(self.artifact)).read("build/build.manifest.json")
        component = f"{MARKETPLACE}/ontology/products/{PRODUCT_ID}/components/thing"
        if url == f"{MARKETPLACE}/settings/status":
            return reply(self.settings_status, {"status": {"component_publication": {"is_operational": True}}})
        if url == f"{MARKETPLACE}/ontology/products/by-name?name=Thing":
            return reply(200, {"products": [{"product_id": PRODUCT_ID}]})
        if url == component:
            return reply(200, {"component_id": "thing", "type": "SERVICE"})
        if url == f"{component}/bundle-uploads":
            return reply(200, {"upload": {"url": "https://bundle-upload.example/", "fields": {"key": "u"}}, "bundle_url": BUNDLE_URL})
        if url == "https://bundle-upload.example/":
            self.marketplace_upload = form_fields(body)
            return 204, b""
        if url == f"{component}/bundles" and method == "PUT":
            self.put_body = json.loads(body)
            return reply(202, {"review_id": "rev_1", "bundle_status": "UPLOADING_IN_PROGRESS"})
        if url == f"{MARKETPLACE}/reviews/rev_1":
            return reply(200, {"review_id": "rev_1", "status": "RUNNING" if len(self.marketplace_calls()) < 9 else self.review})
        if url == f"{component}/bundles":
            return reply(200, {"bundles": [{"review_id": "rev_1", "bundle_id": "bun_1", "bundle_status": "VALID", "bundle_url": "https://hosted"}]})
        raise AssertionError(f"unexpected {method} {url}")

    def marketplace_calls(self):
        return [call for call in self.calls if call[1].startswith(MARKETPLACE) or call[1] == "https://bundle-upload.example/"]

    def build_calls(self):
        return [call for call in self.calls if call[1].startswith(BUILD)]


class Helpers(unittest.TestCase):
    def test_tokens_round_trip(self):
        token = pvb.encode_token({"severity_label": "LOW"})
        self.assertTrue(token.endswith("."))
        self.assertEqual(pvb.decode_token(token), {"severity_label": "LOW"})
        self.assertEqual(pvb.token_header(token), {"alg": "none"})

    def test_severity_mapping(self):
        zero = dict.fromkeys(FINDINGS, 0)
        self.assertEqual(pvb.severity_for(zero), "NONE")
        self.assertEqual(pvb.severity_for({**zero, "nag_warnings": 1}), "LOW")
        self.assertEqual(pvb.severity_for({**zero, "low": 1}), "LOW")
        self.assertEqual(pvb.severity_for({**zero, "moderate": 1}), "MEDIUM")
        self.assertEqual(pvb.severity_for({**zero, "nag_errors": 1}), "HIGH")
        self.assertEqual(pvb.severity_for({**zero, "critical": 1}), "HIGH")
        self.assertTrue(pvb.is_blocking("MEDIUM"))
        self.assertFalse(pvb.is_blocking("LOW"))

    def test_audit_without_counts_fails(self):
        with self.assertRaises(pvb.PublishError):
            pvb.summarize({}, [])

    def test_nag_reports_cover_every_stack(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            lines = [
                {"ruleId": "AwsSolutions-S1", "resourceId": "B", "compliance": "Non-Compliant", "ruleLevel": "Error"},
                {"ruleId": "AwsSolutions-L1", "resourceId": "F", "compliance": "Suppressed", "ruleLevel": "Error"},
                {"ruleId": "AwsSolutions-IAM5", "resourceId": "R", "compliance": "Non-Compliant", "ruleLevel": "Warning"},
            ]
            (out / "AwsSolutions--Thing-review-NagReport.json").write_text(json.dumps({"lines": lines}))
            nag = pvb.read_nag_findings(out, ["Thing-review"])
            self.assertEqual([item["rule_id"] for item in nag], ["AwsSolutions-S1", "AwsSolutions-IAM5"])
            self.assertEqual(nag[0]["stack"], "Thing-review")
            self.assertEqual(pvb.summarize({"metadata": {"vulnerabilities": {}}}, nag)["nag_errors"], 1)
            with self.assertRaisesRegex(pvb.PublishError, "Other-review"):
                pvb.read_nag_findings(out, ["Thing-review", "Other-review"])

    def test_largest_build_token_and_comply_fit_s3_metadata(self):
        comply = pvb.encode_token(pvb.comply_payload(scan_result(), "sha256:" + "b" * 64, datetime.datetime(2026, 10, 2)))
        builder = "x" * 1200
        self.assertLessEqual(pvb.metadata_bytes({"service-builder": builder, "service-comply": comply}), pvb.MAX_METADATA_BYTES)

    def test_multipart_sends_fields_then_file_last(self):
        body, content_type = pvb.multipart([("key", "k"), ("x-amz-meta-service-comply", "tok")], "a.zip", b"PK")
        self.assertIn("multipart/form-data; boundary=", content_type)
        self.assertLess(body.index(b'name="key"'), body.index(b'name="x-amz-meta-service-comply"'))
        self.assertLess(body.index(b'name="x-amz-meta-service-comply"'), body.index(b'name="file"'))
        self.assertEqual(form_fields(body), ({"key": "k", "x-amz-meta-service-comply": "tok"}, b"PK"))

    def test_cloud_assembly_zip_rules(self):
        pvb.assert_cloud_assembly_zip(artifact_zip(["Thing-review"]))
        with self.assertRaisesRegex(pvb.PublishError, "marketplace.product.json"):
            pvb.assert_cloud_assembly_zip(artifact_zip(["Thing-review"], product=False))
        with self.assertRaisesRegex(pvb.PublishError, "Resources"):
            pvb.assert_cloud_assembly_zip(artifact_zip(["Thing-review"], resources=False))
        data = bytearray(artifact_zip(["Thing-review"]))
        eocd = data.rfind(b"PK\x05\x06")
        data[eocd + 16 : eocd + 20] = b"\xff\xff\xff\xff"
        with self.assertRaisesRegex(pvb.PublishError, "ZIP64"):
            pvb.assert_cloud_assembly_zip(bytes(data))

    def marketplace_inputs(self, severity="LOW", comply_source=None, **claims):
        artifact = artifact_zip(["Thing-review"])
        comply = pvb.encode_token({"severity_label": severity, "source_hash": comply_source or "sha256:" + "c" * 64})
        status = build_status("bld_1", artifact, "c" * 64, comply, **claims)
        return artifact, {"service-builder": status["provenance"]["service_builder"], "service-comply": comply}

    def test_marketplace_checks_pass(self):
        artifact, metadata = self.marketplace_inputs()
        self.assertIn("cloud_assembly_zip", pvb.marketplace_checks(artifact, metadata, "thing"))

    def test_marketplace_checks_reject(self):
        cases = [
            ({"severity": "MEDIUM"}, "comply_severity"),
            ({"comply_source": "sha256:" + "d" * 64}, "comply_source_hash"),
            ({"lambda_asset_policy": {"minified": True, "obfuscated": False, "source_maps": False}}, "lambda_asset_policy"),
            ({"component_id": "other"}, "component_id"),
            ({"artifact_hash": "sha256:" + "0" * 64}, "artifact_hash"),
            ({"artifact_kind": "ZIP"}, "artifact_kind"),
        ]
        for kwargs, check in cases:
            with self.subTest(check=check), self.assertRaisesRegex(pvb.PublishError, check):
                artifact, metadata = self.marketplace_inputs(**kwargs)
                pvb.marketplace_checks(artifact, metadata, "thing")
        artifact, metadata = self.marketplace_inputs()
        with self.assertRaisesRegex(pvb.PublishError, "metadata_bytes"):
            pvb.marketplace_checks(artifact, {**metadata, "service-comply": metadata["service-comply"] + "x" * 2048}, "thing")

    def test_verify_build(self):
        artifact = artifact_zip(["Thing-review"])
        manifest = zipfile.ZipFile(io.BytesIO(artifact)).read("build/build.manifest.json")
        comply = pvb.encode_token({"severity_label": "LOW"})
        ok = build_status("bld_1", artifact, "c" * 64, comply)
        self.assertIn("service_comply_binding", pvb.verify_build(ok, artifact, manifest, "c" * 64, comply, MANIFEST))
        bad = [
            (build_status("bld_1", artifact, "c" * 64, comply, iss="build/just-publish"), "build_issuer"),
            (build_status("bld_1", artifact, "c" * 64, comply, sub="bld_2"), "build_issuer"),
            (build_status("bld_1", artifact, "c" * 64, "other"), "service_comply_binding"),
            (build_status("bld_1", artifact, "e" * 64, comply), "source_hash"),
        ]
        for status, check in bad:
            with self.subTest(check=check), self.assertRaisesRegex(pvb.PublishError, check):
                pvb.verify_build(status, artifact, manifest, "c" * 64, comply, MANIFEST)
        with self.assertRaisesRegex(pvb.PublishError, "artifact_sha256"):
            pvb.verify_build(ok, artifact + b"x", manifest, "c" * 64, comply, MANIFEST)

    def test_live_stage_stacks(self):
        self.assertEqual(
            pvb.live_stage_stacks(["deploy-dev-api", "Connect-prod", "Thing-review", "devtools-review", "Thing"]),
            ["deploy-dev-api", "Connect-prod"],
        )

    def test_build_url_default_and_override(self):
        self.assertTrue(pvb.DEFAULT_BUILD_BASE_URL.startswith("https://"))
        self.assertEqual(pvb.build_base_url(f"{BUILD}/"), (BUILD, "BUILD_BASE_URL"))
        with mock.patch.object(pvb, "DEFAULT_BUILD_BASE_URL", BUILD):
            self.assertEqual(pvb.build_base_url(None), (BUILD, "default"))
        with self.assertRaises(pvb.PublishError):
            pvb.build_base_url("http://build.example/dev")

    def test_build_key_rejected_is_a_deployment_gap(self):
        fake = FakeServices(key_status=403)
        with mock.patch.object(pvb, "http_request", fake):
            with self.assertRaisesRegex(pvb.PublishError, "deployment gap for Tinkaton"):
                pvb.build_preflight(pvb.Api("Build", BUILD, KEY))


class MainFlow(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name) / "product"
        self.repo.mkdir()
        git = lambda *args: subprocess.run(["git", "-C", str(self.repo), *args], check=True, capture_output=True)
        git("init", "-q")
        (self.repo / "marketplace.product.json").write_text(json.dumps(MANIFEST))
        git("add", ".")
        git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "init")
        git("update-ref", "refs/remotes/origin/main", "HEAD")
        self.git = git

    def tearDown(self):
        self.tmp.cleanup()

    def run_main(self, fake, env, scan=None, argv=()):
        out, err = io.StringIO(), io.StringIO()
        environment = {
            "MARKETPLACE_API_KEY": KEY,
            "BUILD_BASE_URL": BUILD,
            "MARKETPLACE_BASE_URL": MARKETPLACE,
            "MARKETPLACE_PRODUCT_ID": "",
            "MARKETPLACE_PRODUCT_NAME": "",
            **env,
        }
        with mock.patch.dict(os.environ, environment, clear=False), mock.patch.object(pvb, "http_request", fake), mock.patch.object(
            pvb, "run_security_scan", return_value=scan or scan_result()
        ), mock.patch.object(pvb, "sleep", lambda seconds: None), redirect_stdout(out), redirect_stderr(err):
            code = pvb.main([str(self.repo), "--no-fetch", "--work-dir", str(Path(self.tmp.name) / "work"), *argv])
        printed = out.getvalue() + err.getvalue()
        for secret in (KEY, "ARTIFACTSECRET", "BUNDLESECRET", "source-upload.example", "bundle-upload.example"):
            self.assertNotIn(secret, printed)
        return code, json.loads(out.getvalue())

    def test_dry_run_builds_checks_and_never_calls_marketplace(self):
        fake = FakeServices()
        code, report = self.run_main(fake, {"DRY_RUN": "1"})
        self.assertEqual(code, 0, report.get("error"))
        self.assertEqual(fake.marketplace_calls(), [])
        self.assertTrue(all(h.get("x-api-key") == KEY for (_, url), h in zip(fake.calls, fake.headers) if url.startswith(BUILD)))
        self.assertEqual(report["build"]["build_id"], "bld_1")
        self.assertEqual(report["service_comply"]["source_hash"], f"sha256:{fake.source_sha}")
        self.assertEqual(report["service_builder"]["source_hash"], report["service_comply"]["source_hash"])
        self.assertIn("cloud_assembly_zip", report["checks"]["marketplace"])
        self.assertTrue(report["review_stage"]["safe"])

    def test_dry_run_reports_live_stage_stacks(self):
        fake = FakeServices(stack_names=("Thing-dev",))
        code, report = self.run_main(fake, {"DRY_RUN": "1"}, scan=scan_result(stack_names=("Thing-dev",)))
        self.assertEqual(code, 1)
        self.assertIn("live stage", report["error"])
        self.assertEqual(report["review_stage"]["live_stage_stacks"], ["Thing-dev"])
        self.assertIn("cloud_assembly_zip", report["checks"]["marketplace"])
        self.assertEqual(fake.marketplace_calls(), [])

    def test_publish_uploads_both_tokens_and_polls_review(self):
        fake = FakeServices()
        code, report = self.run_main(fake, {"DRY_RUN": ""})
        self.assertEqual(code, 0, report.get("error"))
        fields, data = fake.marketplace_upload
        self.assertEqual(data, fake.artifact)
        self.assertEqual(fields["x-amz-meta-service-comply"], fake.comply)
        self.assertEqual(pvb.decode_token(fields["x-amz-meta-service-builder"])["iss"], "build")
        self.assertEqual(fake.put_body, {"bundle_url": BUNDLE_URL, "skip_review": False})
        self.assertEqual(report["publish"]["bundle_status"], "VALID")
        self.assertEqual(fake.calls[0], ("GET", f"{MARKETPLACE}/settings/status"))

    def test_live_stage_stops_before_build_when_publishing(self):
        fake = FakeServices()
        code, report = self.run_main(fake, {"DRY_RUN": ""}, scan=scan_result(stack_names=("Thing-prod",)))
        self.assertEqual(code, 1)
        self.assertNotIn(("POST", f"{BUILD}/sources"), fake.calls)
        self.assertNotIn(("POST", f"{MARKETPLACE}/ontology/products/{PRODUCT_ID}/components/thing/bundle-uploads"), fake.calls)

    def test_blocking_scan_starts_no_build(self):
        fake = FakeServices()
        code, report = self.run_main(fake, {"DRY_RUN": "1"}, scan=scan_result(severity="MEDIUM"))
        self.assertEqual(code, 1)
        self.assertIn("MEDIUM", report["error"])
        self.assertNotIn(("POST", f"{BUILD}/sources"), fake.calls)

    def test_missing_key_makes_no_calls(self):
        fake = FakeServices()
        code, report = self.run_main(fake, {"DRY_RUN": "1", "MARKETPLACE_API_KEY": ""})
        self.assertEqual(code, 1)
        self.assertIn("MARKETPLACE_API_KEY is unset", report["error"])
        self.assertEqual(fake.calls, [])

    def test_rejected_marketplace_key_stops_before_build(self):
        fake = FakeServices(settings_status=403)
        code, report = self.run_main(fake, {"DRY_RUN": ""})
        self.assertEqual(code, 1)
        self.assertIn("MARKETPLACE_API_KEY was rejected", report["error"])
        self.assertEqual(fake.build_calls(), [])

    def test_unmerged_ref_is_refused(self):
        (self.repo / "extra.txt").write_text("x")
        self.git("add", ".")
        self.git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "unmerged")
        fake = FakeServices()
        code, report = self.run_main(fake, {"DRY_RUN": "1"}, argv=("--ref", "HEAD"))
        self.assertEqual(code, 1)
        self.assertIn("not on origin/main", report["error"])
        self.assertNotIn(("POST", f"{BUILD}/sources"), fake.calls)

    def test_named_branch_replaces_the_remote_default(self):
        self.git("update-ref", "refs/remotes/origin/release", "HEAD")
        self.git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/missing")
        fake = FakeServices()
        code, report = self.run_main(fake, {"DRY_RUN": "1"}, argv=("--branch", "release"))
        self.assertEqual(code, 0, report.get("error"))
        self.assertEqual(report["source"]["on"], "origin/release")


if __name__ == "__main__":
    unittest.main()
