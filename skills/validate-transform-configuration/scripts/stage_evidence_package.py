#!/usr/bin/env python3
"""Build and upload an immutable DEV evidence package (create-only, manifest last).

  stage_evidence_package.py manifest --dir PKG --prefix s3://<dev-transform-data-bucket>/inputs/<name>/<window>_v1/
      Writes PKG/manifest.json (key, bytes, sha256, rows for csv/jsonl, dataset per top-level directory)
      and prints the upload operation card with its operation digest (APPROVAL_REQUIRED).
  stage_evidence_package.py upload --dir PKG --prefix ... --profile <dev-profile> (--approve sha256:... |
      --owner-decisions decisions.json) [--slice NAME [--catalog prod-actuals.json]]
      Re-derives the card, refuses a changed card or a non-matching digest (or, with the owner's
      blanketDevWrites decision, records that blanket approval against this card's digest), refuses a
      slice whose catalog declares sensitiveFields unless the owner decided sensitiveFieldStaging:
      stage-real-values-to-dev, uploads every object with
      put-object --if-none-match '*' (never overwrites), uploads manifest.json last, reads it back and
      prints its sha256, VersionId and the approved operation digest. Record the identity in the profile's
      validationSources and keep the printed JSON: evaluate_run.py --staging-upload needs it for the final
      PROD-derived validation.

Only sanitized/derived data belongs in a package; see test-dataset-recommendations.md.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from silvally_io import DEFAULT_REGION, SilvallyError, aws, canonical_digest, parse_s3, read_json, sha256_file, write_json

DEFAULT_CATALOG = Path(__file__).resolve().parent.parent / "reference" / "prod-actuals.json"
BLANKET_DEV_WRITES = "staging-and-executions-for-this-run"
SENSITIVE_DECISION = "stage-real-values-to-dev"


def rows_of(path: Path) -> int | None:
    if path.suffix in (".csv", ".jsonl", ".json"):
        lines = [line for line in path.read_text(encoding="utf-8").split("\n") if line.strip()]
        return max(0, len(lines) - 1) if path.suffix == ".csv" else len(lines)
    return None


def build(directory: Path, prefix: str) -> tuple[dict, dict]:
    if not prefix.startswith("s3://") or not prefix.endswith("/"):
        raise SilvallyError("--prefix must be an s3:// prefix ending in /")
    objects = []
    for path in sorted(p for p in directory.rglob("*") if p.is_file() and p.name != "manifest.json"):
        rel = path.relative_to(directory).as_posix()
        objects.append({"key": rel, "dataset": rel.split("/")[0], "bytes": path.stat().st_size, "sha256": sha256_file(path), "rows": rows_of(path)})
    if not objects:
        raise SilvallyError("package directory is empty")
    manifest = {"prefix": prefix, "objects": objects}
    card = {"operation": "s3:PutObject (create-only, If-None-Match *), manifest last", "environment": "dev", "prefix": prefix,
            "objects": [(o["key"], o["sha256"]) for o in objects], "manifestSha256": canonical_digest(manifest),
            "containment": "new keys only; nothing overwritten; no deletes"}
    card["operationDigest"] = canonical_digest(card)
    return manifest, card


def cmd_manifest(args) -> int:
    manifest, card = build(Path(args.dir), args.prefix)
    write_json(Path(args.dir) / "manifest.json", manifest)
    print(json.dumps({**card, "status": "APPROVAL_REQUIRED"}, indent=1))
    return 0


def cmd_upload(args) -> int:
    directory = Path(args.dir)
    manifest, card = build(directory, args.prefix)
    stored = json.loads((directory / "manifest.json").read_text())
    if stored != manifest:
        raise SilvallyError("package changed since the manifest was built; rebuild and re-approve")
    decisions = read_json(args.owner_decisions) if args.owner_decisions else {}
    blanket = decisions.get("blanketDevWrites") == BLANKET_DEV_WRITES
    if args.approve is None and not blanket:
        raise SilvallyError("pass --approve with this card's digest, or --owner-decisions carrying blanketDevWrites")
    if args.approve is not None and args.approve != card["operationDigest"]:
        raise SilvallyError("approval digest does not match this upload card")
    if args.slice:
        sensitive = ((read_json(args.catalog).get("slices") or {}).get(args.slice) or {}).get("sensitiveFields")
        if sensitive and decisions.get("sensitiveFieldStaging") != SENSITIVE_DECISION:
            raise SilvallyError(f"SensitiveStagingDecisionRequired: slice {args.slice} stages {sensitive.get('inputs')}; the owner "
                                "must decide sensitiveFieldStaging: stage-real-values-to-dev")
    bucket, key_prefix = parse_s3(args.prefix)
    for obj in manifest["objects"] + [{"key": "manifest.json"}]:
        aws(["s3api", "put-object", "--bucket", bucket, "--key", key_prefix + obj["key"], "--body", str(directory / obj["key"]),
             "--if-none-match", "*"], profile=args.profile, region=args.region, environment="dev")
    head = aws(["s3api", "head-object", "--bucket", bucket, "--key", key_prefix + "manifest.json"], profile=args.profile, region=args.region, environment="prod")
    back = directory.parent / f".{directory.name}-manifest-readback.json"
    aws(["s3", "cp", args.prefix + "manifest.json", str(back), "--quiet"], profile=args.profile, region=args.region, environment="prod", output_json=False)
    result = {"manifest": args.prefix + "manifest.json", "manifestSha256": sha256_file(back), "manifestVersionId": head.get("VersionId"),
              "matchesLocal": sha256_file(back) == sha256_file(directory / "manifest.json"),
              "approvalOperationDigest": card["operationDigest"],
              "approvalKind": "operation" if args.approve else "owner-blanket-dev-writes", "slice": args.slice}
    back.unlink()
    print(json.dumps(result, indent=1))
    return 0 if result["matchesLocal"] else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("manifest", "upload"):
        p = sub.add_parser(name)
        p.add_argument("--dir", required=True)
        p.add_argument("--prefix", required=True)
        if name == "upload":
            p.add_argument("--profile", required=True)
            p.add_argument("--region", default=DEFAULT_REGION)
            p.add_argument("--approve", help="the upload card's operation digest")
            p.add_argument("--owner-decisions", help="ownerDecisions JSON: blanketDevWrites, sensitiveFieldStaging")
            p.add_argument("--slice", help="the package slice this package stages (recorded; checked for sensitive fields)")
            p.add_argument("--catalog", default=str(DEFAULT_CATALOG), help="PROD-actuals catalog with each slice's sensitiveFields")
    args = parser.parse_args(argv)
    return {"manifest": cmd_manifest, "upload": cmd_upload}[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
