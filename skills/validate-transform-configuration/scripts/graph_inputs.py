#!/usr/bin/env python3
"""Build a slice's Transform graph inputs from real PROD graph data: bounded, read-only, keyed by the window.

  graph_inputs.py gremlin --contracts contracts.json --catalog prod-actuals.json --slice NAME
      (--events selected.jsonl | --keys-file keys.txt) --profile <prod-profile> [--region R]
      [--window-start ISO --window-end-exclusive ISO] [--as-of ISO] [--owner-decisions decisions.json]
      [--max-elements 50000] [--batch-size 10] [--retries 4] [--backoff-seconds 2] [--timeout-seconds 60]
      --private-dir DIR --out-dir PKG --out summary.json
      Read the slice's graph neighbourhood through the PROD Persist Gremlin API (SigV4 execute-api POST to the
      layout's persist.gremlinPath under the URL in SSM persist.apiUrlParameter): the root vertices whose key
      property equals the canary's or window's keys, then each catalog hop (one edge label from an already
      collected vertex dataset, with its other endpoint). Only read traversals are sent; every id and key is
      validated before it enters a query; the total element count is capped. Keys and ids are sent in pages of
      --batch-size (PROD Persist answers a few-dozen-debt traversal with HTTP 503 after ~30 s); a 429/5xx or a
      timeout is retried with exponential backoff, and a page that still fails is split in half until it
      succeeds or is a single id. Every page is merged into ONE dataset per table (deduplicated by ~id; the
      same id with different content fails), so a whole window is one input, never hand-split runs.
  graph_inputs.py edge-days --contracts contracts.json --catalog prod-actuals.json --slice NAME --profile <prod-profile>
      [--end-day YYYY-MM-DD] [--lookback-days 14] [--region R] --out input-days.json
      Phase 1, before any day is chosen: per-UTC-day counts of the slice's windowed edge in PROD Persist, one bounded
      read-only count() traversal per day (newest first, at most 31 days). The catalog's graphInputs.dayCounts names
      the edge, its window property, equality filters that the mapping's SQL applies (for example a provider value the
      output query keeps) and the literal form of the window values (datetime, epoch-millis or iso-string); without it the first
      windowed hop is counted unfiltered. --out is {"<slice>": {"YYYY-MM-DD": edges}}, the input side of
      source_window.py data-days --input-days, so an empty input day is caught before the canary.
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

A catalog root may declare `keyTemplate` (for example `interprose:{}`): each event's actualKey value is
formatted into it before the keyed read, so the root is read by the identity PROD wrote (an event without the
value contributes no key). A catalog `joinCoverage` (requires --events) proves the inputs cover the join the
mapping's SQL makes: every event matching its eventFilter needs a root vertex for its key whose uriProperty
equals the event's URI (uriTemplate over the first non-empty field of each uriParts entry), linked through
the named edge to exactly one endpoint (in endpointDataset, which must match the contracts) whose
endpointProperty matches endpointPattern. Gaps are counted per
category (noFileKey, noEventUri, noRootVertex, uriMismatch, noLinkedEndpoint, ambiguousEndpoint); a
uriMismatch names the event field that would have produced the vertex's URI (for example classifiedRunKey
instead of classifiedKey). Real values go to <private-dir>/<slice>-join-coverage-gaps.jsonl only. Any gap is
status JOIN_COVERAGE_GAP with the catalog's handoff: an input-coverage BLOCKED, never a mapping FAIL.

A root dataset or windowed edge dataset left with no rows is status INPUT_EMPTY (inputEmpty.code
UpstreamInputEmpty): pass the summary to evaluate_run.py --graph-inputs so the slice reports the real cause.

Rows stay in --private-dir and --out-dir (mode 0700, outside any repository); stdout carries counts only.
Stage --out-dir with stage_evidence_package.py under its own approval (or the owner's blanketDevWrites).
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import re
import socket
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from prod_actuals import dig, parse_loose, read_jsonl, text
from silvally_io import DEFAULT_REGION, SilvallyError, aws, load_layout, private_dir, read_json, sha256_file, write_json

SAFE_VALUE = re.compile(r"^[A-Za-z0-9_.:@/+=\-]{1,256}$")
MUTATING_STEPS = re.compile(r"\b(addV|addE|property|drop|mergeV|mergeE|sideEffect|inject|io|call)\s*\(")
SENSITIVE_DECISION = "stage-real-values-to-dev"
DEFAULT_BATCH_SIZE = 10
TRANSIENT_HTTP = {429, 500, 502, 503, 504}


class TransientPersistError(SilvallyError):
    """A Persist answer worth retrying: 429/5xx or a timeout."""


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


def persist_query_fn(profile: str, region: str, timeout: float = 60):
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
        try:
            with urllib.request.urlopen(signed, timeout=timeout) as response:
                return results_of(json.loads(response.read()))
        except urllib.error.HTTPError as error:
            if error.code in TRANSIENT_HTTP:
                raise TransientPersistError(f"HTTP {error.code}") from error
            raise SilvallyError(f"PersistQueryFailed: HTTP {error.code}") from error
        except (urllib.error.URLError, TimeoutError, socket.timeout) as error:
            raise TransientPersistError(f"timeout or connection error ({type(error).__name__})") from error
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
    """Paged reads: pages of batch_size values, retried with backoff, split in half when a page keeps failing."""

    def __init__(self, query, batch_size: int = DEFAULT_BATCH_SIZE, retries: int = 4, backoff: float = 2.0, sleep=time.sleep):
        if batch_size < 1:
            raise SilvallyError("--batch-size must be at least 1")
        self.query, self.batch_size, self.retries, self.backoff, self.sleep = query, batch_size, retries, backoff, sleep
        self.stats = {"batchSize": batch_size, "queries": 0, "retries": 0, "splits": 0}

    def attempt(self, gremlin: str) -> list:
        for n in range(self.retries + 1):
            self.stats["queries"] += 1
            try:
                return self.query(gremlin)
            except TransientPersistError:
                if n == self.retries:
                    raise
                self.stats["retries"] += 1
                self.sleep(self.backoff * 2 ** n)
        return []

    def paged(self, values: list[str], render) -> list:
        out = []
        pending = [values[i:i + self.batch_size] for i in range(0, len(values), self.batch_size)]
        while pending:
            page = pending.pop(0)
            try:
                out += self.attempt(render(",".join(quote(v) for v in page)))
            except TransientPersistError as error:
                if len(page) == 1:
                    raise SilvallyError(f"PersistUnavailable: a single-id page still failed after {self.retries} retries ({error})") from error
                self.stats["splits"] += 1
                half = len(page) // 2
                pending[:0] = [page[:half], page[half:]]
        return out

    def roots(self, label: str, prop: str, keys: list[str]) -> list[dict]:
        rows = self.paged(keys, lambda chunk: f"g.V().hasLabel({quote(label)}).has({quote(prop)}, within({chunk})).elementMap()")
        return [element(r) for r in rows]

    def hop(self, ids: list[str], edge_label: str, direction: str) -> list[tuple[dict, dict]]:
        step, other = ("outE", "inV") if direction == "out" else ("inE", "outV")
        rows = self.paged(ids, lambda chunk: f"g.V({chunk}).{step}({quote(edge_label)}).as('e').{other}().as('v')"
                                             ".select('e','v').by(elementMap()).by(elementMap())")
        return [(element(r["e"]), element(r["v"])) for r in rows]


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


def merge(items: dict, found: dict, stats: dict) -> None:
    """Add one element to its dataset; a repeat is deduplicated, the same id with other content fails."""
    existing = items.get(found["id"])
    if existing is None:
        items[found["id"]] = found
    elif existing == found:
        stats["duplicatesMerged"] += 1
    else:
        raise SilvallyError(f"ConflictingDuplicate: two pages returned ~id {found['id']} with different content "
                            "(the graph changed during the read); rebuild the dataset")


def collect(source, contracts: dict, plan: dict, keys: list[str], window: tuple, max_elements: int) -> tuple[dict, dict]:
    """Root vertices and hop edges per dataset: {dataset: {id: element}} merged over every page, plus counts."""
    inputs = {c["table"]: c for c in contracts["inputs"]}
    root = plan["root"]
    root_label = inputs[root["dataset"]]["label"]
    stats = {"keysRequested": len(keys), "hops": [], "duplicatesMerged": 0}
    data: dict[str, dict] = {root["dataset"]: {}}
    for found in source.roots(root_label, root["keyProperty"], keys):
        merge(data[root["dataset"]], found, stats)
    stats["roots"] = len(data[root["dataset"]])
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
            merge(data[hop["edge"]], edge, stats)
            merge(data[other], vertex, stats)
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


def event_key(event: dict, root: dict) -> str:
    value = text(dig(event, root["actualKey"])).strip()
    return root.get("keyTemplate", "{}").format(value) if value else ""


def root_keys(args, plan: dict) -> list[str]:
    if args.keys_file:
        values = Path(args.keys_file).read_text(encoding="utf-8").splitlines()
    else:
        values = [event_key(e, plan["root"]) for e in read_jsonl(args.events)]
    keys = sorted({v.strip() for v in values if v and v.strip()})
    if not keys:
        raise SilvallyError("no root keys: the canary or window events carry no value of the root actualKey")
    return keys


MAX_GAP_SAMPLES = 5


def first_value(event: dict, paths) -> tuple[str, str]:
    """(value, field name) of the first non-empty path."""
    for path in [paths] if isinstance(paths, str) else paths:
        value = text(dig(event, path))
        if value:
            return value, path.rsplit(".", 1)[-1]
    return "", ""


def join_coverage(cover: dict, plan: dict, contracts: dict, data: dict, events: list[dict]) -> tuple[dict, list[dict]]:
    """The catalog joinCoverage check over the built datasets: counts and field-name samples, plus private rows."""
    root = plan["root"]
    edge = next((c for c in contracts["inputs"] if c["table"] == cover["edge"]), None)
    if not edge or edge.get("graphKind") != "edge" or root["dataset"] not in edge.get("endpoints", {}).values():
        raise SilvallyError(f"joinCoverage edge {cover['edge']} is not an edge input touching {root['dataset']}")
    near_is_to = edge["endpoints"]["to"] == root["dataset"]
    far_dataset = edge["endpoints"]["from" if near_is_to else "to"]
    if cover.get("endpointDataset", far_dataset) != far_dataset:
        raise SilvallyError(f"joinCoverage names endpoint {cover['endpointDataset']} but {cover['edge']} ends at {far_dataset}")
    pattern = re.compile(cover.get("endpointPattern", ".+"))
    vertices = data.get(root["dataset"], {})
    by_key: dict[str, list[dict]] = {}
    by_uri: dict[str, list[str]] = {}
    for vertex in vertices.values():
        by_key.setdefault(text(vertex["properties"].get(root["keyProperty"])), []).append(vertex)
        by_uri.setdefault(text(vertex["properties"].get(cover["uriProperty"])), []).append(vertex["id"])
    linked: dict[str, set] = {}
    for item in data.get(cover["edge"], {}).values():
        near, far = (item.get("IN"), item.get("OUT")) if near_is_to else (item.get("OUT"), item.get("IN"))
        endpoint = data.get(far_dataset, {}).get(far)
        value = text((endpoint or {}).get("properties", {}).get(cover["endpointProperty"]))
        if endpoint and pattern.match(value):
            linked.setdefault(near, set()).add(value)
    parts = cover["uriParts"]

    def uri_of(values: dict) -> str:
        return cover["uriTemplate"].format(**values)

    selected = [e for e in events if all(text(dig(e, k)) == text(v) for k, v in (cover.get("eventFilter") or {}).items())]
    gaps, explained, samples, private = {}, {}, [], []
    covered = 0
    for event in selected:
        key = event_key(event, root)
        values, fields = {}, {}
        for name, paths in parts.items():
            values[name], fields[name] = first_value(event, paths)
        uri = uri_of(values) if all(values.values()) else ""
        found = [text(v["properties"].get(cover["uriProperty"])) for v in by_key.get(key, [])]
        sample = {"expectedFrom": fields}
        if not key:
            category = "noFileKey"
        elif not uri:
            category = "noEventUri"
        elif not found:
            category = "noRootVertex"
        elif uri not in found:
            category = "uriMismatch"
            source = dig(event, cover["explainFrom"]) if cover.get("explainFrom") else None
            names = sorted({f for f, v in (source or {}).items() if isinstance(v, str) and v
                            for name in parts if uri_of({**values, name: v}) in found})
            label = ",".join(names) or "unexplained"
            explained[label] = explained.get(label, 0) + 1
            sample["foundMatches"] = label
        else:
            endpoints = set().union(*(linked.get(i, set()) for i in by_uri.get(uri, [])))
            category = "noLinkedEndpoint" if not endpoints else ("ambiguousEndpoint" if len(endpoints) > 1 else "")
            if category == "ambiguousEndpoint":
                sample["distinctEndpoints"] = len(endpoints)
        if not category:
            covered += 1
            continue
        gaps[category] = gaps.get(category, 0) + 1
        if sum(1 for x in samples if x["category"] == category) < MAX_GAP_SAMPLES:
            samples.append({"category": category, **sample})
            private.append({"category": category, "key": key, "expectedUri": uri, "foundUris": found, **sample})
    report = {"status": "GAP" if gaps else "COVERED", "eventFilter": cover.get("eventFilter") or {}, "eventsChecked": len(selected),
              "covered": covered, "gaps": gaps, "uriMismatchExplainedBy": explained, "gapSamples": samples,
              "join": f"{root['dataset']}.{cover['uriProperty']} == {cover['uriTemplate']} -> {cover['edge']} -> "
                      f"{far_dataset}.{cover['endpointProperty']}"}
    if gaps:
        handoff = dict(cover.get("handoff") or {"code": "GraphJoinCoverageGap", "owner": "graph producer"})
        handoff["detail"] = (f"{sum(gaps.values())} of {len(selected)} events lack the graph join {report['join']} "
                             f"({', '.join(f'{k} {v}' for k, v in sorted(gaps.items()))}"
                             + (f"; URI mismatches match {explained}" if explained else "") + "). "
                             + handoff.get("detail", ""))
        report["handoff"] = handoff
    return report, private


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
    cover = plan.get("joinCoverage")
    if cover and not args.events:
        raise SilvallyError(f"slice {args.slice} declares joinCoverage: pass --events (the canary or window events), not --keys-file")
    keys = root_keys(args, plan)
    window = (parse_loose(args.window_start), parse_loose(args.window_end_exclusive))
    if source is None:
        source = (ExportSource(args.export_dir, contracts) if args.command == "export"
                  else GremlinSource(persist_query_fn(args.profile, args.region, args.timeout_seconds),
                                     args.batch_size, args.retries, args.backoff_seconds))
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
               "paging": {**getattr(source, "stats", {}), "duplicatesMerged": stats["duplicatesMerged"],
                          "mergedInto": "one dataset per table"},
               "sensitiveFieldStaging": decisions.get("sensitiveFieldStaging") if sensitive else "not-applicable"}
    windowed = {h["edge"] for h in plan.get("hops", []) if h.get("window")}
    empty = [d for d, s in datasets.items() if not s["rows"] and (d == plan["root"]["dataset"] or d in windowed)]
    if empty:
        summary["inputEmpty"] = {"code": "UpstreamInputEmpty", "datasets": sorted(empty),
                                 "detail": "the PROD graph has no root vertex for the keys, or no windowed edge in the window"}
    gap = False
    if cover:
        report, private = join_coverage(cover, plan, contracts, data, read_jsonl(args.events))
        if private:
            target = private_dir(args.private_dir) / f"{args.slice}-join-coverage-gaps.jsonl"
            target.write_text("".join(json.dumps(r, sort_keys=True) + "\n" for r in private), encoding="utf-8")
            report["gapSamplesPrivateFile"] = str(target)
        summary["joinCoverage"] = report
        gap = report["status"] == "GAP"
    summary["status"] = ("FAIL" if dangling or failures else "JOIN_COVERAGE_GAP" if gap
                         else "INPUT_EMPTY" if empty else "BUILT")
    write_json(args.out, summary)
    return summary


MAX_LOOKBACK_DAYS = 31
LITERALS = {
    "datetime": lambda moment: f"datetime({quote(moment.strftime('%Y-%m-%dT%H:%M:%SZ'))})",
    "epoch-millis": lambda moment: str(int(moment.timestamp() * 1000)),
    "iso-string": lambda moment: quote(moment.strftime("%Y-%m-%dT%H:%M:%SZ")),
}


def day_count_plan(contracts: dict, spec: dict) -> dict:
    """The windowed edge to count per day: the catalog's graphInputs.dayCounts, else the first windowed hop."""
    plan = spec.get("graphInputs") or {}
    counts = plan.get("dayCounts") or next(({"edge": h["edge"], "window": h["window"]} for h in plan.get("hops", []) if h.get("window")), None)
    if not counts:
        raise SilvallyError("the slice declares no windowed graph edge (graphInputs.dayCounts or a hop with window)")
    contract = next((c for c in contracts["inputs"] if c["table"] == counts["edge"]), None)
    if not contract or contract.get("graphKind") != "edge":
        raise SilvallyError(f"{counts['edge']} is not an edge input of the mapping contracts")
    literal = counts.get("literal", "datetime")
    if literal not in LITERALS:
        raise SilvallyError(f"unknown dayCounts literal {literal}; use one of {sorted(LITERALS)}")
    return {"dataset": counts["edge"], "label": contract["label"], "window": counts["window"], "has": dict(counts.get("has") or {}),
            "literal": literal}


def day_count_query(plan: dict, start: datetime, end: datetime) -> str:
    render = LITERALS[plan["literal"]]
    filters = "".join(f".has({quote(k)}, {quote(str(v))})" for k, v in sorted(plan["has"].items()))
    return assert_read_only(f"g.E().hasLabel({quote(plan['label'])}){filters}"
                            f".has({quote(plan['window'])}, gte({render(start)})).has({quote(plan['window'])}, lt({render(end)})).count()")


def edge_days(args, source=None) -> dict:
    """{slice: {day: count}} of the windowed edge, one bounded count per UTC day, newest first."""
    from datetime import timedelta
    if not 1 <= args.lookback_days <= MAX_LOOKBACK_DAYS:
        raise SilvallyError(f"--lookback-days must be 1..{MAX_LOOKBACK_DAYS} (a bounded read)")
    plan = day_count_plan(read_json(args.contracts), read_json(args.catalog)["slices"][args.slice])
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    end_day = parse_loose(args.end_day + "T00:00:00Z") if args.end_day else today - timedelta(days=1)
    source = source or GremlinSource(persist_query_fn(args.profile, args.region, args.timeout_seconds), 1, args.retries, args.backoff_seconds)
    counts = {}
    for offset in range(args.lookback_days):
        start = end_day - timedelta(days=offset)
        rows = source.attempt(day_count_query(plan, start, start + timedelta(days=1)))
        counts[start.strftime("%Y-%m-%d")] = int(rows[0]) if rows else 0
    write_json(args.out, {args.slice: counts})
    return {"slice": args.slice, "source": "prod-persist-gremlin", "prodAccess": "read-only", "edge": plan["dataset"],
            "window": plan["window"], "filters": plan["has"], "literal": plan["literal"], "lookbackDays": args.lookback_days,
            "byUtcDay": counts, "daysWithEdges": sum(1 for n in counts.values() if n), "out": args.out,
            "queries": getattr(source, "stats", {}).get("queries")}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    days = sub.add_parser("edge-days")
    days.add_argument("--contracts", required=True, help="resolve-transform-intent.py contracts output for the mapping")
    days.add_argument("--catalog", required=True, help="reference/prod-actuals.json or a profile's equivalent")
    days.add_argument("--slice", required=True)
    days.add_argument("--profile", required=True, help="operator's PROD read-only profile")
    days.add_argument("--region", default=DEFAULT_REGION)
    days.add_argument("--end-day", help="newest UTC day counted (default: yesterday, the most recent complete UTC day)")
    days.add_argument("--lookback-days", type=int, default=14)
    days.add_argument("--retries", type=int, default=4)
    days.add_argument("--backoff-seconds", type=float, default=2.0)
    days.add_argument("--timeout-seconds", type=float, default=60.0)
    days.add_argument("--out", required=True, help='{"<slice>": {"YYYY-MM-DD": edges}} for source_window.py data-days --input-days')
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
            p.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE,
                           help="keys or ids per Gremlin page (default 10; PROD Persist times out on a few dozen debts)")
            p.add_argument("--retries", type=int, default=4, help="retries of a page on HTTP 429/5xx or a timeout")
            p.add_argument("--backoff-seconds", type=float, default=2.0, help="first retry delay; doubles per retry")
            p.add_argument("--timeout-seconds", type=float, default=60.0, help="per-request timeout")
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
    if args.command == "edge-days":
        print(json.dumps(edge_days(args), indent=1))
        return 0
    summary = build(args)
    print(json.dumps(summary, indent=1))
    return 0 if summary["status"] == "BUILT" else 1


if __name__ == "__main__":
    raise SystemExit(main())
