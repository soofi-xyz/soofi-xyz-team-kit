#!/usr/bin/env python3
"""Build a slice's Transform graph inputs from real PROD graph data: bounded, read-only, keyed by the window.

  graph_inputs.py gremlin --contracts contracts.json --catalog prod-actuals.json --slice NAME
      (--events selected.jsonl | --keys-file keys.txt) --profile <prod-profile> [--region R]
      [--window-start ISO --window-end-exclusive ISO] [--as-of ISO] [--owner-decisions decisions.json]
      [--max-elements 50000] --private-dir DIR --out-dir PKG --out summary.json
      Read the slice's graph neighbourhood through the PROD Persist Gremlin API (SigV4 execute-api POST to the
      layout's persist.gremlinPath under the URL in SSM persist.apiUrlParameter): the root vertices whose key
      property equals the canary's or window's keys, then each catalog hop (one edge label from an already
      collected vertex dataset, with its other endpoint). Only read traversals are sent; every id and key is
      validated before it enters a query; queries are batched and the total element count is capped.
  graph_inputs.py export --export-dir DIR (same selection arguments, no --profile)
      The same selection over an existing immutable graph export already copied read-only into DIR
      (<dataset>/part-*.parquet in Transform input shape).

Datasets and columns come from the mapping's input contracts (resolve-transform-intent.py contracts): one
`<dataset>/part-00000.parquet` per graph input with `~id`, `~label`, `~from`/`~to` and every `<property>:<Type>`
column, DateTime values as ISO-8601 UTC milliseconds. Values are copied, never derived; absent properties
stay null. The catalog slice's `graphInputs` names the root and hops; a hop with `window` keeps only edges
whose property lies in the window, and `prune` drops collected vertices without such an edge, so the inputs
cover the window's events. --as-of drops vertices and edges created after the PROD actual's data cutoff
(and edges left without an endpoint), aligning the graph with a stale mirror. Every edge endpoint must lie
in its endpoint dataset: a dangling endpoint fails the build.

A catalog `hydration` dataset (for example rendered message bodies) is built from the named edge's artifact
URIs: each object is downloaded read-only from PROD S3 into the private directory, its SHA-256 is verified
against the edge's digest, and the edge's selector (TEXT, JSON_BODY or $.path) extracts the body.
A slice that declares `sensitiveFields` is built only when the owner decided `sensitiveFieldStaging:
stage-real-values-to-dev`; the real values are then staged to DEV unmodified and compared directly.

Rows stay in --private-dir and --out-dir (mode 0700, outside any repository); stdout carries counts only.
Stage --out-dir with stage_evidence_package.py under its own approval (or the owner's blanketDevWrites).
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from prod_actuals import dig, parse_loose, read_jsonl, text
from silvally_io import DEFAULT_REGION, SilvallyError, aws, load_layout, private_dir, read_json, sha256_file, write_json

SAFE_VALUE = re.compile(r"^[A-Za-z0-9_.:@/+=\-]{1,256}$")
MUTATING_STEPS = re.compile(r"\b(addV|addE|property|drop|mergeV|mergeE|sideEffect|inject|io|call)\s*\(")
SENSITIVE_DECISION = "stage-real-values-to-dev"
BATCH = 100


def quote(value: str) -> str:
    if not SAFE_VALUE.match(value):
        raise SilvallyError(f"refusing a key or id with characters outside {SAFE_VALUE.pattern}")
    return "'" + value + "'"


def assert_read_only(query: str) -> str:
    if MUTATING_STEPS.search(query):
        raise SilvallyError("PROD is read-only; refused a mutating Gremlin step")
    return query


def results_of(payload) -> list:
    """The result list of a Persist Gremlin response ({data: {results}}, {results}, {result: {data}}, or a list)."""
    if isinstance(payload, list):
        return payload
    for path in ("data.results", "results", "result.data", "data"):
        value = dig(payload, path)
        if isinstance(value, list):
            return value
    raise SilvallyError(f"unrecognized Persist Gremlin response keys {sorted(payload) if isinstance(payload, dict) else type(payload).__name__}")


def persist_query_fn(profile: str, region: str):
    """A read-only query function over the PROD Persist Gremlin API, signed with the operator's profile."""
    persist = load_layout()["persist"]
    base = aws(["ssm", "get-parameter", "--name", persist["apiUrlParameter"]], profile=profile, region=region,
               environment="prod")["Parameter"]["Value"]
    url = base.rstrip("/") + persist["gremlinPath"]
    try:
        import botocore.session
        from botocore.auth import SigV4Auth
        from botocore.awsrequest import AWSRequest
    except ImportError as error:
        raise SystemExit("botocore is required for Persist reads (scripts/requirements-silvally-prod-oracle.txt)") from error
    credentials = botocore.session.Session(profile=profile).get_credentials().get_frozen_credentials()

    def query(gremlin: str) -> list:
        body = json.dumps({"gremlin": assert_read_only(gremlin)})
        request = AWSRequest(method="POST", url=url, data=body, headers={"Content-Type": "application/json"})
        SigV4Auth(credentials, persist.get("service", "execute-api"), region).add_auth(request)
        signed = urllib.request.Request(url, data=body.encode(), headers=dict(request.headers), method="POST")
        with urllib.request.urlopen(signed, timeout=120) as response:
            return results_of(json.loads(response.read()))
    return query


def element(raw: dict) -> dict:
    """elementMap() output as {id, label, OUT, IN, properties}; single-item value lists are unwrapped."""
    out = {"id": text(raw.get("id", raw.get("T.id"))), "label": raw.get("label", raw.get("T.label")), "properties": {}}
    for side in ("OUT", "IN"):
        endpoint = raw.get(side, raw.get(f"Direction.{side}"))
        if isinstance(endpoint, dict):
            out[side] = text(endpoint.get("id", endpoint.get("T.id")))
    for key, value in raw.items():
        if key in {"id", "label", "T.id", "T.label", "OUT", "IN", "Direction.OUT", "Direction.IN"}:
            continue
        out["properties"][key] = value[0] if isinstance(value, list) and len(value) == 1 else value
    return out


class GremlinSource:
    def __init__(self, query):
        self.query = query

    def roots(self, label: str, prop: str, keys: list[str]) -> list[dict]:
        found = []
        for i in range(0, len(keys), BATCH):
            chunk = ",".join(quote(k) for k in keys[i:i + BATCH])
            found += [element(r) for r in self.query(f"g.V().hasLabel({quote(label)}).has({quote(prop)}, within({chunk})).elementMap()")]
        return found

    def hop(self, ids: list[str], edge_label: str, direction: str) -> list[tuple[dict, dict]]:
        step, other = ("outE", "inV") if direction == "out" else ("inE", "outV")
        pairs = []
        for i in range(0, len(ids), BATCH):
            chunk = ",".join(quote(v) for v in ids[i:i + BATCH])
            rows = self.query(f"g.V({chunk}).{step}({quote(edge_label)}).as('e').{other}().as('v')"
                              ".select('e','v').by(elementMap()).by(elementMap())")
            pairs += [(element(r["e"]), element(r["v"])) for r in rows]
        return pairs


class ExportSource:
    """The same selection over an existing immutable export in Transform input shape."""

    def __init__(self, directory: str, contracts: dict):
        import pyarrow.parquet as pq
        self.tables = {}
        for contract in contracts["inputs"]:
            files = sorted(glob.glob(str(Path(directory) / contract["table"] / "*.parquet")))
            self.tables[contract.get("label") or contract["table"]] = [r for f in files for r in pq.read_table(f).to_pylist()]

    @staticmethod
    def as_element(row: dict, label: str) -> dict:
        out = {"id": text(row["~id"]), "label": row.get("~label") or label,
               "properties": {k.split(":", 1)[0]: v for k, v in row.items() if not k.startswith("~")}}
        if "~from" in row:
            out["OUT"], out["IN"] = text(row["~from"]), text(row["~to"])
        return out

    def roots(self, label: str, prop: str, keys: list[str]) -> list[dict]:
        wanted = set(keys)
        return [self.as_element(r, label) for r in self.tables.get(label, [])
                if text(next((v for k, v in r.items() if k.split(":", 1)[0] == prop), None)) in wanted]

    def hop(self, ids: list[str], edge_label: str, direction: str) -> list[tuple[dict, dict]]:
        wanted = set(ids)
        near = ("OUT", "IN") if direction == "out" else ("IN", "OUT")
        vertices = {text(r["~id"]): (label, r) for label, rows in self.tables.items() for r in rows if "~from" not in r}
        pairs = []
        for row in self.tables.get(edge_label, []):
            edge = self.as_element(row, edge_label)
            if edge[near[0]] in wanted and edge[near[1]] in vertices:
                label, vertex = vertices[edge[near[1]]]
                pairs.append((edge, self.as_element(vertex, label)))
        return pairs


def iso_millis(value) -> str | None:
    moment = parse_loose(value)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z" if moment else None


def cast(value, kind: str):
    if value is None:
        return None
    if kind == "DateTime":
        return iso_millis(value)
    if kind == "Date":
        moment = parse_loose(value)
        return moment.strftime("%Y-%m-%d") if moment else None
    if kind in ("Int", "Long", "Short", "Byte"):
        return int(value)
    if kind in ("Double", "Float"):
        return float(value)
    if kind in ("Bool", "Boolean"):
        return value if isinstance(value, bool) else text(value).lower() == "true"
    return text(value)


def in_window(value, start: datetime | None, end: datetime | None) -> bool:
    moment = parse_loose(value)
    return moment is not None and (start is None or moment >= start) and (end is None or moment < end)


def collect(source, contracts: dict, plan: dict, keys: list[str], window: tuple, max_elements: int) -> tuple[dict, dict]:
    """Root vertices and hop edges per dataset: {dataset: {id: element}}, plus per-hop counts."""
    inputs = {c["table"]: c for c in contracts["inputs"]}
    root = plan["root"]
    root_label = inputs[root["dataset"]]["label"]
    data: dict[str, dict] = {root["dataset"]: {e["id"]: e for e in source.roots(root_label, root["keyProperty"], keys)}}
    stats = {"roots": len(data[root["dataset"]]), "keysRequested": len(keys), "hops": []}
    for hop in plan.get("hops", []):
        contract = inputs[hop["edge"]]
        endpoints = contract["endpoints"]
        other = endpoints["to"] if hop["direction"] == "out" else endpoints["from"]
        near = endpoints["from"] if hop["direction"] == "out" else endpoints["to"]
        if near != hop["from"]:
            raise SilvallyError(f"hop {hop['edge']} {hop['direction']} starts at {near}, not {hop['from']}")
        pairs = source.hop(sorted(data[hop["from"]]), contract["label"], hop["direction"])
        data.setdefault(hop["edge"], {})
        data.setdefault(other, {})
        if hop.get("window"):
            pairs = [(e, v) for e, v in pairs if in_window(e["properties"].get(hop["window"]), *window)]
        for edge, vertex in pairs:
            data[hop["edge"]][edge["id"]] = edge
            data[other].setdefault(vertex["id"], vertex)
        if hop.get("prune"):
            side = "OUT" if hop["direction"] == "out" else "IN"
            kept = {e[side] for e in data[hop["edge"]].values()}
            data[hop["from"]] = {i: v for i, v in data[hop["from"]].items() if i in kept}
            close_endpoints(data, contracts, {})
        stats["hops"].append({"edge": hop["edge"], "edges": len(data[hop["edge"]]), "endpointDataset": other,
                              "endpointVertices": len(data[other])})
        if sum(len(d) for d in data.values()) > max_elements:
            raise SilvallyError(f"GraphReadUnbounded: more than {max_elements} elements; narrow the keys or raise --max-elements")
    return data, stats


def apply_as_of(data: dict, contracts: dict, cutoff: datetime) -> dict:
    dropped = {}
    for dataset, items in data.items():
        late = [i for i, e in items.items() if (parse_loose(e["properties"].get("created_at")) or cutoff) > cutoff]
        for i in late:
            del items[i]
        dropped[dataset] = len(late)
    close_endpoints(data, contracts, dropped)
    return dropped


def close_endpoints(data: dict, contracts: dict, dropped: dict | None = None) -> int:
    """Drop edges whose endpoint is absent from its endpoint dataset; return how many were dangling."""
    dangling = 0
    for contract in contracts["inputs"]:
        if contract.get("graphKind") != "edge" or contract["table"] not in data:
            continue
        ends = contract["endpoints"]
        bad = [i for i, e in data[contract["table"]].items()
               if e.get("OUT") not in data.get(ends["from"], {}) or e.get("IN") not in data.get(ends["to"], {})]
        dangling += len(bad)
        if dropped is not None:
            for i in bad:
                del data[contract["table"]][i]
            dropped[contract["table"]] = dropped.get(contract["table"], 0) + len(bad)
    return dangling


def dataset_rows(contract: dict, items: dict) -> tuple[list[str], list[dict]]:
    columns = ["~id", "~label"] + (["~from", "~to"] if contract.get("graphKind") == "edge" else [])
    columns += contract.get("requiredColumns", []) + contract.get("optionalColumns", [])
    columns = list(dict.fromkeys(columns))
    rows = []
    for e in sorted(items.values(), key=lambda x: x["id"]):
        row = {"~id": e["id"], "~label": e.get("label") or contract["label"]}
        if contract.get("graphKind") == "edge":
            row["~from"], row["~to"] = e.get("OUT"), e.get("IN")
        for column in columns:
            if column.startswith("~"):
                continue
            name, _, kind = column.partition(":")
            row[column] = cast(e["properties"].get(name), kind or "String")
        rows.append(row)
    return columns, rows


def write_parquet(directory: Path, columns: list[str], rows: list[dict]) -> None:
    import pyarrow as pa
    import pyarrow.parquet as pq
    types = {"Int": pa.int32(), "Long": pa.int64(), "Short": pa.int16(), "Byte": pa.int8(), "Double": pa.float64(),
             "Float": pa.float32(), "Bool": pa.bool_(), "Boolean": pa.bool_()}
    schema = pa.schema([(c, types.get(c.partition(":")[2], pa.string())) for c in columns])
    directory.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pylist(rows, schema=schema), directory / "part-00000.parquet")


def select_body(raw: bytes, selector: str) -> str:
    if selector == "TEXT":
        return raw.decode("utf-8")
    document = json.loads(raw)
    path = "body" if selector == "JSON_BODY" else selector.removeprefix("$.")
    value = dig(document, path)
    if value is None:
        raise SilvallyError(f"selector {selector} found no body")
    return text(value)


def hydrate(spec: dict, edges: dict, fetch) -> tuple[list[dict], dict]:
    """Rows of a hydration dataset from artifact edges; fetch(uri) returns the object's bytes (read-only)."""
    columns, rows, failures = spec["columns"], [], {}
    seen = set()
    for edge in edges.values():
        props = edge["properties"]
        row = {column: text(props.get(prop)) for column, prop in columns.items()}
        identity = tuple(sorted(row.items()))
        if identity in seen:
            continue
        seen.add(identity)
        try:
            raw = fetch(row[spec["uriColumn"]])
            digest = row[spec["sha256Column"]].removeprefix("sha256:")
            if hashlib.sha256(raw).hexdigest() != digest:
                raise SilvallyError("ArtifactDigestMismatch")
            row[spec["bodyColumn"]] = select_body(raw, row[spec["selectorColumn"]])
        except (SilvallyError, ValueError, UnicodeDecodeError) as error:
            reason = str(error).split(":", 1)[0] or type(error).__name__
            failures[reason] = failures.get(reason, 0) + 1
            continue
        rows.append(row)
    return rows, failures


def s3_fetcher(profile: str, region: str, directory: Path):
    def fetch(uri: str) -> bytes:
        if not uri.startswith("s3://"):
            raise SilvallyError("ArtifactNotS3")
        target = directory / hashlib.sha256(uri.encode()).hexdigest()
        aws(["s3", "cp", uri, str(target), "--quiet"], profile=profile, region=region, environment="prod", output_json=False)
        data = target.read_bytes()
        target.unlink()
        return data
    return fetch


def root_keys(args, plan: dict) -> list[str]:
    if args.keys_file:
        values = Path(args.keys_file).read_text(encoding="utf-8").splitlines()
    else:
        values = [text(dig(e, plan["root"]["actualKey"])) for e in read_jsonl(args.events)]
    keys = sorted({v.strip() for v in values if v and v.strip()})
    if not keys:
        raise SilvallyError("no root keys: the canary or window events carry no value of the root actualKey")
    return keys


def build(args, source=None, fetch=None) -> dict:
    contracts = read_json(args.contracts)
    spec = read_json(args.catalog)["slices"][args.slice]
    plan = spec.get("graphInputs")
    if not plan:
        raise SilvallyError(f"slice {args.slice} declares no graphInputs in the catalog")
    decisions = read_json(args.owner_decisions) if args.owner_decisions else {}
    sensitive = spec.get("sensitiveFields")
    if sensitive and decisions.get("sensitiveFieldStaging") != SENSITIVE_DECISION:
        raise SilvallyError(f"SensitiveStagingDecisionRequired: slice {args.slice} stages {sensitive.get('inputs')} to DEV; "
                            "the owner must decide sensitiveFieldStaging: stage-real-values-to-dev (state it up front, "
                            "or approve it when asked)")
    keys = root_keys(args, plan)
    window = (parse_loose(args.window_start), parse_loose(args.window_end_exclusive))
    if source is None:
        source = (ExportSource(args.export_dir, contracts) if args.command == "export"
                  else GremlinSource(persist_query_fn(args.profile, args.region)))
    data, stats = collect(source, contracts, plan, keys, window, args.max_elements)
    dropped = apply_as_of(data, contracts, parse_loose(args.as_of)) if args.as_of else {}
    dangling = close_endpoints(data, contracts)
    out = private_dir(args.out_dir)
    datasets = {}
    for contract in contracts["inputs"]:
        if contract["table"] not in data:
            continue
        columns, rows = dataset_rows(contract, data[contract["table"]])
        write_parquet(out / contract["table"], columns, rows)
        datasets[contract["table"]] = {"rows": len(rows), "sha256": "sha256:" + sha256_file(out / contract["table"] / "part-00000.parquet")}
    hydration = spec.get("hydration")
    failures = {}
    if hydration:
        work = private_dir(Path(args.private_dir) / "artifacts")
        rows, failures = hydrate(hydration, data[hydration["edge"]], fetch or s3_fetcher(args.profile, args.region, work))
        target = out / hydration["dataset"]
        target.mkdir(parents=True, exist_ok=True)
        (target / "part-00000.jsonl").write_text("".join(json.dumps(r, sort_keys=True) + "\n" for r in rows), encoding="utf-8")
        datasets[hydration["dataset"]] = {"rows": len(rows), "sha256": "sha256:" + sha256_file(target / "part-00000.jsonl"),
                                          "hydrationFailures": failures}
    summary = {"slice": args.slice, "source": "existing-export" if args.command == "export" else "prod-persist-gremlin",
               "prodAccess": "read-only", "rootKeys": len(keys), "rootsFound": stats["roots"], "hops": stats["hops"],
               "window": {"start": args.window_start, "endExclusive": args.window_end_exclusive} if args.window_start else None,
               "asOf": args.as_of, "droppedAfterAsOf": dropped, "danglingEndpointCount": dangling, "datasets": datasets,
               "sensitiveFieldStaging": decisions.get("sensitiveFieldStaging") if sensitive else "not-applicable",
               "status": "FAIL" if dangling or failures else "BUILT"}
    write_json(args.out, summary)
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("gremlin", "export"):
        p = sub.add_parser(name)
        p.add_argument("--contracts", required=True, help="resolve-transform-intent.py contracts output for the mapping")
        p.add_argument("--catalog", required=True, help="reference/prod-actuals.json or a profile's equivalent")
        p.add_argument("--slice", required=True)
        keys = p.add_mutually_exclusive_group(required=True)
        keys.add_argument("--events", help="canary or window events (JSONL); the root keys are their catalog actualKey")
        keys.add_argument("--keys-file", help="one root key per line")
        if name == "gremlin":
            p.add_argument("--profile", required=True, help="operator's PROD read-only profile")
            p.add_argument("--region", default=DEFAULT_REGION)
        else:
            p.add_argument("--export-dir", required=True, help="an immutable export copied read-only: <dataset>/part-*.parquet")
            p.add_argument("--profile", help="PROD read-only profile, needed only to hydrate artifacts")
            p.add_argument("--region", default=DEFAULT_REGION)
        p.add_argument("--window-start")
        p.add_argument("--window-end-exclusive")
        p.add_argument("--as-of", help="drop elements created after this instant (the PROD actual's dataThrough)")
        p.add_argument("--owner-decisions", help="ownerDecisions JSON (sensitiveFieldStaging for sensitive slices)")
        p.add_argument("--max-elements", type=int, default=50000)
        p.add_argument("--private-dir", required=True)
        p.add_argument("--out-dir", required=True, help="package directory: one <dataset>/ per graph input")
        p.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    summary = build(args)
    print(json.dumps(summary, indent=1))
    return 0 if summary["status"] == "BUILT" else 1


if __name__ == "__main__":
    raise SystemExit(main())
