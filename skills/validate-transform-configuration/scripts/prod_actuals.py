#!/usr/bin/env python3
"""What PROD actually did in a confirmed window, the DEV canary sample, and the comparison against it.

  prod_actuals.py lambda-outcomes --profile <prod-profile> --region R --log-group LG --function-name F
      --start ISO --end-exclusive ISO --slice NAME --private-dir DIR --out summary.json
      Read-only: filter an EXPRESS state machine's execution log group for LambdaFunctionScheduled and
      LambdaFunctionSucceeded/Failed/TimedOut events of one function, pair each result with its scheduled
      input, and write one private row per event (eventTime, outcome accepted|rejected, input, actual, error).
  prod_actuals.py table-summary --rows rows.json --slice NAME --baseline-kind iceberg-table --out summary.json
      Summarize iceberg_snapshot_read.py rows (window read) as a slice baseline, with snapshot freshness.
  prod_actuals.py none --slice NAME --reason TEXT --out summary.json
      Record that no PROD actual exists for a slice; comparison falls back to schema, row-count and
      reject-reason checks, and the report must say so.
  prod_actuals.py canary-sample --events events.jsonl --slice NAME --time-field F --key-field K
      [--outcome-field O] [--per-slice 10] --private-out selected.jsonl --out summary.json
      Deterministic canary: group events by outcome, order each group by (event time, SHA-256 of the key),
      then take round-robin across the sorted outcome names until --per-slice events are chosen, so every
      outcome present in the window (for example accepted and rejected) is represented.
  prod_actuals.py inputs --events selected.jsonl --input-field input [--bind FIELD=actual.PATH ...]
      --out-dir DIR
      Write the selected events' real PROD inputs as part-00000.jsonl for approval-gated DEV staging.
      --bind fills FIELD from the PROD result only when the input lacks it (the value PROD resolved).
  prod_actuals.py compare --catalog prod-actuals.json --slice NAME --actual events.jsonl
      --dataset NAME=PATH [...] [--delimiter '|'] [--allow-column COLUMN=REASON ...] --out checks.json
      Keyed comparison of DEV outputs with the PROD actual: rows only in DEV, rows only in PROD, per-column
      mismatches over the catalog fieldMap, row counts, and rejects against PROD failures. Output uses the
      compare_datasets.py checks shape. Values never leave the private files; only counts are printed.

PROD calls go through silvally_io.aws with environment="prod", which refuses every write verb. Private
files hold real rows: keep them in a mode-0700 directory outside any repository and delete them afterwards.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from compare_datasets import read_rows
from silvally_io import SilvallyError, aws, private_dir, read_json, sha256_file, write_json
from source_window import iso, parse_utc

RESULT_TYPES = {"LambdaFunctionSucceeded": "accepted", "LambdaFunctionFailed": "rejected", "LambdaFunctionTimedOut": "rejected"}
LAMBDA_TYPES = ("LambdaFunctionScheduled", "LambdaFunctionStarted", *RESULT_TYPES)


def dig(value, path: str):
    for part in path.split("."):
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except ValueError:
                return None
        if not isinstance(value, dict):
            return None
        value = value.get(part)
    return value


def text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return json.dumps(value, sort_keys=True)
    return str(value)


def parsed(value):
    if isinstance(value, str) and value.strip()[:1] in ("{", "["):
        try:
            return json.loads(value)
        except ValueError:
            return value
    return value


def read_jsonl(path: Path | str) -> list[dict]:
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(json.dumps(r, sort_keys=True, default=str) + "\n" for r in rows), encoding="utf-8")


def utc_day(value: str) -> str:
    return value[:10]


def pair_outcomes(messages: list[dict], function_name: str) -> list[dict]:
    """Pair each Lambda result with the scheduled input it follows, per execution."""
    by_id: dict[tuple, dict] = {}
    for m in messages:
        by_id[(m.get("execution_arn"), str(m.get("id")))] = m
    rows = []
    for m in messages:
        outcome = RESULT_TYPES.get(m.get("type"))
        if not outcome:
            continue
        cursor, scheduled = m, None
        for _ in range(4):
            cursor = by_id.get((m.get("execution_arn"), str(cursor.get("previous_event_id"))))
            if cursor is None:
                break
            if cursor.get("type") == "LambdaFunctionScheduled":
                scheduled = cursor
                break
        details = (scheduled or {}).get("details") or {}
        if scheduled is None or function_name not in json.dumps(details):
            continue
        result = m.get("details") or {}
        rows.append({
            "eventTime": iso(datetime.fromtimestamp(int(scheduled["event_timestamp"]) / 1000, timezone.utc)),
            "outcome": outcome,
            "input": parsed(details.get("input")),
            "actual": parsed(result.get("output")),
            "error": result.get("error"),
            "executionRef": hashlib.sha256(str(m.get("execution_arn")).encode()).hexdigest()[:16],
        })
    return sorted(rows, key=lambda r: (r["eventTime"], r["executionRef"]))


def cmd_lambda_outcomes(args) -> int:
    start, end = parse_utc(args.start), parse_utc(args.end_exclusive)
    pattern = " ".join(f'?"{t}"' for t in LAMBDA_TYPES)
    messages, token, pages = [], None, 0
    while True:
        call = ["logs", "filter-log-events", "--log-group-name", args.log_group, "--filter-pattern", pattern,
                "--start-time", str(int(start.timestamp() * 1000)), "--end-time", str(int(end.timestamp() * 1000) - 1)]
        if token:
            call += ["--next-token", token]
        page = aws(call, profile=args.profile, region=args.region, environment="prod")
        messages += [json.loads(e["message"]) for e in page.get("events", []) if e.get("message", "").startswith("{")]
        token, pages = page.get("nextToken"), pages + 1
        if not token or pages >= args.max_pages:
            break
    rows = pair_outcomes(messages, args.function_name)
    out = private_dir(args.private_dir)
    write_jsonl(out / f"{args.slice}-events.jsonl", rows)
    summary = {"slice": args.slice, "baselineKind": "state-machine-lambda-outcomes", "status": "AVAILABLE" if rows else "EMPTY",
               "window": {"start": iso(start), "endExclusive": iso(end)}, "events": len(rows),
               "byOutcome": dict(Counter(r["outcome"] for r in rows)), "byUtcDay": dict(Counter(utc_day(r["eventTime"]) for r in rows)),
               "errors": dict(Counter(r["error"] for r in rows if r["error"])), "pagesRead": pages, "truncated": bool(token),
               "privateEventsSha256": "sha256:" + sha256_file(out / f"{args.slice}-events.jsonl"), "prodAccess": "read-only"}
    write_json(args.out, summary)
    print(json.dumps(summary, indent=1))
    return 0 if rows else 1


def cmd_table_summary(args) -> int:
    doc = read_json(args.rows)
    rows = doc.get("rows", doc) if isinstance(doc, dict) else doc
    snapshot = doc.get("snapshotTimestampMs") if isinstance(doc, dict) else None
    window_end = parse_utc(args.end_exclusive) if args.end_exclusive else None
    fresh = window_end is None or (snapshot is not None and snapshot >= window_end.timestamp() * 1000)
    status = "STALE" if not fresh else ("AVAILABLE" if rows else "EMPTY")
    summary = {"slice": args.slice, "baselineKind": args.baseline_kind, "status": status, "rows": len(rows),
               "snapshotTimestampMs": snapshot, "freshForWindow": fresh, "prodAccess": "read-only"}
    write_json(args.out, summary)
    print(json.dumps(summary, indent=1))
    return 0 if status == "AVAILABLE" else 1


def cmd_none(args) -> int:
    summary = {"slice": args.slice, "baselineKind": "none", "status": "NONE", "reason": args.reason,
               "fallback": ["schema", "row-count", "reject-reason"], "prodAccess": "read-only"}
    write_json(args.out, summary)
    print(json.dumps(summary, indent=1))
    return 0


def canary_select(events: list[dict], time_field: str, key_field: str, outcome_field: str | None, per_slice: int) -> list[dict]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for event in events:
        groups[text(dig(event, outcome_field)) if outcome_field else ""].append(event)
    for rows in groups.values():
        rows.sort(key=lambda e: (text(dig(e, time_field)), hashlib.sha256(text(dig(e, key_field)).encode()).hexdigest()))
    chosen, depth = [], 0
    while len(chosen) < per_slice and any(depth < len(g) for g in groups.values()):
        for name in sorted(groups):
            if depth < len(groups[name]) and len(chosen) < per_slice:
                chosen.append(groups[name][depth])
        depth += 1
    return chosen


def cmd_canary_sample(args) -> int:
    events = read_jsonl(args.events)
    chosen = canary_select(events, args.time_field, args.key_field, args.outcome_field, args.per_slice)
    target = Path(args.private_out)
    private_dir(target.parent)
    write_jsonl(target, chosen)
    keys = [text(dig(e, args.key_field)) for e in chosen]
    summary = {"slice": args.slice, "eventsInWindow": len(events), "eventsSelected": len(chosen), "perSlice": args.per_slice,
               "selection": f"round-robin over sorted {args.outcome_field or 'single'} groups, each ordered by "
                            f"({args.time_field}, sha256({args.key_field}))",
               "byOutcome": dict(Counter(text(dig(e, args.outcome_field)) for e in chosen)) if args.outcome_field else {},
               "selectionDigest": "sha256:" + hashlib.sha256("\n".join(keys).encode()).hexdigest(),
               "status": "SELECTED" if chosen else "EMPTY"}
    write_json(args.out, summary)
    print(json.dumps(summary, indent=1))
    return 0 if chosen else 1


def cmd_inputs(args) -> int:
    binds = [b.split("=", 1) for b in args.bind or []]
    rows, bound = [], 0
    for event in read_jsonl(args.events):
        row = dig(event, args.input_field)
        if not isinstance(row, dict):
            raise SilvallyError(f"an event has no object at {args.input_field}")
        row = dict(row)
        for field, path in binds:
            if row.get(field) in (None, "") and dig(event, path) not in (None, ""):
                row[field] = dig(event, path)
                bound += 1
        rows.append(row)
    out = private_dir(args.out_dir)
    write_jsonl(out / "part-00000.jsonl", rows)
    summary = {"rows": len(rows), "boundFields": bound, "sha256": "sha256:" + sha256_file(out / "part-00000.jsonl")}
    print(json.dumps(summary, indent=1))
    return 0


def row_matches(row: dict, condition: dict, getter) -> bool:
    return all(text(getter(row, k)) == text(v) for k, v in condition.items())


def cmd_compare(args) -> int:
    spec = read_json(args.catalog)["slices"][args.slice]
    datasets = dict(d.split("=", 1) for d in args.dataset)
    allowed = dict(a.split("=", 1) for a in args.allow_column or [])
    actual = read_jsonl(args.actual) if args.actual else []
    lambda_kind = spec["baselineKind"] == "state-machine-lambda-outcomes"
    accepted = [e for e in actual if e.get("outcome") == "accepted"] if lambda_kind else actual
    source = (lambda e, path: dig(e.get("actual"), path)) if lambda_kind else dig
    condition = (spec.get("rowFilter") or {}).get("actual") or {}
    accepted = [e for e in accepted if row_matches(e, condition, source)]
    checks = []
    main = next((d for d in spec["outputDatasets"] if d in datasets and d != (spec.get("rejects") or {}).get("dataset")), None)
    if main:
        _, rows = read_rows(datasets[main], args.delimiter)
        condition = (spec.get("rowFilter") or {}).get("dataset") or {}
        rows = [r for r in rows if row_matches(r, condition, lambda r, k: r.get(k))]
        dev_key = spec["key"]["dataset"]
        actual_key = spec["key"]["actual"]
        dev = {tuple(r.get(k, "") for k in dev_key): r for r in rows}
        prod = {tuple(text(source(e, k)) for k in actual_key): e for e in accepted}
        mismatches = Counter()
        for key in dev.keys() & prod.keys():
            for column, path in spec["fieldMap"].items():
                if column not in allowed and dev[key].get(column, "") != text(source(prod[key], path)):
                    mismatches[column] += 1
        only_dev, only_prod = len(dev.keys() - prod.keys()), len(prod.keys() - dev.keys())
        ok = not mismatches and not only_dev and not only_prod and len(rows) == len(accepted)
        checks.append({"id": f"prod-actuals-{main}", "dataset": main, "kind": "matches-prod-actuals", "failureCode": "ProdActualsMismatch",
                       "status": "PASS" if ok else "FAIL", "devRows": len(rows), "prodRows": len(accepted),
                       "matchedKeys": len(dev.keys() & prod.keys()), "onlyDev": only_dev, "onlyProd": only_prod,
                       "mismatchedByColumn": dict(mismatches), "allowedColumns": allowed})
    rejects = spec.get("rejects")
    if lambda_kind and rejects and rejects["dataset"] in datasets:
        _, rows = read_rows(datasets[rejects["dataset"]], args.delimiter)
        failed = [e for e in actual if e.get("outcome") == rejects["actualOutcome"]]
        prod_keys = {hashlib.sha256(text(dig(e.get("input"), "classifiedKey") or dig(e.get("input"), "s3Key")).encode()).hexdigest()
                     for e in failed}
        dev_keys = {r.get(rejects["key"], "") for r in rows}
        reasons = Counter(r.get("reason", "") for r in rows)
        ok = prod_keys <= dev_keys
        checks.append({"id": f"prod-actuals-{rejects['dataset']}", "dataset": rejects["dataset"], "kind": "rejects-cover-prod-failures",
                       "failureCode": "ProdRejectMismatch", "status": "PASS" if ok else "FAIL", "devRejects": len(rows),
                       "prodFailures": len(failed), "prodFailuresNotRejected": len(prod_keys - dev_keys), "rejectReasons": dict(reasons)})
    if not checks:
        raise SilvallyError(f"no dataset of slice {args.slice} was supplied")
    statuses = {c["status"] for c in checks}
    summary = {"slice": args.slice, "baselineKind": spec["baselineKind"], "checks": checks,
               "status": "FAIL" if "FAIL" in statuses else "PASS"}
    write_json(args.out, summary)
    print(json.dumps(summary, indent=1))
    return 0 if summary["status"] == "PASS" else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("lambda-outcomes")
    p.add_argument("--profile", required=True, help="operator's PROD read-only profile")
    p.add_argument("--region", required=True)
    p.add_argument("--log-group", required=True, help="the EXPRESS state machine's execution log group")
    p.add_argument("--function-name", required=True)
    p.add_argument("--start", required=True)
    p.add_argument("--end-exclusive", required=True)
    p.add_argument("--slice", required=True)
    p.add_argument("--private-dir", required=True)
    p.add_argument("--max-pages", type=int, default=500)
    p.add_argument("--out", required=True)
    p = sub.add_parser("table-summary")
    p.add_argument("--rows", required=True, help="iceberg_snapshot_read.py rows.json")
    p.add_argument("--slice", required=True)
    p.add_argument("--baseline-kind", default="iceberg-table")
    p.add_argument("--end-exclusive", help="window end; the snapshot must be at or after it")
    p.add_argument("--out", required=True)
    p = sub.add_parser("none")
    p.add_argument("--slice", required=True)
    p.add_argument("--reason", required=True)
    p.add_argument("--out", required=True)
    p = sub.add_parser("canary-sample")
    p.add_argument("--events", required=True)
    p.add_argument("--slice", required=True)
    p.add_argument("--time-field", required=True)
    p.add_argument("--key-field", required=True)
    p.add_argument("--outcome-field")
    p.add_argument("--per-slice", type=int, default=10)
    p.add_argument("--private-out", required=True)
    p.add_argument("--out", required=True)
    p = sub.add_parser("inputs")
    p.add_argument("--events", required=True)
    p.add_argument("--input-field", default="input")
    p.add_argument("--bind", action="append", help="FIELD=actual.PATH filled only when the input lacks FIELD")
    p.add_argument("--out-dir", required=True)
    p = sub.add_parser("compare")
    p.add_argument("--catalog", required=True, help="reference/prod-actuals.json or a profile's equivalent")
    p.add_argument("--slice", required=True)
    p.add_argument("--actual", help="private events or rows JSONL of the PROD actual")
    p.add_argument("--dataset", action="append", required=True, help="DATASET=PATH of a captured DEV output")
    p.add_argument("--delimiter", default="|")
    p.add_argument("--allow-column", action="append", help="COLUMN=REASON excluded from value comparison (recorded)")
    p.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    return {"lambda-outcomes": cmd_lambda_outcomes, "table-summary": cmd_table_summary, "none": cmd_none,
            "canary-sample": cmd_canary_sample, "inputs": cmd_inputs, "compare": cmd_compare}[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
