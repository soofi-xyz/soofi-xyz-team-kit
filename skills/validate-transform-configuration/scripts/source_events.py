#!/usr/bin/env python3
"""Build a chained validation's first input from real PROD events, read-only, catalog-driven.

  source_events.py days --catalog chain-sources.json --source NAME --slice SLICE --profile <prod-profile>
      [--end-day YYYY-MM-DD] [--lookback-days 14] [--region R] --out source-days.json
      Phase 1: per-UTC-day object counts of the source's listing prefix, per family (list only, no object read).
      --out is {"<slice>": {"YYYY-MM-DD": objects of the catalog daySelection.requiredFamilies}}, usable both as
      source_window.py data-days --slice-days and --input-days (the events are the input and the baseline).
  source_events.py build --catalog chain-sources.json --source NAME --slice SLICE --day YYYY-MM-DD --stage canary|full
      --profile <prod-profile> --owner-decisions decisions.json --dev-prefix s3://<dev-bucket>/<staging prefix>/
      [--lookup-rows NAME=rows.jsonl ...] [--canary-scan-limit 500] --private-dir DIR --package-dir PKG --out summary.json
      Lists the window day's folder (and the catalog's spill days), downloads only objects of declared families, explodes
      each document into observations (family `rows` path), keeps those whose time field lies in [day, day + 1), and
      resolves the catalog lookups in order: a DynamoDB batch-get (read-only), an S3 JSON object selected by a key
      template, an S3 artifact copied byte-for-byte into PKG/artifacts/<sha256 of its URI>/<basename> (its DEV location
      under --dev-prefix becomes the artifact URI, its SHA-256 is computed from the bytes), and a rows-file lookup
      (for example a key-bounded iceberg_snapshot_read.py read). Fields come from the catalog's declarative expressions
      (catalog_expressions.py); quarantine rules give each dropped observation one counted reason. The canary
      orders observations deterministically (round-robin over the outcome groups, each by time and the SHA-256 of the
      key, as prod_actuals.py canary-sample does) and resolves them in pages until it holds 10 accepted rows.
      A rows-file lookup that is not supplied stops the build with LOOKUP_ROWS_REQUIRED after writing the keys to
      DIR/lookup-keys/<NAME>.txt and the catalog's read command; resolved lookups are cached in DIR so the rerun reads
      PROD only for what is missing. PKG/<table>/part-00000.jsonl holds the accepted rows (sorted canonical JSON).
      The summary doubles as evaluate_run.py --canary-sample (slice, eventsSelected, selectionDigest, byOutcome).
  source_events.py expect --chains chains.json --chain ID --build-summary summary.json --private-dir DIR --package-dir PKG
      --dev-prefix s3://... --private-out expected.jsonl --baseline-out baseline.json --out expect.json
      The compare step's expected target rows from the accepted source rows: each row is either excluded by the first
      matching catalog exclusion (counted per category) or mapped by the catalog field expressions, bodies hydrated
      from the package's artifact copies (SHA-256 verified). Duplicate keys collapse to one row (counted). --baseline-out
      is the PROD-actuals baseline record for evaluate_run.py --prod-actuals (baselineKind source-events).

A source whose catalog lists sensitiveFields is built only under the owner's sensitiveFieldStaging decision
(stage-real-values-to-dev); otherwise build stops with SensitiveStagingDecisionRequired before any PROD read.
Rows stay in --private-dir and --package-dir (mode 0700, outside any repository); stdout carries counts only.
Stage PKG with stage_evidence_package.py under its own approval (or the owner's blanketDevWrites).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import copy
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from catalog_expressions import condition, evaluate, lookup, phone10, text
from graph_inputs import select_body
from prod_actuals import canary_select, parse_loose, read_jsonl, write_jsonl
from silvally_io import DEFAULT_REGION, SilvallyError, aws, parse_s3, private_dir, read_json, sha256_file, write_json

SENSITIVE_DECISION = "stage-real-values-to-dev"
MAX_LOOKBACK_DAYS = 31
CACHE = "resolved-{stage}-{day}.json"


def load_source(path: str, name: str) -> dict:
    sources = read_json(path).get("sources") or {}
    if name not in sources:
        raise SilvallyError(f"source {name!r} is not in {path} (known: {sorted(sources)})")
    return sources[name]


class Prod:
    """Read-only PROD access through the aws CLI (silvally_io refuses every write verb)."""

    def __init__(self, profile: str, region: str, work: Path):
        self.profile, self.region, self.work = profile, region, work
        self.stats = Counter()

    def list(self, bucket: str, prefix: str) -> list[dict]:
        page = aws(["s3api", "list-objects-v2", "--bucket", bucket, "--prefix", prefix], profile=self.profile, region=self.region,
                   environment="prod")
        self.stats["listCalls"] += 1
        return [{"key": o["Key"], "bytes": o.get("Size", 0)} for o in page.get("Contents", [])]

    def get(self, bucket: str, key: str) -> bytes:
        target = self.work / hashlib.sha256(f"{bucket}/{key}".encode()).hexdigest()
        aws(["s3", "cp", f"s3://{bucket}/{key}", str(target), "--quiet"], profile=self.profile, region=self.region,
            environment="prod", output_json=False)
        data = target.read_bytes()
        target.unlink()
        self.stats["objectGets"] += 1
        self.stats["objectBytes"] += len(data)
        return data

    def content_type(self, bucket: str, key: str) -> str:
        head = aws(["s3api", "head-object", "--bucket", bucket, "--key", key], profile=self.profile, region=self.region,
                   environment="prod")
        return text(head.get("ContentType")).split(";")[0].strip()

    def table(self, prefix: str) -> str:
        names = aws(["dynamodb", "list-tables"], profile=self.profile, region=self.region, environment="prod").get("TableNames", [])
        found = [n for n in names if n.startswith(prefix)]
        if len(found) != 1:
            raise SilvallyError(f"expected exactly one PROD table named {prefix}*, found {found}")
        return found[0]

    def batch_get(self, table: str, attribute: str, keys: list[str]) -> dict[str, dict]:
        out, pending = {}, [{attribute: {"S": k}} for k in keys]
        for _ in range(5):
            if not pending:
                break
            result = aws(["dynamodb", "batch-get-item", "--request-items", json.dumps({table: {"Keys": pending}})],
                         profile=self.profile, region=self.region, environment="prod")
            self.stats["batchGetCalls"] += 1
            for item in (result.get("Responses") or {}).get(table, []):
                record = unmarshal({"M": item})
                out[text(record.get(attribute))] = record
            pending = ((result.get("UnprocessedKeys") or {}).get(table) or {}).get("Keys") or []
        if pending:
            raise SilvallyError(f"DynamoDB left {len(pending)} keys unprocessed after retries")
        return out


def unmarshal(value: dict):
    kind, raw = next(iter(value.items()))
    if kind == "M":
        return {k: unmarshal(v) for k, v in raw.items()}
    if kind == "L":
        return [unmarshal(v) for v in raw]
    if kind == "N":
        return int(raw) if raw.lstrip("-").isdigit() else float(raw)
    if kind in ("SS", "NS", "BS"):
        return list(raw)
    if kind == "NULL":
        return None
    return raw


def days(args, prod: Prod | None = None) -> dict:
    source = load_source(args.catalog, args.source)
    listing = source["readMethod"]["listing"]
    required = source["daySelection"]["requiredFamilies"]
    if not 1 <= args.lookback_days <= MAX_LOOKBACK_DAYS:
        raise SilvallyError(f"--lookback-days must be 1..{MAX_LOOKBACK_DAYS} (a bounded listing)")
    prod = prod or Prod(args.profile, args.region, private_dir(Path(args.out).parent / ".source-days-work"))
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    end = parse_loose(args.end_day + "T00:00:00Z") if args.end_day else today - timedelta(days=1)
    counts, families = {}, {}
    for offset in range(args.lookback_days):
        day = (end - timedelta(days=offset)).strftime("%Y-%m-%d")
        objects = prod.list(listing["bucket"], listing["prefix"].format(day=day))
        by_family = Counter(family_of(o["key"], source) for o in objects)
        families[day] = dict(sorted(by_family.items()))
        counts[day] = sum(by_family[f] for f in required)
    write_json(args.out, {args.slice: counts})
    return {"slice": args.slice, "source": args.source, "prodAccess": "read-only", "requiredFamilies": required,
            "byUtcDay": counts, "byFamily": families, "daysWithData": sum(1 for n in counts.values() if n), "out": args.out}


def family_of(key: str, source: dict) -> str:
    name = key.rsplit("/", 1)[-1]
    for family in list(source["families"]) + list(source.get("excludedFamilies") or {}):
        if name.startswith(family):
            return family
    return "UNDECLARED"


def observations(source: dict, day: str, prod: Prod) -> tuple[list[dict], dict]:
    listing = source["readMethod"]["listing"]
    start = parse_loose(day + "T00:00:00Z")
    end = start + timedelta(days=1)
    seen, out, stats = set(), [], {"objects": Counter(), "excludedFamilyObjects": Counter(), "outsideWindow": 0, "documentsRead": 0}
    for offset in listing.get("dayFolders", [0]):
        folder = (start + timedelta(days=offset)).strftime("%Y-%m-%d")
        for obj in prod.list(listing["bucket"], listing["prefix"].format(day=folder)):
            family = family_of(obj["key"], source)
            if family not in source["families"]:
                stats["excludedFamilyObjects"][family] += 1
                continue
            if obj["key"] in seen:
                continue
            seen.add(obj["key"])
            stats["objects"][family] += 1
            document = json.loads(prod.get(listing["bucket"], obj["key"]))
            stats["documentsRead"] += 1
            spec = source["families"][family]
            rows = lookup(document, spec["rows"]) if spec.get("rows") else [document]
            head = without(document, spec.get("rows"))
            for index, row in enumerate(rows if isinstance(rows, list) else []):
                scope = {"doc": head, "row": row}
                moment = parse_loose(evaluate(spec["fields"][spec["timeField"]], scope))
                if moment is None or not (start <= moment < end):
                    stats["outsideWindow"] += 1
                    continue
                preview = {f: evaluate(spec["fields"][f], scope) for f in canary_fields(source, spec) if f in spec["fields"]}
                out.append({"family": family, "object": obj["key"], "index": index, "doc": head, "row": row, "preview": preview})
    return out, {k: dict(v) if isinstance(v, Counter) else v for k, v in stats.items()}


def canary_fields(source: dict, spec: dict) -> list[str]:
    """The fields the deterministic canary order reads (time, key and outcome), computed before any lookup."""
    canary = source.get("canary") or {}
    keys = canary.get("eventKeyField") or []
    return [spec["timeField"], canary.get("eventTimeField"), canary.get("outcomeField"),
            *([keys] if isinstance(keys, str) else keys)]


def without(document: dict, path: str | None) -> dict:
    """The document without its rows array, so each observation carries the envelope once and not every sibling row."""
    if not path:
        return {}
    head = copy.copy(document)
    parts, node = path.split("."), head
    for part in parts[:-1]:
        if not isinstance(node.get(part), dict):
            return head
        node[part] = copy.copy(node[part])
        node = node[part]
    node.pop(parts[-1], None)
    return head


class Resolver:
    """The catalog lookups of one source, cached per key, read-only against PROD."""

    def __init__(self, source: dict, prod: Prod, package: Path, dev_prefix: str, rows_files: dict[str, str]):
        self.source, self.prod, self.package, self.dev_prefix = source, prod, package, dev_prefix
        self.rows_files, self.tables, self.cache = rows_files, {}, {"objects": {}, "artifacts": {}}
        self.row_lookups = {name: self.load_rows(name, spec) for name, spec in source["lookups"].items()
                            if spec["kind"] == "rows-file" and name in rows_files}

    def load_rows(self, name: str, spec: dict) -> dict[str, str]:
        values: dict[str, set] = {}
        normalize = phone10 if spec.get("keyNormalize") == "phone10" else (lambda v: text(v).strip())
        for row in read_jsonl(self.rows_files[name]):
            values.setdefault(normalize(row.get(spec["keyColumn"])), set()).add(text(row.get(spec["valueColumn"])).strip().upper())
        reduce, valid = spec.get("reduce") or {}, set(spec.get("valid") or [])
        out = {}
        for key, found in values.items():
            good = found & valid if valid else found
            if len(good) == 1:
                out[key] = next(iter(good))
            elif len(good) > 1:
                out[key] = reduce.get("conflict", "")
            else:
                out[key] = reduce.get("none", "")
        out[""] = reduce.get("none", "")
        return out

    def resolve(self, batch: list[dict]) -> None:
        """Bind every non-rows lookup into each observation's scope (in catalog order)."""
        for name, spec in self.source["lookups"].items():
            wanted = [o for o in batch if name in self.source["families"][o["family"]].get("lookups", [])]
            if not wanted or spec["kind"] == "rows-file":
                continue
            if spec["kind"] == "dynamodb-batch-get":
                table = self.tables.setdefault(name, self.prod.table(spec["tableNamePrefix"]))
                keys = sorted({text(evaluate(spec["key"], scope_of(o))) for o in wanted} - {""})
                found = {}
                for i in range(0, len(keys), spec.get("pageSize", 100)):
                    found.update(self.prod.batch_get(table, spec["keyAttribute"], keys[i:i + spec.get("pageSize", 100)]))
                for o in wanted:
                    o.setdefault("bound", {})[spec["bind"]] = found.get(text(evaluate(spec["key"], scope_of(o))), {})
            elif spec["kind"] == "s3-json-select":
                for o in wanted:
                    scope = scope_of(o)
                    if any(not text(lookup(scope, r)).strip() for r in spec.get("requires", [])):
                        o.setdefault("bound", {})[spec["bind"]] = {}
                        continue
                    key = evaluate(spec["key"], scope)
                    if key not in self.cache["objects"]:
                        try:
                            self.cache["objects"][key] = json.loads(self.prod.get(spec["bucket"], key))
                        except (SilvallyError, ValueError):
                            self.cache["objects"][key] = None
                    document = self.cache["objects"][key] or {}
                    want = text(evaluate(spec["select"]["equals"], scope))
                    items = lookup(document, spec["select"]["array"]) or []
                    match = next((i for i in items if isinstance(i, dict) and text(i.get(spec["select"]["match"])) == want and want), {})
                    o.setdefault("bound", {})[spec["bind"]] = match
            elif spec["kind"] == "s3-artifact":
                for o in wanted:
                    uri = text(evaluate(spec["uri"], scope_of(o))).strip()
                    o.setdefault("artifact", {})
                    if uri:
                        o["artifact"] = self.artifact(uri, spec)
            else:
                raise SilvallyError(f"unknown lookup kind {spec['kind']!r}")

    def artifact(self, uri: str, spec: dict) -> dict:
        if uri in self.cache["artifacts"]:
            return self.cache["artifacts"][uri]
        record = {}
        try:
            bucket, key = parse_s3(uri)
            data = self.prod.get(bucket, key)
            content_type = self.prod.content_type(bucket, key)
            selector = (spec.get("selectorByContentType") or {}).get(content_type)
            if selector:
                rel = f"artifacts/{hashlib.sha256(uri.encode()).hexdigest()}/{key.rsplit('/', 1)[-1] or 'object'}"
                target = self.package / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                names = spec["fields"]
                record = {names["uri"]: self.dev_prefix + rel, names["contentType"]: content_type,
                          names["sha256"]: hashlib.sha256(data).hexdigest(), names["selector"]: selector}
        except SilvallyError:
            record = {}
        self.cache["artifacts"][uri] = record
        return record


def scope_of(observation: dict, out: dict | None = None, lookups: dict | None = None) -> dict:
    return {"doc": observation["doc"], "row": observation["row"], **(observation.get("bound") or {}),
            "out": out or {}, "lookup": lookups or {}}


def rows_fields(source: dict) -> dict[str, str]:
    """field -> rows-file lookup name, for fields whose expression reads lookup.<name>."""
    names = {n for n, s in source["lookups"].items() if s["kind"] == "rows-file"}
    out = {}
    for spec in source["families"].values():
        for field, expr in spec["fields"].items():
            path = expr.get("path", "") if isinstance(expr, dict) else ""
            if path.startswith("lookup.") and path.split(".", 1)[1] in names:
                out[field] = path.split(".", 1)[1]
    return out


def finish(observation: dict, source: dict, rows_lookups: dict | None) -> tuple[dict | None, str | None]:
    """The accepted row of one resolved observation, or its quarantine reason. rows_lookups None checks only the
    quarantine rules (the canary's acceptance test before the rows-file lookups are read)."""
    spec = source["families"][observation["family"]]
    enums = source.get("enums") or {}
    from_rows = rows_fields(source)
    out = finish_fields(observation, source)
    for rule in spec.get("quarantine", []):
        if condition(rule["when"], scope_of(observation, out), enums):
            return None, rule["reason"]
    if rows_lookups is None:
        return out, None
    for field, name in from_rows.items():
        if field in spec["fields"]:
            spec_lookup = source["lookups"][name]
            table = rows_lookups.get(name, {})
            key = text(evaluate({"path": spec_lookup["keysFrom"]}, scope_of(observation, out)))
            out[field] = table.get(key, table.get(""))
    out.update(observation.get("artifact") or {})
    missing = [f for f in source.get("requiredFields", []) if f not in out or out[f] in (None, "")]
    if missing:
        return None, "missing_required_field"
    return {k: v for k, v in out.items() if v is not None}, None


def canonical(row: dict) -> str:
    return json.dumps(row, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def build(args, prod: Prod | None = None) -> dict:
    source = load_source(args.catalog, args.source)
    decisions = read_json(args.owner_decisions) if args.owner_decisions else {}
    sensitive = source.get("sensitiveFields")
    if sensitive and decisions.get("sensitiveFieldStaging") != SENSITIVE_DECISION:
        raise SilvallyError(f"SensitiveStagingDecisionRequired: source {args.source} stages {sensitive.get('inputs')} to DEV; the "
                            "owner must decide sensitiveFieldStaging: stage-real-values-to-dev (state it up front or approve it when asked)")
    if not args.dev_prefix.startswith("s3://") or not args.dev_prefix.endswith("/"):
        raise SilvallyError("--dev-prefix must be the DEV staging prefix ending in / (the package is uploaded there)")
    private, package = private_dir(args.private_dir), private_dir(args.package_dir)
    prod = prod or Prod(args.profile, args.region, private_dir(private / "work"))
    rows_files = dict(r.split("=", 1) for r in args.lookup_rows or [])
    cache_path = private / CACHE.format(stage=args.stage, day=args.day)
    resolver = Resolver(source, prod, package, args.dev_prefix, rows_files)
    if cache_path.exists():
        cached = read_json(cache_path)
        selected, read_stats, scanned = cached["observations"], cached["readStats"], cached["scanned"]
    else:
        found, read_stats = observations(source, args.day, prod)
        canary = source.get("canary") or {}
        ordered = canary_select([{**o, **o["preview"]} for o in found], canary.get("eventTimeField", "effective_at"),
                                canary.get("eventKeyField", ["provider_message_identifier"]), canary.get("outcomeField"), len(found))
        selected, scanned = [], 0
        limit = len(ordered) if args.stage == "full" else min(len(ordered), args.canary_scan_limit)
        per_slice = canary.get("perSlice", 10)
        page = 100 if args.stage == "full" else per_slice
        while scanned < limit and (args.stage == "full" or sum(1 for o in selected if o.get("accepted")) < per_slice):
            batch = ordered[scanned:min(limit, scanned + page)]
            scanned += len(batch)
            resolver.resolve(batch)
            for o in batch:
                _, reason = finish(o, source, None)
                o["accepted"] = reason is None
                if args.stage == "canary" and o["accepted"] and sum(1 for x in selected if x.get("accepted")) >= per_slice:
                    continue
                selected.append(o)
        if args.stage == "canary":
            selected = [o for o in selected if o.get("accepted")][:per_slice] + [o for o in selected if not o.get("accepted")]
        write_json(cache_path, {"observations": selected, "readStats": read_stats, "scanned": scanned})
        cache_path.chmod(0o600)
    missing_rows = [n for n, s in source["lookups"].items() if s["kind"] == "rows-file" and n not in rows_files]
    if missing_rows:
        keys_dir = private_dir(private / "lookup-keys")
        commands = {}
        for name in missing_rows:
            spec = source["lookups"][name]
            values = sorted({text(evaluate({"path": spec["keysFrom"]}, scope_of(o, finish_fields(o, source))))
                             for o in selected if o.get("accepted")} - {""})
            (keys_dir / f"{name}.txt").write_text("".join(v + "\n" for v in values), encoding="utf-8")
            commands[name] = {"keys": len(values), "keysFile": str(keys_dir / f"{name}.txt"), "read": spec.get("read")}
        summary = {"slice": args.slice, "source": args.source, "stage": args.stage, "day": args.day, "status": "LOOKUP_ROWS_REQUIRED",
                   "lookupRowsRequired": commands, "next": "run each read, then rerun build with --lookup-rows NAME=<rows.jsonl>"}
        write_json(args.out, summary)
        return summary
    accepted, quarantine, reasons = [], [], Counter()
    contexts = []
    for o in selected:
        row, reason = finish(o, source, resolver.row_lookups)
        if reason:
            reasons[reason] += 1
            identity = canonical({"family": o["family"], "object": o["object"], "index": o["index"]})
            quarantine.append({"reason": reason, "identitySha256": hashlib.sha256(identity.encode()).hexdigest()})
            continue
        accepted.append(row)
        contexts.append({"row": row, "source": o.get("bound") or {}})
    if args.stage == "canary":
        per_slice = (source.get("canary") or {}).get("perSlice", 10)
        accepted = accepted[:per_slice]
        contexts = contexts[:per_slice]
    table = package / source.get("dataset", "lifecycle")
    table.mkdir(parents=True, exist_ok=True)
    lines = sorted(canonical(r) for r in accepted)
    (table / "part-00000.jsonl").write_text("".join(line + "\n" for line in lines), encoding="utf-8")
    write_jsonl(private / f"quarantine-{args.stage}.jsonl", quarantine)
    write_jsonl(private / f"accepted-sources-{args.stage}.jsonl", contexts)
    keys = [text(r.get("provider_message_identifier")) + "|" + text(r.get("effective_at")) for r in sorted(accepted, key=canonical)]
    outcome = (source.get("canary") or {}).get("outcomeField")
    summary = {"slice": args.slice, "source": args.source, "language": source.get("language"), "dataset": source.get("dataset"),
               "stage": args.stage, "day": args.day, "prodAccess": "read-only", "window": {"start": args.day + "T00:00:00Z",
               "endExclusive": (parse_loose(args.day + "T00:00:00Z") + timedelta(days=1)).strftime("%Y-%m-%dT00:00:00Z")},
               "observationsResolved": len(selected), "observationsScanned": scanned, "readStats": read_stats,
               "accepted": len(accepted), "quarantine": dict(sorted(reasons.items())),
               "artifactsCopied": sum(1 for v in resolver.cache["artifacts"].values() if v),
               "eventsSelected": len(accepted), "perSlice": (source.get("canary") or {}).get("perSlice", 10) if args.stage == "canary" else None,
               "byOutcome": dict(Counter(text(r.get(outcome)) for r in accepted)) if outcome else {},
               "selectionDigest": "sha256:" + hashlib.sha256("\n".join(keys).encode()).hexdigest(),
               "packageDir": str(package), "devPrefix": args.dev_prefix,
               "rowsSha256": "sha256:" + sha256_file(table / "part-00000.jsonl"),
               "prodReads": dict(prod.stats), "sensitiveFieldStaging": decisions.get("sensitiveFieldStaging") if sensitive else "not-applicable",
               "status": "BUILT" if accepted else "INPUT_EMPTY"}
    if not accepted:
        summary["inputEmpty"] = {"code": "UpstreamInputEmpty", "datasets": [source.get("dataset")],
                                 "detail": "no observation of the day was accepted (see quarantine)"}
    write_json(args.out, summary)
    return summary


def finish_fields(observation: dict, source: dict) -> dict:
    """Every field that does not come from a rows-file lookup, with the catalog's status aliases applied."""
    spec = source["families"][observation["family"]]
    from_rows = rows_fields(source)
    out = {}
    for name, expr in spec["fields"].items():
        if name not in from_rows:
            out[name] = evaluate(expr, scope_of(observation, out))
    if "canonical_status" in out:
        status = text(out["canonical_status"])
        out["canonical_status"] = (source.get("statusAliases") or {}).get(status, status)
    return out


def body_of(row: dict, package: Path, dev_prefix: str, names: dict) -> str | None:
    uri = text(row.get(names["uri"]))
    if not uri.startswith(dev_prefix):
        return None
    path = package / uri[len(dev_prefix):]
    if not path.exists():
        return None
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != text(row.get(names["sha256"])):
        raise SilvallyError("ArtifactDigestMismatch: a packaged artifact does not match its recorded SHA-256")
    return select_body(data, text(row.get(names["selector"])))


def expect(args) -> dict:
    chain = (read_json(args.chains).get("chains") or {}).get(args.chain)
    if not chain:
        raise SilvallyError(f"chain {args.chain!r} is not in {args.chains}")
    compare = next(s for s in chain["steps"] if s["kind"] == "compare")
    source_step = next(s for s in chain["steps"] if s["id"] == compare["baseline"])
    sources_path = Path(args.chains).parent / source_step["catalog"]
    source = load_source(str(sources_path), source_step["source"])
    rule = compare["expectation"]
    built = read_json(args.build_summary)
    stage = built["stage"]
    names = next(s["fields"] for s in source["lookups"].values() if s["kind"] == "s3-artifact")
    contexts = read_jsonl(Path(args.private_dir) / f"accepted-sources-{stage}.jsonl")
    package = Path(args.package_dir)
    excluded, gaps, expected, keys, duplicates = Counter(), Counter(), [], set(), 0
    for entry in contexts:
        row = entry["row"]
        body = body_of(row, package, args.dev_prefix, names)
        scope = {"row": row, "body": body, "source": entry.get("source") or {}}
        category = next((e["category"] for e in rule["exclusions"] if condition(e["when"], scope, source.get("enums"))), None)
        if category:
            excluded[category] += 1
            continue
        for gap in rule.get("coverageGaps", []):
            if condition(gap["when"], scope, source.get("enums")):
                gaps[gap["code"]] += 1
        target = {name: text(evaluate(expr, scope)) for name, expr in rule["fields"].items()}
        key = tuple(target[k] for k in rule["key"])
        if key in keys:
            duplicates += 1
            continue
        keys.add(key)
        expected.append(target)
    out = Path(args.private_out)
    private_dir(out.parent)
    write_jsonl(out, sorted(expected, key=canonical))
    summary = {"slice": chain["slice"], "chain": args.chain, "stage": stage, "dataset": compare["output"]["dataset"],
               "sourceAccepted": len(contexts), "expectedRows": len(expected), "exclusions": dict(sorted(excluded.items())),
               "duplicateKeysCollapsed": duplicates, "quarantine": built.get("quarantine", {}), "coverageGaps": dict(sorted(gaps.items())),
               "rulesFrom": rule.get("rulesFrom"), "expectedSha256": "sha256:" + sha256_file(out)}
    write_json(args.out, summary)
    write_json(args.baseline_out, {"slice": chain["slice"], "baselineKind": "source-events", "status": "AVAILABLE" if contexts else "EMPTY",
                                   "source": source_step["source"], "stage": stage, "day": built.get("day"),
                                   "rows": len(expected), "detail": "expected rows derived from the PROD source events by the chain's "
                                   "documented mapping rules (chains.json compare.expectation)"})
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("days")
    p.add_argument("--catalog", required=True)
    p.add_argument("--source", required=True)
    p.add_argument("--slice", required=True)
    p.add_argument("--profile", required=True, help="operator's PROD read-only profile")
    p.add_argument("--region", default=DEFAULT_REGION)
    p.add_argument("--end-day", help="newest UTC day counted (default: yesterday)")
    p.add_argument("--lookback-days", type=int, default=14)
    p.add_argument("--out", required=True)
    p = sub.add_parser("build")
    p.add_argument("--catalog", required=True)
    p.add_argument("--source", required=True)
    p.add_argument("--slice", required=True)
    p.add_argument("--day", required=True, help="the confirmed UTC day (YYYY-MM-DD)")
    p.add_argument("--stage", choices=("canary", "full"), required=True)
    p.add_argument("--profile", required=True, help="operator's PROD read-only profile")
    p.add_argument("--region", default=DEFAULT_REGION)
    p.add_argument("--owner-decisions", help="ownerDecisions JSON (sensitiveFieldStaging)")
    p.add_argument("--dev-prefix", required=True, help="DEV staging prefix of this package (artifact URIs point under it)")
    p.add_argument("--lookup-rows", action="append", help="NAME=rows.jsonl for a rows-file lookup (repeatable)")
    p.add_argument("--canary-scan-limit", type=int, default=500)
    p.add_argument("--private-dir", required=True)
    p.add_argument("--package-dir", required=True)
    p.add_argument("--out", required=True)
    p = sub.add_parser("expect")
    p.add_argument("--chains", required=True)
    p.add_argument("--chain", required=True)
    p.add_argument("--build-summary", required=True)
    p.add_argument("--private-dir", required=True)
    p.add_argument("--package-dir", required=True)
    p.add_argument("--dev-prefix", required=True)
    p.add_argument("--private-out", required=True)
    p.add_argument("--baseline-out", required=True)
    p.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    if args.command == "days":
        result = days(args)
    elif args.command == "build":
        result = build(args)
    else:
        result = expect(args)
    print(json.dumps(result, indent=1))
    return 0 if result.get("status", "BUILT") in ("BUILT", "LOOKUP_ROWS_REQUIRED") or args.command != "build" else 1


if __name__ == "__main__":
    raise SystemExit(main())
