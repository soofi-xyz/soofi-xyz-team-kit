#!/usr/bin/env python3
"""Execute a materialized Transform mapping locally with Spark SQL (synthetic-local, phase 7).

  local_mapping_run.py --mapping <dir>/transform-mappings/<id>/<version>/mapping.json \
      --input <table>=<fixture file|dir|glob> [--input ...] [--output <dataset> ...] --out <dir>

For each selected output (default: every output whose requiredInputs are all supplied) it
registers each declared input as its declared view, verifies every query's SHA-256 against
mapping.json, runs the SQL with the mapping's sqlOptions, and writes the result with the
mapping's output format/options (csv, jsonl or parquet; a per-output format overrides the
mapping default). Graph outputs are written in the Neptune layout (<out>/vertices/<dataset>/,
<out>/edges/<dataset>/) that graph_export_bridge.py neptune-csv reads. Absent optional graph
properties (`"optional": true`) become typed nulls, as the Transform runtime does. A missing
required input or a missing non-optional graph property column fails, as in Transform.
--negatives additionally proves, for every selected output and each of its requiredInputs, that a
request omitting exactly that input is rejected before any query runs (reported as negativeCases).

This proves the SQL and contracts at the local Spark version only; it is not deployed-runtime
evidence (phase 9 still needs an approved DEV execution). Needs pyspark and Java 17; use the
Transform repository's scripts/setup-spark-tests.sh for the deployed major/minor version.
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import sys
from pathlib import Path

SPARK_TYPES = {"String": "string", "Bool": "boolean", "Boolean": "boolean", "Byte": "byte", "Short": "short", "Int": "int",
               "Long": "long", "Float": "float", "Double": "double", "Date": "date", "DateTime": "timestamp", "Timestamp": "timestamp"}


def spark_session():
    os.environ.setdefault("TZ", "UTC")
    os.environ.setdefault("SPARK_LOCAL_IP", "127.0.0.1")
    os.environ.setdefault("PYSPARK_PYTHON", sys.executable)
    os.environ.setdefault("PYSPARK_DRIVER_PYTHON", sys.executable)
    from pyspark.sql import SparkSession

    spark = (SparkSession.builder.master("local[2]").appName("silvally-local-mapping")
             .config("spark.sql.session.timeZone", "UTC").config("spark.ui.enabled", "false")
             .config("spark.sql.shuffle.partitions", "4").config("spark.sql.caseSensitive", "true").getOrCreate())
    spark.sparkContext.setLogLevel("ERROR")
    return spark


def read_input(spark, spec: dict, path: str):
    fmt = spec.get("format", "parquet")
    options = {k: str(v).lower() if isinstance(v, bool) else str(v) for k, v in (spec.get("options") or {}).items()}
    if fmt == "jsonl":
        fmt = "json"
    reader = spark.read.options(**options)
    frame = reader.format(fmt).load(path)
    graph = spec.get("graph")
    if graph:
        from pyspark.sql import functions as F

        for prop in graph.get("properties", []):
            if prop["column"] in frame.columns:
                continue
            if prop.get("optional"):
                frame = frame.withColumn(prop["column"], F.lit(None).cast(SPARK_TYPES.get(prop["type"], "string")))
            else:
                raise ValueError(f"Graph dataset '{spec['table']}' lacks property column '{prop['column']}'")
    return frame


def missing_inputs(output: dict, supplied: set[str]) -> list[str]:
    return sorted(set(output.get("requiredInputs", [])) - supplied)


def input_digests(path: str) -> list[str]:
    files = [f for f in sorted(glob.glob(str(Path(path) / "**" / "*"), recursive=True) if Path(path).is_dir() else glob.glob(path))
             if Path(f).is_file() and not f.endswith(".crc")]
    return [hashlib.sha256(Path(f).read_bytes()).hexdigest() for f in files]


def write_output(frame, output: dict, target: Path) -> dict:
    fmt = output.get("format", "csv")
    options = {k: (str(v).lower() if isinstance(v, bool) else str(v)) for k, v in (output.get("options") or {}).items()}
    writer = frame.coalesce(1).write.mode("overwrite").options(**options)
    {"csv": writer.csv, "jsonl": writer.json, "parquet": writer.parquet}[fmt](str(target))
    parts = sorted(glob.glob(str(target / "part-*")))
    return {"files": len(parts), "sha256": [hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in parts]}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--mapping", required=True)
    parser.add_argument("--input", action="append", default=[], help="TABLE=PATH (file, directory or glob)")
    parser.add_argument("--output", action="append", help="output dataset to run (default: all runnable)")
    parser.add_argument("--out", required=True)
    parser.add_argument("--negatives", action="store_true", help="also prove each required input's omission is rejected")
    args = parser.parse_args(argv)

    mapping_path = Path(args.mapping)
    mapping = json.loads(mapping_path.read_text())
    supplied = dict(spec.split("=", 1) for spec in args.input)
    inputs = {i["table"]: i for i in mapping["inputs"]}
    unknown = set(supplied) - set(inputs)
    if unknown:
        raise SystemExit(f"inputs not declared by the mapping: {sorted(unknown)}")
    outputs = [o for o in mapping["outputs"] if (args.output is None and set(o.get("requiredInputs", [])) <= set(supplied))
               or (args.output and o["dataset"] in args.output)]
    if not outputs:
        raise SystemExit("no output is runnable with the supplied inputs")
    for o in outputs:
        missing = missing_inputs(o, set(supplied))
        if missing:
            raise SystemExit(f"output {o['dataset']} requires missing input(s) {missing}")
    negatives = []
    if args.negatives:
        for o in outputs:
            for table in o.get("requiredInputs", []):
                rejected = missing_inputs(o, set(supplied) - {table}) == [table]
                negatives.append({"dataset": o["dataset"], "missingInput": table, "rejected": rejected})

    spark = spark_session()
    ansi = (mapping.get("sqlOptions") or {}).get("ansiEnabled")
    if ansi is not None:
        spark.conf.set("spark.sql.ansi.enabled", str(bool(ansi)).lower())
    for table, path in supplied.items():
        read_input(spark, inputs[table], path).createOrReplaceTempView(inputs[table]["view"])
    default_output = mapping.get("output") or {}
    report = {"mapping": f"{mapping['id']}@{mapping['version']}", "mappingSha256": hashlib.sha256(mapping_path.read_bytes()).hexdigest(),
              "sparkVersion": spark.version, "inputs": {t: input_digests(p) for t, p in supplied.items()}, "outputs": [],
              "negativeCases": negatives}
    graph_output = default_output.get("shape") == "graph"
    for output in outputs:
        frame = None
        for query in output["queries"]:
            sql_path = mapping_path.parent / query["path"]
            text = sql_path.read_bytes()
            if hashlib.sha256(text).hexdigest() != query["sha256"]:
                raise SystemExit(f"{query['path']}: SHA-256 differs from mapping.json")
            frame = spark.sql(text.decode())
        spec = {**default_output, **{k: v for k, v in output.items() if k in ("format", "options")}}
        target = Path(args.out) / output["dataset"]
        if graph_output:
            kind = (output.get("graph") or {}).get("kind") or ("edge" if output["dataset"].startswith("edge") else "vertex")
            target = Path(args.out) / ("edges" if kind == "edge" else "vertices") / output["dataset"]
        result = write_output(frame, spec, target)
        report["outputs"].append({"dataset": output["dataset"], "rows": frame.count(), "columns": frame.columns,
                                  "location": str(target.relative_to(Path(args.out))), **result})
    (Path(args.out) / "report.json").write_text(json.dumps(report, indent=1) + "\n")
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
