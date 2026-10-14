#!/usr/bin/env python3
"""One local run directory per validation run, and cleanup of that run's private rows only.

  run_workspace.py new --root ~/silvally-runs --label <mapping-or-request-slug> [--now ISO]
      Create <root>/<label>-<UTC yyyymmddThhmmssZ>-<random>/ with a .silvally-run.json marker (runId, label,
      createdAt) and a mode-0700 private/ directory for restricted PROD rows. Refuses an existing directory,
      so a run never inherits another session's cards, fixtures or evidence. Prints the path and runId.
  run_workspace.py cleanup --run-dir DIR
      Delete DIR/private/ of this run only: refuses a directory without this tool's marker, a private/ that is a
      symlink or leaves DIR, and any path owned by another run's marker. Sanitized evidence stays; the cleanup
      is recorded in the marker.

Every tool that writes restricted rows (--private-dir) points inside <run>/private/; every transform_runs.py run
directory lives under <run>/ and refuses a directory another run already uses.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shutil
import time
from pathlib import Path

from silvally_io import SilvallyError, private_dir, read_json, write_json

MARKER = ".silvally-run.json"


def slug(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if not cleaned:
        raise SilvallyError("--label needs at least one letter or digit")
    return cleaned[:60]


def cmd_new(args) -> int:
    stamp = args.now or time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    run_id = f"{slug(args.label)}-{stamp}-{secrets.token_hex(3)}"
    root = Path(args.root).expanduser()
    run_dir = root / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    os.chmod(run_dir, 0o700)
    private_dir(run_dir / "private")
    write_json(run_dir / MARKER, {"runId": run_id, "label": args.label, "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                  "private": "private/"})
    print(json.dumps({"runDir": str(run_dir), "runId": run_id, "privateDir": str(run_dir / "private")}))
    return 0


def cmd_cleanup(args) -> int:
    run_dir = Path(args.run_dir).expanduser().resolve()
    marker_path = run_dir / MARKER
    if not marker_path.exists():
        raise SilvallyError(f"{run_dir} has no {MARKER}; cleanup deletes only a run directory created by run_workspace.py new")
    marker = read_json(marker_path)
    private = run_dir / "private"
    if private.is_symlink() or (private.exists() and private.resolve().parent != run_dir):
        raise SilvallyError("private/ is not a plain directory inside this run directory; refusing")
    foreign = [str(p.parent) for p in private.rglob(MARKER)] if private.exists() else []
    if foreign:
        raise SilvallyError(f"private/ contains other runs {foreign}; refusing")
    removed = sum(1 for p in private.rglob("*") if p.is_file()) if private.exists() else 0
    if private.exists():
        shutil.rmtree(private)
    marker["cleanups"] = [*marker.get("cleanups", []), {"removedFiles": removed, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}]
    write_json(marker_path, marker)
    print(json.dumps({"runId": marker["runId"], "removedPrivateFiles": removed}))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("new")
    p.add_argument("--root", required=True, help="a directory outside any repository, for example ~/silvally-runs")
    p.add_argument("--label", required=True)
    p.add_argument("--now", help="UTC stamp yyyymmddThhmmssZ (default: now)")
    p = sub.add_parser("cleanup")
    p.add_argument("--run-dir", required=True)
    args = parser.parse_args(argv)
    return {"new": cmd_new, "cleanup": cmd_cleanup}[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
