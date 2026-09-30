#!/usr/bin/env python3
"""Check that DEV serves the pinned mapping, and republish a pruned candidate through the registry's own DEV deploy path.

  dev_redeploy.py check --registry-uri s3://<registry>/ | --workspace WS --label dev
      --mapping <id>@<version> --pin <sha256> --profile <dev-profile> [--region R]
      [--slug OWNER/REPO --head-sha <pinned candidate commit>] --out check.json
      Read-only: download the served transform-mappings/<id>/<version>/mapping.json and compare its SHA-256 with the
      pin. SERVED (equal), PRUNED (absent) or DIGEST_DIFFERS. With --slug and --head-sha the newest successful run of
      the layout's DEV deploy workflow (gh, read-only) classifies a mismatch. The newest run is chosen from every run
      of that workflow across all branches created within devDeploy.runListHorizonDays (default 30, GitHub's re-run
      horizon; the listing grows past runListLimit instead of truncating), completed with conclusion success and the
      layout's event, ordered by completion (updatedAt), then creation, attempt and run id:
        DeploymentRace  another head deployed after the pin (latest-PR-wins prune or overwrite): BLOCKED, recoverable
                        with the owner's devRedeployPinned decision;
        DeploymentDrift the pinned head's own deploy is the newest and still does not serve the pin: the candidate or
                        its build is wrong, FAIL (Kecleon / the registry owner), never redeployed.
  dev_redeploy.py redeploy --check check.json --owner-decisions decisions.json --run-dir RUN
      [--max-redeploys N] [--wait] [--timeout-minutes M] [--poll-seconds S] [--poll-attempts K] --out result.json
      Only with ownerDecisions.devRedeployPinned = rerun-pr-dev-workflow-for-pinned-head and a DeploymentRace check:
      find the newest run of the layout's devDeploy.workflowFile for the pinned head SHA (gh run list --commit) and
      re-run it in full (gh run rerun <id>); a run still in progress is waited for, not re-run. The operation card and
      its owner approval are recorded under RUN/deployments/. With --wait, poll the run to completion and then the
      served digest until it equals the pin; with --workspace, then refresh that workspace's registry snapshot of the
      mapping (read-only: mapping.json and its inputs-manifest.json record with the served VersionId). At most maxRedeploys (layout devDeploy, default 2; the owner may lower or
      raise it with "up to N times") re-runs per run directory; the next prune is BLOCKED with a DeploymentRace
      handoff (make the DEV registry additive across PR deploys, or hold other DEV deploys during validation).

Nothing here deploys PROD: a workflow in devDeploy.forbiddenWorkflowFiles or named like PROD is refused, and only the
pinned head's own DEV workflow run is re-run. Deploy owns the deployment and its rollback; Silvally records digests.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from silvally_io import DEFAULT_REGION, SilvallyError, aws, canonical_digest, load_layout, parse_s3, read_json, sha256_file, write_json

REDEPLOY_DECISION = "rerun-pr-dev-workflow-for-pinned-head"
RACE_HANDOFF = {
    "code": "DeploymentRace",
    "owner": "Deploy / the registry repository's CI owners (Conkeldurr for Lexicon publication)",
    "detail": ("DEV mapping deploys are latest-PR-wins: another pull request's DEV deploy pruned or replaced the pinned "
               "candidate again after the allowed redeploys. Make the DEV registry additive across PR deploys (never prune "
               "another head's id@version), or hold other DEV deploys while the validation runs, then rerun the validation"),
}


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def gh(args: list[str]) -> str:
    env = {**os.environ, "GH_PROMPT_DISABLED": "1"}
    result = subprocess.run(["gh", *args], capture_output=True, text=True, env=env, stdin=subprocess.DEVNULL)
    if result.returncode != 0:
        raise SilvallyError(f"gh {' '.join(args[:2])} failed: {result.stderr.strip()[-400:]}")
    return result.stdout.strip()


def registry_uri(args) -> str:
    if args.registry_uri:
        return args.registry_uri.rstrip("/") + "/"
    manifest = read_json(Path(args.workspace) / "inputs-manifest.json")
    entry = next((e for e in manifest if e.get("kind") == "registry" and e.get("name") == args.label), None)
    if not entry or not entry.get("location"):
        raise SilvallyError(f"no registry {args.label} with a location in {args.workspace}/inputs-manifest.json")
    return entry["location"].rstrip("/") + "/"


def served_status(location: str, mapping: str, pin: str, profile: str, region: str = DEFAULT_REGION,
                  keep: Path | None = None) -> dict:
    """Read-only: the served mapping.json of id@version under the registry location, compared with the pinned digest.
    keep receives a copy of the served file (the workspace registry snapshot)."""
    mapping_id, version = mapping.split("@")
    bucket, prefix = parse_s3(location.rstrip("/") + "/")
    key = f"{prefix}{mapping_id}/{version}/mapping.json"
    listing = aws(["s3api", "list-objects-v2", "--bucket", bucket, "--prefix", key], profile=profile, region=region,
                  environment="prod")
    record = {"mapping": mapping, "registry": f"s3://{bucket}/{prefix}", "location": f"s3://{bucket}/{key}", "pin": pin,
              "checkedAt": now()}
    if not any(o.get("Key") == key for o in listing.get("Contents") or []):
        return {**record, "status": "PRUNED", "served": None}
    head = aws(["s3api", "head-object", "--bucket", bucket, "--key", key], profile=profile, region=region, environment="prod")
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / "mapping.json"
        aws(["s3", "cp", f"s3://{bucket}/{key}", str(target), "--quiet"], profile=profile, region=region,
            environment="prod", output_json=False)
        served = sha256_file(target)
        if keep is not None:
            keep.parent.mkdir(parents=True, exist_ok=True)
            keep.write_bytes(target.read_bytes())
    return {**record, "status": "SERVED" if served == pin else "DIGEST_DIFFERS", "served": served,
            "versionId": head.get("VersionId"), "lastModified": head.get("LastModified")}


RUN_FIELDS = "databaseId,headSha,headBranch,status,conclusion,createdAt,updatedAt,attempt,event,workflowName"


def deploy_runs(slug: str, workflow: str, extra: list[str], limit: int = 30) -> list[dict]:
    return json.loads(gh(["run", "list", "-R", slug, "--workflow", workflow, *extra, "--limit", str(limit), "--json", RUN_FIELDS]) or "[]")


def list_all_runs(slug: str, deploy: dict, now: datetime | None = None) -> tuple[list[dict], dict]:
    """Every run of the DEV deploy workflow created within the re-run horizon, across all branches.

    gh run list pages internally up to --limit and orders by creation, so a run created long ago and re-run recently can
    fall behind newer creations; the created filter bounds the listing to the horizon in which GitHub still allows a
    re-run, and the limit grows until the listing is shorter than it (never a silently truncated page)."""
    horizon = deploy.get("runListHorizonDays", 30)
    since = ((now or datetime.now(timezone.utc)) - timedelta(days=horizon)).strftime("%Y-%m-%d")
    limit = deploy.get("runListLimit", 1000)
    while True:
        runs = deploy_runs(slug, deploy["workflowFile"], ["--created", f">={since}"], limit)
        if len(runs) < limit:
            return runs, {"createdSince": since, "limit": limit, "listed": len(runs)}
        if limit >= deploy.get("runListMaxLimit", 8000):
            raise SilvallyError(f"more than {limit} {deploy['workflowFile']} runs since {since}; the newest DEV deploy cannot be "
                                "determined from a truncated listing")
        limit *= 2


def newest_successful_deploy(runs: list[dict], deploy: dict) -> dict | None:
    """The newest completed, successful DEV deploy run: latest completion (updatedAt), then creation, attempt and run id,
    so the same listing always selects the same run whatever order gh returned it in."""
    done = [r for r in runs if r.get("status") == "completed" and r.get("conclusion") == "success"
            and (not deploy.get("event") or r.get("event") == deploy["event"])
            and "prod" not in str(r.get("workflowName") or "").lower()]
    return max(done, key=lambda r: (r.get("updatedAt") or r.get("createdAt") or "", r.get("createdAt") or "",
                                    r.get("attempt") or 0, r.get("databaseId") or 0), default=None)


def classify(check: dict, slug: str, head_sha: str, deploy: dict) -> dict:
    """Who deployed last decides whether a mismatch is a recoverable race or a wrong candidate."""
    if check["status"] == "SERVED":
        return {**check, "classification": None}
    runs, listing = list_all_runs(slug, deploy)
    newest = newest_successful_deploy(runs, deploy)
    base = {**check, "repository": slug, "headSha": head_sha, "deployListing": listing,
            "newestDeploy": {k: newest.get(k) for k in ("databaseId", "headSha", "headBranch", "createdAt", "updatedAt", "attempt")}
            if newest else None}
    if newest and newest.get("headSha") != head_sha:
        return {**base, "classification": "DeploymentRace", "verdict": "BLOCKED", "recoverable": True,
                "detail": (f"the newest successful DEV deploy is another head ({newest.get('headBranch')}); the pinned "
                           f"{check['mapping']} is {check['status'].lower().replace('_', ' ')} by that latest-PR-wins deploy")}
    return {**base, "classification": "DeploymentDrift", "verdict": "FAIL", "recoverable": False,
            "detail": ("the pinned head's own DEV deploy is the newest and does not serve the pinned digest: the candidate "
                       "or its build differs from what the registry publishes (hand to Kecleon / the registry owner)")
            if newest else "no successful DEV deploy of the pinned head was found; the candidate was never published"}


def refresh_snapshot(workspace: str, label: str, check: dict, profile: str, region: str) -> dict:
    """Read-only on AWS: after a redeploy, replace the workspace's registry snapshot of the redeployed id@version (its
    mapping.json and the inputs-manifest.json record with the served VersionId), so a later spec-from-intent pins what
    DEV serves now instead of the pre-redeploy snapshot."""
    manifest_path = Path(workspace) / "inputs-manifest.json"
    manifest = read_json(manifest_path)
    entry = next((e for e in manifest if e.get("kind") == "registry" and e.get("name") == label), None)
    if not entry:
        raise SilvallyError(f"no registry {label} in {manifest_path}")
    mapping_id, version = check["mapping"].split("@")
    keep = Path(entry["path"]) / mapping_id / version / "mapping.json" if entry.get("path") else None
    served = served_status(check["registry"], check["mapping"], check["pin"], profile, region, keep=keep)
    if served["status"] != "SERVED":
        return {**served, "snapshot": "unchanged"}
    record = {"mapping": check["mapping"], "sha256": served["served"], "versionId": served.get("versionId"),
              "lastModified": served.get("lastModified"), "refreshedAt": served["checkedAt"]}
    entry["mappings"] = [m for m in entry.get("mappings", []) if m.get("mapping") != check["mapping"]] + [record]
    write_json(manifest_path, manifest)
    return {**served, "snapshot": str(manifest_path)}


def refuse_prod(deploy: dict, run: dict | None = None) -> None:
    names = [deploy["workflowFile"], deploy.get("workflowName", ""), (run or {}).get("workflowName", "")]
    if deploy["workflowFile"] in deploy.get("forbiddenWorkflowFiles", []) or any("prod" in n.lower() for n in names if n):
        raise SilvallyError("PROD is never deployed; only the pinned head's DEV workflow run may be re-run")


def cmd_check(args) -> int:
    layout = load_layout(args.layout)
    check = served_status(registry_uri(args), args.mapping, args.pin, args.profile, args.region)
    if args.slug and args.head_sha:
        check = classify(check, args.slug, args.head_sha, layout["devDeploy"])
    write_json(args.out, check)
    print(json.dumps(check, indent=1))
    return 0 if check["status"] == "SERVED" else 1


def wait_for_run(slug: str, run_id: int, timeout_minutes: float, poll: float) -> dict:
    deadline = time.monotonic() + timeout_minutes * 60
    while True:
        view = json.loads(gh(["run", "view", str(run_id), "-R", slug, "--json", "status,conclusion,attempt,headSha,updatedAt"]))
        if view.get("status") == "completed" or time.monotonic() >= deadline:
            return view
        time.sleep(poll)


def cmd_redeploy(args) -> int:
    layout = load_layout(args.layout)
    deploy = layout["devDeploy"]
    check = read_json(args.check)
    decisions = read_json(args.owner_decisions) if args.owner_decisions else {}
    if decisions.get("devRedeployPinned") != REDEPLOY_DECISION:
        raise SilvallyError("DevRedeployDecisionRequired: republishing the pinned candidate to DEV needs the owner's "
                            f"devRedeployPinned: {REDEPLOY_DECISION} decision (blanketDevWrites does not cover a deploy); ask the owner")
    if check.get("status") == "SERVED":
        raise SilvallyError("the pinned mapping is already served; nothing to redeploy")
    if check.get("classification") != "DeploymentRace":
        raise SilvallyError(f"only a DeploymentRace is redeployed; this check is {check.get('classification') or 'unclassified'} "
                            "(run check with --slug and --head-sha; a DeploymentDrift is a FAIL, not a race)")
    slug, head = check["repository"], check["headSha"]
    limit = args.max_redeploys if args.max_redeploys is not None else decisions.get("devRedeployMaxAttempts", deploy.get("maxRedeploys", 2))
    run_dir = Path(args.run_dir)
    done = sorted(p for p in (run_dir / "deployments").glob("redeploy-*.json") if p.stem.removeprefix("redeploy-").isdigit())
    attempt = len(done) + 1
    if len(done) >= limit:
        result = {"status": "BLOCKED", "mapping": check["mapping"], "redeploys": len(done), "maxRedeploys": limit,
                  "handoff": RACE_HANDOFF, "check": check}
        write_json(run_dir / "deployments" / "deployment-race.json", result)
        write_json(args.out, result)
        print(json.dumps(result, indent=1))
        return 1
    refuse_prod(deploy)
    runs = [r for r in deploy_runs(slug, deploy["workflowFile"], ["--commit", head]) if r.get("headSha") == head and r.get("event") == deploy["event"]]
    if not runs:
        raise SilvallyError(f"no {deploy['workflowFile']} run for the pinned head {head}; the documented DEV deploy path cannot republish it")
    run = max(runs, key=lambda r: r.get("createdAt") or "")
    refuse_prod(deploy, run)
    in_progress = run.get("status") != "completed"
    card = {"operation": "dev-redeploy-pinned-candidate", "environment": "dev", "repository": slug,
            "workflow": deploy["workflowFile"], "runId": run["databaseId"], "headSha": head, "mapping": check["mapping"],
            "pin": check["pin"], "attempt": attempt, "maxRedeploys": limit,
            "runs": "wait for the in-progress run" if in_progress else f"gh run rerun {run['databaseId']} -R {slug}",
            "reason": check.get("detail"), "containment": "re-runs the pinned head's own DEV deploy; PROD is never deployed; Deploy owns rollback"}
    card["operationDigest"] = canonical_digest(card)
    approval = {"operationDigest": card["operationDigest"], "environment": "dev", "status": "APPROVED",
                "kind": "owner-dev-redeploy-pinned", "decision": REDEPLOY_DECISION, "recordedAt": now()}
    write_json(run_dir / "deployments" / f"redeploy-{attempt}.json", {**card, "approval": approval})
    if not in_progress:
        gh(["run", "rerun", str(run["databaseId"]), "-R", slug])
    result = {"status": "RERUN_STARTED" if not in_progress else "WAITING_FOR_RUN", "attempt": attempt, "maxRedeploys": limit,
              "runId": run["databaseId"], "operationDigest": card["operationDigest"], "mapping": check["mapping"]}
    if args.wait:
        view = wait_for_run(slug, run["databaseId"], args.timeout_minutes or deploy.get("runTimeoutMinutes", 45),
                            args.poll_seconds if args.poll_seconds is not None else deploy.get("servedPollSeconds", 30))
        result["run"] = view
        if view.get("status") != "completed" or view.get("conclusion") != "success":
            result.update({"status": "BLOCKED", "blocking": f"DevRedeployFailed: run {run['databaseId']} ended "
                                                            f"{view.get('status')}/{view.get('conclusion')}"})
        else:
            served = None
            polls = args.poll_attempts or deploy.get("servedPollAttempts", 20)
            for n in range(polls):
                served = served_status(check["registry"], check["mapping"], check["pin"], args.profile, args.region)
                if served["status"] == "SERVED":
                    break
                if n + 1 < polls:
                    time.sleep(args.poll_seconds if args.poll_seconds is not None else deploy.get("servedPollSeconds", 30))
            result["served"] = served
            result["status"] = "SERVED" if served and served["status"] == "SERVED" else "BLOCKED"
            if result["status"] == "BLOCKED":
                result["blocking"] = "DeploymentRace: the redeployed run succeeded but DEV still does not serve the pin"
            elif args.workspace:
                result["snapshotRefresh"] = refresh_snapshot(args.workspace, args.label, check, args.profile, args.region)
    write_json(run_dir / "deployments" / f"redeploy-{attempt}.result.json", result)
    write_json(args.out, result)
    print(json.dumps(result, indent=1))
    return 0 if result["status"] in {"SERVED", "RERUN_STARTED", "WAITING_FOR_RUN"} else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--layout", help="registry layout JSON (default reference/registry-layout.json)")
    sub = parser.add_subparsers(dest="command", required=True)
    c = sub.add_parser("check")
    where = c.add_mutually_exclusive_group(required=True)
    where.add_argument("--registry-uri", help="s3:// prefix of the published registry (transform-mappings/)")
    where.add_argument("--workspace", help="the resolver's workspace; its inputs-manifest.json names the registry location")
    c.add_argument("--label", default="dev")
    c.add_argument("--mapping", required=True)
    c.add_argument("--pin", required=True, help="the pinned mapping.json SHA-256")
    c.add_argument("--profile", required=True, help="operator's DEV profile (read-only here)")
    c.add_argument("--region", default=DEFAULT_REGION)
    c.add_argument("--slug", help="registry repository, to classify a mismatch by the newest DEV deploy")
    c.add_argument("--head-sha", help="the pinned candidate's head commit")
    c.add_argument("--out", required=True)
    r = sub.add_parser("redeploy")
    r.add_argument("--check", required=True, help="a classified check result (DeploymentRace)")
    r.add_argument("--owner-decisions", required=True, help="ownerDecisions JSON with devRedeployPinned")
    r.add_argument("--run-dir", required=True, help="the validation run directory; redeploys are counted per run")
    r.add_argument("--max-redeploys", type=int)
    r.add_argument("--wait", action="store_true", help="poll the run, then the served digest, until it equals the pin")
    r.add_argument("--profile", help="DEV profile for the served-digest polls (required with --wait)")
    r.add_argument("--region", default=DEFAULT_REGION)
    r.add_argument("--timeout-minutes", type=float)
    r.add_argument("--poll-seconds", type=float)
    r.add_argument("--poll-attempts", type=int)
    r.add_argument("--workspace", help="the resolver's workspace; once served, its registry snapshot of the mapping is refreshed")
    r.add_argument("--label", default="dev", help="registry label of the refreshed snapshot")
    r.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    if args.command == "redeploy" and args.wait and not args.profile:
        raise SilvallyError("--wait needs --profile to re-check the served digest")
    return {"check": cmd_check, "redeploy": cmd_redeploy}[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
