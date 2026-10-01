"""Declarative field expressions and conditions for catalog-driven builders (no mapping-specific code).

An expression is one JSON object:

  {"path": "row.id"}                       dotted lookup in the scope (missing parts are None)
  {"const": value}                         a literal
  {"first": [expr, ...]}                   the first non-blank value, else ""
  {"if": expr, "then": expr, "else": expr} truthy test (true, a non-blank string, a non-empty list or object)
  {"case": [{"when": cond, "then": expr}, ...], "else": expr}
  {"normalize": expr, "as": NAME}          one of NORMALIZERS
  {"format": "a/{x}/{y}", "args": {"x": expr, "y": expr}}

A condition is one JSON object:

  {"blank": expr} | {"present": expr} | {"equals": expr, "value": v} | {"notEquals": expr, "value": v}
  {"in": expr, "values": [...]} | {"notIn": expr, "values": [...]} | {"all": [cond, ...]} | {"any": [cond, ...]}

`values` may be "language-enum:<field>", resolved from the catalog's enums. Scopes are plain dictionaries.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from prod_actuals import parse_loose
from silvally_io import SilvallyError


def text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def lookup(scope: dict, path: str):
    value = scope
    for part in path.split("."):
        if isinstance(value, dict):
            value = value.get(part)
        elif isinstance(value, list) and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        else:
            return None
    return value


def blank(value) -> bool:
    if value is None:
        return True
    if isinstance(value, bool):
        return False
    if isinstance(value, (list, dict)):
        return not value
    return not text(value).strip()


def truthy(value) -> bool:
    return value is True or (not isinstance(value, bool) and not blank(value))


def utc_millis(value) -> str:
    moment = parse_loose(value)
    if moment is None:
        return ""
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def phone10(value) -> str:
    digits = re.sub(r"\D", "", text(value))
    return digits[1:] if len(digits) == 11 and digits.startswith("1") else (digits if len(digits) == 10 else "")


def status_token(value) -> str:
    raw = text(value).strip()
    return re.sub(r"[\s-]+", "_", re.sub(r"([a-z])([A-Z])", r"\1_\2", raw)).upper()


def as_int(value):
    raw = text(value).strip()
    return int(raw) if re.fullmatch(r"-?\d+", raw) else None


def utc_date_path(value) -> str:
    moment = parse_loose(value)
    return moment.astimezone(timezone.utc).strftime("%Y/%m/%d") if isinstance(moment, datetime) else ""


NORMALIZERS = {
    "trim": lambda v: text(v).strip(),
    "utc-millis": utc_millis,
    "phone10": phone10,
    "status-token": status_token,
    "int": as_int,
    "utc-date-path": utc_date_path,
    "single-line-pipe-safe": lambda v: None if v is None else re.sub(r"\r\n|\r|\n", " ", text(v)).replace("|", " "),
    "digits": lambda v: re.sub(r"\D", "", text(v)),
}


def evaluate(expr, scope: dict):
    if not isinstance(expr, dict) or len({"path", "const", "first", "if", "case", "normalize", "format"} & set(expr)) != 1:
        raise SilvallyError(f"malformed catalog expression {expr!r}")
    if "path" in expr:
        return lookup(scope, expr["path"])
    if "const" in expr:
        return expr["const"]
    if "first" in expr:
        return next((v for v in (evaluate(e, scope) for e in expr["first"]) if not blank(v)), "")
    if "if" in expr:
        return evaluate(expr["then"] if truthy(evaluate(expr["if"], scope)) else expr["else"], scope)
    if "case" in expr:
        for branch in expr["case"]:
            if condition(branch["when"], scope):
                return evaluate(branch["then"], scope)
        return evaluate(expr["else"], scope) if "else" in expr else None
    if "normalize" in expr:
        name = expr.get("as")
        if name not in NORMALIZERS:
            raise SilvallyError(f"unknown normalizer {name!r}; use one of {sorted(NORMALIZERS)}")
        return NORMALIZERS[name](evaluate(expr["normalize"], scope))
    return expr["format"].format(**{k: text(evaluate(v, scope)) for k, v in expr.get("args", {}).items()})


def resolve_values(values, enums: dict | None) -> list:
    if isinstance(values, str) and values.startswith("language-enum:"):
        name = values.split(":", 1)[1]
        if name not in (enums or {}):
            raise SilvallyError(f"catalog names enum {name!r} but declares no such enum")
        return list(enums[name])
    return list(values)


def condition(cond: dict, scope: dict, enums: dict | None = None) -> bool:
    if "all" in cond:
        return all(condition(c, scope, enums) for c in cond["all"])
    if "any" in cond:
        return any(condition(c, scope, enums) for c in cond["any"])
    if "blank" in cond:
        return blank(evaluate(cond["blank"], scope))
    if "present" in cond:
        return not blank(evaluate(cond["present"], scope))
    if "equals" in cond:
        return text(evaluate(cond["equals"], scope)) == text(cond["value"])
    if "notEquals" in cond:
        return text(evaluate(cond["notEquals"], scope)) != text(cond["value"])
    if "in" in cond:
        return text(evaluate(cond["in"], scope)) in {text(v) for v in resolve_values(cond["values"], enums)}
    if "notIn" in cond:
        return text(evaluate(cond["notIn"], scope)) not in {text(v) for v in resolve_values(cond["values"], enums)}
    raise SilvallyError(f"malformed catalog condition {cond!r}")
