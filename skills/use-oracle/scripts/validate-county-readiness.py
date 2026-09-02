#!/usr/bin/env python3
"""Fail-closed county readiness validator for elephant-pipeline YAML catalogs.

Reads elephant-pipeline/docs/<county>-sources.yaml (or a fixture path). Prints a JSON
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
DEFAULT_DISCREPANCY_THRESHOLD_PCT = 2.0
FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "readiness"


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

    if assessed is None:
        gates.append(
            _gate(
                "parcel",
                "BLOCKED",
                "canonical assessed-property count is missing; GIS is not a substitute denominator",
                "Record tax-roll/NAL/appraiser assessed count and choose a canonical source",
            )
        )
    else:
        discrepancy_pct = None
        if gis is not None and assessed > 0:
            discrepancy_pct = abs(gis - assessed) / assessed * 100.0
        unresolved = (
            discrepancy_pct is not None
            and discrepancy_pct > threshold
            and exception is None
        )
        gis_only = canonical in {"gis", "geometry", "polygon"} and exception is None
        if unresolved or (gis_only and discrepancy_pct is not None and discrepancy_pct > threshold):
            pretty = f"{discrepancy_pct:.1f}" if discrepancy_pct is not None else "unknown"
            gates.append(
                _gate(
                    "parcel",
                    "BLOCKED",
                    (
                        f"GIS {gis} vs assessed {assessed} is approximately {pretty}% "
                        f"(threshold {threshold}%); unresolved material discrepancy; "
                        "GIS-only seeding is not allowed"
                    ),
                    "Document cause, canonical denominator, seed decision, excluded population, and coverage effect, then record an approved exception",
                )
            )
        elif exception and discrepancy_pct is not None and discrepancy_pct > threshold:
            gates.append(
                _gate(
                    "parcel",
                    "APPROVED_EXCEPTION",
                    f"{exception.get('reason')} (discrepancy {discrepancy_pct:.1f}%)",
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
    unclassified = []
    for row in jurisdictions:
        if not isinstance(row, dict):
            unclassified.append("<invalid-row>")
            continue
        status = row.get("status")
        name = row.get("jurisdiction") or "<unnamed>"
        if status in UNCLASSIFIED or status not in PERMIT_CLASSIFICATIONS:
            unclassified.append(name)
    count_mismatch = expected is not None and int(expected) != len(jurisdictions)
    if expected is None:
        gates.append(
            _gate(
                "permit",
                "BLOCKED",
                "expected_jurisdiction_count is missing",
                "Enumerate every incorporated, unincorporated, delegated, and predecessor jurisdiction",
            )
        )
    elif (unclassified or count_mismatch) and permit_exception is None:
        reasons = []
        if count_mismatch:
            reasons.append(
                f"cataloged {len(jurisdictions)} jurisdictions != expected {expected}"
            )
        if unclassified:
            reasons.append("unclassified: " + ", ".join(unclassified))
        gates.append(
            _gate(
                "permit",
                "BLOCKED",
                "; ".join(reasons),
                "Classify every jurisdiction (no needs-review) before seed or ingest",
            )
        )
    elif permit_exception and (unclassified or count_mismatch):
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

    blocked = [gate for gate in gates if gate["status"] == "BLOCKED"]
    overall = "BLOCKED" if blocked else "PASS"
    next_action = (
        blocked[0]["required_action"]
        if blocked
        else "Readiness passed. Pilot or full ingest may proceed."
    )
    return {
        "overall": overall,
        "catalog": {
            "county": catalog.get("county"),
            "slug": catalog.get("slug"),
            "state": catalog.get("state"),
            "fips": str(catalog.get("fips")) if catalog.get("fips") is not None else None,
        },
        "gates": gates,
        "next_automated_action": next_action if blocked else None,
        "next_permissible_automated_action": next_action,
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
            "broward-2026.yaml",
            1,
            lambda report: (
                _expect(report["overall"] == "BLOCKED", "broward must BLOCK", errors),
                _expect(report["seed_allowed"] is False, "broward must forbid seed", errors),
                _expect(
                    any(
                        gate["gate"] == "parcel" and gate["status"] == "BLOCKED"
                        for gate in report["gates"]
                    ),
                    "broward parcel gate must BLOCK",
                    errors,
                ),
                _expect(
                    any("26.6" in gate["evidence"] for gate in report["gates"] if gate["gate"] == "parcel"),
                    "broward evidence must include approximately 26.6% discrepancy",
                    errors,
                ),
            ),
        ),
        (
            "hillsborough-unclassified-permits.yaml",
            1,
            lambda report: (
                _expect(
                    any(
                        gate["gate"] == "parcel" and gate["status"] == "PASS"
                        for gate in report["gates"]
                    ),
                    "hillsborough parcel gate must PASS",
                    errors,
                ),
                _expect(
                    any(
                        gate["gate"] == "permit" and gate["status"] == "BLOCKED"
                        for gate in report["gates"]
                    ),
                    "hillsborough permit gate must BLOCK",
                    errors,
                ),
                _expect(report["seed_allowed"] is False, "hillsborough must forbid seed", errors),
            ),
        ),
        (
            "ready-minimal.yaml",
            0,
            lambda report: (
                _expect(report["overall"] == "PASS", "ready catalog must PASS", errors),
                _expect(report["seed_allowed"] is True, "ready catalog must allow seed", errors),
                _expect(report["ingest_allowed"] is True, "ready catalog must allow ingest", errors),
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
