#!/usr/bin/env python3
"""What PROD actually did in a confirmed window, the DEV canary sample, and the comparison against it.

  prod_actuals.py lambda-outcomes --profile <prod-profile> --region R --log-group LG --function-name F
      --start ISO --end-exclusive ISO --slice NAME --private-dir DIR --out summary.json
      Read-only: filter an EXPRESS state machine's execution log group for LambdaFunctionScheduled and
      LambdaFunctionSucceeded/Failed/TimedOut events of one function, pair each result with its scheduled
      input, and write one private row per event (eventTime, outcome accepted|rejected, input, actual, error).
  prod_actuals.py probe-days --profile <prod-profile> --region R --log-group LG --function-name F --slice NAME
      [--lookback-days 7] [--max-pages-per-day 20] [--now ISO] --out day-counts.json
      Read-only day selection for a Lambda-outcomes slice: probe complete UTC days newest-first with a bounded
      page budget per day and stop at the first day with data, instead of scanning the whole lookback. The
      output feeds source_window.py data-days (counts are lower bounds; the chosen day is then read in full).
  prod_actuals.py table-summary --rows rows.json --slice NAME [--catalog C] [--baseline-kind iceberg-table]
      [--end-exclusive ISO] [--data-through ISO] --out summary.json
      Summarize iceberg_snapshot_read.py rows (window or key read) as a slice baseline. Freshness is the DATA's:
      the table's maximum data timestamp (iceberg_snapshot_read.py --data-max-column, or --data-through) must
      reach the window end; a re-committed snapshot is not enough. A stale actual names the most recent UTC day
      its data covers and a data-platform handoff for the mirror.
  prod_actuals.py none --slice NAME --reason TEXT --out summary.json
      Record that no PROD actual exists for a slice; comparison falls back to schema, row-count and
      reject-reason checks, and the report must say so.
  prod_actuals.py canary-sample --events events.jsonl --slice NAME (--catalog C | --time-field F --key-field K
      [--key-field K2 ...] [--outcome-field O] [--outcome-mode value|presence]) [--per-slice 10]
      --private-out selected.jsonl --out summary.json
      Deterministic canary: keep the catalog's canary population, group events by outcome, order each group by
      (event time, SHA-256 of the key), then take round-robin across the sorted outcome names until --per-slice
      events are chosen, so every outcome present in the window (for example accepted and rejected, or active
      and deleted) is represented. Repeated key fields are fallbacks: the first non-empty value is the key.
      outcome-mode presence groups by whether the field is empty (catalog outcomeLabels name the two groups).
  prod_actuals.py keys --events selected.jsonl --field F --out keys.txt
      Write the distinct values of F (for example the canary debts) for key reads and graph-input roots.
  prod_actuals.py inputs --events selected.jsonl --input-field input --out-dir DIR
      Write the selected events' real PROD inputs, exactly as PROD sent them, as part-00000.jsonl for
      approval-gated DEV staging. Nothing from the PROD result enters an input: a value the mapping resolves
      (for example M2D's debt) comes from the slice's real upstream inputs (graph_inputs.py), so comparing it
      with the PROD result is a genuine check.
  prod_actuals.py compare --catalog prod-actuals.json --slice NAME --actual events.jsonl
      --dataset NAME=PATH [...] [--delimiter '|'] [--allow-column COLUMN=REASON ...] [--dev-scope all|actual-keys]
      --out checks.json
      Keyed comparison of DEV outputs with the PROD actual: rows only in DEV, rows only in PROD, per-column
      mismatches over the catalog fieldMap, row counts, and rejects against PROD failures. A row whose catalog
      key has an empty part is keyed by the catalog's fallback key; keyCoverage reports how many rows carry
      the primary key. --dev-scope actual-keys (canary only) compares the DEV rows of the sampled events. Output
      uses the compare_datasets.py checks shape. Values never leave the private files; only counts are printed.

PROD calls go through silvally_io.aws with environment="prod", which refuses every write verb. Private
files hold real rows: keep them in a mode-0700 directory outside any repository and delete them afterwards.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from compare_datasets import read_rows
from silvally_io import SilvallyError, aws, private_dir, read_json, sha256_file, write_json
from source_window import iso, parse_utc

RESULT_TYPES = {"LambdaFunctionSucceeded": "accepted", "LambdaFunctionFailed": "rejected", "LambdaFunctionTimedOut": "rejected"}
LAMBDA_TYPES = ("LambdaFunctionScheduled", "LambdaFunctionStarted", *RESULT_TYPES)
LOOSE_TIMESTAMP = re.compile(r"^(\d{4}-\d{2}-\d{2})(?:[ T_](\d{2})[:\-](\d{2})(?:[:\-](\d{2})(\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$")
DEFAULT_REJECT_KEY_FIELDS = ["input.classifiedKey", "input.s3Key"]


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


def parse_loose(value) -> datetime | None:
    """A UTC instant from ISO text, 'YYYY-MM-DD_HH-MM-SS' stage stamps, a date, or epoch seconds/milliseconds."""
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return datetime.fromtimestamp(value / 1000 if value > 1e11 else value, timezone.utc)
    match = LOOSE_TIMESTAMP.match(str(value).strip())
    if not match:
        return None
    day, hour, minute, second, fraction, zone = match.groups()
    stamp = f"{day}T{hour or '00'}:{minute or '00'}:{second or '00'}{(fraction or '')[:7].ljust(7, '0') if fraction else ''}"
    moment = datetime.fromisoformat(stamp)
    if zone and zone != "Z":
        moment = moment.replace(tzinfo=datetime.strptime(zone.replace(":", ""), "%z").tzinfo)
    return moment.replace(tzinfo=moment.tzinfo or timezone.utc).astimezone(timezone.utc)


def last_covered_day(data_through: datetime) -> str:
    """The most recent complete UTC day whose end is at or before the data cutoff."""
    midnight = data_through.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return (midnight - timedelta(days=1)).strftime("%Y-%m-%d")


def utc_millis(value) -> str:
    moment = parse_loose(value)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z" if moment else text(value)


NORMALIZERS = {"utc-timestamp": utc_millis, "digits": lambda v: re.sub(r"\D", "", text(v))}


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


def filter_page(log_group: str, pattern: str, start: datetime, end: datetime, token: str | None, limit: int | None,
                profile: str, region: str) -> dict:
    """One real page of filter-log-events (--no-paginate: the CLI must not silently read every page)."""
    call = ["logs", "filter-log-events", "--log-group-name", log_group, "--filter-pattern", pattern,
            "--start-time", str(int(start.timestamp() * 1000)), "--end-time", str(int(end.timestamp() * 1000) - 1), "--no-paginate"]
    if limit:
        call += ["--limit", str(limit)]
    if token:
        call += ["--next-token", token]
    return aws(call, profile=profile, region=region, environment="prod")


def cmd_lambda_outcomes(args) -> int:
    start, end = parse_utc(args.start), parse_utc(args.end_exclusive)
    pattern = " ".join(f'?"{t}"' for t in LAMBDA_TYPES)
    messages, token, pages = [], None, 0
    while True:
        page = filter_page(args.log_group, pattern, start, end, token, None, args.profile, args.region)
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
    if token:
        summary["status"] = "TRUNCATED"
    write_json(args.out, summary)
    print(json.dumps(summary, indent=1))
    return 0 if summary["status"] == "AVAILABLE" else 1


def cmd_probe_days(args) -> int:
    """Newest-first bounded probe: the first complete UTC day on which the function was scheduled."""
    now = parse_utc(args.now) if args.now else datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    pattern = f'"LambdaFunctionScheduled" "{args.function_name}"'
    counts, probed, chosen = {}, [], None
    for offset in range(1, args.lookback_days + 1):
        start = today - timedelta(days=offset)
        day = start.strftime("%Y-%m-%d")
        seen, token, pages = 0, None, 0
        while pages < args.max_pages_per_day:
            page = filter_page(args.log_group, pattern, start, start + timedelta(days=1), token, args.page_limit, args.profile, args.region)
            seen += len(page.get("events", []))
            token, pages = page.get("nextToken"), pages + 1
            if seen or not token:
                break
        counts[day] = seen
        probed.append({"day": day, "pagesRead": pages, "eventsSeen": seen, "exhausted": not token})
        if seen:
            chosen = day
            break
    write_json(args.out, {args.slice: counts})
    summary = {"slice": args.slice, "mostRecentDayWithData": chosen, "probed": probed, "countsAreLowerBounds": True,
               "status": "HAS_DATA" if chosen else "EMPTY"}
    print(json.dumps(summary, indent=1))
    return 0 if chosen else 1


def cmd_table_summary(args) -> int:
    doc = read_json(args.rows)
    rows = doc.get("rows", doc) if isinstance(doc, dict) else doc
    snapshot = doc.get("snapshotTimestampMs") if isinstance(doc, dict) else None
    window_end = parse_utc(args.end_exclusive) if args.end_exclusive else None
    source = read_json(args.catalog)["slices"][args.slice].get("source", {}) if args.catalog else {}
    column = source.get("dataTimestampColumn")
    data_through = parse_loose(args.data_through or (doc.get("dataMax") if isinstance(doc, dict) else None))
    snapshot_fresh = window_end is None or (snapshot is not None and snapshot >= window_end.timestamp() * 1000)
    reasons = []
    if window_end is not None and data_through is not None:
        data_fresh = data_through >= window_end
        if not data_fresh:
            reasons.append(f"the data reaches only {iso(data_through)}, before the window end {iso(window_end)}")
    elif window_end is not None and column:
        data_fresh = False
        reasons.append(f"data freshness unproven: read the table's maximum {column} (iceberg_snapshot_read.py --data-max-column)")
    else:
        data_fresh = snapshot_fresh
    if not snapshot_fresh:
        reasons.append("the snapshot was committed before the window end")
    fresh = snapshot_fresh and data_fresh
    status = "STALE" if not fresh else ("AVAILABLE" if rows else "EMPTY")
    summary = {"slice": args.slice, "baselineKind": args.baseline_kind, "status": status, "rows": len(rows),
               "snapshotTimestampMs": snapshot, "freshForWindow": fresh, "dataTimestampColumn": column,
               "dataThrough": iso(data_through) if data_through else None, "prodAccess": "read-only"}
    if reasons:
        summary["staleReasons"] = reasons
    if data_through is not None:
        summary["mostRecentCoveredDay"] = last_covered_day(data_through)
    if status == "STALE" and data_through is not None:
        summary["handoff"] = {"code": "ProdMirrorStale", "owner": "data platform (the mirror's ETL)",
                              "detail": f"{source.get('table') or 'the PROD mirror'} data stops at {iso(data_through)}; "
                                        f"use {summary['mostRecentCoveredDay']} or refresh the mirror"}
    write_json(args.out, summary)
    print(json.dumps(summary, indent=1))
    return 0 if status == "AVAILABLE" else 1


def cmd_none(args) -> int:
    summary = {"slice": args.slice, "baselineKind": "none", "status": "NONE", "reason": args.reason,
               "fallback": ["schema", "row-count", "reject-reason"], "prodAccess": "read-only"}
    write_json(args.out, summary)
    print(json.dumps(summary, indent=1))
    return 0


def key_of(event: dict, fields) -> str:
    for field in [fields] if isinstance(fields, str) else fields:
        value = text(dig(event, field))
        if value:
            return value
    return ""


def outcome_of(event: dict, field: str | None, mode: str = "value", labels: dict | None = None) -> str:
    if not field:
        return ""
    value = text(dig(event, field))
    if mode == "presence":
        return (labels or {}).get("present" if value else "absent", "present" if value else "absent")
    return value


def canary_select(events: list[dict], time_field: str, key_fields, outcome_field: str | None, per_slice: int,
                  outcome_mode: str = "value", labels: dict | None = None) -> list[dict]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for event in events:
        groups[outcome_of(event, outcome_field, outcome_mode, labels)].append(event)
    for rows in groups.values():
        rows.sort(key=lambda e: (text(dig(e, time_field)), hashlib.sha256(key_of(e, key_fields).encode()).hexdigest()))
    chosen, depth = [], 0
    while len(chosen) < per_slice and any(depth < len(g) for g in groups.values()):
        for name in sorted(groups):
            if depth < len(groups[name]) and len(chosen) < per_slice:
                chosen.append(groups[name][depth])
        depth += 1
    return chosen


def canary_fields(args) -> dict:
    if args.catalog:
        canary = read_json(args.catalog)["slices"][args.slice]["canary"]
        keys = canary["eventKeyField"]
        return {"time": canary["eventTimeField"], "keys": [keys] if isinstance(keys, str) else list(keys),
                "outcome": canary.get("outcomeField"), "mode": canary.get("outcomeMode", "value"),
                "labels": canary.get("outcomeLabels") or {}, "population": canary.get("population") or {}}
    if not (args.time_field and args.key_field):
        raise SilvallyError("pass --catalog, or --time-field and --key-field")
    return {"time": args.time_field, "keys": args.key_field, "outcome": args.outcome_field, "mode": args.outcome_mode,
            "labels": {}, "population": {}}


def cmd_canary_sample(args) -> int:
    fields = canary_fields(args)
    events = read_jsonl(args.events)
    population = [e for e in events if row_matches(e, fields["population"], dig)]
    keyed = [e for e in population if key_of(e, fields["keys"])]
    chosen = canary_select(keyed, fields["time"], fields["keys"], fields["outcome"], args.per_slice, fields["mode"], fields["labels"])
    target = Path(args.private_out)
    private_dir(target.parent)
    write_jsonl(target, chosen)
    keys = [key_of(e, fields["keys"]) for e in chosen]
    summary = {"slice": args.slice, "eventsInWindow": len(events), "eventsInPopulation": len(population),
               "eventsWithoutKey": len(population) - len(keyed), "eventsSelected": len(chosen), "perSlice": args.per_slice,
               "population": fields["population"], "keyFields": fields["keys"],
               "selection": f"round-robin over sorted {fields['outcome'] or 'single'} groups ({fields['mode']}), each ordered by "
                            f"({fields['time']}, sha256(first non-empty of {fields['keys']}))",
               "byOutcome": dict(Counter(outcome_of(e, fields["outcome"], fields["mode"], fields["labels"]) for e in chosen))
               if fields["outcome"] else {},
               "selectionDigest": "sha256:" + hashlib.sha256("\n".join(keys).encode()).hexdigest(),
               "status": "SELECTED" if chosen else "EMPTY"}
    write_json(args.out, summary)
    print(json.dumps(summary, indent=1))
    return 0 if chosen else 1


def cmd_keys(args) -> int:
    values = sorted({text(dig(e, args.field)) for e in read_jsonl(args.events)} - {""})
    target = Path(args.out)
    private_dir(target.parent)
    target.write_text("".join(v + "\n" for v in values), encoding="utf-8")
    print(json.dumps({"field": args.field, "keys": len(values), "sha256": "sha256:" + sha256_file(target)}))
    return 0 if values else 1


def cmd_inputs(args) -> int:
    rows = []
    for event in read_jsonl(args.events):
        row = dig(event, args.input_field)
        if not isinstance(row, dict):
            raise SilvallyError(f"an event has no object at {args.input_field}")
        rows.append(row)
    out = private_dir(args.out_dir)
    write_jsonl(out / "part-00000.jsonl", rows)
    summary = {"rows": len(rows), "inputsAsProdSent": True, "sha256": "sha256:" + sha256_file(out / "part-00000.jsonl")}
    print(json.dumps(summary, indent=1))
    return 0


def row_matches(row: dict, condition: dict, getter) -> bool:
    return all(text(getter(row, k)) == text(v) for k, v in condition.items())


def keyer(key: dict, side: str, getter, normalize: dict):
    """Row -> ('primary'|'fallback', values...) or None when neither the key nor its fallback is fully populated."""
    def value(row, column):
        raw = getter(row, column)
        return NORMALIZERS[normalize[column]](raw) if column in normalize else text(raw)

    primary, fallback = key[side], (key.get("fallback") or {}).get(side)

    def of(row):
        values = tuple(value(row, c) for c in primary)
        if all(values):
            return ("primary", *values)
        if fallback:
            values = tuple(value(row, c) for c in fallback)
            if all(values):
                return ("fallback", *values)
        return None
    return of, value


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
    normalize = spec.get("normalize") or {}
    checks = []
    main = next((d for d in spec["outputDatasets"] if d in datasets and d != (spec.get("rejects") or {}).get("dataset")), None)
    if main:
        _, rows = read_rows(datasets[main], args.delimiter)
        condition = (spec.get("rowFilter") or {}).get("dataset") or {}
        rows = [r for r in rows if row_matches(r, condition, lambda r, k: r.get(k))]
        dev_key, dev_value = keyer(spec["key"], "dataset", lambda r, k: r.get(k), normalize)
        prod_key, prod_value = keyer(spec["key"], "actual", source, normalize)
        prod, prod_unkeyed = {}, 0
        for e in accepted:
            key = prod_key(e)
            if key is None:
                prod_unkeyed += 1
            else:
                prod.setdefault(key, e)
        out_of_scope = 0
        if args.dev_scope == "actual-keys":
            kept = [r for r in rows if dev_key(r) in prod]
            out_of_scope, rows = len(rows) - len(kept), kept
        dev, dev_unkeyed = {}, 0
        for r in rows:
            key = dev_key(r)
            if key is None:
                dev_unkeyed += 1
            else:
                dev.setdefault(key, r)
        mismatches = Counter()
        for key in dev.keys() & prod.keys():
            for column, path in spec["fieldMap"].items():
                expected = NORMALIZERS[normalize[column]](source(prod[key], path)) if column in normalize else text(source(prod[key], path))
                if column not in allowed and dev_value(dev[key], column) != expected:
                    mismatches[column] += 1
        only_dev, only_prod = len(dev.keys() - prod.keys()), len(prod.keys() - dev.keys())
        coverage = {"devPrimary": sum(k[0] == "primary" for k in dev), "devFallback": sum(k[0] == "fallback" for k in dev),
                    "devUnkeyed": dev_unkeyed, "prodPrimary": sum(k[0] == "primary" for k in prod),
                    "prodFallback": sum(k[0] == "fallback" for k in prod), "prodUnkeyed": prod_unkeyed}
        ok = (not mismatches and not only_dev and not only_prod and len(rows) == len(accepted)
              and not dev_unkeyed and not prod_unkeyed)
        checks.append({"id": f"prod-actuals-{main}", "dataset": main, "kind": "matches-prod-actuals", "failureCode": "ProdActualsMismatch",
                       "status": "PASS" if ok else "FAIL", "devRows": len(rows), "prodRows": len(accepted),
                       "matchedKeys": len(dev.keys() & prod.keys()), "onlyDev": only_dev, "onlyProd": only_prod,
                       "keyCoverage": coverage, "devScope": args.dev_scope, "devRowsOutOfScope": out_of_scope,
                       "normalizedColumns": normalize, "mismatchedByColumn": dict(mismatches), "allowedColumns": allowed})
    rejects = spec.get("rejects")
    if lambda_kind and rejects and rejects["dataset"] in datasets:
        _, rows = read_rows(datasets[rejects["dataset"]], args.delimiter)
        failed = [e for e in actual if e.get("outcome") == rejects["actualOutcome"]]
        fields = rejects.get("actualKeyFields") or DEFAULT_REJECT_KEY_FIELDS
        prod_keys = {hashlib.sha256(key_of(e, fields).encode()).hexdigest() for e in failed}
        dev_keys = {r.get(rejects["key"], "") for r in rows}
        reasons = Counter(r.get("reason", "") for r in rows)
        ok = prod_keys <= dev_keys
        checks.append({"id": f"prod-actuals-{rejects['dataset']}", "dataset": rejects["dataset"], "kind": "rejects-cover-prod-failures",
                       "failureCode": "ProdRejectMismatch", "status": "PASS" if ok else "FAIL", "devRejects": len(rows),
                       "prodFailures": len(failed), "prodFailuresNotRejected": len(prod_keys - dev_keys), "rejectReasons": dict(reasons)})
    if not checks:
        raise SilvallyError(f"no dataset of slice {args.slice} was supplied")
    statuses = {c["status"] for c in checks}
    summary = {"slice": args.slice, "baselineKind": spec["baselineKind"], "devScope": args.dev_scope, "checks": checks,
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
    p = sub.add_parser("probe-days")
    p.add_argument("--profile", required=True, help="operator's PROD read-only profile")
    p.add_argument("--region", required=True)
    p.add_argument("--log-group", required=True)
    p.add_argument("--function-name", required=True)
    p.add_argument("--slice", required=True)
    p.add_argument("--lookback-days", type=int, default=7)
    p.add_argument("--max-pages-per-day", type=int, default=20)
    p.add_argument("--page-limit", type=int, default=50, help="events per page")
    p.add_argument("--now", help="evaluation time (ISO, UTC); default is the current time")
    p.add_argument("--out", required=True, help='{"<slice>": {"YYYY-MM-DD": events}} for source_window.py data-days')
    p = sub.add_parser("table-summary")
    p.add_argument("--rows", required=True, help="iceberg_snapshot_read.py rows.json")
    p.add_argument("--slice", required=True)
    p.add_argument("--catalog", help="prod-actuals catalog; its source.dataTimestampColumn makes data freshness mandatory")
    p.add_argument("--baseline-kind", default="iceberg-table")
    p.add_argument("--end-exclusive", help="window end; the snapshot and the data must reach it")
    p.add_argument("--data-through", help="the table's maximum data timestamp when rows.json lacks dataMax")
    p.add_argument("--out", required=True)
    p = sub.add_parser("none")
    p.add_argument("--slice", required=True)
    p.add_argument("--reason", required=True)
    p.add_argument("--out", required=True)
    p = sub.add_parser("canary-sample")
    p.add_argument("--events", required=True)
    p.add_argument("--slice", required=True)
    p.add_argument("--catalog", help="prod-actuals catalog: the slice's canary fields, outcome mode and population")
    p.add_argument("--time-field")
    p.add_argument("--key-field", action="append", help="key field; repeat for fallbacks (first non-empty wins)")
    p.add_argument("--outcome-field")
    p.add_argument("--outcome-mode", choices=("value", "presence"), default="value")
    p.add_argument("--per-slice", type=int, default=10)
    p.add_argument("--private-out", required=True)
    p.add_argument("--out", required=True)
    p = sub.add_parser("keys")
    p.add_argument("--events", required=True)
    p.add_argument("--field", required=True)
    p.add_argument("--out", required=True)
    p = sub.add_parser("inputs")
    p.add_argument("--events", required=True)
    p.add_argument("--input-field", default="input")
    p.add_argument("--out-dir", required=True)
    p = sub.add_parser("compare")
    p.add_argument("--catalog", required=True, help="reference/prod-actuals.json or a profile's equivalent")
    p.add_argument("--slice", required=True)
    p.add_argument("--actual", help="private events or rows JSONL of the PROD actual")
    p.add_argument("--dataset", action="append", required=True, help="DATASET=PATH of a captured DEV output")
    p.add_argument("--delimiter", default="|")
    p.add_argument("--allow-column", action="append", help="COLUMN=REASON excluded from value comparison (recorded)")
    p.add_argument("--dev-scope", choices=("all", "actual-keys"), default="all",
                   help="actual-keys: the canary compares only the DEV rows of the sampled events (never for the full window)")
    p.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    return {"lambda-outcomes": cmd_lambda_outcomes, "probe-days": cmd_probe_days, "table-summary": cmd_table_summary,
            "none": cmd_none, "canary-sample": cmd_canary_sample, "keys": cmd_keys, "inputs": cmd_inputs,
            "compare": cmd_compare}[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
