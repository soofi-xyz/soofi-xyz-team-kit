#!/usr/bin/env python3
"""Fail-closed county readiness validator for bundled runtime YAML catalogs.

Reads skills/use-oracle/runtime/docs/<county>-sources.yaml (or a fixture path). Prints a JSON
readiness report. Exit 0 only when every gate is PASS, APPROVED_EXCEPTION, or
NOT_APPLICABLE. Any BLOCKED gate exits 1.

The stack gate proves the Restate run-tracking stack (catalog section `stack`). A
leftover `destination` section from the retired Query DB adds a non-blocking WARN to
`warnings`; it never decides readiness. With `--probe`, the stack gate also queries
`<restate_admin_url>/services` (or `--restate-admin-url`) and BLOCKS unless all seven
Oracle services are registered there; without it the gate trusts the catalog.

onboard-county, county-seed-data, and county-ingest-run (pilot or full) MUST run this
and STOP on a non-zero exit.
"""

from __future__ import annotations

import json
import sys
import urllib.request
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
# Copies of permits held by someone other than the issuing authority. An appraisal
# district or assessor keeps only the permits it needs to value improvements, usually
# without license numbers or fees and over a short window. A secondary copy is never
# historical permit records and never stands in for a minable issuing portal.
SECONDARY_PORTAL_KINDS = {
    "appraisal-derived",
    "assessor-copy",
    "open-data-mirror",
    "vendor-aggregate",
}
SOURCE_ROLES = {"primary", "secondary"}
DEFAULT_DISCREPANCY_THRESHOLD_PCT = 2.0
FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "readiness"
GATE_OWNERS = {
    "catalog_metadata": "county-discovery",
    "parcel": "county-discovery",
    "permit": "county-discovery / county-permit-adapter",
    "stack": "bootstrap-oracle-infra",
    "enrichment": "bbb-harvest",
}
SAFE_PREPARATION_ACTIONS = [
    "Continue bounded source and jurisdiction enumeration",
    "Continue adapter fingerprinting, scaffolds, fixtures, and bounded tests",
    "Continue AWS BBB runtime, Restate stack, upload-node, and Atlas PR readiness",
    "Prepare named API or records requests for blocked sources",
]
REQUIRED_SERVICES = [
    "Parcel",
    "CountyIngest",
    "CountyLedger",
    "PermitFeed",
    "PermitHarvest",
    "PublishGroup",
]
# --probe checks every service the runtime registers, IngestChunk included.
PROBED_SERVICES = [*REQUIRED_SERVICES, "IngestChunk"]
STACK_ACTION = (
    "Bring up the Restate stack with bootstrap-oracle-infra, register the services "
    "process, and record stack.orchestrator: restate, stack.services_registered: true, "
    "stack.verified_at, and stack.publication.upload_node when publication is in scope"
)
LEGACY_DESTINATION_WARNING = (
    "destination section is obsolete: the internal Query DB was removed and the "
    "readiness validator ignores it; delete it and keep run tracking in the stack section"
)
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


def probe_stack(admin_url: str, opener=None) -> dict:
    """List the services registered on a Restate admin API.

    `opener(url) -> bytes` is injectable so the self-test stays offline.
    """
    url = admin_url.rstrip("/") + "/services"
    try:
        if opener is None:
            with urllib.request.urlopen(url, timeout=10) as response:  # noqa: S310 - operator URL
                body = response.read()
        else:
            body = opener(url)
        services = sorted(
            {str(item.get("name")) for item in json.loads(body).get("services", []) if isinstance(item, dict)}
        )
    except Exception as error:  # network, HTTP, or JSON failure
        return {"url": url, "ok": False, "services": [], "missing": PROBED_SERVICES, "error": str(error)[:200]}
    missing = [name for name in PROBED_SERVICES if name not in services]
    return {"url": url, "ok": not missing, "services": services, "missing": missing, "error": None}


def evaluate(catalog: dict, probe: dict | None = None) -> dict:
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
    invalid_role = []
    secondary_as_history = []
    secondary_over_minable = []
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
        role = row.get("source_role")
        if role is not None and role not in SOURCE_ROLES:
            invalid_role.append(name)
        is_secondary = role == "secondary" or kind in SECONDARY_PORTAL_KINDS
        if is_secondary and role == "primary":
            invalid_role.append(name)
        if is_secondary and row.get("historical_records") is True:
            secondary_as_history.append(name)
        if (
            is_secondary
            and status in {"supported", "delegated"}
            and row.get("issuer_portal_minable") is not False
        ):
            secondary_over_minable.append(name)
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
    if invalid_role:
        permit_reasons.append(
            "source_role must be primary or secondary, and appraisal-derived/assessor-copy/open-data-mirror/vendor-aggregate portals are secondary: "
            + ", ".join(invalid_role)
        )
    if secondary_as_history:
        permit_reasons.append(
            "secondary permit copies treated as historical records: "
            + ", ".join(secondary_as_history)
        )
    if secondary_over_minable:
        permit_reasons.append(
            "secondary permit copy planned as the source while the issuing portal is minable or unproven (set issuer_portal_minable: false with evidence, or harvest the issuer): "
            + ", ".join(secondary_over_minable)
        )
    if permit_reasons and permit_exception is None:
        gates.append(
            _gate(
                "permit",
                "BLOCKED",
                "; ".join(permit_reasons),
                "Enumerate every incorporated, unincorporated, delegated, and predecessor jurisdiction; classify each; catalog records_request for blocked/custodian/manual-only rows; do not treat a county one-stop or application portal as complete municipal history; harvest each issuing authority instead of an appraisal-district, assessor, open-data, or vendor copy",
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

    stack = catalog.get("stack")
    if not isinstance(stack, dict) or not stack:
        gates.append(
            _gate(
                "stack",
                "BLOCKED",
                "stack section is missing",
                STACK_ACTION,
            )
        )
    else:
        stack_reasons: list[str] = []
        orchestrator = str(stack.get("orchestrator") or "").strip().lower()
        if orchestrator != "restate":
            stack_reasons.append(
                f"stack.orchestrator is {orchestrator or 'missing'}; it must be restate"
            )
        if stack.get("services_registered") is not True:
            stack_reasons.append(
                "stack.services_registered is not true; "
                + ", ".join(REQUIRED_SERVICES)
                + " must be visible in `restate services list`"
            )
        if not str(stack.get("verified_at") or "").strip():
            stack_reasons.append("stack.verified_at is missing")
        publication = stack.get("publication")
        if not isinstance(publication, dict):
            publication = {}
        publication_in_scope = publication.get("in_scope") is True
        if publication_in_scope and not str(publication.get("upload_node") or "").strip():
            stack_reasons.append(
                "stack.publication.in_scope is true but stack.publication.upload_node is not set"
            )
        if probe is not None and not probe["ok"]:
            stack_reasons.append(
                f"probe of {probe['url']} failed: "
                + (probe["error"] or "missing " + ", ".join(probe["missing"]))
            )
        if stack_reasons:
            gates.append(
                _gate(
                    "stack",
                    "BLOCKED",
                    "; ".join(stack_reasons),
                    STACK_ACTION,
                )
            )
        else:
            gates.append(
                _gate(
                    "stack",
                    "PASS",
                    f"orchestrator=restate admin={stack.get('restate_admin_url') or 'n/a'} "
                    f"services_registered=true verified_at={stack.get('verified_at')} "
                    f"publication_in_scope={str(publication_in_scope).lower()}"
                    + (
                        f" upload_node={publication.get('upload_node')}"
                        if publication_in_scope
                        else ""
                    )
                    + (
                        f" probe={probe['url']} services={len(probe['services'])}"
                        if probe is not None
                        else " probe=not-run"
                    ),
                )
            )

    warnings: list[dict] = []
    if "destination" in catalog:
        warning = {
            "gate": "stack",
            "level": "WARN",
            "message": LEGACY_DESTINATION_WARNING,
        }
        warnings.append(warning)
        for gate in gates:
            if gate["gate"] == "stack":
                gate.setdefault("warnings", []).append(LEGACY_DESTINATION_WARNING)

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
        "warnings": warnings,
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


def validate_path(
    path: Path, probe: bool = False, admin_url: str | None = None, opener=None
) -> tuple[dict, int]:
    catalog = load_catalog(path)
    probe_result = None
    if probe:
        stack = catalog.get("stack") if isinstance(catalog.get("stack"), dict) else {}
        url = admin_url or str(stack.get("restate_admin_url") or "http://localhost:9070")
        probe_result = probe_stack(url, opener)
    report = evaluate(catalog, probe_result)
    report["catalog_path"] = str(path)
    if probe_result is not None:
        report["stack_probe"] = probe_result
    return report, 0 if report["overall"] == "PASS" else 1


def _expect(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def _gate_status(report: dict, name: str) -> str | None:
    for gate in report["gates"]:
        if gate["gate"] == name:
            return gate["status"]
    return None


def _gate_evidence(report: dict, name: str) -> str:
    for gate in report["gates"]:
        if gate["gate"] == name:
            return gate["evidence"]
    return ""


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
            "secondary-copy-not-permit-source.yaml",
            1,
            lambda report: (
                _expect(
                    any(
                        gate["gate"] == "permit" and gate["status"] == "BLOCKED"
                        for gate in report["gates"]
                    ),
                    "secondary permit copy must BLOCK the permit gate",
                    errors,
                ),
                _expect(
                    any(
                        "secondary permit copies treated as historical records" in gate["evidence"]
                        and "issuing portal is minable or unproven" in gate["evidence"]
                        for gate in report["gates"]
                        if gate["gate"] == "permit"
                    ),
                    "permit evidence must name the secondary copy and the unharvested issuer",
                    errors,
                ),
                _expect(report["seed_allowed"] is False, "secondary copy must forbid seed", errors),
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
                    _gate_status(report, "stack") == "PASS",
                    "ready catalog must PASS the stack gate",
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
        (
            "stack-ready-publication-in-scope.yaml",
            0,
            lambda report: (
                _expect(report["overall"] == "PASS", "proven stack with upload node must PASS", errors),
                _expect(
                    _gate_status(report, "stack") == "PASS",
                    "proven stack with upload node must PASS the stack gate",
                    errors,
                ),
                _expect(report["warnings"] == [], "stack without destination must not warn", errors),
                _expect(report["ingest_allowed"] is True, "proven stack must allow ingest", errors),
            ),
        ),
        (
            "stack-missing.yaml",
            1,
            lambda report: (
                _expect(
                    _gate_status(report, "stack") == "BLOCKED",
                    "missing stack section must BLOCK the stack gate",
                    errors,
                ),
                _expect(report["seed_allowed"] is False, "missing stack must forbid seed", errors),
                _expect(
                    any(
                        item["gate"] == "stack" and item["owner"] == "bootstrap-oracle-infra"
                        for item in report["required_blocker_actions"]
                    ),
                    "blocked stack gate must name bootstrap-oracle-infra",
                    errors,
                ),
            ),
        ),
        (
            "stack-services-not-registered.yaml",
            1,
            lambda report: (
                _expect(
                    _gate_status(report, "stack") == "BLOCKED",
                    "unregistered services must BLOCK the stack gate",
                    errors,
                ),
                _expect(
                    "services_registered" in _gate_evidence(report, "stack"),
                    "stack evidence must name services_registered",
                    errors,
                ),
                _expect(report["execution_allowed"] is False, "unregistered services must forbid execution", errors),
            ),
        ),
        (
            "stack-publication-without-upload-node.yaml",
            1,
            lambda report: (
                _expect(
                    _gate_status(report, "stack") == "BLOCKED",
                    "publication in scope without upload node must BLOCK the stack gate",
                    errors,
                ),
                _expect(
                    "upload_node" in _gate_evidence(report, "stack"),
                    "stack evidence must name upload_node",
                    errors,
                ),
            ),
        ),
        (
            "legacy-destination-section-warns.yaml",
            0,
            lambda report: (
                _expect(report["overall"] == "PASS", "leftover destination must not block", errors),
                _expect(
                    _gate_status(report, "stack") == "PASS",
                    "leftover destination must leave the stack gate PASS",
                    errors,
                ),
                _expect(
                    any(
                        warning["gate"] == "stack"
                        and warning["level"] == "WARN"
                        and "obsolete" in warning["message"]
                        for warning in report["warnings"]
                    ),
                    "leftover destination must produce a WARN note",
                    errors,
                ),
                _expect(
                    all(gate["gate"] != "destination" for gate in report["gates"]),
                    "destination must no longer be a gate",
                    errors,
                ),
            ),
        ),
    ]
    for filename, expected_exit, check in cases:
        path = FIXTURES_DIR / filename
        report, code = validate_path(path)
        _expect(code == expected_exit, f"{filename}: exit {code} != {expected_exit}", errors)
        check(report)
    # --probe, offline: an injected opener stands in for the Restate admin API.
    ready = FIXTURES_DIR / "stack-ready-publication-in-scope.yaml"
    all_services = json.dumps({"services": [{"name": name} for name in PROBED_SERVICES]}).encode()
    report, code = validate_path(ready, probe=True, admin_url="http://probe.invalid:9070", opener=lambda url: all_services)
    _expect(code == 0 and _gate_status(report, "stack") == "PASS", "probe with all services must PASS", errors)
    _expect(report.get("stack_probe", {}).get("url") == "http://probe.invalid:9070/services", "probe must query <admin>/services", errors)
    partial = json.dumps({"services": [{"name": "Parcel"}, {"name": "CountyIngest"}]}).encode()
    report, code = validate_path(ready, probe=True, opener=lambda url: partial)
    _expect(code == 1 and _gate_status(report, "stack") == "BLOCKED", "probe missing services must BLOCK", errors)
    _expect("IngestChunk" in _gate_evidence(report, "stack"), "probe evidence must name missing services", errors)

    def unreachable(url):
        raise OSError("connection refused")

    report, code = validate_path(ready, probe=True, opener=unreachable)
    _expect(code == 1 and "connection refused" in _gate_evidence(report, "stack"), "unreachable probe must BLOCK", errors)
    if errors:
        print("readiness self-test failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("readiness self-test passed")
    return 0


def main(argv: list[str]) -> int:
    args = argv[1:]
    if args in (["--self-test"], ["--test"]):
        return run_self_test()
    probe = False
    admin_url = None
    positional: list[str] = []
    index = 0
    while index < len(args):
        arg = args[index]
        if arg == "--probe":
            probe = True
        elif arg == "--restate-admin-url" and index + 1 < len(args):
            admin_url = args[index + 1]
            probe = True
            index += 1
        else:
            positional.append(arg)
        index += 1
    if len(positional) != 1 or positional[0].startswith("--"):
        print(
            "usage: validate-county-readiness.py [--probe] [--restate-admin-url URL] "
            "<docs/<county>-sources.yaml>\n"
            "       validate-county-readiness.py --self-test",
            file=sys.stderr,
        )
        return 2
    path = Path(positional[0])
    if not path.is_file():
        print(json.dumps({"overall": "BLOCKED", "error": f"catalog not found: {path}"}))
        return 1
    report, code = validate_path(path, probe=probe, admin_url=admin_url)
    json.dump(report, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return code


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
