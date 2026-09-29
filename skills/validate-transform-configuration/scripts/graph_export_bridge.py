#!/usr/bin/env python3
"""Bridge Transform graph outputs to Parquet graph exports (requires pyarrow).

  neptune-csv  Convert Transform Neptune CSV output (vertices/ and edges/ part files with
               ~id,~label,~from,~to and name:Type headers) into one Parquet dataset per label:
               <out>/vertex-<label>/part-00000.parquet and <out>/edge-<label>/part-00000.parquet.
               Column names keep the Neptune header (name:Type); values are typed per Type.
               --created-at synthesizes the Persist-assigned created_at:DateTime that Transform
               outputs do not carry: base timestamp plus one millisecond per row in deterministic
               (~id) order. Record in evidence that created_at ordering is synthetic.
               --id-prefix-mode logical keeps ~id as emitted; physical appends "~1" like a first ingest.

  iso-dates    Rewrite a Parquet graph export whose DateTime/Date columns are epoch milliseconds
               into ISO-8601 strings (DateTime: yyyy-MM-ddTHH:mm:ss.SSSZ UTC, Date: yyyy-MM-dd),
               the input contract Transform graph inputs require.

Both print a JSON manifest (rows, columns, sha256 per written file). No rows are printed.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import glob
import io
import json
from pathlib import Path

from silvally_io import sha256_file

try:
    import pyarrow as pa
    import pyarrow.parquet as pq
except ImportError as error:  # pragma: no cover - dependency message
    raise SystemExit("graph_export_bridge.py requires pyarrow (see scripts/requirements-silvally.txt)") from error

SPECIAL = ("~id", "~label", "~from", "~to")
EPOCH = dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)


def graph_type(column: str) -> str | None:
    return column.split(":", 1)[1] if ":" in column and not column.startswith("~") else None


def typed(value: str, kind: str | None):
    if value == "" or value is None:
        return None
    if kind in ("Int", "Long", "Short", "Byte"):
        return int(value)
    if kind in ("Double", "Float"):
        return float(value)
    if kind in ("Bool", "Boolean"):
        return value.lower() == "true"
    return value


def arrow_type(kind: str | None):
    return {"Int": pa.int32(), "Long": pa.int64(), "Short": pa.int16(), "Byte": pa.int8(), "Double": pa.float64(),
            "Float": pa.float32(), "Bool": pa.bool_(), "Boolean": pa.bool_()}.get(kind or "", pa.string())


def iso_millis(ts: dt.datetime) -> str:
    return ts.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{ts.microsecond // 1000:03d}Z"


def read_neptune(directory: Path) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = {}
    for path in sorted(glob.glob(str(directory / "**" / "*.csv"), recursive=True)):
        rows = list(csv.reader(io.StringIO(Path(path).read_text(encoding="utf-8"))))
        if not rows:
            continue
        header = rows[0]
        for values in rows[1:]:
            record = dict(zip(header, values))
            groups.setdefault(record["~label"], []).append(record)
    return groups


def write_table(rows: list[dict], columns: list[str], target: Path) -> dict:
    fields = [pa.field(c, arrow_type(graph_type(c))) for c in columns]
    data = {c: [typed(r.get(c, ""), graph_type(c)) for r in rows] for c in columns}
    table = pa.table(data, schema=pa.schema(fields))
    target.mkdir(parents=True, exist_ok=True)
    out = target / "part-00000.parquet"
    pq.write_table(table, out)
    return {"dataset": target.name, "rows": table.num_rows, "columns": columns, "sha256": sha256_file(out)}


def cmd_neptune(args) -> int:
    source, out = Path(args.source), Path(args.out)
    base = dt.datetime.fromisoformat(args.created_at.replace("Z", "+00:00")) if args.created_at else None
    manifest = []
    for kind in ("vertices", "edges"):
        prefix = "vertex" if kind == "vertices" else "edge"
        for label, rows in sorted(read_neptune(source / kind).items()):
            rows.sort(key=lambda r: r["~id"])
            if args.id_prefix_mode == "physical":
                for r in rows:
                    r["~id"] = f"{r['~id']}~1"
                    for end in ("~from", "~to"):
                        if end in r:
                            r[end] = f"{r[end]}~1"
            columns = [c for c in (["~id", "~label"] + (["~from", "~to"] if kind == "edges" else [])) if c in rows[0]]
            columns += sorted({c for r in rows for c in r} - set(SPECIAL))
            if base is not None and "created_at:DateTime" not in columns:
                for i, r in enumerate(rows):
                    r["created_at:DateTime"] = iso_millis(base + dt.timedelta(milliseconds=i))
                columns.append("created_at:DateTime")
            manifest.append(write_table(rows, columns, out / f"{prefix}-{label.replace('_', '-')}"))
    result = {"source": str(source), "createdAtSynthesized": base is not None, "datasets": manifest}
    print(json.dumps(result, indent=1))
    return 0


def cmd_iso(args) -> int:
    source, out = Path(args.source), Path(args.out)
    table = pq.read_table(source)
    converted = []
    columns = []
    for name in table.column_names:
        col = table.column(name)
        kind = graph_type(name)
        if kind in ("DateTime", "Date") and pa.types.is_integer(col.type):
            values = [None if v is None else EPOCH + dt.timedelta(milliseconds=v) for v in col.to_pylist()]
            text = [None if v is None else (iso_millis(v) if kind == "DateTime" else v.date().isoformat()) for v in values]
            col = pa.array(text, pa.string())
            converted.append(name)
        columns.append(col)
    table = pa.table(columns, names=table.column_names)
    out.mkdir(parents=True, exist_ok=True)
    target = out / "part-00000.parquet"
    pq.write_table(table, target)
    print(json.dumps({"source": str(source), "rows": table.num_rows, "convertedColumns": converted, "sha256": sha256_file(target)}, indent=1))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("neptune-csv")
    p.add_argument("--source", required=True, help="directory holding vertices/ and edges/ CSV part files")
    p.add_argument("--out", required=True)
    p.add_argument("--created-at", help="ISO-8601 UTC base for synthesized created_at, e.g. 2026-09-24T00:00:00Z")
    p.add_argument("--id-prefix-mode", choices=("logical", "physical"), default="logical")
    p = sub.add_parser("iso-dates")
    p.add_argument("--source", required=True, help="Parquet file or dataset directory")
    p.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    return {"neptune-csv": cmd_neptune, "iso-dates": cmd_iso}[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
