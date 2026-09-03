#!/usr/bin/env python3
"""Fail-closed county readiness validator for bundled runtime YAML catalogs.

Reads skills/use-oracle/runtime/docs/<county>-sources.yaml (or a fixture path). Prints a JSON
readiness report. Exit 0 only when every gate is PASS, APPROVED_EXCEPTION, or
NOT_APPLICABLE. Any BLOCKED gate exits 1.

onboard-county, county-seed-data, and county-ingest-run (pilot or full) MUST run this
and STOP on a non-zero exit.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

PERMIT_CLASSIFICATIONS = {
    "supported",
    "delegated",
    "manual-only",
    "blocked",
    "unavailable",
    "excluded",
    "custodian-only",
}
UNCLASSIFIED = {"needs-review", None, "", "unclassified"}
REQUEST_REQUIRED_STATUSES = {"blocked", "custodian-only", "manual-only"}
VALID_REQUEST_ROUTES = {"api-first", "records-first"}
GEOMETRY_NULL_POLICY = {"acknowledged", "none"}
CENTRAL_PORTAL_KINDS = {
    "central-submission",
    "supplemental-approval",
    "application-intake",
    "onestop",
}
DEFAULT_DISCREPANCY_THRESHOLD_PCT = 2.0
FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "readiness"
GATE_OWNERS = {
    "catalog_metadata": "county-discovery",
    "parcel": "county-discovery",
    "permit": "county-discovery / county-permit-adapter",
    "destination": "bootstrap-oracle-infra / query-db-loading-matching",
    "enrichment": "bbb-harvest",
}
SAFE_PREPARATION_ACTIONS = [
    "Continue bounded source and jurisdiction enumeration",
    "Continue adapter fingerprinting, scaffolds, fixtures, and bounded tests",
    "Continue AWS BBB runtime, Neon destination, and Filebase/IPNS readiness",
    "Prepare named API or records requests for blocked sources",
]
READY_AUTO_ADVANCE_ACTION = (
    "Start the next dependency-ready stage from the durable run manifest "
    "without operator confirmation"
)


def _parse_scalar(raw: str):
    value = raw.strip()
    if not value or value in {"null", "~", "None"}:
        return None
    if value in {"true", "True", "yes"}:
        return True
    if value in {"false", "False", "no"}:
        return False
    if (value.startswith('"') and value.endswith('"')) or (
        value.startswith("'") and value.endswith("'")
    ):
        return value[1:-1]
    try:
        if value.startswith("0") and value.isdigit() and len(value) > 1:
            return value
        if "." in value:
            return float(value)
        return int(value)
    except ValueError:
        return value


def _strip_comment(line: str) -> str:
    in_single = False
    in_double = False
    out = []
    for char in line:
        if char == "'" and not in_double:
            in_single = not in_single
        elif char == '"' and not in_single:
            in_double = not in_double
        elif char == "#" and not in_single and not in_double:
            break
        out.append(char)
    return "".join(out).rstrip()


def load_simple_yaml(text: str):
    """Indent-based subset: maps, lists of maps/scalars, comments, scalars."""
    lines = []
    for raw in text.splitlines():
        stripped = _strip_comment(raw)
        if stripped.strip():
            lines.append(stripped)

    root: dict = {}
    stack: list[tuple[int, object]] = [(-1, root)]

    def current_container():
        return stack[-1][1]

    i = 0
    while i < len(lines):
        line = lines[i]
        indent = len(line) - len(line.lstrip(" "))
        content = line.strip()
        while len(stack) > 1 and indent <= stack[-1][0]:
            stack.pop()
        parent = current_container()

        if content.startswith("- "):
            item_text = content[2:].strip()
            if not isinstance(parent, list):
                raise ValueError(f"list item without list parent: {content}")
            if ":" in item_text and not item_text.startswith("{") and not (
                item_text.startswith("'") or item_text.startswith('"')
            ):
                key, _, rest = item_text.partition(":")
                entry = {key.strip(): _parse_scalar(rest)}
                parent.append(entry)
                stack.append((indent, entry))
            else:
                parent.append(_parse_scalar(item_text) if item_text else {})
                if item_text == "" or item_text.endswith(":"):
                    stack.append((indent, parent[-1]))
        elif ":" in content:
            key, _, rest = content.partition(":")
            key = key.strip()
            rest = rest.strip()
            if not isinstance(parent, dict):
                raise ValueError(f"mapping entry without map parent: {content}")
            if rest in {"", "|", ">"}:
                next_indent = None
                if i + 1 < len(lines):
                    next_indent = len(lines[i + 1]) - len(lines[i + 1].lstrip(" "))
                if next_indent is not None and next_indent > indent:
                    nxt = lines[i + 1].strip()
                    child: object = [] if nxt.startswith("- ") else {}
                    parent[key] = child
                    stack.append((indent, child))
                else:
                    parent[key] = None
            else:
                parent[key] = _parse_scalar(rest)
        else:
            raise ValueError(f"unsupported YAML line: {content}")
        i += 1
    return root


def load_catalog(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore

        data = yaml.safe_load(text)
    except ImportError:
        data = load_simple_yaml(text)
    if not isinstance(data, dict):
        raise ValueError(f"{path}: catalog root must be a mapping")
    return data


def _gate(name: str, status: str, evidence: str, action: str | None = None) -> dict:
    return {
        "gate": name,
        "status": status,
        "evidence": evidence,
        "required_action": action,
    }


def _approved(catalog: dict, gate: str) -> dict | None:
    for item in catalog.get("approved_exceptions") or []:
        if isinstance(item, dict) and item.get("gate") == gate and item.get("reason"):
            return item
    return None


def _identity_sources(raw: object) -> list[str]:
    if isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]
    if isinstance(raw, str):
        return [part.strip() for part in raw.split(",") if part.strip()]
    return []


def _records_request_complete(row: dict) -> bool:
    req = row.get("records_request")
    if not isinstance(req, dict):
        return False
    office = str(req.get("recipient_office") or "").strip()
    scope = str(req.get("system_scope") or "").strip()
    route = str(req.get("route") or "").strip()
    portal = str(req.get("request_portal_url") or "").strip()
    email = str(req.get("request_email") or "").strip()
    return bool(office and scope and route in VALID_REQUEST_ROUTES and (portal or email))


def _as_number(value) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def evaluate(catalog: dict) -> dict:
    gates = []

    required = ["county", "state", "slug", "fips"]
    missing = [field for field in required if not catalog.get(field)]
    if missing:
        gates.append(
            _gate(
                "catalog_metadata",
                "BLOCKED",
                f"missing required fields: {', '.join(missing)}",
                "Fill county, state, slug, and FIPS in docs/<county>-sources.yaml",
            )
        )
    else:
        gates.append(
            _gate(
                "catalog_metadata",
                "PASS",
                f"{catalog['county']} {catalog['state']} slug={catalog['slug']} fips={catalog['fips']}",
            )
        )

    parcel = catalog.get("parcel") or {}
    gis = _as_number(parcel.get("gis_feature_count"))
    assessed = _as_number(parcel.get("assessed_parcel_count"))
    threshold = _as_number(parcel.get("discrepancy_threshold_pct"))
    if threshold is None:
        threshold = DEFAULT_DISCREPANCY_THRESHOLD_PCT
    canonical = (parcel.get("canonical_source") or "").strip().lower()
    exception = _approved(catalog, "parcel")
    parcel_reasons: list[str] = []
    discrepancy_pct = None

    if assessed is None:
        parcel_reasons.append(
            "canonical assessed-property count is missing; GIS is not a substitute denominator"
        )
    else:
        if gis is not None and assessed > 0:
            discrepancy_pct = abs(gis - assessed) / assessed * 100.0
        counts_differ = gis is not None and gis != assessed
        if counts_differ and not str(parcel.get("discrepancy_explanation") or "").strip():
            parcel_reasons.append(
                "GIS and assessed counts differ but parcel.discrepancy_explanation is missing"
            )
        if (
            gis is not None
            and gis < assessed
            and str(parcel.get("separately_assessed_without_geometry") or "").strip().lower()
            not in GEOMETRY_NULL_POLICY
        ):
            parcel_reasons.append(
                "GIS count is below assessed count; catalog must set "
                "parcel.separately_assessed_without_geometry to acknowledged or none "
                "(condos and other units without unique polygons)"
            )
        unresolved = (
            discrepancy_pct is not None
            and discrepancy_pct > threshold
            and exception is None
        )
        gis_only = canonical in {"gis", "geometry", "polygon"} and exception is None
        if unresolved or (
            gis_only and discrepancy_pct is not None and discrepancy_pct > threshold
        ):
            pretty = f"{discrepancy_pct:.1f}" if discrepancy_pct is not None else "unknown"
            parcel_reasons.append(
                f"GIS {gis} vs assessed {assessed} is approximately {pretty}% "
                f"(threshold {threshold}%); unresolved material discrepancy; "
                "GIS-only seeding is not allowed"
            )
    if parcel_reasons and exception is None:
        gates.append(
            _gate(
                "parcel",
                "BLOCKED",
                "; ".join(parcel_reasons),
                "Record tax-roll/NAL counts, explain any GIS gap, address geometry-null units, and do not seed from GIS alone when the gap is material",
            )
        )
    elif exception and parcel_reasons:
        gates.append(
            _gate(
                "parcel",
                "APPROVED_EXCEPTION",
                f"{exception.get('reason')} (discrepancy {discrepancy_pct:.1f}%)"
                if discrepancy_pct is not None
                else str(exception.get("reason")),
            )
        )
    else:
        pretty = f"{discrepancy_pct:.2f}%" if discrepancy_pct is not None else "n/a"
        gates.append(
            _gate(
                "parcel",
                "PASS",
                f"canonical={canonical or 'tax_roll'} assessed={assessed} gis={gis} discrepancy={pretty}",
            )
        )

    permits = catalog.get("permits") or {}
    jurisdictions = permits.get("jurisdictions") or []
    expected = permits.get("expected_jurisdiction_count")
    permit_exception = _approved(catalog, "permit")
    permit_reasons: list[str] = []
    unclassified = []
    missing_history_flag = []
    central_as_history = []
    missing_request = []
    if permits.get("assumes_unified_countywide_history") is True:
        permit_reasons.append(
            "assumes_unified_countywide_history is true; a county portal is not every municipality's historical permit source"
        )
    for row in jurisdictions:
        if not isinstance(row, dict):
            unclassified.append("<invalid-row>")
            continue
        status = row.get("status")
        name = row.get("jurisdiction") or "<unnamed>"
        if status in UNCLASSIFIED or status not in PERMIT_CLASSIFICATIONS:
            unclassified.append(name)
        if row.get("historical_records") not in {True, False}:
            missing_history_flag.append(name)
        kind = str(row.get("portal_kind") or "").strip().lower()
        if kind in CENTRAL_PORTAL_KINDS and row.get("historical_records") is True:
            central_as_history.append(name)
        if status in REQUEST_REQUIRED_STATUSES and not _records_request_complete(row):
            missing_request.append(name)
    if expected is None:
        permit_reasons.append("expected_jurisdiction_count is missing")
    elif int(expected) != len(jurisdictions):
        permit_reasons.append(
            f"cataloged {len(jurisdictions)} jurisdictions != expected {expected}"
        )
    if unclassified:
        permit_reasons.append("unclassified: " + ", ".join(unclassified))
    if missing_history_flag:
        permit_reasons.append(
            "historical_records true/false missing for: " + ", ".join(missing_history_flag)
        )
    if central_as_history:
        permit_reasons.append(
            "central-submission/onestop/supplemental portals treated as historical records: "
            + ", ".join(central_as_history)
        )
    if missing_request:
        permit_reasons.append(
            "records_request missing or incomplete for: " + ", ".join(missing_request)
        )
    if permit_reasons and permit_exception is None:
        gates.append(
            _gate(
                "permit",
                "BLOCKED",
                "; ".join(permit_reasons),
                "Enumerate every incorporated, unincorporated, delegated, and predecessor jurisdiction; classify each; catalog records_request for blocked/custodian/manual-only rows; do not treat a county one-stop or application portal as complete municipal history",
            )
        )
    elif permit_exception and permit_reasons:
        gates.append(
            _gate(
                "permit",
                "APPROVED_EXCEPTION",
                str(permit_exception.get("reason")),
            )
        )
    else:
        gates.append(
            _gate(
                "permit",
                "PASS",
                f"{len(jurisdictions)}/{expected} jurisdictions classified",
            )
        )

    destination = catalog.get("destination") or {}
    writes = destination.get("writes_in_scope")
    if writes is False:
        gates.append(
            _gate(
                "destination",
                "NOT_APPLICABLE",
                "writes_in_scope is false",
            )
        )
    elif destination.get("proven") is True:
        sources = _identity_sources(destination.get("independent_identity_sources"))
        if len(sources) < 2:
            gates.append(
                _gate(
                    "destination",
                    "BLOCKED",
                    "destination proven requires two independent identity sources",
                    "Prove destination from two independent sources (for example console project/branch and configured IDs) before writes",
                )
            )
        else:
            gates.append(
                _gate(
                    "destination",
                    "PASS",
                    "destination independently proven",
                )
            )
    else:
        gates.append(
            _gate(
                "destination",
                "BLOCKED",
                "destination is not independently proven",
                "Prove project, branch, endpoint, role, and non-production status before writes",
            )
        )

    enrichment = catalog.get("enrichment") or {}
    bbb = enrichment.get("bbb") if isinstance(enrichment, dict) else None
    if not isinstance(bbb, dict) or not bbb:
        gates.append(_gate("enrichment", "PASS", "no BBB advertised-count claim"))
    else:
        advertised = bbb.get("advertised_listing_count")
        expected_bbb = bbb.get("expected_count")
        try:
            advertised_n = int(advertised) if advertised is not None else None
            expected_n = int(expected_bbb) if expected_bbb is not None else None
        except (TypeError, ValueError):
            advertised_n = None
            expected_n = None
        cap = bbb.get("listing_page_cap")
        acknowledged = bbb.get("cap_acknowledged") is True
        if (
            advertised_n is not None
            and expected_n is not None
            and advertised_n == expected_n
            and (cap is None or not acknowledged)
        ):
            gates.append(
                _gate(
                    "enrichment",
                    "BLOCKED",
                    "BBB expected_count equals advertised_listing_count without listing_page_cap and cap_acknowledged",
                    "Do not treat advertised listing totals as harvestable; record listing_page_cap and cap_acknowledged when expected_count matches the advertised count",
                )
            )
        else:
            gates.append(_gate("enrichment", "PASS", "BBB advertised-count claim is bounded"))

    blocked = [gate for gate in gates if gate["status"] == "BLOCKED"]
    for gate in blocked:
        gate["blocker_owner"] = GATE_OWNERS.get(gate["gate"], "oracle")
    overall = "BLOCKED" if blocked else "PASS"
    next_automated_actions = (
        SAFE_PREPARATION_ACTIONS.copy()
        if blocked
        else [READY_AUTO_ADVANCE_ACTION]
    )
    required_blocker_actions = [
        {
            "gate": gate["gate"],
            "owner": gate["blocker_owner"],
            "required_action": gate["required_action"],
        }
        for gate in blocked
    ]
    return {
        "overall": overall,
        "catalog": {
            "county": catalog.get("county"),
            "slug": catalog.get("slug"),
            "state": catalog.get("state"),
            "fips": str(catalog.get("fips")) if catalog.get("fips") is not None else None,
        },
        "gates": gates,
        "preparation_allowed": True,
        "execution_allowed": overall == "PASS",
        "auto_advance_required": True,
        "required_blocker_actions": required_blocker_actions,
        "next_automated_actions": next_automated_actions,
        "next_automated_action": next_automated_actions[0],
        "next_permissible_automated_action": next_automated_actions[0],
        "seed_allowed": overall == "PASS",
        "ingest_allowed": overall == "PASS",
    }


def validate_path(path: Path) -> tuple[dict, int]:
    catalog = load_catalog(path)
    report = evaluate(catalog)
    report["catalog_path"] = str(path)
    return report, 0 if report["overall"] == "PASS" else 1


def _expect(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def run_self_test() -> int:
    errors: list[str] = []
    cases = [
        (
            "material-gis-assessed-discrepancy.yaml",
            1,
            lambda report: (
                _expect(report["overall"] == "BLOCKED", "material GIS gap must BLOCK", errors),
                _expect(report["seed_allowed"] is False, "material GIS gap must forbid seed", errors),
                _expect(
                    any(
                        gate["gate"] == "parcel" and gate["status"] == "BLOCKED"
                        for gate in report["gates"]
                    ),
                    "material GIS gap must BLOCK the parcel gate",
                    errors,
                ),
                _expect(
                    any(
                        "GIS-only seeding is not allowed" in gate["evidence"]
                        for gate in report["gates"]
                        if gate["gate"] == "parcel"
                    ),
                    "parcel evidence must forbid GIS-only seeding",
                    errors,
                ),
            ),
        ),
        (
            "unclassified-permit-jurisdiction.yaml",
            1,
            lambda report: (
                _expect(
                    any(
                        gate["gate"] == "parcel" and gate["status"] == "PASS"
                        for gate in report["gates"]
                    ),
                    "small reconciled GIS gap may PASS parcel",
                    errors,
                ),
                _expect(
                    any(
                        gate["gate"] == "permit" and gate["status"] == "BLOCKED"
                        for gate in report["gates"]
                    ),
                    "unclassified municipal permit must BLOCK",
                    errors,
                ),
                _expect(report["seed_allowed"] is False, "unclassified permit must forbid seed", errors),
            ),
        ),
        (
            "unified-portal-not-municipal-history.yaml",
            1,
            lambda report: (
                _expect(
                    any(
                        gate["gate"] == "permit" and gate["status"] == "BLOCKED"
                        for gate in report["gates"]
                    ),
                    "unified county portal must not count as municipal history",
                    errors,
                ),
                _expect(report["seed_allowed"] is False, "unified-portal trap must forbid seed", errors),
            ),
        ),
        (
            "ready-minimal.yaml",
            0,
            lambda report: (
                _expect(report["overall"] == "PASS", "ready catalog must PASS", errors),
                _expect(report["seed_allowed"] is True, "ready catalog must allow seed", errors),
                _expect(report["ingest_allowed"] is True, "ready catalog must allow ingest", errors),
                _expect(
                    report["execution_allowed"] is True,
                    "ready catalog must allow execution",
                    errors,
                ),
                _expect(
                    report["next_automated_action"] == READY_AUTO_ADVANCE_ACTION,
                    "ready catalog must auto-advance without operator confirmation",
                    errors,
                ),
            ),
        ),
        (
            "blocked-without-request-route.yaml",
            1,
            lambda report: (
                _expect(
                    any(
                        gate["gate"] == "permit" and gate["status"] == "BLOCKED"
                        for gate in report["gates"]
                    ),
                    "blocked jurisdiction without records_request must BLOCK permit",
                    errors,
                ),
                _expect(
                    any(
                        "records_request missing or incomplete" in gate["evidence"]
                        for gate in report["gates"]
                        if gate["gate"] == "permit"
                    ),
                    "permit evidence must name incomplete records_request",
                    errors,
                ),
                _expect(report["seed_allowed"] is False, "missing records_request must forbid seed", errors),
                _expect(
                    report["preparation_allowed"] is True,
                    "readiness block must allow independent preparation",
                    errors,
                ),
                _expect(
                    report["execution_allowed"] is False,
                    "readiness block must forbid execution",
                    errors,
                ),
                _expect(
                    report["next_automated_actions"] == SAFE_PREPARATION_ACTIONS,
                    "readiness block must return all safe continuation actions",
                    errors,
                ),
                _expect(
                    any(
                        item["gate"] == "permit"
                        and item["owner"] == "county-discovery / county-permit-adapter"
                        for item in report["required_blocker_actions"]
                    ),
                    "blocked permit gate must name its owner",
                    errors,
                ),
            ),
        ),
        (
            "advertised-listing-count-is-not-harvestable.yaml",
            1,
            lambda report: (
                _expect(
                    any(
                        gate["gate"] == "enrichment" and gate["status"] == "BLOCKED"
                        for gate in report["gates"]
                    ),
                    "advertised BBB count without cap acknowledgement must BLOCK enrichment",
                    errors,
                ),
                _expect(
                    any(
                        "advertised_listing_count without listing_page_cap" in gate["evidence"]
                        for gate in report["gates"]
                        if gate["gate"] == "enrichment"
                    ),
                    "enrichment evidence must reject advertised BBB totals",
                    errors,
                ),
                _expect(report["seed_allowed"] is False, "BBB advertised-count trap must forbid seed", errors),
            ),
        ),
    ]
    for filename, expected_exit, check in cases:
        path = FIXTURES_DIR / filename
        report, code = validate_path(path)
        _expect(code == expected_exit, f"{filename}: exit {code} != {expected_exit}", errors)
        check(report)
    if errors:
        print("readiness self-test failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("readiness self-test passed")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[1] in {"--self-test", "--test"}:
        return run_self_test()
    if len(argv) != 2:
        print(
            "usage: validate-county-readiness.py <docs/<county>-sources.yaml>\n"
            "       validate-county-readiness.py --self-test",
            file=sys.stderr,
        )
        return 2
    path = Path(argv[1])
    if not path.is_file():
        print(json.dumps({"overall": "BLOCKED", "error": f"catalog not found: {path}"}))
        return 1
    report, code = validate_path(path)
    json.dump(report, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return code


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
