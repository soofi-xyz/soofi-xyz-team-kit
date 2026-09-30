#!/usr/bin/env python3
"""Aggregate-only comparisons of CSV, JSONL or Parquet datasets (regression, parity, format, contracts).

  diff     Compare two datasets. Reports identical (sorted-row byte equality), row counts,
           content sha256, and — with --key — rows only-left/only-right and per-column change
           counts. --normalize applies declared normalizations before comparing.
  parts    Byte identity of two datasets: equal multisets of part-file SHA-256 digests.
  format   Check CSV part files: first line equals the declared header, delimiter, and that
           every data row has the declared column count.
  closure  Graph closure for Parquet/CSV graph exports: unique ~id per dataset and zero
           dangling ~from/~to against declared endpoint datasets.
  check    Evaluate output contracts plus a profile's declarative invariants, oracles and
           allowed losses against captured outputs. Contracts come from
           `resolve-transform-intent.py contracts`; a profile direction's outputContracts
           override the derived fields it declares in derivationOverrides and add
           columnConstraints/key. No check is specific to any mapping.
           check and closure require --slice and record it: evaluate_run.py never applies
           evidence of one slice (or of no slice) to another.

A dataset is a file, a directory of part-* files, or a glob. CSV uses --delimiter (default ',',
the Transform default; pass the registered delimiter). Parquet needs pyarrow. Output is JSON
with counts and digests only; no values are printed.
"""

from __future__ import annotations

import argparse
import csv
import glob
import hashlib
import io
import json
import re
from pathlib import Path


def files_of(spec: str) -> list[str]:
    path = Path(spec)
    if path.is_dir():
        found = sorted(glob.glob(str(path / "**" / "part-*"), recursive=True)) or sorted(
            p for p in glob.glob(str(path / "**" / "*"), recursive=True) if p.endswith((".csv", ".parquet", ".jsonl", ".json")))
    else:
        found = sorted(glob.glob(spec))
    found = [f for f in found if not f.endswith((".crc", "_SUCCESS")) and Path(f).name != "_metadata.json"]
    if not found:
        raise SystemExit(f"no data files for {spec}")
    return found


def detect_kind(files: list[str], declared: str | None) -> str:
    if declared:
        return declared
    first = files[0]
    if first.endswith(".parquet"):
        return "parquet"
    if first.endswith((".jsonl", ".json")):
        return "jsonl"
    return "csv"


def scalar(value) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, sort_keys=True)
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def read_rows(spec: str, delimiter: str, kind: str | None = None, header: bool = True) -> tuple[list[str], list[dict]]:
    files = files_of(spec)
    kind = detect_kind(files, kind)
    if kind == "parquet":
        import pyarrow.parquet as pq

        tables = [pq.read_table(f) for f in files]
        columns = tables[0].column_names
        rows = [{c: scalar(v) for c, v in r.items()} for t in tables for r in t.to_pylist()]
        return columns, rows
    if kind == "jsonl":
        columns: list[str] = []
        rows = []
        for f in files:
            for text in Path(f).read_text(encoding="utf-8").splitlines():
                if text.strip():
                    doc = json.loads(text)
                    columns += [k for k in doc if k not in columns]
                    rows.append({k: scalar(v) for k, v in doc.items()})
        return columns, rows
    columns, rows = None, []
    for f in files:
        reader = csv.reader(io.StringIO(Path(f).read_text(encoding="utf-8")), delimiter=delimiter)
        first = next(reader, None) if header else None
        if header and first is None:
            continue
        columns = columns or first
        for r in reader:
            if r:
                rows.append(dict(zip(columns, r)) if columns else {str(i): v for i, v in enumerate(r)})
    return columns or [], rows


NORMALIZERS = {
    "lower-booleans": lambda v: v.lower() if v.lower() in ("true", "false") else v,
    "strip": str.strip,
    "iso-millis": lambda v: (v[:23] + "Z") if len(v) >= 23 and v[10:11] == "T" else v,
}


def line(row: dict, columns: list[str]) -> str:
    return "\x1f".join(row.get(c, "") for c in columns)


def keyed_diff(left: list[dict], right: list[dict], columns: list[str], key: list[str]) -> dict:
    lk = {tuple(r.get(k, "") for k in key): r for r in left}
    rk = {tuple(r.get(k, "") for k in key): r for r in right}
    changed = {c: 0 for c in columns if c not in key}
    emptied = {c: 0 for c in changed}
    for k in lk.keys() & rk.keys():
        for c in changed:
            if lk[k].get(c, "") != rk[k].get(c, ""):
                changed[c] += 1
                emptied[c] += lk[k].get(c, "") == "" and rk[k].get(c, "") != ""
    return {"key": key, "duplicateLeftKeys": len(left) - len(lk), "duplicateRightKeys": len(right) - len(rk),
            "onlyLeft": len(lk.keys() - rk.keys()), "onlyRight": len(rk.keys() - lk.keys()),
            "changedByColumn": {c: n for c, n in changed.items() if n},
            "emptiedByColumn": {c: n for c, n in emptied.items() if n}}


def cmd_diff(args) -> int:
    lc, left = read_rows(args.left, args.delimiter, args.format)
    rc, right = read_rows(args.right, args.delimiter, args.format)
    columns = args.column or [c for c in lc if c in rc]
    for name in args.normalize or []:
        fn = NORMALIZERS[name]
        for row in left + right:
            for c in columns:
                row[c] = fn(row.get(c, ""))
    ll, rl = sorted(line(r, columns) for r in left), sorted(line(r, columns) for r in right)
    out = {"columnsCompared": columns, "headersEqual": lc == rc, "leftRows": len(left), "rightRows": len(right),
           "leftSha256": hashlib.sha256("\n".join(ll).encode()).hexdigest(),
           "rightSha256": hashlib.sha256("\n".join(rl).encode()).hexdigest(), "identical": ll == rl}
    if args.key:
        out.update(keyed_diff(left, right, columns, args.key))
    print(json.dumps(out, indent=1))
    return 0 if (out["identical"] or not args.expect_identical) else 1


def part_digests(spec: str) -> list[str]:
    return sorted(hashlib.sha256(Path(f).read_bytes()).hexdigest() for f in files_of(spec))


def cmd_parts(args) -> int:
    left, right = part_digests(args.left), part_digests(args.right)
    out = {"parts": [len(left), len(right)], "partShaMultisetEqual": left == right,
           "bytes": [sum(Path(f).stat().st_size for f in files_of(s)) for s in (args.left, args.right)]}
    print(json.dumps(out, indent=1))
    return 0 if out["partShaMultisetEqual"] else 1


def format_problems(spec: str, header: list[str], delimiter: str) -> tuple[int, list[dict]]:
    problems, rows = [], 0
    expected = delimiter.join(header)
    for f in files_of(spec):
        lines = Path(f).read_text(encoding="utf-8").split("\n")
        if lines[0] != expected:
            problems.append({"file": Path(f).name, "issue": "header"})
        for n, text in enumerate(lines[1:], 2):
            if not text:
                continue
            rows += 1
            if len(text.split(delimiter)) != len(header):
                problems.append({"file": Path(f).name, "line": n, "issue": "column-count"})
                break
    return rows, problems


def cmd_format(args) -> int:
    rows, problems = format_problems(args.dataset, args.header, args.delimiter)
    out = {"expectedHeader": args.delimiter.join(args.header), "rows": rows, "problems": problems, "pass": not problems}
    print(json.dumps(out, indent=1))
    return 0 if out["pass"] else 1


def cmd_closure(args) -> int:
    vertices = {}
    report = {"vertices": {}, "edges": {}}
    for spec in args.vertex:
        name, _, path = spec.partition("=")
        _, rows = read_rows(path, args.delimiter)
        ids = [r["~id"] for r in rows]
        vertices[name] = set(ids)
        report["vertices"][name] = {"rows": len(ids), "unique": len(set(ids)) == len(ids)}
    dangling_total = 0
    for spec in args.edge:
        name, _, rest = spec.partition("=")
        path, from_ds, to_ds = rest.rsplit(":", 2)
        _, rows = read_rows(path, args.delimiter)
        ids = [r["~id"] for r in rows]
        dangling = sum(r["~from"] not in vertices[from_ds] for r in rows) + sum(r["~to"] not in vertices[to_ds] for r in rows)
        dangling_total += dangling
        report["edges"][name] = {"rows": len(rows), "unique": len(set(ids)) == len(ids), "endpoints": 2 * len(rows), "dangling": dangling}
    report["danglingEndpointCount"] = dangling_total
    report["identityUnique"] = all(v["unique"] for v in list(report["vertices"].values()) + list(report["edges"].values()))
    report["endpointCount"] = sum(e["endpoints"] for e in report["edges"].values())
    report["slice"] = args.slice
    text = json.dumps(report, indent=1)
    if args.out:
        Path(args.out).write_text(text + "\n")
    print(text)
    return 0 if dangling_total == 0 and report["identityUnique"] else 1


# ---------------------------------------------------------------------------
# check: contracts + declarative profile semantics
# ---------------------------------------------------------------------------

OVERRIDABLE = ("requiredInputs", "format", "columnSource", "columns", "key")


def merged_contracts(derived: dict, profile: dict | None) -> dict[str, dict]:
    """Derived contracts, with the profile's declared overrides and additive constraints applied."""
    contracts = {c["dataset"]: dict(c) for c in derived.get("outputs", [])}
    for direction in (profile or {}).get("directions", []):
        mapping = direction.get("mapping", {})
        if f"{mapping.get('id')}@{mapping.get('version')}" != derived.get("mapping"):
            continue
        overrides = {(o["dataset"], o["field"]) for o in direction.get("derivationOverrides", [])}
        for declared in direction.get("outputContracts", []):
            target = contracts.setdefault(declared["dataset"], {"dataset": declared["dataset"]})
            for field in OVERRIDABLE:
                if (declared["dataset"], field) in overrides and field in declared:
                    target[field] = declared[field]
            if "key" in declared and "key" not in target:
                target["key"] = declared["key"]
            target["columnConstraints"] = declared.get("columnConstraints", [])
    return contracts


def constraint_violations(rows: list[dict], constraint: dict) -> int:
    column = constraint["column"]
    values = [r.get(column, "") for r in rows]
    if "const" in constraint:
        return sum(v != constraint["const"] for v in values)
    if "enum" in constraint:
        return sum(v not in constraint["enum"] for v in values)
    if "pattern" in constraint:
        pattern = re.compile(constraint["pattern"])
        return sum(not pattern.fullmatch(v) for v in values)
    if constraint.get("nonEmpty"):
        return sum(v == "" for v in values)
    return 0


def evaluate_check(check: dict, rows: list[dict], columns: list[str], contract: dict, oracles: dict,
                   oracle_paths: dict[str, str], losses: dict, delimiter: str) -> dict:
    kind = check["kind"]
    if kind == "column-constraint":
        bad = constraint_violations(rows, check)
        return {"status": "PASS" if bad == 0 else "FAIL", "violations": bad}
    if kind == "unique-key":
        key = check.get("key") or contract.get("key")
        if not key:
            return {"status": "NOT_APPLICABLE", "detail": "dataset declares no key (no required fields)"}
        keys = [tuple(r.get(k, "") for k in key) for r in rows]
        dup = len(keys) - len(set(keys))
        return {"status": "PASS" if dup == 0 else "FAIL", "duplicateKeys": dup}
    if kind == "row-count":
        n = len(rows)
        ok = all((("min" not in check) or n >= check["min"], ("max" not in check) or n <= check["max"],
                  ("equals" not in check) or n == check["equals"]))
        return {"status": "PASS" if ok else "FAIL", "rows": n}
    if kind == "columns-exact":
        expected = check.get("columns") or contract.get("columns") or []
        return {"status": "PASS" if columns == expected else "FAIL", "columns": len(columns), "expected": len(expected)}
    if kind == "matches-oracle":
        oracle = oracles.get(check["oracle"])
        path = oracle_paths.get(check["oracle"])
        if oracle is None or path is None:
            return {"status": "BLOCKED", "detail": f"oracle {check['oracle']} not supplied"}
        if oracle["comparison"] == "part-bytes":
            return {"status": "PASS" if part_digests(path) == part_digests(check["_dataset_path"]) else "FAIL",
                    "parts": [len(part_digests(check["_dataset_path"])), len(part_digests(path))]}
        fmt = contract.get("format", {})
        _, expected_rows = read_rows(path, fmt.get("delimiter", delimiter), fmt.get("type"), fmt.get("header", True))
        compared = [c for c in columns if c not in oracle.get("ignoreColumns", [])]
        if oracle["comparison"] == "sorted-rows":
            equal = sorted(line(r, compared) for r in rows) == sorted(line(r, compared) for r in expected_rows)
            return {"status": "PASS" if equal else "FAIL", "rows": [len(rows), len(expected_rows)]}
        key = oracle.get("key") or contract.get("key")
        if not key:
            return {"status": "BLOCKED", "detail": "keyed oracle comparison needs a key (oracle.key or contract key)"}
        diff = keyed_diff(rows, expected_rows, compared, key)
        permitted = {}
        for loss_id in oracle.get("allowedLosses", []):
            loss = losses[loss_id]
            column = loss["column"]
            changed = diff["changedByColumn"].get(column, 0)
            if loss["kind"] == "emptied" and changed == diff["emptiedByColumn"].get(column, 0) and changed:
                permitted[column] = {"loss": loss_id, "rows": changed}
            elif loss["kind"] == "any" and changed:
                permitted[column] = {"loss": loss_id, "rows": changed}
        unexplained = {c: n for c, n in diff["changedByColumn"].items() if c not in permitted}
        ok = not unexplained and diff["onlyLeft"] == 0 and diff["onlyRight"] == 0
        return {"status": "PASS" if ok else "FAIL", **diff, "permittedLosses": permitted, "unexplainedChanges": unexplained}
    return {"status": "BLOCKED", "detail": f"unknown check kind {kind}"}


def cmd_check(args) -> int:
    derived = json.loads(Path(args.contracts).read_text())
    profile = json.loads(Path(args.profile).read_text()) if args.profile else None
    contracts = merged_contracts(derived, profile)
    datasets = dict(d.split("=", 1) for d in args.dataset)
    oracle_paths = dict(o.split("=", 1) for o in args.oracle or [])
    oracles = {o["id"]: o for o in (profile or {}).get("oracles", [])}
    losses = {loss["id"]: loss for loss in (profile or {}).get("allowedLosses", [])}
    results = []

    def record(check_id: str, dataset: str, kind: str, failure_code: str, outcome: dict) -> None:
        results.append({"id": check_id, "dataset": dataset, "kind": kind, "failureCode": failure_code, **outcome})

    loaded = {}
    for dataset, path in datasets.items():
        contract = contracts.get(dataset)
        if contract is None:
            record(f"contract-{dataset}", dataset, "contract", "DatasetNotRegistered", {"status": "FAIL"})
            continue
        fmt = contract.get("format", {})
        kind = fmt.get("type")
        columns, rows = read_rows(path, fmt.get("delimiter", args.delimiter), kind, fmt.get("header", True))
        loaded[dataset] = (columns, rows, path)
        expected_columns = contract.get("columns") or []
        if kind == "csv" and fmt.get("header") and expected_columns:
            n, problems = format_problems(path, expected_columns, fmt.get("delimiter", ","))
            record(f"format-{dataset}", dataset, "csv-header-and-delimiter", "OutputFormatDrift",
                   {"status": "PASS" if not problems else "FAIL", "rows": n, "problems": len(problems)})
        if expected_columns:
            ok = columns == expected_columns if kind != "jsonl" else set(columns) <= set(expected_columns)
            record(f"columns-{dataset}", dataset, "columns-match-contract", "ProfileParityDrift",
                   {"status": "PASS" if ok else "FAIL", "columns": len(columns), "expected": len(expected_columns)})
        elif contract.get("shape") == "tabular":
            record(f"columns-{dataset}", dataset, "columns-match-contract", "TargetSchemaUndefined",
                   {"status": "BLOCKED", "detail": "no language definition or declared consumer columns"})
        if contract.get("key"):
            keys = [tuple(r.get(k, "") for k in contract["key"]) for r in rows]
            record(f"key-{dataset}", dataset, "unique-key", "DuplicateKey",
                   {"status": "PASS" if len(keys) == len(set(keys)) else "FAIL", "duplicateKeys": len(keys) - len(set(keys))})
        for constraint in contract.get("columnConstraints", []):
            bad = constraint_violations(rows, constraint)
            record(f"constraint-{dataset}-{constraint['column']}", dataset, "column-constraint", "ColumnConstraintViolation",
                   {"status": "PASS" if bad == 0 else "FAIL", "violations": bad})
    for invariant in (profile or {}).get("invariants", []):
        check = invariant.get("check")
        if not check:
            continue
        dataset = check.get("dataset")
        if dataset not in loaded:
            record(invariant["id"], dataset, check["kind"], invariant["failureCode"], {"status": "NOT_APPLICABLE", "detail": "dataset not supplied"})
            continue
        columns, rows, path = loaded[dataset]
        outcome = evaluate_check({**check, "_dataset_path": path}, rows, columns, contracts[dataset], oracles, oracle_paths, losses, args.delimiter)
        record(invariant["id"], dataset, check["kind"], invariant["failureCode"], outcome)
    statuses = {r["status"] for r in results}
    summary = {"mapping": derived.get("mapping"), "slice": args.slice, "checks": results,
               "status": "FAIL" if "FAIL" in statuses else ("BLOCKED" if "BLOCKED" in statuses else "PASS")}
    text = json.dumps(summary, indent=1)
    if args.out:
        Path(args.out).write_text(text + "\n")
    print(text)
    return 0 if summary["status"] == "PASS" else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--delimiter", default=",")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("diff")
    p.add_argument("left")
    p.add_argument("right")
    p.add_argument("--key", action="append")
    p.add_argument("--column", action="append", help="restrict to these columns (default: shared columns)")
    p.add_argument("--normalize", action="append", choices=sorted(NORMALIZERS))
    p.add_argument("--format", choices=("csv", "jsonl", "parquet"), help="default: detected from file names")
    p.add_argument("--expect-identical", action="store_true")
    p = sub.add_parser("parts")
    p.add_argument("left")
    p.add_argument("right")
    p = sub.add_parser("format")
    p.add_argument("dataset")
    p.add_argument("--header", nargs="+", required=True)
    p = sub.add_parser("closure")
    p.add_argument("--vertex", action="append", default=[], help="name=PATH")
    p.add_argument("--edge", action="append", default=[], help="name=PATH:FROM_VERTEX_NAME:TO_VERTEX_NAME")
    p.add_argument("--slice", required=True, help="the package slice this evidence belongs to ('*' only for a single-slice request)")
    p.add_argument("--out")
    p = sub.add_parser("check")
    p.add_argument("--slice", required=True, help="the package slice this evidence belongs to ('*' only for a single-slice request)")
    p.add_argument("--contracts", required=True, help="resolve-transform-intent.py contracts output for the mapping")
    p.add_argument("--profile", help="profile JSON: overrides, columnConstraints, invariants with check, oracles, allowedLosses")
    p.add_argument("--dataset", action="append", required=True, help="DATASET=PATH of a captured output")
    p.add_argument("--oracle", action="append", help="ORACLE_ID=PATH of a locally materialized oracle dataset")
    p.add_argument("--out")
    args = parser.parse_args(argv)
    return {"diff": cmd_diff, "parts": cmd_parts, "format": cmd_format, "closure": cmd_closure, "check": cmd_check}[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
