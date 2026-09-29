#!/usr/bin/env python3
"""Aggregate-only comparisons of CSV or Parquet datasets (regression, parity, format).

  diff     Compare two datasets. Reports identical (sorted-row byte equality), row counts,
           content sha256, and — with --key — rows only-left/only-right and per-column change
           counts. --normalize applies declared normalizations before comparing.
  format   Check CSV part files: first line equals the declared header, delimiter, and that
           every data row has the declared column count.
  closure  Graph closure for Parquet/CSV graph exports: unique ~id per dataset and zero
           dangling ~from/~to against declared endpoint datasets.

A dataset is a file, a directory of part-* files, or a glob. CSV uses --delimiter (default |).
Parquet needs pyarrow. Output is JSON with counts and digests only; no values are printed.
"""

from __future__ import annotations

import argparse
import csv
import glob
import hashlib
import io
import json
from pathlib import Path


def files_of(spec: str) -> list[str]:
    path = Path(spec)
    if path.is_dir():
        found = sorted(glob.glob(str(path / "**" / "part-*"), recursive=True)) or sorted(
            p for p in glob.glob(str(path / "**" / "*"), recursive=True) if p.endswith((".csv", ".parquet")))
    else:
        found = sorted(glob.glob(spec))
    found = [f for f in found if not f.endswith((".crc", "_SUCCESS", ".json"))]
    if not found:
        raise SystemExit(f"no data files for {spec}")
    return found


def read_rows(spec: str, delimiter: str) -> tuple[list[str], list[dict]]:
    files = files_of(spec)
    if files[0].endswith(".parquet"):
        import pyarrow.parquet as pq

        tables = [pq.read_table(f) for f in files]
        columns = tables[0].column_names
        rows = [{c: ("" if v is None else str(v)) for c, v in r.items()} for t in tables for r in t.to_pylist()]
        return columns, rows
    columns, rows = None, []
    for f in files:
        reader = csv.reader(io.StringIO(Path(f).read_text(encoding="utf-8")), delimiter=delimiter)
        header = next(reader, None)
        if header is None:
            continue
        columns = columns or header
        rows += [dict(zip(header, r)) for r in reader if r]
    return columns or [], rows


NORMALIZERS = {
    "lower-booleans": lambda v: v.lower() if v.lower() in ("true", "false") else v,
    "strip": str.strip,
    "iso-millis": lambda v: (v[:23] + "Z") if len(v) >= 23 and v[10:11] == "T" else v,
}


def line(row: dict, columns: list[str]) -> str:
    return "\x1f".join(row.get(c, "") for c in columns)


def cmd_diff(args) -> int:
    lc, left = read_rows(args.left, args.delimiter)
    rc, right = read_rows(args.right, args.delimiter)
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
        lk = {tuple(r.get(k, "") for k in args.key): r for r in left}
        rk = {tuple(r.get(k, "") for k in args.key): r for r in right}
        changed = {c: 0 for c in columns if c not in args.key}
        for k in lk.keys() & rk.keys():
            for c in changed:
                changed[c] += lk[k].get(c, "") != rk[k].get(c, "")
        out.update({"key": args.key, "duplicateLeftKeys": len(left) - len(lk), "duplicateRightKeys": len(right) - len(rk),
                    "onlyLeft": len(lk.keys() - rk.keys()), "onlyRight": len(rk.keys() - lk.keys()),
                    "changedByColumn": {c: n for c, n in changed.items() if n}})
    print(json.dumps(out, indent=1))
    return 0 if (out["identical"] or not args.expect_identical) else 1


def cmd_format(args) -> int:
    problems, rows = [], 0
    expected = args.delimiter.join(args.header)
    for f in files_of(args.dataset):
        lines = Path(f).read_text(encoding="utf-8").split("\n")
        if lines[0] != expected:
            problems.append({"file": Path(f).name, "issue": "header"})
        for n, text in enumerate(lines[1:], 2):
            if not text:
                continue
            rows += 1
            if len(text.split(args.delimiter)) != len(args.header):
                problems.append({"file": Path(f).name, "line": n, "issue": "column-count"})
                break
    out = {"expectedHeader": expected, "rows": rows, "problems": problems, "pass": not problems}
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
    print(json.dumps(report, indent=1))
    return 0 if dangling_total == 0 and report["identityUnique"] else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--delimiter", default="|")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("diff")
    p.add_argument("left")
    p.add_argument("right")
    p.add_argument("--key", action="append")
    p.add_argument("--column", action="append", help="restrict to these columns (default: shared columns)")
    p.add_argument("--normalize", action="append", choices=sorted(NORMALIZERS))
    p.add_argument("--expect-identical", action="store_true")
    p = sub.add_parser("format")
    p.add_argument("dataset")
    p.add_argument("--header", nargs="+", required=True)
    p = sub.add_parser("closure")
    p.add_argument("--vertex", action="append", default=[], help="name=PATH")
    p.add_argument("--edge", action="append", default=[], help="name=PATH:FROM_VERTEX_NAME:TO_VERTEX_NAME")
    args = parser.parse_args(argv)
    return {"diff": cmd_diff, "format": cmd_format, "closure": cmd_closure}[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
