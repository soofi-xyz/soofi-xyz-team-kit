#!/usr/bin/env python3
"""Read-only snapshot read of a Glue/Iceberg table (for example a PROD mirror of the target system).

  iceberg_snapshot_read.py --profile <prod-profile> --table <glue_database>.<table> --columns <col>,<col> \
      (--key-column <key column> --keys-file keys.txt | --window-column <col> --start ISO --end-exclusive ISO) \
      --private-dir <dir outside any repo> [--snapshot-id N]

Uses only S3 GetObject/Glue GetTable through pyiceberg (no Athena, no writes). The snapshot is
scanned and filtered in memory by --keys-file or by the UTC window, because pyiceberg In() filters
were observed to drop matching rows. Matching rows are written to --private-dir (mode 0700,
refused inside a git checkout) as rows.json and rows.jsonl, the PROD actual that
prod_actuals.py table-summary and compare read; stdout carries only aggregates: snapshot id and
timestamp, table row count, matched rows and whether the snapshot covers the window. Delete the
private directory after the comparison; never commit or upload it.

Requires pyiceberg[glue,pyarrow]==0.7.1 (see scripts/requirements-silvally.txt).
"""

from __future__ import annotations

import argparse
import json
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from silvally_io import DEFAULT_REGION, SilvallyError, private_dir, write_json
from source_window import parse_utc


def inside_git(path: Path) -> bool:
    result = subprocess.run(["git", "-C", str(path), "rev-parse", "--is-inside-work-tree"], capture_output=True, text=True)
    return result.returncode == 0 and result.stdout.strip() == "true"


def credentials(profile: str) -> dict:
    """Short-lived credentials from the AWS CLI (works with SSO profiles), used only in-process."""
    result = subprocess.run(["aws", "configure", "export-credentials", "--profile", profile, "--format", "process"],
                            capture_output=True, text=True)
    if result.returncode != 0:
        raise SilvallyError(f"cannot obtain credentials for profile {profile}; run aws sso login --profile {profile}")
    data = json.loads(result.stdout)
    return {"access_key": data["AccessKeyId"], "secret_key": data["SecretAccessKey"], "token": data.get("SessionToken")}


def in_window(value, start: datetime, end: datetime) -> bool:
    if value is None:
        return False
    if not isinstance(value, datetime):
        try:
            value = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return False
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return start <= value < end


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--region", default=DEFAULT_REGION)
    parser.add_argument("--table", required=True, help="glue_database.table")
    parser.add_argument("--columns", required=True, help="comma-separated columns to read")
    parser.add_argument("--key-column")
    parser.add_argument("--keys-file", help="one key per line")
    parser.add_argument("--window-column", help="read rows whose column value lies in [--start, --end-exclusive) instead of keys")
    parser.add_argument("--start")
    parser.add_argument("--end-exclusive")
    parser.add_argument("--snapshot-id", type=int)
    parser.add_argument("--private-dir", required=True)
    args = parser.parse_args(argv)
    if bool(args.window_column) == bool(args.keys_file) or (args.keys_file and not args.key_column) or (
            args.window_column and not (args.start and args.end_exclusive)):
        raise SilvallyError("pass either --key-column with --keys-file, or --window-column with --start and --end-exclusive")

    out = Path(args.private_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    if inside_git(out):
        raise SilvallyError("--private-dir must be outside any git checkout")
    private_dir(out)
    try:
        from pyiceberg.catalog.glue import GlueCatalog
    except ImportError as error:
        raise SystemExit("pyiceberg[glue,pyarrow]==0.7.1 is required (scripts/requirements-silvally.txt)") from error
    creds = credentials(args.profile)
    catalog = GlueCatalog("glue", **{
        "region_name": args.region, "aws_access_key_id": creds["access_key"], "aws_secret_access_key": creds["secret_key"],
        "aws_session_token": creds["token"], "s3.region": args.region, "s3.access-key-id": creds["access_key"],
        "s3.secret-access-key": creds["secret_key"], "s3.session-token": creds["token"],
    })
    table = catalog.load_table(args.table)
    snapshot = table.snapshot_by_id(args.snapshot_id) if args.snapshot_id else table.current_snapshot()
    columns = tuple(c.strip() for c in args.columns.split(","))
    selector = args.key_column or args.window_column
    if selector not in columns:
        columns += (selector,)
    data = table.scan(selected_fields=columns, snapshot_id=snapshot.snapshot_id).to_arrow()
    if args.keys_file:
        keys = {line.strip() for line in Path(args.keys_file).read_text().splitlines() if line.strip()}
        rows = [r for r in data.to_pylist() if str(r[args.key_column]) in keys]
    else:
        start, end = parse_utc(args.start), parse_utc(args.end_exclusive)
        rows = [r for r in data.to_pylist() if in_window(r[args.window_column], start, end)]
    write_json(out / "rows.json", {"table": args.table, "snapshotId": snapshot.snapshot_id,
                                   "snapshotTimestampMs": snapshot.timestamp_ms, "rows": rows})
    (out / "rows.jsonl").write_text("".join(json.dumps(r, sort_keys=True, default=str) + "\n" for r in rows), encoding="utf-8")
    per_key = Counter(str(r[selector]) for r in rows) if args.keys_file else Counter()
    summary = {"table": args.table, "snapshotId": snapshot.snapshot_id, "snapshotTimestampMs": snapshot.timestamp_ms,
               "currentSnapshotId": table.current_snapshot().snapshot_id, "tableRows": data.num_rows, "rowsMatched": len(rows),
               "columns": list(columns), "privateRowsFile": "rows.json and rows.jsonl (mode-0700 directory; do not commit)"}
    if args.keys_file:
        summary.update({"keysRequested": len(keys), "keysMatched": len(per_key),
                        "keysWithMultipleRows": sum(1 for c in per_key.values() if c > 1)})
    else:
        summary["window"] = {"column": args.window_column, "start": args.start, "endExclusive": args.end_exclusive,
                             "snapshotCoversWindow": snapshot.timestamp_ms >= end.timestamp() * 1000}
    write_json(out / "summary.json", summary)
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
