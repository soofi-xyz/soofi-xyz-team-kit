#!/usr/bin/env python3
"""Derive, recommend and confirm the PROD-derived source window used by the final validation run.

  source_window.py policy --profile P.json [--intent intent.json] [--out policy.json]
      Print the profile's sourceWindowPolicy, or derive one from its source-role datasets and the
      resolver's coverageTargets when the profile lacks it; every defaulted value is recorded.
  source_window.py recommend --policy policy.json --candidates candidates.json [--max-rows N]
      [--cost-ceiling USD] [--min-candidates 7] [--now ISO] --out selection.json
      Mark each sanitized per-UTC-day candidate complete or not and recommend the most recent contiguous
      run of complete days covering minimumCompleteUtcDays (status NEEDS_CONFIRMATION), or BLOCKED.
  source_window.py confirm --selection selection.json --start ISO --end-exclusive ISO --policy policy.json
      --out confirmed.json
      Record the window the user explicitly confirmed: the recommendation, or a longer contiguous range of
      complete candidates when allowLongerRange is true. Run it only after the user's own answer.

Candidates are sanitized aggregates gathered with read-only PROD metadata calls: one object per complete UTC
day with start, endExclusive, sourceFamiliesPresent, coverageSignals, rowCount, byteCount, estimatedCostUsd and
immutableEvidence. The tool never reads rows, never contacts AWS and never pads or samples data.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone

from silvally_io import SilvallyError, read_json, write_json

DEFAULTS = {"minimumCompleteUtcDays": 1, "allowLongerRange": True}
CANDIDATE_KEYS = ("start", "endExclusive", "complete", "sourceFamiliesPresent", "coverageSignals", "rowCount",
                  "byteCount", "estimatedCostUsd", "immutableEvidence")


def kebab(value: str) -> str:
    return "-".join(part for part in value.lower().replace("_", "-").split("-") if part)


def parse_utc(raw: str) -> datetime:
    value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if value.tzinfo is None or value.utcoffset() != timedelta(0):
        raise SilvallyError(f"{raw} is not a UTC timestamp")
    return value


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def is_midnight(value: datetime) -> bool:
    return value.hour == value.minute == value.second == value.microsecond == 0


def window_token(window: dict) -> str:
    """The half-open window segment used in DEV staging prefixes: YYYY-MM-DDT000000Z_YYYY-MM-DDT000000Z."""
    return "_".join(parse_utc(window[k]).strftime("%Y-%m-%dT%H%M%SZ") for k in ("start", "endExclusive"))


def derive_policy(profile: dict, intent: dict | None) -> dict:
    declared = profile.get("sourceWindowPolicy")
    if declared:
        return declared
    families = sorted({d["name"] for d in profile.get("datasets", []) if d.get("role") == "source"})
    if not families:
        raise SilvallyError("the profile declares no source-role dataset; a source window policy cannot be derived")
    signals = [f"{kebab(f)}-rows-present" for f in families]
    for entry in (intent or {}).get("parityDerivation", []):
        if entry.get("dataset") in families:
            signals += [f"{kebab(entry['dataset'])}-{kebab(t['field'])}-values-covered" for t in entry.get("coverageTargets", [])]
    return {"kind": "prod-derived-complete-utc-days", **DEFAULTS, "requiredSourceFamilies": families,
            "requiredCoverageSignals": sorted(set(signals)), "origin": "derived-at-intake", "recordedDefaults": dict(DEFAULTS),
            "evidenceIds": ["profile-source-datasets"] + (["intent-coverage-targets"] if intent else [])}


def signal_met(value) -> bool:
    return value is True or (isinstance(value, int) and not isinstance(value, bool) and value > 0)


def assess(candidate: dict, policy: dict, now: datetime, max_rows: int | None, cost_ceiling: float | None) -> list[str]:
    reasons = []
    start, end = parse_utc(candidate["start"]), parse_utc(candidate["endExclusive"])
    if not (is_midnight(start) and end - start == timedelta(days=1)):
        reasons.append("not one complete UTC day")
    if end > now:
        reasons.append("day has not ended")
    missing = sorted(set(policy["requiredSourceFamilies"]) - set(candidate.get("sourceFamiliesPresent", [])))
    if missing:
        reasons.append(f"missing source families {missing}")
    unmet = sorted(s for s in policy["requiredCoverageSignals"] if not signal_met(candidate.get("coverageSignals", {}).get(s)))
    if unmet:
        reasons.append(f"unmet coverage signals {unmet}")
    if not candidate.get("immutableEvidence"):
        reasons.append("no immutable source evidence")
    if max_rows is not None and candidate.get("rowCount", 0) > max_rows:
        reasons.append(f"rowCount above the {max_rows} bound")
    if cost_ceiling is not None and candidate.get("estimatedCostUsd", 0) > cost_ceiling:
        reasons.append(f"estimated cost above the {cost_ceiling} USD ceiling")
    return reasons


def recommend(policy: dict, candidates: list[dict], now: datetime, max_rows: int | None, cost_ceiling: float | None,
              min_candidates: int) -> tuple[dict, dict]:
    compared, notes = [], {}
    for raw in sorted(candidates, key=lambda c: c["start"]):
        reasons = assess(raw, policy, now, max_rows, cost_ceiling)
        compared.append({**{k: raw[k] for k in CANDIDATE_KEYS if k in raw and k != "complete"}, "complete": not reasons})
        notes[raw["start"]] = reasons
    minimum = policy["minimumCompleteUtcDays"]
    recommended = None
    if len(compared) >= min_candidates:
        for i in range(len(compared) - minimum, -1, -1):
            run = compared[i:i + minimum]
            contiguous = all(parse_utc(b["start"]) == parse_utc(a["endExclusive"]) for a, b in zip(run, run[1:]))
            if contiguous and all(c["complete"] for c in run):
                recommended = {"start": run[0]["start"], "endExclusive": run[-1]["endExclusive"], "completeUtcDays": minimum}
                break
    status = "NEEDS_CONFIRMATION" if recommended else "BLOCKED"
    selection = {"status": status, "minimumCompleteUtcDays": minimum, "allowLongerRange": policy["allowLongerRange"],
                 "candidateComparisons": compared, "recommendedWindow": recommended,
                 "confirmedWindow": None, "evidenceIds": ["prod-source-window-metadata"]}
    summary = {"status": status, "candidates": len(compared), "complete": sum(c["complete"] for c in compared),
               "recommendedWindow": recommended, "incompleteReasons": {k: v for k, v in notes.items() if v}}
    if len(compared) < min_candidates:
        summary["blockedReason"] = f"only {len(compared)} candidate days compared; at least {min_candidates} are required"
    elif not recommended:
        summary["blockedReason"] = f"no {minimum} contiguous complete UTC day(s) among the candidates"
    return selection, summary


def confirm(selection: dict, policy: dict, start: str, end_exclusive: str) -> dict:
    if selection.get("status") != "NEEDS_CONFIRMATION" or not selection.get("recommendedWindow"):
        raise SilvallyError("only a NEEDS_CONFIRMATION selection with a recommendation can be confirmed")
    begin, end = parse_utc(start), parse_utc(end_exclusive)
    days = (end - begin).days
    if not (is_midnight(begin) and is_midnight(end)) or days < policy["minimumCompleteUtcDays"]:
        raise SilvallyError("the confirmed window must be whole UTC days covering at least minimumCompleteUtcDays")
    recommended = selection["recommendedWindow"]
    is_recommended = (begin, end) == (parse_utc(recommended["start"]), parse_utc(recommended["endExclusive"]))
    if not is_recommended and not policy["allowLongerRange"]:
        raise SilvallyError("the profile does not allow a range other than the recommended window")
    by_start = {parse_utc(c["start"]): c for c in selection["candidateComparisons"]}
    for offset in range(days):
        day = by_start.get(begin + timedelta(days=offset))
        if not day or not day["complete"]:
            raise SilvallyError(f"{iso(begin + timedelta(days=offset))} is not a compared complete UTC day")
    confirmed = {**selection, "status": "CONFIRMED",
                 "confirmedWindow": {"start": iso(begin), "endExclusive": iso(end), "completeUtcDays": days}}
    confirmed["evidenceIds"] = sorted(set(selection["evidenceIds"]) | {"source-window-user-confirmation"})
    return confirmed


def validate_confirmed(selection: dict | None, policy: dict | None) -> tuple[str, str]:
    """PASS/FAIL/BLOCKED for a supplied selection against the profile policy (used by evaluate_run.py)."""
    if not policy:
        return "BLOCKED", "SourceWindowPolicyMissing: the profile declares no sourceWindowPolicy"
    if not selection:
        return "BLOCKED", "SourceWindowUnconfirmed: no PROD-derived source window selection was supplied"
    if selection.get("status") == "BLOCKED":
        return "BLOCKED", "SourceWindowUnavailable: no complete PROD-derived window exists or PROD metadata was inaccessible"
    if selection.get("status") != "CONFIRMED" or not selection.get("confirmedWindow"):
        return "BLOCKED", "SourceWindowUnconfirmed: the recommended window awaits the user's explicit confirmation"
    window = selection["confirmedWindow"]
    begin, end = parse_utc(window["start"]), parse_utc(window["endExclusive"])
    days = (end - begin).total_seconds() / 86400
    if not (is_midnight(begin) and is_midnight(end)) or days != window.get("completeUtcDays") or days < policy["minimumCompleteUtcDays"]:
        return "FAIL", "SourceWindowIncomplete: the confirmed window is not whole UTC days covering the profile minimum"
    complete = {parse_utc(c["start"]) for c in selection.get("candidateComparisons", []) if c.get("complete")}
    if any(begin + timedelta(days=d) not in complete for d in range(int(days))):
        return "FAIL", "SourceWindowIncomplete: the confirmed window includes a day not proven complete"
    if days > policy["minimumCompleteUtcDays"] and not policy["allowLongerRange"]:
        return "FAIL", "SourceWindowIncomplete: a longer range was confirmed but the profile forbids it"
    return "PASS", f"confirmed PROD-derived window [{window['start']}, {window['endExclusive']}) of {int(days)} complete UTC day(s)"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("policy")
    p.add_argument("--profile", required=True)
    p.add_argument("--intent")
    p.add_argument("--out")
    r = sub.add_parser("recommend")
    r.add_argument("--policy", required=True)
    r.add_argument("--candidates", required=True)
    r.add_argument("--max-rows", type=int)
    r.add_argument("--cost-ceiling", type=float)
    r.add_argument("--min-candidates", type=int, default=7)
    r.add_argument("--now", help="evaluation time (ISO, UTC); default is the current time")
    r.add_argument("--out", required=True)
    c = sub.add_parser("confirm")
    c.add_argument("--selection", required=True)
    c.add_argument("--policy", required=True)
    c.add_argument("--start", required=True)
    c.add_argument("--end-exclusive", required=True)
    c.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    if args.command == "policy":
        policy = derive_policy(read_json(args.profile), read_json(args.intent) if args.intent else None)
        if args.out:
            write_json(args.out, policy)
        print(json.dumps(policy, indent=1))
        return 0
    policy = read_json(args.policy)
    if args.command == "recommend":
        now = parse_utc(args.now) if args.now else datetime.now(timezone.utc)
        selection, summary = recommend(policy, read_json(args.candidates), now, args.max_rows, args.cost_ceiling, args.min_candidates)
        write_json(args.out, selection)
        print(json.dumps(summary, indent=1))
        return 0 if selection["status"] == "NEEDS_CONFIRMATION" else 1
    confirmed = confirm(read_json(args.selection), policy, args.start, args.end_exclusive)
    write_json(args.out, confirmed)
    print(json.dumps({"status": confirmed["status"], "confirmedWindow": confirmed["confirmedWindow"],
                      "windowToken": window_token(confirmed["confirmedWindow"])}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
