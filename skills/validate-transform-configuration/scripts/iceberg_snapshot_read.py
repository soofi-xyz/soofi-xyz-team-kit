#!/usr/bin/env python3
"""Read-only, bounded snapshot read of a Glue/Iceberg table (for example a PROD mirror of the target system).

  iceberg_snapshot_read.py --profile <prod-profile> --table <glue_database>.<table> --columns <col>,<col> \
      --window-column <col> --start ISO --end-exclusive ISO [--key-column <key column> --keys-file keys.txt] \
      [--where <col>=<value> ...] --private-dir <dir outside any repo> [--snapshot-id N] \
      [--data-max-column <stage timestamp column>] [--allow-full-scan]
  iceberg_snapshot_read.py ... --key-column <key> --keys-file keys.txt --current-state-as-of <data cutoff ISO> \
      --data-max-column <stage timestamp column> --private-dir <dir>      (current-state-by-key; no window)

Uses only S3 GetObject/Glue GetTable through pyiceberg (no Athena, no writes). The read is bounded to the selected
UTC day(s): --window-column with --start/--end-exclusive is pushed down to the scan as a range predicate on that
column (partition and file pruning through Iceberg column bounds), widened by one day on each side so a string or
local-time column cannot lose boundary rows, and then applied exactly in memory. A key read (--keys-file, for the
canary sample or the full window's actual keys) of an event actual takes the same window, so it reads only the selected
day(s) and not the whole table. A current-state-by-key actual (catalog comparison.actualScope) is read in two steps:
select the keys from the window (a window read, then prod_actuals.py keys), then read each selected key's current state
with --current-state-as-of <the mirror's data cutoff> --key-column --keys-file --data-max-column and no window: every
row of those keys whose data timestamp is at or before the cutoff, not only the window's rows. --where col=value adds equality predicates (for example the catalog slice's rowFilter.actual),
pushed down and re-checked in memory, so byUtcDay counts only the comparison population. Key lists are filtered in
memory, because pyiceberg In() filters were observed to drop matching rows. A read without a window is refused unless
it is a key-bounded --current-state-as-of read or --allow-full-scan is given explicitly. Window columns of type timestamptz, timestamp, date or string can be pushed
down; any other type needs --allow-full-scan.

Matching rows are written to --private-dir (mode 0700, refused inside a git checkout) as rows.json and rows.jsonl, the
PROD actual that prod_actuals.py table-summary and compare read; stdout carries only aggregates: snapshot id and
timestamp, rows scanned, matched rows, the pushed-down filter, rows per UTC day of a window read (the day-selection
counts for source_window.py data-days: read a bounded lookback window once, newest day first) and whether the snapshot
covers the window. --data-max-column records the table-wide maximum of that column (for example
_stage_output_timestamp) as dataMax: the DATA's freshness, which prod_actuals.py table-summary requires because a
mirror can re-commit snapshots while its data stops. It comes from the snapshot's data-file upper bounds (manifest
metadata, no data read) and falls back to a scan of that one column only when the table records no bounds. Delete the
private directory after the comparison (run_workspace.py cleanup); never commit or upload it.

Requires pyiceberg[glue,pyarrow]==0.7.1 (see scripts/requirements-silvally-prod-oracle.txt).
"""

from __future__ import annotations

import argparse
import json
import subprocess
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from prod_actuals import parse_loose
from silvally_io import DEFAULT_REGION, SilvallyError, private_dir, write_json
from source_window import iso, parse_utc

PUSHDOWN_TYPES = {"timestamptz", "timestamp", "date", "string"}


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
    moment = parse_loose(value)
    return moment is not None and start <= moment < end


def window_bounds(field_type: str, start: datetime, end: datetime) -> tuple[str, str]:
    """Literal bounds [low, high) for a pushed-down window on a column of this Iceberg type, widened by one day."""
    low, high = start - timedelta(days=1), end + timedelta(days=1)
    kind = field_type.lower()
    if kind == "timestamptz":
        return low.strftime("%Y-%m-%dT%H:%M:%S+00:00"), high.strftime("%Y-%m-%dT%H:%M:%S+00:00")
    if kind == "timestamp":
        return low.strftime("%Y-%m-%dT%H:%M:%S"), high.strftime("%Y-%m-%dT%H:%M:%S")
    if kind in {"date", "string"}:
        return low.strftime("%Y-%m-%d"), high.strftime("%Y-%m-%d")
    raise SilvallyError(f"cannot push a UTC window down to a {field_type} column; pass --allow-full-scan to read the "
                        "whole snapshot explicitly")


def parse_where(values: list[str]) -> dict[str, str]:
    out = {}
    for value in values:
        column, sep, literal = value.partition("=")
        if not sep or not column.strip():
            raise SilvallyError(f"--where expects column=value, got {value!r}")
        out[column.strip()] = literal.strip()
    return out


def row_filter_spec(schema_types: dict[str, str], window_column: str | None, start: datetime | None, end: datetime | None,
                    where: dict[str, str]) -> list[tuple[str, str, str]]:
    """The predicates pushed down to the scan, as (operator, column, literal); every one is re-checked in memory."""
    predicates = []
    if window_column:
        if window_column not in schema_types:
            raise SilvallyError(f"--window-column {window_column} is not a column of the table")
        low, high = window_bounds(schema_types[window_column], start, end)
        predicates += [(">=", window_column, low), ("<", window_column, high)]
    for column, literal in where.items():
        if column not in schema_types:
            raise SilvallyError(f"--where column {column} is not a column of the table")
        predicates.append(("==", column, literal))
    return predicates


def build_expression(predicates: list[tuple[str, str, str]]):
    from pyiceberg.expressions import AlwaysTrue, And, EqualTo, GreaterThanOrEqual, LessThan
    ops = {">=": GreaterThanOrEqual, "<": LessThan, "==": EqualTo}
    expression = AlwaysTrue()
    for op, column, literal in predicates:
        expression = And(expression, ops[op](column, literal))
    return expression


def where_matches(row: dict, where: dict[str, str]) -> bool:
    return all(row.get(column) is not None and str(row.get(column)) == literal for column, literal in where.items())


def data_max(table, snapshot_id: int, column: str) -> tuple[str | None, str]:
    """Table-wide max of a data timestamp column from data-file upper bounds; a one-column scan when none are recorded."""
    try:
        files = table.inspect.files(snapshot_id=snapshot_id).to_pylist()
        bounds = [parse_loose(((f.get("readable_metrics") or {}).get(column) or {}).get("upper_bound"))
                  for f in files if f.get("content", 0) == 0]
        bounds = [b for b in bounds if b is not None]
        if bounds:
            return iso(max(bounds)), "data-file-upper-bounds"
    except (AttributeError, KeyError, TypeError, ValueError):
        pass
    values = table.scan(selected_fields=(column,), snapshot_id=snapshot_id).to_arrow().column(column).to_pylist()
    stamps = [parse_loose(v) for v in values if v is not None]
    stamps = [s for s in stamps if s is not None]
    return (iso(max(stamps)) if stamps else None), "single-column-scan"


def check_read_mode(args) -> None:
    """A window read, a key read inside the window, or a key-bounded current-state read as of the data cutoff."""
    if args.current_state_as_of:
        if args.window_column or not (args.key_column and args.keys_file and args.data_max_column):
            raise SilvallyError("--current-state-as-of reads the selected keys' current state: pass --key-column, --keys-file and "
                                "--data-max-column, and no --window-column (select the keys from the window first)")
        parse_utc(args.current_state_as_of)
        return
    if not (args.window_column or args.keys_file) or (args.keys_file and not args.key_column) or (
            args.window_column and not (args.start and args.end_exclusive)):
        raise SilvallyError("pass --window-column with --start and --end-exclusive, optionally with --key-column and --keys-file")
    if not args.window_column and not args.allow_full_scan:
        raise SilvallyError("a key read without --window-column scans the whole table; pass the selected day(s) as the window, "
                            "--current-state-as-of <data cutoff> for a current-state-by-key actual, or --allow-full-scan explicitly")


def as_of_matches(row: dict, column: str, as_of: datetime) -> bool:
    moment = parse_loose(row.get(column))
    return moment is not None and moment <= as_of


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--region", default=DEFAULT_REGION)
    parser.add_argument("--table", required=True, help="glue_database.table")
    parser.add_argument("--columns", required=True, help="comma-separated columns to read")
    parser.add_argument("--key-column")
    parser.add_argument("--keys-file", help="one key per line; combine with the window so only the selected day(s) are read")
    parser.add_argument("--window-column", help="read rows whose column value lies in [--start, --end-exclusive) (pushed down)")
    parser.add_argument("--start")
    parser.add_argument("--end-exclusive")
    parser.add_argument("--where", action="append", default=[], help="column=value equality filter (pushed down; repeatable)")
    parser.add_argument("--allow-full-scan", action="store_true", help="explicitly read the whole snapshot without a window")
    parser.add_argument("--snapshot-id", type=int)
    parser.add_argument("--data-max-column", help="record the table-wide maximum of this data/stage timestamp column as dataMax")
    parser.add_argument("--current-state-as-of",
                        help="ISO data cutoff: read every row of the --keys-file keys whose --data-max-column is at or before it, "
                             "whatever its window-column value (a current-state-by-key actual); no --window-column")
    parser.add_argument("--private-dir", required=True)
    args = parser.parse_args(argv)
    check_read_mode(args)
    where = parse_where(args.where)

    out = Path(args.private_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    if inside_git(out):
        raise SilvallyError("--private-dir must be outside any git checkout")
    private_dir(out)
    try:
        from pyiceberg.catalog.glue import GlueCatalog
    except ImportError as error:
        raise SystemExit("pyiceberg[glue,pyarrow]==0.7.1 is required (scripts/requirements-silvally-prod-oracle.txt)") from error
    creds = credentials(args.profile)
    catalog = GlueCatalog("glue", **{
        "region_name": args.region, "aws_access_key_id": creds["access_key"], "aws_secret_access_key": creds["secret_key"],
        "aws_session_token": creds["token"], "s3.region": args.region, "s3.access-key-id": creds["access_key"],
        "s3.secret-access-key": creds["secret_key"], "s3.session-token": creds["token"],
    })
    table = catalog.load_table(args.table)
    summary = read_snapshot(table, args, where)
    write_json(out / "summary.json", summary["summary"])
    write_json(out / "rows.json", summary["rowsDocument"])
    (out / "rows.jsonl").write_text("".join(json.dumps(r, sort_keys=True, default=str) + "\n" for r in summary["rowsDocument"]["rows"]),
                                    encoding="utf-8")
    print(json.dumps(summary["summary"], indent=1))
    return 0


def read_snapshot(table, args, where: dict[str, str]) -> dict:
    """The bounded read itself; returns the sanitized summary and the private rows document."""
    snapshot = table.snapshot_by_id(args.snapshot_id) if args.snapshot_id else table.current_snapshot()
    columns = tuple(c.strip() for c in args.columns.split(","))
    as_of_column = args.data_max_column if getattr(args, "current_state_as_of", None) else None
    for extra in (args.key_column, args.window_column, as_of_column, *where):
        if extra and extra not in columns:
            columns += (extra,)
    start = parse_utc(args.start) if args.window_column else None
    end = parse_utc(args.end_exclusive) if args.window_column else None
    types = {field.name: str(field.field_type) for field in table.schema().fields}
    if args.window_column and types.get(args.window_column, "").lower() not in PUSHDOWN_TYPES and args.allow_full_scan:
        predicates = row_filter_spec(types, None, None, None, where)
    else:
        predicates = row_filter_spec(types, args.window_column, start, end, where)
    pushed = {"row_filter": build_expression(predicates)} if predicates else {}
    data = table.scan(**pushed, selected_fields=columns, snapshot_id=snapshot.snapshot_id).to_arrow()
    rows = [r for r in data.to_pylist() if where_matches(r, where)]
    if args.window_column:
        rows = [r for r in rows if in_window(r[args.window_column], start, end)]
    if as_of_column:
        as_of = parse_utc(args.current_state_as_of)
        rows = [r for r in rows if as_of_matches(r, as_of_column, as_of)]
    keys = set()
    if args.keys_file:
        keys = {line.strip() for line in Path(args.keys_file).read_text().splitlines() if line.strip()}
        rows = [r for r in rows if str(r[args.key_column]) in keys]
    freshness, method = data_max(table, snapshot.snapshot_id, args.data_max_column) if args.data_max_column else (None, None)
    summary = {"table": args.table, "snapshotId": snapshot.snapshot_id, "snapshotTimestampMs": snapshot.timestamp_ms,
               "currentSnapshotId": table.current_snapshot().snapshot_id, "rowsScanned": data.num_rows, "rowsMatched": len(rows),
               "pushedDownFilter": [f"{c} {op} {v!r}" for op, c, v in predicates] or ["none (explicit --allow-full-scan)"],
               "columns": list(columns), "privateRowsFile": "rows.json and rows.jsonl (mode-0700 directory; do not commit)"}
    if where:
        summary["where"] = where
    if as_of_column:
        summary["currentStateAsOf"] = {"readMode": "current-state-by-key", "column": as_of_column, "asOf": args.current_state_as_of,
                                       "detail": "every row of the selected keys with a data timestamp at or before the cutoff, "
                                                 "not limited to the window's rows"}
    if args.keys_file:
        per_key = Counter(str(r[args.key_column]) for r in rows)
        summary.update({"keysRequested": len(keys), "keysMatched": len(per_key),
                        "keysWithMultipleRows": sum(1 for c in per_key.values() if c > 1)})
    if args.window_column:
        summary["window"] = {"column": args.window_column, "start": args.start, "endExclusive": args.end_exclusive,
                             "snapshotCoversWindow": snapshot.timestamp_ms >= end.timestamp() * 1000}
        days = Counter(parse_loose(r[args.window_column]).strftime("%Y-%m-%d") for r in rows if parse_loose(r[args.window_column]))
        summary["byUtcDay"] = dict(sorted(days.items(), reverse=True))
    if args.data_max_column:
        summary["dataMax"] = {"column": args.data_max_column, "value": freshness, "method": method}
    return {"summary": summary, "rowsDocument": {"table": args.table, "snapshotId": snapshot.snapshot_id,
                                                 "snapshotTimestampMs": snapshot.timestamp_ms, "dataMax": freshness, "rows": rows}}


if __name__ == "__main__":
    raise SystemExit(main())
