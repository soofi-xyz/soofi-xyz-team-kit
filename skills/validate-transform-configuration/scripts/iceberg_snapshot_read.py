#!/usr/bin/env python3
"""Read-only snapshot read of a Glue/Iceberg table (e.g. PROD Stage) for oracle building.

  iceberg_snapshot_read.py --profile <prod-profile> --table interprose_current.debt_settlement_agency \
      --columns id,debt_id,dsa_name,reported_date --key-column debt_id --keys-file keys.txt \
      --private-dir <dir outside any repo> [--snapshot-id N]

Uses only S3 GetObject/Glue GetTable through pyiceberg (no Athena, no writes). The full
snapshot is scanned and filtered locally by --keys-file, because pyiceberg In() filters
were observed to drop matching rows. Matching rows are written to --private-dir
(mode 0700, refused inside a git checkout) as rows.json; stdout carries only aggregates:
snapshot id and timestamp, table row count, matched rows, keys with more than one row.
Delete the private directory when the oracle is built; never commit or upload it.

Requires pyiceberg[glue,pyarrow]==0.7.1 (see scripts/requirements-silvally.txt).
"""

from __future__ import annotations

import argparse
import json
import subprocess
from collections import Counter
from pathlib import Path

from silvally_io import DEFAULT_REGION, SilvallyError, private_dir, write_json


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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--region", default=DEFAULT_REGION)
    parser.add_argument("--table", required=True, help="glue_database.table")
    parser.add_argument("--columns", required=True, help="comma-separated columns to read")
    parser.add_argument("--key-column", required=True)
    parser.add_argument("--keys-file", required=True, help="one key per line")
    parser.add_argument("--snapshot-id", type=int)
    parser.add_argument("--private-dir", required=True)
    args = parser.parse_args(argv)

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
    if args.key_column not in columns:
        columns += (args.key_column,)
    keys = {line.strip() for line in Path(args.keys_file).read_text().splitlines() if line.strip()}
    data = table.scan(selected_fields=columns, snapshot_id=snapshot.snapshot_id).to_arrow()
    rows = [r for r in data.to_pylist() if str(r[args.key_column]) in keys]
    write_json(out / "rows.json", rows)
    per_key = Counter(str(r[args.key_column]) for r in rows)
    summary = {"table": args.table, "snapshotId": snapshot.snapshot_id, "snapshotTimestampMs": snapshot.timestamp_ms,
               "currentSnapshotId": table.current_snapshot().snapshot_id, "tableRows": data.num_rows, "keysRequested": len(keys),
               "keysMatched": len(per_key), "rowsMatched": len(rows), "keysWithMultipleRows": sum(1 for c in per_key.values() if c > 1),
               "columns": list(columns), "privateRowsFile": "rows.json (mode-0700 directory; do not commit)"}
    write_json(out / "summary.json", summary)
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
