#!/usr/bin/env python3
"""Fetch the read-only inputs Silvally needs into a disposable workspace.

Nothing is read from the operator's existing checkouts. Every command is
read-only against GitHub and AWS and writes only under --workspace.

  fetch_validation_inputs.py repo --workspace WS --slug OWNER/REPO (--ref REF | --pr N) --name lexicon-candidate
  fetch_validation_inputs.py registry --workspace WS --label dev --profile <dev-profile> [--region us-east-2]
  fetch_validation_inputs.py ssm-names --workspace WS --label dev --profile <dev-profile>
  fetch_validation_inputs.py materialize --workspace WS --name lexicon-candidate --command "npx tsx infra/test/spark/materialize-mappings.ts {out}"

Each command prints and appends a JSON record to WS/inputs-manifest.json
(pinned commit SHAs, SSM parameter values that are locations, file digests).
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
from pathlib import Path

from silvally_io import DEFAULT_REGION, SilvallyError, aws, parse_s3, read_json, sha256_file, write_json

REGISTRY_PARAMETER = "/lexicon/transform-mappings-uri"


def record(workspace: Path, entry: dict) -> dict:
    manifest = workspace / "inputs-manifest.json"
    entries = read_json(manifest) if manifest.exists() else []
    entries = [e for e in entries if not (e.get("kind") == entry["kind"] and e.get("name") == entry.get("name"))]
    entries.append(entry)
    write_json(manifest, entries)
    print(json.dumps(entry, indent=1))
    return entry


def run(command: list[str], cwd: Path | None = None) -> str:
    result = subprocess.run(command, cwd=cwd, capture_output=True, text=True)
    if result.returncode != 0:
        raise SilvallyError(f"{' '.join(command[:3])} failed: {result.stderr.strip()[-400:]}")
    return result.stdout.strip()


def resolve_ref(slug: str, ref: str | None, pr: int | None) -> tuple[str, dict]:
    if pr is not None:
        data = json.loads(run(["gh", "pr", "view", str(pr), "-R", slug, "--json", "headRefOid,headRefName,state"]))
        return data["headRefOid"], {"selectionMethod": "pull-request", "pullRequestNumber": pr, "headRefName": data["headRefName"], "state": data["state"]}
    if ref is None:
        ref = json.loads(run(["gh", "repo", "view", slug, "--json", "defaultBranchRef"]))["defaultBranchRef"]["name"]
        method = "default-branch"
    else:
        method = "requested-ref"
    sha = run(["gh", "api", f"repos/{slug}/commits/{ref}", "--jq", ".sha"])
    return sha, {"selectionMethod": method, "requestedRef": ref}


def fetch_repo(args) -> dict:
    workspace = Path(args.workspace)
    target = workspace / args.name
    sha, selection = resolve_ref(args.slug, args.ref, args.pr)
    if not (target / ".git").exists():
        target.mkdir(parents=True, exist_ok=True)
        run(["git", "init", "-q"], cwd=target)
        run(["git", "remote", "add", "origin", f"https://github.com/{args.slug}.git"], cwd=target)
        run(["git", "config", "credential.helper", "!gh auth git-credential"], cwd=target)
    run(["git", "fetch", "-q", "--depth", str(args.depth), "origin", sha], cwd=target)
    run(["git", "checkout", "-q", "--detach", sha], cwd=target)
    head = run(["git", "rev-parse", "HEAD"], cwd=target)
    if head != sha:
        raise SilvallyError(f"checkout HEAD {head} does not match selected {sha}")
    missing = [p for p in args.required_path or [] if not (target / p).exists()]
    return record(workspace, {"kind": "repository", "name": args.name, "slug": args.slug, "commitSha": sha, **selection,
                              "path": str(target), "requiredPathsVerified": not missing, "missingRequiredPaths": missing})


def fetch_registry(args) -> dict:
    workspace = Path(args.workspace)
    uri = aws(["ssm", "get-parameter", "--name", REGISTRY_PARAMETER], profile=args.profile, region=args.region,
              environment=args.environment)["Parameter"]["Value"].rstrip("/") + "/"
    bucket, prefix = parse_s3(uri)
    target = workspace / f"registry-{args.label}"
    aws(["s3", "sync", uri, str(target), "--exclude", "*", "--include", "*/mapping.json", "--include", "*/queries/*", "--quiet"],
        profile=args.profile, region=args.region, environment=args.environment, output_json=False)
    mappings = []
    for mapping in sorted(target.glob("*/*/mapping.json")):
        key = f"{prefix}{mapping.relative_to(target)}"
        head = aws(["s3api", "head-object", "--bucket", bucket, "--key", key], profile=args.profile, region=args.region,
                   environment=args.environment)
        mappings.append({"mapping": f"{mapping.parent.parent.name}@{mapping.parent.name}", "sha256": sha256_file(mapping),
                         "versionId": head.get("VersionId"), "lastModified": head.get("LastModified")})
    return record(workspace, {"kind": "registry", "name": args.label, "location": uri, "path": str(target), "mappings": mappings})


def fetch_ssm_names(args) -> dict:
    workspace = Path(args.workspace)
    names, token = [], None
    while True:
        call = ["ssm", "get-parameters-by-path", "--path", args.path, "--recursive"]
        if token:
            call += ["--next-token", token]
        page = aws(call, profile=args.profile, region=args.region, environment=args.environment)
        names += [p["Name"] for p in page.get("Parameters", [])]
        token = page.get("NextToken")
        if not token:
            break
    target = workspace / f"ssm-{args.label}.json"
    write_json(target, sorted(names))
    return record(workspace, {"kind": "ssm-names", "name": args.label, "path": str(target), "count": len(names)})


def materialize(args) -> dict:
    workspace = Path(args.workspace)
    checkout = workspace / args.name
    out = workspace / f"{args.name}-materialized"
    if args.install:
        for step in args.install:
            subprocess.run(shlex.split(step), cwd=checkout, check=True)
    command = [part.replace("{out}", str(out)) for part in shlex.split(args.command)]
    subprocess.run(command, cwd=checkout, check=True, env={**os.environ})
    mappings = [{"mapping": f"{m.parent.parent.name}@{m.parent.name}", "sha256": sha256_file(m)}
                for m in sorted(out.rglob("mapping.json"))]
    return record(workspace, {"kind": "materialized", "name": args.name, "path": str(out), "mappings": mappings})


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    repo = sub.add_parser("repo")
    repo.add_argument("--workspace", required=True)
    repo.add_argument("--slug", required=True)
    repo.add_argument("--ref")
    repo.add_argument("--pr", type=int)
    repo.add_argument("--name", required=True)
    repo.add_argument("--depth", type=int, default=50)
    repo.add_argument("--required-path", action="append")
    for name in ("registry", "ssm-names"):
        p = sub.add_parser(name)
        p.add_argument("--workspace", required=True)
        p.add_argument("--label", required=True)
        p.add_argument("--profile", required=True, help="operator-chosen AWS profile for that environment")
        p.add_argument("--region", default=DEFAULT_REGION)
        p.add_argument("--environment", choices=("dev", "prod"), default="prod",
                       help="prod enforces read-only verbs; dev reads are read-only too")
        if name == "ssm-names":
            p.add_argument("--path", default="/lexicon")
    mat = sub.add_parser("materialize")
    mat.add_argument("--workspace", required=True)
    mat.add_argument("--name", required=True)
    mat.add_argument("--command", required=True, help="materialization command; {out} is replaced by the output directory")
    mat.add_argument("--install", action="append", help="setup command run first in the checkout, e.g. 'npm ci'")
    args = parser.parse_args(argv)
    {"repo": fetch_repo, "registry": fetch_registry, "ssm-names": fetch_ssm_names, "materialize": materialize}[args.command](args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
