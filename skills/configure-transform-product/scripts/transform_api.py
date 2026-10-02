#!/usr/bin/env python3
"""SigV4 client for Transform's configuration and run API.

Subcommands:
  validate <bundle-root>          POST /transform/mappings/validate per mapping version (stores nothing)
  register <bundle-root>          PUT  /transform/mappings/{id}/versions/{version} per mapping version
  get <mapping-id> <version>      GET  /transform/mappings/{id}/versions/{version}
  list <mapping-id>               GET  /transform/mappings/{id}/versions
  start <request.json>            POST /transform/runs (v1 or v2 request, optional --transaction-id)
  status <run-id>                 GET  /transform/runs/{run_id}
  approve <run-id>                POST /transform/runs/{run_id}/approval

A bundle root holds mappings/<id>/<version>/mapping.json plus the queries each
output declares. The base URL comes from --api-url or TRANSFORM_API_URL (SSM
/<stackName>/api-url); the region from --region or AWS_REGION (default
us-east-2). Credentials come from the standard botocore chain and are never
printed. Every result is printed as JSON; any non-2xx response exits 1.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import quote

DEFAULT_REGION = "us-east-2"


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_bundle(root: Path) -> list[dict[str, Any]]:
    """Reads every mappings/<id>/<version>/mapping.json and fills in each query's sha256."""
    mappings_dir = root / "mappings"
    if not mappings_dir.is_dir():
        raise SystemExit(f"no mappings/ directory under {root}")
    packages = []
    for mapping_dir in sorted(p for p in mappings_dir.iterdir() if p.is_dir()):
        for version_dir in sorted(p for p in mapping_dir.iterdir() if p.is_dir()):
            rule = json.loads((version_dir / "mapping.json").read_text(encoding="utf-8"))
            queries: dict[str, str] = {}
            for output in rule.get("outputs", []):
                for query in output.get("queries", []):
                    sql = (version_dir / query["path"]).read_text(encoding="utf-8")
                    queries[query["path"]] = sql
                    query["sha256"] = sha256(sql)
            packages.append(
                {"mapping_id": mapping_dir.name, "version": version_dir.name, "body": {"rule": rule, "queries": queries}}
            )
    if not packages:
        raise SystemExit(f"no mapping versions under {mappings_dir}")
    return packages


def request(method: str, url: str, region: str, body: Any = None) -> tuple[int, Any]:
    from botocore.auth import SigV4Auth
    from botocore.awsrequest import AWSRequest
    from botocore.session import Session

    credentials = Session().get_credentials()
    if credentials is None:
        raise SystemExit("no AWS credentials found; set AWS_PROFILE or credentials in the environment")
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"content-type": "application/json"} if data is not None else {}
    aws_request = AWSRequest(method=method, url=url, data=data, headers=headers)
    SigV4Auth(credentials, "execute-api", region).add_auth(aws_request)
    http_request = urllib.request.Request(url, data=data, method=method, headers=dict(aws_request.headers.items()))
    try:
        with urllib.request.urlopen(http_request, timeout=60) as response:
            status, text = response.status, response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        status, text = error.code, error.read().decode("utf-8")
    try:
        return status, json.loads(text) if text else None
    except json.JSONDecodeError:
        return status, {"ok": False, "error": {"type": "NonJsonResponse", "message": text[:500]}}


def base_url(value: str | None) -> str:
    url = value or os.environ.get("TRANSFORM_API_URL")
    if not url:
        raise SystemExit("set --api-url or TRANSFORM_API_URL (SSM /<stackName>/api-url)")
    return url if url.endswith("/") else f"{url}/"


def segment(value: str) -> str:
    return quote(value, safe="")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--api-url", help="Transform API base URL (default TRANSFORM_API_URL)")
    parser.add_argument("--region", default=os.environ.get("AWS_REGION", DEFAULT_REGION))
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("validate", "register"):
        sub.add_parser(name).add_argument("bundle_root", type=Path)
    get = sub.add_parser("get")
    get.add_argument("mapping_id")
    get.add_argument("version")
    sub.add_parser("list").add_argument("mapping_id")
    start = sub.add_parser("start")
    start.add_argument("request_file", type=Path, help="JSON v1 or v2 Transform request")
    start.add_argument("--transaction-id", help="idempotency key; becomes the run id (^[A-Za-z0-9_-]{1,80}$)")
    sub.add_parser("status").add_argument("run_id")
    approve = sub.add_parser("approve")
    approve.add_argument("run_id")
    decision = approve.add_mutually_exclusive_group(required=True)
    decision.add_argument("--approve", dest="approved", action="store_true")
    decision.add_argument("--reject", dest="approved", action="store_false")
    approve.add_argument("--reviewed-by", required=True)
    approve.add_argument("--comment")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    base = base_url(args.api_url)
    calls: list[tuple[str, str, str, Any]] = []
    if args.command in ("validate", "register"):
        for package in load_bundle(args.bundle_root):
            label = f"{package['mapping_id']}@{package['version']}"
            if args.command == "validate":
                calls.append((label, "POST", "transform/mappings/validate", package["body"]))
            else:
                path = f"transform/mappings/{segment(package['mapping_id'])}/versions/{segment(package['version'])}"
                calls.append((label, "PUT", path, package["body"]))
    elif args.command == "get":
        path = f"transform/mappings/{segment(args.mapping_id)}/versions/{segment(args.version)}"
        calls.append((f"{args.mapping_id}@{args.version}", "GET", path, None))
    elif args.command == "list":
        calls.append((args.mapping_id, "GET", f"transform/mappings/{segment(args.mapping_id)}/versions", None))
    elif args.command == "start":
        body = json.loads(args.request_file.read_text(encoding="utf-8"))
        if args.transaction_id:
            body["transaction_id"] = args.transaction_id
        calls.append((args.transaction_id or "new-run", "POST", "transform/runs", body))
    elif args.command == "status":
        calls.append((args.run_id, "GET", f"transform/runs/{segment(args.run_id)}", None))
    else:
        body = {"approved": args.approved, "reviewedBy": args.reviewed_by}
        if args.comment:
            body["comment"] = args.comment
        calls.append((args.run_id, "POST", f"transform/runs/{segment(args.run_id)}/approval", body))

    results = []
    failed = False
    for label, method, path, body in calls:
        status, payload = request(method, base + path, args.region, body)
        failed |= not 200 <= status < 300
        results.append({"target": label, "status": status, "response": payload})
    json.dump(results[0] if len(results) == 1 else results, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
