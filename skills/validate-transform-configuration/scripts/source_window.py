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
  source_window.py data-days --slice-days counts.json (--day YYYY-MM-DD | --most-recent) [--now ISO]
      [--data-through SLICE=ISO ...] [--input-days input-counts.json ...] [--lookback-days N]
      [--catalog prod-actuals.json] --out days.json
      Check that every slice has real PROD rows on the confirmed day on both sides: the PROD actual
      (--slice-days) and, with --input-days, the slice's Transform inputs. An EMPTY, STALE_ACTUAL or
      INPUT_EMPTY slice gets the nearest UTC day with both to suggest to the user. --most-recent applies the
      owner decision "most recent full UTC day with real data per slice" instead of a confirmation question.
      --data-through is a slice's PROD-actual data cutoff (prod_actuals.py table-summary dataThrough): days
      ending after it are not eligible, and whenever it is before the end of the requested (or most recent
      complete) UTC day the stale mirror is recorded as a ProdMirrorStale data-platform handoff. A slice whose
      actual days never meet an input day records an UpstreamInputEmpty handoff. --lookback-days bounds the days
      that may be chosen (the most recent N complete UTC days); --catalog adds the slice's recorded
      blockedHandoffs to a slice that has no eligible day. Counts come from bounded newest-first reads
      (prod_actuals.py probe-days, iceberg_snapshot_read.py byUtcDay with the catalog rowFilter as --where, and for
      graph inputs graph_inputs.py edge-days), never a whole-lookback Lambda scan. Never substitutes synthetic data.

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


def data_days(slice_days: dict, day: str | None, most_recent: bool, now: datetime, data_through: dict | None = None,
              input_days: dict | None = None, lookback_days: int | None = None, catalog: dict | None = None) -> dict:
    """Per-slice real-data check of a UTC day, or the most recent complete UTC day with data per slice.

    slice_days maps slice -> {"YYYY-MM-DD": rows} of the PROD actual, input_days the same for the slice's
    Transform inputs (for example Persist status edges); both come from sanitized read-only PROD counts. A day
    is eligible only when both sides have rows. A slice without an eligible day is EMPTY (no actual rows),
    STALE_ACTUAL (rows only after the actual's cutoff) or INPUT_EMPTY (actual rows but no input rows), with
    the nearest eligible UTC day (ties go to the earlier day). data_through maps slice -> the PROD actual's data
    cutoff; a day that ends after it is not eligible, and whenever the cutoff is before the end of the requested
    day (or of the most recent complete UTC day) the stale mirror is recorded as a data-platform handoff.
    lookback_days limits eligible days to the most recent N complete UTC days; catalog adds each slice's recorded
    blockedHandoffs when it has no eligible day.
    """
    today = now.strftime("%Y-%m-%d")
    oldest = (datetime.fromisoformat(today) - timedelta(days=lookback_days)).strftime("%Y-%m-%d") if lookback_days else ""
    requested = day or (datetime.fromisoformat(today) - timedelta(days=1)).strftime("%Y-%m-%d")
    out = {}
    for name, counts in sorted(slice_days.items()):
        cutoff = parse_utc((data_through or {})[name]) if name in (data_through or {}) else None
        inputs = (input_days or {}).get(name)
        covered = (lambda d: cutoff is None or parse_utc(d + "T00:00:00Z") + timedelta(days=1) <= cutoff)
        fed = (lambda d: inputs is None or bool(inputs.get(d)))
        actual_days = sorted(d for d, rows in counts.items() if rows and oldest <= d < today and covered(d))
        days = [d for d in actual_days if fed(d)]
        if most_recent:
            chosen = days[-1] if days else None
            status = "HAS_DATA" if chosen else ("INPUT_EMPTY" if actual_days else (
                "STALE_ACTUAL" if any(rows and d < today for d, rows in counts.items()) else "EMPTY"))
            out[name] = {"day": chosen, "rows": counts.get(chosen, 0) if chosen else 0, "status": status,
                         "nearestDayWithData": chosen}
        else:
            rows = counts.get(day, 0)
            target = datetime.fromisoformat(day)
            nearest = min(days, key=lambda d: (abs((datetime.fromisoformat(d) - target).days), d)) if days else None
            status = ("STALE_ACTUAL" if rows and not covered(day) else "EMPTY") if not (rows and covered(day)) else (
                "HAS_DATA" if fed(day) else "INPUT_EMPTY")
            out[name] = {"day": day, "rows": rows, "status": status,
                         "nearestDayWithData": day if status == "HAS_DATA" else nearest}
        handoffs = []
        if inputs is not None:
            fed_days = sorted(d for d, n in inputs.items() if n)
            out[name]["inputRows"] = inputs.get(out[name]["day"], 0) if out[name]["day"] else 0
            out[name]["inputDays"] = {"first": fed_days[0], "last": fed_days[-1]} if fed_days else None
            if out[name]["status"] == "INPUT_EMPTY":
                handoffs.append({"code": "UpstreamInputEmpty", "owner": "the slice's upstream producer (Persist ingestion)",
                                 "detail": "no UTC day has both PROD-actual rows and Transform input rows" + (
                                     f"; actual days end {actual_days[-1]}, input days are "
                                     f"{fed_days[0]}..{fed_days[-1]}" if actual_days and fed_days else
                                     ("; the input side has no rows" if not fed_days else ""))})
        if cutoff is not None:
            out[name]["dataThrough"] = iso(cutoff)
            if cutoff < parse_utc(requested + "T00:00:00Z") + timedelta(days=1):
                handoffs.append({"code": "ProdMirrorStale", "owner": "data platform (the mirror's ETL)",
                                 "detail": f"the PROD actual's data stops at {iso(cutoff)}, before the end of {requested}; "
                                           "later days have no actual"})
        if out[name]["status"] != "HAS_DATA":
            known = {h["code"] for h in handoffs}
            handoffs += [h for h in ((catalog or {}).get("slices", {}).get(name, {}).get("blockedHandoffs") or []) if h["code"] not in known]
        if handoffs:
            out[name]["handoffs"] = handoffs
    empty = sorted(n for n, s in out.items() if s["status"] != "HAS_DATA")
    return {"status": "EMPTY_SLICES" if empty else "OK", "emptySlices": empty,
            "selection": "most-recent-full-utc-day-with-data-per-slice" if most_recent else "confirmed-day",
            "requestedDay": requested, "lookbackDays": lookback_days, "slices": out, "evidenceIds": ["prod-slice-day-counts"]}


def slice_window(entry: dict) -> dict:
    start = parse_utc(entry["day"] + "T00:00:00Z")
    return {"start": iso(start), "endExclusive": iso(start + timedelta(days=1)), "completeUtcDays": 1}


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
    d = sub.add_parser("data-days")
    d.add_argument("--slice-days", required=True, action="append",
                   help='{"<slice>": {"YYYY-MM-DD": rows}} from read-only PROD counts (repeatable; one file per probe is merged)')
    group = d.add_mutually_exclusive_group(required=True)
    group.add_argument("--day", help="the confirmed UTC day (YYYY-MM-DD)")
    group.add_argument("--most-recent", action="store_true",
                       help="owner decision: the most recent complete UTC day with real data, per slice")
    d.add_argument("--now", help="evaluation time (ISO, UTC); default is the current time")
    d.add_argument("--data-through", action="append", default=[],
                   help="SLICE=ISO: the slice's PROD-actual data cutoff; later days are not eligible")
    d.add_argument("--input-days", action="append", default=[],
                   help='{"<slice>": {"YYYY-MM-DD": rows}} of the slice\'s Transform inputs (repeatable); a day needs rows on both sides')
    d.add_argument("--lookback-days", type=int, help="only the most recent N complete UTC days are eligible (a bounded choice)")
    d.add_argument("--catalog", help="PROD-actuals catalog; a slice without an eligible day also gets its blockedHandoffs")
    d.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    if args.command == "data-days":
        now = parse_utc(args.now) if args.now else datetime.now(timezone.utc)
        cutoffs = dict(v.split("=", 1) for v in args.data_through)
        merged = {name: counts for path in args.slice_days for name, counts in read_json(path).items()}
        inputs = {name: counts for path in args.input_days for name, counts in read_json(path).items()}
        result = data_days(merged, args.day, args.most_recent, now, cutoffs, inputs or None, args.lookback_days,
                           read_json(args.catalog) if args.catalog else None)
        write_json(args.out, result)
        print(json.dumps(result, indent=1))
        return 0 if result["status"] == "OK" else 1
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
