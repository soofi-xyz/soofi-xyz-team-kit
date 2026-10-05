#!/usr/bin/env python3
"""Publish a product to Prism Marketplace with a bundle built by the Build service.

  publish_via_build.py <product-repo> [--branch BRANCH] [--ref REF] [--work-dir DIR]
                       [--no-fetch] [--marketplace-repo PATH] [--marketplace-ref REF]

1. Source: resolve REF (default: the tip of origin/BRANCH, where BRANCH defaults
   to the remote default branch) to a commit on origin/BRANCH and `git archive`
   it as source.zip. The product checkout is only read (and fetched unless
   --no-fetch).
2. Security scan of that zip: install with lifecycle scripts off, a
   credential-free `tsx marketplace/app.ts` synth the way Build runs it
   (CDK_OUTDIR plus cdk.json/cdk.context.json context), the package manager's
   production audit and the cdk-nag report of every manifest stack. cdk-nag
   AwsSolutionsChecks is applied for the scan when the app does not apply it.
   The results become the `service-comply` token, bound to the zip by
   `source_hash`. MEDIUM or worse stops before Build.
3. Build: POST /sources (the comply token rides along, so Build binds it as
   `service_comply_sha256`), POST /builds, poll GET /builds/{id}, download the
   artifact and manifest and verify them against the build's provenance.
   `service-builder` is Build's own token from the build status.
4. Check the artifact and both tokens against Marketplace's bundle rules
   (lambda/services/bundle-review.ts), the 2 KB S3 metadata limit and the
   review-stage rule. --marketplace-repo also runs Marketplace's own
   validators from that checkout's ref against the artifact, offline.
5. Unless DRY_RUN=1: POST .../bundle-uploads, upload the zip with both tokens,
   PUT .../bundles, poll GET /reviews/{id} and read the bundle row.

Build runs in the Marketplace account on the same shared usage plan, so the
one key, MARKETPLACE_API_KEY, authorizes both APIs.

Env:
  MARKETPLACE_API_KEY                  required; x-api-key for Marketplace and Build
  DRY_RUN=1                            stop before any Marketplace call
  MARKETPLACE_BASE_URL                 https://<host>/.../marketplace (default: Prism Marketplace)
  BUILD_BASE_URL                       Build API URL (default: DEFAULT_BUILD_BASE_URL)
  MARKETPLACE_PRODUCT_ID               product UUID (default: by-name lookup)
  MARKETPLACE_PRODUCT_NAME             default: the manifest's component_name
  BUILD_TIMEOUT_SECONDS                default 1200
  MARKETPLACE_REVIEW_TIMEOUT_SECONDS   default 1200

Prints progress on stderr and one JSON report on stdout. Never prints API keys,
upload forms, or presigned artifact/bundle URLs. Exits 1 on any stop.
"""

from __future__ import annotations

import argparse
import base64
import datetime
import hashlib
import io
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import uuid
import zipfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote, urlparse

DEFAULT_MARKETPLACE_BASE_URL = "https://1ubssdfzw2.execute-api.us-east-2.amazonaws.com/dev/marketplace"
DEFAULT_BUILD_BASE_URL = "https://5b45a3h1bd.execute-api.us-east-2.amazonaws.com/dev"
ISSUER = "registeel/publish-via-build"
MAX_BUNDLE_BYTES = 268_435_456
MAX_METADATA_BYTES = 2048
CDK_NAG_VERSION = "2.38.2"
TSX_VERSION = "4.20.5"
BLOCKING_SEVERITIES = {"CRITICAL", "HIGH", "MEDIUM"}
TERMINAL_BUILD = {"SUCCEEDED", "FAILED", "CANCELLED"}
PACKED_STAGE = "review"
LIVE_STAGE = re.compile(r"(?:^|-)(?:dev|prod)(?:-|$)", re.IGNORECASE)
NAG_REPORT = re.compile(r"^AwsSolutions-(.*)-NagReport\.json$")
NULL_BUILD_ID = "bld_00000000000000000000000000"
REQUIRED_CAPABILITIES = ("source-uploads", "marketplace-artifact")
LAMBDA_ASSET_POLICY = {"minified": True, "obfuscated": True, "source_maps": False}
REQUIRED_ZIP_ENTRIES = ("marketplace.product.json", "cdk.out/manifest.json", "build/build.manifest.json")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
PASSTHROUGH_ENV = ("PATH", "LANG", "LC_ALL", "TERM")
MARKETPLACE_KEY_STEPS = "follow Prerequisites in skills/operate-marketplace/SKILL.md to get and set it, then restart Cursor"

NAG_PRELOAD = """\
import { createRequire } from "node:module";
const productRequire = createRequire(process.env.PUBLISH_SCAN_PRODUCT_ROOT + "/package.json");
const nagRequire = createRequire(process.env.PUBLISH_SCAN_NAG_ROOT + "/package.json");
const cdk = productRequire("aws-cdk-lib");
const nag = nagRequire("cdk-nag");
const isNag = (aspect) => aspect instanceof nag.AwsSolutionsChecks || aspect?.constructor?.name === "AwsSolutionsChecks";
const synth = cdk.App.prototype.synth;
cdk.App.prototype.synth = function (options) {
  if (!this.node.findAll().some((node) => cdk.Aspects.of(node).all.some(isNag))) {
    cdk.Aspects.of(this).add(new nag.AwsSolutionsChecks({ reports: true, reportFormats: [nag.NagReportFormat.JSON] }));
    process.stderr.write("publish-via-build: applied cdk-nag AwsSolutionsChecks for the scan\\n");
  }
  return synth.call(this, options);
};
"""

MARKETPLACE_VALIDATOR = """\
import { readFileSync } from "node:fs";
import { assertComplyPassed, downloadBundle, inspectBundle } from "./bundle-review.mts";
const body = readFileSync(process.env.MP_ARTIFACT);
const headers = {
  "content-length": String(body.byteLength),
  "x-amz-meta-service-builder": process.env.MP_BUILDER,
  "x-amz-meta-service-comply": process.env.MP_COMPLY,
};
globalThis.fetch = async (_url, init) =>
  new Response(init?.method === "HEAD" ? null : body, { status: 200, headers });
const url = "https://bundle-check.s3.us-east-2.amazonaws.com/bundle.zip";
const metadata = await inspectBundle(url);
assertComplyPassed(metadata);
if (metadata.builder.component_id !== process.env.MP_COMPONENT_ID) {
  throw new Error("service-builder component_id does not match the component");
}
await downloadBundle(url, metadata.builder.artifact_hash);
console.log(JSON.stringify({ ok: true, checks: ["inspectBundle", "assertComplyPassed", "component_id", "downloadBundle"] }));
"""


class PublishError(Exception):
    """A stop condition. The message never contains a secret."""


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def compact(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"))


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _segment(segment: str) -> dict[str, Any]:
    try:
        value = json.loads(base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4)))
    except ValueError as exc:
        raise PublishError("token segment is not base64url JSON") from exc
    if not isinstance(value, dict):
        raise PublishError("token segment is not a JSON object")
    return value


COMPLY_HEADER = b64url(compact({"alg": "none"}).encode())


def encode_token(payload: dict[str, Any]) -> str:
    """Unsigned `header.payload.` token, the shape Marketplace decodes."""
    return f"{COMPLY_HEADER}.{b64url(compact(payload).encode())}."


def decode_token(token: str) -> dict[str, Any]:
    parts = token.split(".")
    return _segment(parts[1] if len(parts) > 1 else parts[0])


def token_header(token: str) -> dict[str, Any]:
    return _segment(token.split(".")[0])


def metadata_bytes(metadata: dict[str, str]) -> int:
    """S3 counts every user-metadata key (without x-amz-meta-) and value toward 2 KB."""
    return sum(len(key.encode()) + len(value.encode()) for key, value in metadata.items())


def strip_sha(value: Any) -> str:
    return value[len("sha256:") :] if isinstance(value, str) and value.startswith("sha256:") else str(value or "")


# ---------- security scan ----------


def severity_for(findings: dict[str, int]) -> str:
    if findings["critical"] or findings["high"] or findings["nag_errors"]:
        return "HIGH"
    if findings["moderate"]:
        return "MEDIUM"
    if findings["low"] or findings["nag_warnings"]:
        return "LOW"
    return "NONE"


def is_blocking(severity: str) -> bool:
    return severity.upper() in BLOCKING_SEVERITIES


def summarize(audit: dict[str, Any], nag: list[dict[str, Any]]) -> dict[str, int]:
    counts = (audit.get("metadata") or {}).get("vulnerabilities")
    if not isinstance(counts, dict):
        raise PublishError("dependency audit did not return vulnerability counts")
    return {
        "critical": int(counts.get("critical") or 0),
        "high": int(counts.get("high") or 0),
        "moderate": int(counts.get("moderate") or 0),
        "low": int(counts.get("low") or 0),
        "nag_errors": sum(1 for item in nag if item["level"] == "Error"),
        "nag_warnings": sum(1 for item in nag if item["level"] == "Warning"),
    }


def assembly_stack_names(cdk_out: Path, stack_ids: list[str]) -> list[str]:
    """CloudFormation stack names the assembly deploys for the manifest's construct ids."""
    artifacts = json.loads((cdk_out / "manifest.json").read_text(encoding="utf-8")).get("artifacts") or {}
    names = []
    for stack_id in stack_ids:
        name = ((artifacts.get(stack_id) or {}).get("properties") or {}).get("stackName")
        if not name:
            raise PublishError(f"cdk.out has no stack artifact for {stack_id}")
        names.append(name)
    return names


def report_stack_name(file_name: str) -> str:
    """cdk-nag names reports `AwsSolutions-<stage path>-<stackName>`; a root stack has an empty stage path."""
    return re.sub(r"^-", "", NAG_REPORT.match(file_name).group(1))


def read_nag_findings(cdk_out: Path, stack_names: list[str]) -> list[dict[str, Any]]:
    """Non-compliant cdk-nag lines; fails unless every expected stack has a report."""
    reports = sorted(path.name for path in cdk_out.iterdir() if NAG_REPORT.match(path.name))
    reported = {report_stack_name(name) for name in reports}
    missing = [name for name in stack_names if name not in reported]
    if not stack_names or missing:
        raise PublishError(f"cdk-nag reports missing for {', '.join(missing) or 'all stacks'}")
    findings = []
    for name in reports:
        report = json.loads((cdk_out / name).read_text(encoding="utf-8"))
        for line in report.get("lines") or []:
            if line.get("compliance") == "Non-Compliant":
                findings.append(
                    {
                        "stack": report_stack_name(name),
                        "rule_id": line.get("ruleId"),
                        "level": line.get("ruleLevel"),
                        "resource_id": line.get("resourceId"),
                    }
                )
    return findings


def comply_payload(scan: dict[str, Any], source_hash: str, scanned_at: datetime.datetime) -> dict[str, Any]:
    return {
        "issuer": ISSUER,
        "scanners": scan["scanners"],
        "severity_label": scan["severity_label"],
        "findings": scan["findings"],
        "source_hash": source_hash,
        "scanned_at": scanned_at.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def product_context(source_dir: Path) -> str:
    """CDK context Build passes: cdk.json "context" over cdk.context.json, with stage=review over both."""
    merged: dict[str, Any] = {}
    cached = source_dir / "cdk.context.json"
    if cached.is_file():
        merged.update(json.loads(cached.read_text(encoding="utf-8")))
    project = source_dir / "cdk.json"
    if project.is_file():
        context = json.loads(project.read_text(encoding="utf-8")).get("context") or {}
        if not isinstance(context, dict):
            raise PublishError('cdk.json "context" must be an object')
        merged.update(context)
    merged["stage"] = PACKED_STAGE
    return compact(merged)


def package_manager(source_dir: Path) -> str:
    found = [name for name, lock in (("pnpm", "pnpm-lock.yaml"), ("npm", "package-lock.json")) if (source_dir / lock).is_file()]
    if len(found) != 1:
        raise PublishError("the source needs exactly one lockfile: pnpm-lock.yaml or package-lock.json")
    return found[0]


def product_env(home: Path, extra: dict[str, str] | None = None) -> dict[str, str]:
    """Environment for product code: no AWS or API credentials, no user npmrc."""
    env = {name: os.environ[name] for name in PASSTHROUGH_ENV if name in os.environ}
    env.update(
        HOME=str(home),
        COREPACK_HOME=os.environ.get("COREPACK_HOME", str(Path.home() / ".cache" / "node" / "corepack")),
        AWS_CONFIG_FILE=os.devnull,
        AWS_SHARED_CREDENTIALS_FILE=os.devnull,
        AWS_EC2_METADATA_DISABLED="true",
        CI="true",
    )
    env.update(extra or {})
    return env


def run(cmd: list[str], cwd: Path, env: dict[str, str], capture: bool = False, check: bool = True, timeout: int = 1800) -> subprocess.CompletedProcess:
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            env=env,
            stdout=subprocess.PIPE if capture else sys.stderr,
            stderr=subprocess.PIPE if capture else sys.stderr,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise PublishError(f"{' '.join(cmd[:3])} could not run: {exc.__class__.__name__}") from exc
    if check and result.returncode != 0:
        if capture and result.stderr:
            log("\n".join(result.stderr.strip().splitlines()[-20:]))
        raise PublishError(f"{' '.join(cmd[:3])} failed (exit {result.returncode})")
    return result


def tsx_command(source_dir: Path) -> list[str]:
    local = source_dir / "node_modules" / ".bin" / "tsx"
    return [str(local)] if local.exists() else ["npx", "--yes", f"tsx@{TSX_VERSION}"]


def nag_root(source_dir: Path, scanner_dir: Path, env: dict[str, str]) -> Path:
    """The product's cdk-nag when it has one, else a pinned copy sharing the product's aws-cdk-lib."""
    if (source_dir / "node_modules" / "cdk-nag" / "package.json").is_file():
        return source_dir
    scanner_dir.mkdir(parents=True, exist_ok=True)
    (scanner_dir / "package.json").write_text("{}\n", encoding="utf-8")
    run(
        ["npm", "install", "--no-save", "--no-package-lock", "--legacy-peer-deps", "--ignore-scripts", f"cdk-nag@{CDK_NAG_VERSION}"],
        scanner_dir,
        env,
    )
    for peer in ("aws-cdk-lib", "constructs"):
        target = source_dir / "node_modules" / peer
        if not target.exists():
            raise PublishError(f"the product has no {peer} dependency")
        link = scanner_dir / "node_modules" / peer
        if link.exists() or link.is_symlink():
            shutil.rmtree(link) if link.is_dir() and not link.is_symlink() else link.unlink()
        link.symlink_to(target.resolve(), target_is_directory=True)
    return scanner_dir


def run_security_scan(source_dir: Path, work_dir: Path, stack_ids: list[str]) -> dict[str, Any]:
    home = work_dir / "scan-home"
    home.mkdir(parents=True, exist_ok=True)
    env = product_env(home)
    manager = package_manager(source_dir)
    log(f"scan: installing with {manager} (lifecycle scripts off)")
    if manager == "pnpm":
        run(["pnpm", "install", "--frozen-lockfile", "--ignore-scripts", "--ignore-pnpmfile"], source_dir, env)
        audit_cmd = ["pnpm", "audit", "--prod", "--json"]
    else:
        run(["npm", "ci", "--ignore-scripts"], source_dir, env)
        audit_cmd = ["npm", "audit", "--omit=dev", "--json"]
    audit_raw = run(audit_cmd, source_dir, env, capture=True, check=False).stdout
    try:
        audit = json.loads(audit_raw)
    except ValueError as exc:
        raise PublishError(f"{' '.join(audit_cmd[:2])} did not return JSON") from exc
    manager_version = run([manager, "--version"], source_dir, env, capture=True).stdout.strip()

    root = nag_root(source_dir, work_dir / "scanner", env)
    nag_version = json.loads((root / "node_modules" / "cdk-nag" / "package.json").read_text(encoding="utf-8"))["version"]
    preload = work_dir / "nag-preload.mjs"
    preload.write_text(NAG_PRELOAD, encoding="utf-8")
    cdk_out = work_dir / "scan-cdk.out"
    shutil.rmtree(cdk_out, ignore_errors=True)
    synth_env = {
        "CDK_OUTDIR": str(cdk_out),
        "NODE_OPTIONS": f"--import={preload.as_uri()}",
        "PUBLISH_SCAN_PRODUCT_ROOT": str(source_dir),
        "PUBLISH_SCAN_NAG_ROOT": str(root),
    }
    synth_env["CDK_CONTEXT_JSON"] = product_context(source_dir)
    log("scan: credential-free synth of marketplace/app.ts")
    run([*tsx_command(source_dir), "marketplace/app.ts"], source_dir, product_env(home, synth_env))

    stack_names = assembly_stack_names(cdk_out, stack_ids)
    nag = read_nag_findings(cdk_out, stack_names)
    findings = summarize(audit, nag)
    return {
        "scanners": [f"{manager}-audit@{manager_version}", f"cdk-nag@{nag_version}"],
        "severity_label": severity_for(findings),
        "findings": findings,
        "nag": nag,
        "stack_names": stack_names,
        "nag_from_product": root == source_dir,
    }


# ---------- HTTP ----------


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def http_request(method: str, url: str, headers: dict[str, str], body: bytes | None, label: str, timeout: int = 60) -> tuple[int, bytes]:
    """The only network call. Errors name `label`, never the URL."""
    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with _OPENER.open(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()
    except (urllib.error.URLError, OSError) as exc:
        raise PublishError(f"{label} is unreachable ({exc.__class__.__name__})") from exc


class Api:
    def __init__(self, label: str, base: str, key: str):
        self.label, self.base, self.key = label, base.rstrip("/"), key

    def raw(self, method: str, path: str, body: Any = None) -> tuple[int, bytes]:
        headers = {"x-api-key": self.key}
        data = None
        if body is not None:
            headers["content-type"] = "application/json"
            data = json.dumps(body).encode()
        return http_request(method, f"{self.base}{path}", headers, data, f"{self.label} {method} {path}")

    def call(self, method: str, path: str, body: Any = None) -> tuple[int, dict[str, Any]]:
        status, raw = self.raw(method, path, body)
        try:
            parsed = json.loads(raw) if raw else {}
        except ValueError:
            parsed = {}
        return status, parsed if isinstance(parsed, dict) else {}

    def require(self, method: str, path: str, body: Any = None, expect: tuple[int, ...] = (200,)) -> dict[str, Any]:
        status, data = self.call(method, path, body)
        if status not in expect:
            tag = (data.get("error") or {}).get("tag") if isinstance(data.get("error"), dict) else None
            raise PublishError(f"{self.label} {method} {path} returned {status} {tag or 'unknown'}")
        return data


def multipart(fields: list[tuple[str, str]], file_name: str, data: bytes) -> tuple[bytes, str]:
    """A presigned S3 POST body: every field in order, then the file last."""
    boundary = f"publish-via-build-{uuid.uuid4().hex}"
    chunks = [
        f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        for name, value in fields
    ]
    chunks.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{file_name}"\r\n'
        "Content-Type: application/zip\r\n\r\n".encode()
        + data
        + b"\r\n"
    )
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def post_form(upload: dict[str, Any], extra: dict[str, str], data: bytes, file_name: str, label: str) -> None:
    body, content_type = multipart([*upload["fields"].items(), *extra.items()], file_name, data)
    status, raw = http_request("POST", upload["url"], {"content-type": content_type}, body, f"{label} upload", timeout=600)
    if status not in (200, 201, 204):
        code = re.search(rb"<Code>([A-Za-z]+)</Code>", raw or b"")
        raise PublishError(f"{label} upload returned {status} {code.group(1).decode() if code else 'unknown'}")


# ---------- source ----------


def git(repo: Path, *args: str) -> str:
    result = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    if result.returncode != 0:
        raise subprocess.CalledProcessError(result.returncode, args[0], result.stdout, result.stderr)
    return result.stdout.strip()


def resolve_source(repo: Path, ref: str | None, branch: str | None, fetch: bool) -> tuple[str, str]:
    """Commit for `ref` and the remote branch it must be on (`branch`, else the remote default)."""
    try:
        if fetch:
            git(repo, "fetch", "--quiet", "origin")
        if branch:
            default = f"origin/{branch}"
        else:
            try:
                default = git(repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")
            except subprocess.CalledProcessError:
                default = "origin/main"
        commit = git(repo, "rev-parse", "--verify", f"{ref or default}^{{commit}}")
    except subprocess.CalledProcessError as exc:
        raise PublishError(f"git {exc.cmd} failed in {repo}: {(exc.stderr or '').strip().splitlines()[-1:]}") from exc
    try:
        git(repo, "merge-base", "--is-ancestor", commit, default)
    except subprocess.CalledProcessError as exc:
        raise PublishError(f"{ref or default} ({commit[:12]}) is not on {default}; publish only merged commits of that branch") from exc
    return commit, default


def read_product_manifest(source_zip: bytes) -> dict[str, Any]:
    with zipfile.ZipFile(io.BytesIO(source_zip)) as archive:
        if "marketplace.product.json" not in archive.namelist():
            raise PublishError("marketplace.product.json must be at the repository root")
        manifest = json.loads(archive.read("marketplace.product.json"))
    for field in ("component_id", "component_name", "bundle_type", "stacks"):
        if not manifest.get(field):
            raise PublishError(f"marketplace.product.json has no {field}")
    if manifest["bundle_type"] not in ("SERVICE", "DATA"):
        raise PublishError("marketplace.product.json bundle_type must be SERVICE or DATA")
    return manifest


# ---------- Build ----------


def build_preflight(api: Api) -> dict[str, Any]:
    status, info = api.call("GET", "/information")
    if status != 200 or info.get("service") != "build":
        raise PublishError(f"BUILD_BASE_URL does not reach Build (GET /information returned {status})")
    missing = [cap for cap in REQUIRED_CAPABILITIES if cap not in (info.get("capabilities") or [])]
    if missing:
        raise PublishError(f"Build lacks capabilities {', '.join(missing)}")
    status, _ = api.call("GET", f"/builds/{NULL_BUILD_ID}")
    if status == 403:
        raise PublishError(
            "Build rejected MARKETPLACE_API_KEY (403 ApiKeyDenied): Build's API stage is not on the Marketplace "
            "account's shared usage plan yet. This is a Build deployment gap for Tinkaton, not a key problem."
        )
    if status != 404:
        raise PublishError(f"Build key check returned {status}, expected 404")
    return info


def run_build(api: Api, source_zip: bytes, comply_token: str, manifest: dict[str, Any], timeout: int) -> dict[str, Any]:
    source = api.require("POST", "/sources", {}, expect=(201,))
    post_form(
        source["upload"],
        {"x-amz-meta-service-code": "", "x-amz-meta-service-comply": comply_token},
        source_zip,
        "source.zip",
        "Build source",
    )
    log(f"build: uploaded {source['source_id']}")
    started = api.require(
        "POST",
        "/builds",
        {"source_id": source["source_id"], "bundle_type": manifest["bundle_type"], "component_id": manifest["component_id"]},
        expect=(202,),
    )
    build_id = started["build_id"]
    log(f"build: {build_id} started (transaction {started.get('transaction_id')})")
    deadline = time.monotonic() + timeout
    last = None
    while True:
        status = api.require("GET", f"/builds/{build_id}")
        if status.get("build_status") != last:
            last = status.get("build_status")
            log(f"build: {build_id} {last}")
        if last in TERMINAL_BUILD:
            break
        if time.monotonic() > deadline:
            raise PublishError(f"build {build_id} still {last} after {timeout}s")
        sleep(10)
    status["source_id"] = source["source_id"]
    status["transaction_id"] = started.get("transaction_id")
    if last != "SUCCEEDED":
        logs = api.require("GET", f"/builds/{build_id}/logs?limit=500")
        log("\n".join(entry.get("message", "") for entry in (logs.get("entries") or [])[-40:]))
        failure = status.get("failure") or {}
        raise PublishError(f"build {build_id} {last}: {failure.get('tag')} at {failure.get('phase')}: {failure.get('reason')}")
    return status


def download_build_outputs(api: Api, status: dict[str, Any]) -> tuple[bytes, bytes]:
    artifact_url = status.pop("artifact_url", None)
    if not artifact_url:
        raise PublishError(f"build {status['build_id']} has no artifact_url")
    code, artifact = http_request("GET", artifact_url, {}, None, "Build artifact download", timeout=600)
    del artifact_url
    if code != 200:
        raise PublishError(f"Build artifact download returned {code}")
    code, manifest = api.raw("GET", f"/builds/{status['build_id']}/manifest")
    if code != 200:
        raise PublishError(f"Build GET /builds/{status['build_id']}/manifest returned {code}")
    return artifact, manifest


def zip_entry(artifact: bytes, path: str) -> bytes:
    with zipfile.ZipFile(io.BytesIO(artifact)) as archive:
        return archive.read(path)


def verify_build(status: dict[str, Any], artifact: bytes, manifest_route: bytes, source_sha256: str, comply_token: str, product: dict[str, Any]) -> list[str]:
    """Build's own consumer checks; raises on the first failure."""
    passed: list[str] = []

    def check(name: str, ok: bool, detail: str) -> None:
        if not ok:
            raise PublishError(f"Build output check {name} failed: {detail}")
        passed.append(name)

    provenance = status.get("provenance") or {}
    token = provenance.get("service_builder") or ""
    check("service_builder_present", bool(token), "status has no provenance.service_builder")
    builder = decode_token(token)
    artifact_sha = sha256_hex(artifact)
    check(
        "artifact_sha256",
        artifact_sha == provenance.get("artifact_sha256") == strip_sha(builder.get("artifact_hash")),
        "download, provenance.artifact_sha256 and service-builder artifact_hash differ",
    )
    in_zip = sha256_hex(zip_entry(artifact, "build/build.manifest.json"))
    check(
        "build_manifest_sha256",
        sha256_hex(manifest_route) == in_zip == provenance.get("build_manifest_sha256"),
        "manifest route, zip entry and provenance.build_manifest_sha256 differ",
    )
    check(
        "source_hash",
        builder.get("source_hash") == f"sha256:{source_sha256}" and strip_sha(provenance.get("source_sha256")) == source_sha256,
        "Build's source hash is not the uploaded zip's sha256",
    )
    check(
        "build_issuer",
        token_header(token) == {"alg": "none", "typ": "JWT"}
        and token.endswith(".")
        and builder.get("iss") == "build"
        and builder.get("sub") == status.get("build_id"),
        "service-builder is not Build's token for this build",
    )
    check("component_id", builder.get("component_id") == product["component_id"], "service-builder component_id differs from the manifest")
    check(
        "service_comply_binding",
        provenance.get("service_comply") == "PRESENT" and builder.get("service_comply_sha256") == sha256_hex(comply_token.encode()),
        "Build did not bind the uploaded service-comply token",
    )
    check("artifact_built", (status.get("runner") or {}).get("artifact_built") is True, "runner.artifact_built is not true")
    policy = status.get("asset_policy") or {}
    check(
        "asset_policy",
        policy.get("outcome") == "PASSED" and all(a.get("framework") or a.get("obfuscated") for a in policy.get("lambda_assets") or []),
        "asset policy did not pass for every product Lambda asset",
    )
    return passed


# ---------- Marketplace checks ----------


def assert_cloud_assembly_zip(artifact: bytes) -> None:
    """Mirror of Marketplace's assertCloudAssemblyZip plus its non-ZIP64 rule."""
    eocd = artifact.rfind(b"PK\x05\x06", max(0, len(artifact) - 22 - 65535))
    if eocd < 0 or eocd + 22 > len(artifact):
        raise PublishError("bundle is not a zip archive")
    if struct.unpack_from("<I", artifact, eocd + 16)[0] == 0xFFFFFFFF:
        raise PublishError("ZIP64 bundles are not supported")
    try:
        archive = zipfile.ZipFile(io.BytesIO(artifact))
    except zipfile.BadZipFile as exc:
        raise PublishError("bundle is not a zip archive") from exc
    with archive:
        names = archive.namelist()

        def json_object(name: str) -> dict[str, Any]:
            try:
                value = json.loads(archive.read(name))
            except (ValueError, zipfile.BadZipFile) as exc:
                raise PublishError(f"bundle entry {name} is not valid JSON") from exc
            if not isinstance(value, dict):
                raise PublishError(f"bundle entry {name} is not a JSON object")
            return value

        for path in REQUIRED_ZIP_ENTRIES:
            entry = next((name for name in names if name == path or name.endswith(f"/{path}")), None)
            if entry is None:
                raise PublishError(f"bundle is missing {path}")
            json_object(entry)
        templates = [name for name in names if name.endswith(".template.json")]
        if not templates:
            raise PublishError("bundle is missing a CloudFormation template")
        for name in templates:
            if not isinstance(json_object(name).get("Resources"), dict):
                raise PublishError(f"bundle template {name} has no Resources")


def marketplace_checks(artifact: bytes, metadata: dict[str, str], component_id: str) -> list[str]:
    """Marketplace's inspectBundle, assertComplyPassed, component and download rules, offline."""
    passed: list[str] = []

    def check(name: str, ok: bool, detail: str) -> None:
        if not ok:
            raise PublishError(f"Marketplace check {name} failed: {detail}")
        passed.append(name)

    builder = decode_token(metadata["service-builder"])
    comply = decode_token(metadata["service-comply"])
    check("size", 0 < len(artifact) <= MAX_BUNDLE_BYTES, f"bundle must be 1..{MAX_BUNDLE_BYTES} bytes")
    check("metadata_bytes", metadata_bytes(metadata) <= MAX_METADATA_BYTES, f"S3 metadata is {metadata_bytes(metadata)} bytes")
    check(
        "artifact_kind",
        builder.get("artifact_kind") == "CDK_CLOUD_ASSEMBLY" and builder.get("deployer_contract_version") == "1",
        "not a supported Build CDK cloud assembly",
    )
    check(
        "hashes",
        all(isinstance(builder.get(f), str) and builder[f].startswith("sha256:") for f in ("source_hash", "assembly_hash", "artifact_hash")),
        "source_hash, assembly_hash and artifact_hash must be sha256: values",
    )
    check("cloud_assembly", isinstance(builder.get("cloud_assembly"), dict), "cloud_assembly is required")
    check("deployment_parameters", isinstance(builder.get("deployment_parameters"), dict), "deployment_parameters is required")
    policy = builder.get("lambda_asset_policy")
    check(
        "lambda_asset_policy",
        isinstance(policy, dict) and all(policy.get(k) is v for k, v in LAMBDA_ASSET_POLICY.items()),
        "lambda_asset_policy must be minified/obfuscated true and source_maps false",
    )
    check("component_id", builder.get("component_id") == component_id, f"service-builder component_id must be '{component_id}'")
    severity = str(comply.get("severity_label") or "").upper()
    check("comply_severity", bool(severity) and not is_blocking(severity), f"service-comply severity is {severity or 'missing'}")
    check("comply_source_hash", comply.get("source_hash") == builder.get("source_hash"), "service-comply source_hash differs from service-builder")
    check("artifact_hash", strip_sha(builder.get("artifact_hash")) == sha256_hex(artifact), "service-builder artifact_hash does not match")
    assert_cloud_assembly_zip(artifact)
    passed.append("cloud_assembly_zip")
    return passed


def live_stage_stacks(stack_names: list[str]) -> list[str]:
    """Stack names carrying a dev/prod stage; the sandbox review would update those installs."""
    return [name for name in stack_names if LIVE_STAGE.search(name)]


def run_marketplace_validator(repo: Path, ref: str, work_dir: Path, artifact_path: Path, metadata: dict[str, str], component_id: str) -> dict[str, Any]:
    """Runs Marketplace's own bundle-review.ts from `ref` against the artifact with fetch stubbed out."""
    target = work_dir / "marketplace-validator"
    target.mkdir(parents=True, exist_ok=True)
    try:
        revision = git(repo, "rev-parse", f"{ref}^{{commit}}")
        (target / "bundle-review.mts").write_text(git(repo, "show", f"{revision}:lambda/services/bundle-review.ts") + "\n", encoding="utf-8")
    except subprocess.CalledProcessError as exc:
        raise PublishError(f"cannot read lambda/services/bundle-review.ts at {ref} in {repo}") from exc
    (target / "check.mts").write_text(MARKETPLACE_VALIDATOR, encoding="utf-8")
    env = product_env(
        work_dir / "scan-home",
        {
            "MP_ARTIFACT": str(artifact_path),
            "MP_BUILDER": metadata["service-builder"],
            "MP_COMPLY": metadata["service-comply"],
            "MP_COMPONENT_ID": component_id,
        },
    )
    result = run(["npx", "--yes", f"tsx@{TSX_VERSION}", "check.mts"], target, env, capture=True, check=False)
    if result.returncode != 0:
        errors = [line.strip() for line in result.stderr.splitlines() if "Error" in line]
        raise PublishError(f"Marketplace bundle-review.ts at {revision[:12]} rejected the bundle: {errors[-1] if errors else 'no error message'}")
    return {"revision": revision, **json.loads(result.stdout.strip().splitlines()[-1])}


# ---------- Marketplace publish ----------


def marketplace_base_url(value: str | None) -> str:
    base = (value or DEFAULT_MARKETPLACE_BASE_URL).rstrip("/")
    url = urlparse(base)
    if url.scheme != "https" or not url.path.endswith("/marketplace") or url.query or url.fragment:
        raise PublishError("MARKETPLACE_BASE_URL must be https://<host>/.../marketplace")
    return base


def build_base_url(value: str | None) -> tuple[str, str]:
    """Build URL and where it came from: `BUILD_BASE_URL` when set, else the built-in default."""
    if value:
        base, origin = value.rstrip("/"), "BUILD_BASE_URL"
    else:
        base, origin = DEFAULT_BUILD_BASE_URL.rstrip("/"), "default"
    url = urlparse(base)
    if url.scheme != "https" or not url.hostname or url.query or url.fragment:
        raise PublishError("BUILD_BASE_URL must be an https:// Build API URL")
    return base, origin


def component_path(product_id: str, component_id: str) -> str:
    return f"/ontology/products/{product_id}/components/{quote(component_id, safe='')}"


def marketplace_key_check(api: Api) -> None:
    """GET /settings/status: the key works and review settings are operational."""
    status, settings = api.call("GET", "/settings/status")
    if status in (401, 403):
        raise PublishError(f"MARKETPLACE_API_KEY was rejected ({status}); {MARKETPLACE_KEY_STEPS}")
    if status != 200:
        raise PublishError(f"Marketplace GET /settings/status returned {status}")
    if not ((settings.get("status") or {}).get("component_publication") or {}).get("is_operational"):
        raise PublishError("Marketplace review settings are not operational; configure them first (operate-marketplace §1)")


def marketplace_preflight(api: Api, manifest: dict[str, Any]) -> str:
    """Read-only: product id and the registered component."""
    product_id = os.environ.get("MARKETPLACE_PRODUCT_ID")
    if product_id:
        if not UUID.match(product_id):
            raise PublishError("MARKETPLACE_PRODUCT_ID must be a UUID")
    else:
        name = os.environ.get("MARKETPLACE_PRODUCT_NAME") or manifest["component_name"]
        products = api.require("GET", f"/ontology/products/by-name?name={quote(name)}").get("products") or []
        if len(products) != 1:
            raise PublishError(f"expected one Marketplace product named {name}, found {len(products)}")
        product_id = products[0]["product_id"]
    status, component = api.call("GET", component_path(product_id, manifest["component_id"]))
    if status == 404:
        raise PublishError(f"component {manifest['component_id']} is not registered; register it first (operate-marketplace §2)")
    if status != 200:
        raise PublishError(f"Marketplace GET component returned {status}")
    if component.get("type") != manifest["bundle_type"]:
        raise PublishError(f"component {manifest['component_id']} is {component.get('type')}, the manifest says {manifest['bundle_type']}")
    return product_id


def publish(api: Api, product_id: str, component_id: str, artifact: bytes, metadata: dict[str, str], timeout: int) -> dict[str, Any]:
    path = component_path(product_id, component_id)
    issued = api.require("POST", f"{path}/bundle-uploads")
    post_form(
        issued["upload"],
        {f"x-amz-meta-{name}": value for name, value in metadata.items()},
        artifact,
        f"{component_id}-cloud-assembly.zip",
        "Marketplace bundle",
    )
    accepted = api.require("PUT", f"{path}/bundles", {"bundle_url": issued.pop("bundle_url"), "skip_review": False}, expect=(202,))
    del issued
    review_id = accepted["review_id"]
    log(f"marketplace: review {review_id} {accepted.get('bundle_status')}")
    deadline = time.monotonic() + timeout
    while True:
        review = api.require("GET", f"/reviews/{review_id}")
        if review.get("status") != "RUNNING":
            break
        if time.monotonic() > deadline:
            raise PublishError(f"review {review_id} still RUNNING after {timeout}s")
        sleep(15)
    result: dict[str, Any] = {"product_id": product_id, "review_id": review_id, "review_status": review.get("status")}
    if review.get("status") != "SUCCEEDED":
        result["review_details"] = review.get("review_details")
        return result
    rows = api.require("GET", f"{path}/bundles").get("bundles") or []
    row = next((item for item in rows if item.get("review_id") == review_id), {})
    result.update(bundle_id=row.get("bundle_id"), bundle_status=row.get("bundle_status"), hosted_bundle_url_present=bool(row.get("bundle_url")))
    return result


# ---------- main ----------


def sleep(seconds: float) -> None:
    time.sleep(seconds)


def positive_seconds(name: str, default: int) -> int:
    value = os.environ.get(name, "").strip()
    if not value:
        return default
    if not value.isdigit() or int(value) <= 0:
        raise PublishError(f"{name} must be a positive integer")
    return int(value)


def require_env(name: str, steps: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        raise PublishError(f"{name} is unset; {steps}")
    return value


def execute(args: argparse.Namespace, report: dict[str, Any]) -> bool:
    dry_run = os.environ.get("DRY_RUN") == "1"
    report["dry_run"] = dry_run
    key = require_env("MARKETPLACE_API_KEY", MARKETPLACE_KEY_STEPS)
    build_url, build_url_origin = build_base_url(os.environ.get("BUILD_BASE_URL"))
    build = Api("Build", build_url, key)
    build_timeout = positive_seconds("BUILD_TIMEOUT_SECONDS", 1200)
    marketplace = None
    if not dry_run:
        marketplace = Api("Marketplace", marketplace_base_url(os.environ.get("MARKETPLACE_BASE_URL")), key)
        review_timeout = positive_seconds("MARKETPLACE_REVIEW_TIMEOUT_SECONDS", 1200)
        marketplace_key_check(marketplace)
    info = build_preflight(build)
    report["build_service"] = {"url": build_url_origin, "stage": info.get("stage")}

    repo = Path(args.repo).resolve()
    commit, default = resolve_source(repo, args.ref, args.branch, fetch=not args.no_fetch)
    work_dir = Path(args.work_dir).resolve() if args.work_dir else Path(tempfile.mkdtemp(prefix="publish-via-build-"))
    work_dir.mkdir(parents=True, exist_ok=True)
    report["work_dir"] = str(work_dir)
    source_path = work_dir / "source.zip"
    try:
        git(repo, "archive", "--format=zip", "-o", str(source_path), commit)
    except subprocess.CalledProcessError as exc:
        raise PublishError(f"git archive of {commit[:12]} failed") from exc
    source_zip = source_path.read_bytes()
    source_sha = sha256_hex(source_zip)
    manifest = read_product_manifest(source_zip)
    report["source"] = {"commit": commit, "on": default, "source_hash": f"sha256:{source_sha}", "zip_bytes": len(source_zip)}
    report["product"] = {key: manifest[key] for key in ("component_id", "component_name", "bundle_type", "stacks")}

    product_id = marketplace_preflight(marketplace, manifest) if marketplace else None

    source_dir = work_dir / "source"
    shutil.rmtree(source_dir, ignore_errors=True)
    with zipfile.ZipFile(io.BytesIO(source_zip)) as archive:
        archive.extractall(source_dir)
    scan = run_security_scan(source_dir, work_dir, manifest["stacks"])
    comply_token = encode_token(comply_payload(scan, f"sha256:{source_sha}", datetime.datetime.now(datetime.timezone.utc)))
    report["scan"] = {
        "scanners": scan["scanners"],
        "severity_label": scan["severity_label"],
        "findings": scan["findings"],
        "nag_findings": scan["nag"][:50],
        "nag_from_product": scan["nag_from_product"],
        "stack_names": scan["stack_names"],
    }
    report["service_comply"] = decode_token(comply_token)
    if is_blocking(scan["severity_label"]):
        raise PublishError(f"security scan severity {scan['severity_label']}; fix the findings before publishing")
    live = live_stage_stacks(scan["stack_names"])
    if live and not dry_run:
        raise PublishError(f"stacks {', '.join(live)} carry a live stage; the sandbox review would update those installs")

    status = run_build(build, source_zip, comply_token, manifest, build_timeout)
    artifact, manifest_route = download_build_outputs(build, status)
    artifact_path = work_dir / f"{manifest['component_id']}-cloud-assembly.zip"
    artifact_path.write_bytes(artifact)
    build_manifest = json.loads(zip_entry(artifact, "build/build.manifest.json"))
    stack_names = build_manifest.get("cloudFormationStackNames") or []
    report["build"] = {
        "build_id": status.get("build_id"),
        "transaction_id": status.get("transaction_id"),
        "source_id": status.get("source_id"),
        "build_status": status.get("build_status"),
        "artifact_bytes": len(artifact),
        "artifact_sha256": sha256_hex(artifact),
        "cloudformation_stack_names": stack_names,
        "lambda_assets": len((status.get("asset_policy") or {}).get("lambda_assets") or []),
        "artifact_metadata_keys": (status.get("provenance") or {}).get("artifact_metadata_keys"),
    }
    checks: dict[str, Any] = {}
    report["checks"] = checks
    checks["build"] = verify_build(status, artifact, manifest_route, source_sha, comply_token, manifest)
    builder_token = status["provenance"]["service_builder"]
    report["service_builder"] = decode_token(builder_token)
    metadata = {"service-builder": builder_token, "service-comply": comply_token}
    report["metadata_bytes"] = {
        "service-builder": len("service-builder") + len(builder_token),
        "service-comply": len("service-comply") + len(comply_token),
        "total": metadata_bytes(metadata),
        "limit": MAX_METADATA_BYTES,
    }
    (work_dir / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    checks["scan_matches_build_stacks"] = scan["stack_names"] == stack_names
    if not checks["scan_matches_build_stacks"]:
        raise PublishError("the scan synth and Build produced different CloudFormation stack names")
    checks["marketplace"] = marketplace_checks(artifact, metadata, manifest["component_id"])
    if args.marketplace_repo:
        checks["marketplace_repo"] = run_marketplace_validator(
            Path(args.marketplace_repo).resolve(), args.marketplace_ref, work_dir, artifact_path, metadata, manifest["component_id"]
        )
    live = live_stage_stacks(stack_names)
    report["review_stage"] = {"safe": not live, "live_stage_stacks": live}
    if live:
        raise PublishError(f"stacks {', '.join(live)} carry a live stage; the sandbox review would update those installs")
    if dry_run:
        log("DRY_RUN=1: stopping before any Marketplace call")
        return True
    report["publish"] = publish(marketplace, product_id, manifest["component_id"], artifact, metadata, review_timeout)
    return report["publish"].get("review_status") == "SUCCEEDED"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("repo", help="product git checkout (read only)")
    parser.add_argument("--branch", help="remote branch to publish from (default: the remote default branch)")
    parser.add_argument("--ref", help="commit-ish on that remote branch (default: its tip)")
    parser.add_argument("--work-dir", help="scratch directory (default: a new temporary directory)")
    parser.add_argument("--no-fetch", action="store_true", help="do not git fetch origin first")
    parser.add_argument("--marketplace-repo", help="Marketplace checkout whose bundle-review.ts to run offline")
    parser.add_argument("--marketplace-ref", default="origin/main", help="ref of --marketplace-repo (default origin/main)")
    args = parser.parse_args(argv)
    report: dict[str, Any] = {}
    try:
        ok = execute(args, report)
    except PublishError as exc:
        report.update(ok=False, error=str(exc))
        print(json.dumps(report, indent=2))
        return 1
    report["ok"] = ok
    print(json.dumps(report, indent=2))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
