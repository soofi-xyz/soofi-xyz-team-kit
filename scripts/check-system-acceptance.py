#!/usr/bin/env python3
"""Compare recorded System mock evidence with teaching fixtures; never claims AWS verification."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCENARIOS = ROOT / "skills/build-system-product/reference/mock-scenarios.json"
EXECUTION = re.compile(r"^arn:aws(?:-us-gov|-cn)?:states:[a-z0-9-]+:\d{12}:execution:[^:]+:.+$")


def check(records: object, scenarios: dict) -> list[str]:
    if not isinstance(records, list):
        return ["evidence must be an array"]
    expected = {(scenario["id"], case["id"]): case
                for scenario in scenarios["scenarios"] for case in scenario["cases"]}
    errors: list[str] = []
    seen: set[tuple[str, str]] = set()
    configurations: dict[str, str] = {}
    for record in records:
        if not isinstance(record, dict):
            errors.append("each evidence record must be an object")
            continue
        key = (str(record.get("scenarioId", "")), str(record.get("caseId", "")))
        label = "/".join(key)
        if record.get("phase") != "framework-acceptance":
            errors.append(f"{label}: a demonstration or local test is not framework acceptance")
        if key not in expected:
            errors.append(f"{label}: unknown scenario/case")
            continue
        if key in seen:
            errors.append(f"{label}: duplicate evidence")
        seen.add(key)
        for field in ("configurationId", "requestId", "humanObservation", "logReference"):
            if not isinstance(record.get(field), str) or not record[field].strip():
                errors.append(f"{label}: missing {field}")
        if type(record.get("iteration")) is not int or record["iteration"] < 1:
            errors.append(f"{label}: iteration must be a positive index in the scoped feature plan")
        if record.get("featureId") != expected[key]["featureId"]:
            errors.append(f"{label}: evidence does not identify the expected product feature")
        if record.get("invokedBy") != "user":
            errors.append(f"{label}: missing user-run configuration evidence")
        configuration_key = expected[key]["configuration"]
        configuration_id = record.get("configurationId")
        if isinstance(configuration_id, str) and configuration_id.strip():
            if configuration_key in configurations and configurations[configuration_key] != configuration_id:
                errors.append(f"{label}: cases for the same configuration must use the same identity")
            configurations[configuration_key] = configuration_id
        if not EXECUTION.fullmatch(str(record.get("executionArn", ""))):
            errors.append(f"{label}: missing Step Functions execution ARN")
        if record.get("mocked") is not True:
            errors.append(f"{label}: mock acceptance must identify mocked leaves")
        if json.dumps(record.get("actualResponse"), sort_keys=True) != json.dumps(expected[key]["expectedResponse"], sort_keys=True):
            errors.append(f"{label}: response differs from expected result")
        if record.get("observedSteps") != expected[key]["expectedSteps"]:
            errors.append(f"{label}: observed steps differ from expected order")
    for key in sorted(set(expected) - seen):
        errors.append(f"{'/'.join(key)}: missing acceptance evidence")
    if len(set(configurations.values())) != len(configurations):
        errors.append("distinct fixture configurations must have distinct configuration identities")
    return errors


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: python3 scripts/check-system-acceptance.py <recorded-evidence.json>", file=sys.stderr)
        return 2
    try:
        records = json.loads(Path(argv[0]).read_text())
        scenarios = json.loads(SCENARIOS.read_text())
    except (OSError, ValueError) as exc:
        print(f"cannot read evidence: {exc}", file=sys.stderr)
        return 2
    errors = check(records, scenarios)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print("Recorded scenario evidence matches fixtures. Full feature coverage and AWS execution authenticity were not checked.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
