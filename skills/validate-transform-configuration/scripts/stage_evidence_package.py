#!/usr/bin/env python3
"""Build and upload an immutable DEV evidence package (create-only, manifest last).

  stage_evidence_package.py manifest --dir PKG --prefix s3://<dev-transform-data-bucket>/inputs/<name>/<window>_v1/
      Writes PKG/manifest.json (key, bytes, sha256, rows for csv/jsonl, dataset per top-level directory)
      and prints the upload operation card with its operation digest (APPROVAL_REQUIRED).
  stage_evidence_package.py upload --dir PKG --prefix ... --profile <dev-profile> --approve sha256:...
      Re-derives the card, refuses a changed card or a non-matching digest, uploads every object with
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

from silvally_io import DEFAULT_REGION, SilvallyError, aws, canonical_digest, parse_s3, sha256_file, write_json


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
    if args.approve != card["operationDigest"]:
        raise SilvallyError("approval digest does not match this upload card")
    bucket, key_prefix = parse_s3(args.prefix)
    for obj in manifest["objects"] + [{"key": "manifest.json"}]:
        aws(["s3api", "put-object", "--bucket", bucket, "--key", key_prefix + obj["key"], "--body", str(directory / obj["key"]),
             "--if-none-match", "*"], profile=args.profile, region=args.region, environment="dev")
    head = aws(["s3api", "head-object", "--bucket", bucket, "--key", key_prefix + "manifest.json"], profile=args.profile, region=args.region, environment="prod")
    back = directory.parent / f".{directory.name}-manifest-readback.json"
    aws(["s3", "cp", args.prefix + "manifest.json", str(back), "--quiet"], profile=args.profile, region=args.region, environment="prod", output_json=False)
    result = {"manifest": args.prefix + "manifest.json", "manifestSha256": sha256_file(back), "manifestVersionId": head.get("VersionId"),
              "matchesLocal": sha256_file(back) == sha256_file(directory / "manifest.json"),
              "approvalOperationDigest": card["operationDigest"]}
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
            p.add_argument("--approve", required=True)
    args = parser.parse_args(argv)
    return {"manifest": cmd_manifest, "upload": cmd_upload}[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
