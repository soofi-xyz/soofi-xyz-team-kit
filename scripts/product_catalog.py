#!/usr/bin/env python3
"""Validate product ownership and render the README product map.

Run `python3 scripts/product_catalog.py sync` after catalog/agent changes.
Run `python3 scripts/product_catalog.py check` in validation.
This validates plugin contracts; it does not claim live product readiness.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = Path("skills/guide-product-work/reference/product-catalog.json")
START = "<!-- product-catalog:start -->"
END = "<!-- product-catalog:end -->"
NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def metadata(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n") or "\n---\n" not in text[4:]:
        raise ValueError(f"{path}: missing frontmatter")
    frontmatter = text.split("\n---\n", 1)[0][4:]
    return {key: value.strip().strip('\"\'') for key, value in
            re.findall(r"^([\w-]+):\s*(.*)$", frontmatter, re.M)}


def validate(catalog: dict, root: Path = ROOT) -> list[str]:
    root = root.resolve()
    errors: list[str] = []
    seen_products: set[str] = set()
    owners: dict[str, str] = {}
    aliases: dict[str, str] = {}
    workflow = catalog.get("workflowSkill", "")
    if catalog.get("catalogVersion") != 1:
        errors.append("unsupported catalogVersion")
    if not NAME.fullmatch(workflow) or not (root / "skills" / workflow / "SKILL.md").is_file():
        errors.append("workflowSkill must name an existing skill")
    for product in catalog.get("products", []):
        pid = product.get("id", "")
        if not NAME.fullmatch(pid) or pid in seen_products:
            errors.append(f"invalid or duplicate product id: {pid!r}")
        seen_products.add(pid)
        for label in [product.get("name", ""), *product.get("legacyNames", [])]:
            key = label.casefold()
            if not key or (key in aliases and aliases[key] != pid):
                errors.append(f"ambiguous or empty product name: {label!r}")
            aliases[key] = pid
        status = product.get("status")
        if status not in {"assigned", "unassigned"}:
            errors.append(f"{pid}: invalid assignment status")
        guide = f"skills/{workflow}/reference/iterations/{pid}.md"
        if status == "assigned":
            if product.get("iterationGuide") != guide:
                errors.append(f"{pid}: iterationGuide must identify this product's iteration plan")
            if not (root / guide).is_file():
                errors.append(f"{pid}: missing product iteration plan")
        for role in ("build", "configure"):
            agent = product.get("agents", {}).get(role)
            skill = product.get("skills", {}).get(role)
            if status == "unassigned":
                if agent is not None or skill is not None:
                    errors.append(f"{pid}: unassigned product has an active {role} role")
                continue
            if not isinstance(agent, str) or not NAME.fullmatch(agent):
                errors.append(f"{pid}: missing {role} agent")
                continue
            if agent in owners:
                errors.append(f"{agent}: duplicate ownership ({owners[agent]}, {pid}/{role})")
            owners[agent] = f"{pid}/{role}"
            path = root / "agents" / f"{agent}.md"
            if not path.is_file():
                errors.append(f"{pid}: missing agent {agent}")
            else:
                fields = metadata(path)
                if (fields.get("name"), fields.get("product"), fields.get("role")) != (agent, pid, role):
                    errors.append(f"{agent}: frontmatter disagrees with catalog ownership")
                if f"skills/{workflow}/SKILL.md" not in path.read_text():
                    errors.append(f"{agent}: missing shared workflow reference")
                if guide not in path.read_text():
                    errors.append(f"{agent}: missing product iteration plan reference")
            if not isinstance(skill, str) or not NAME.fullmatch(skill) or not (root / "skills" / skill / "SKILL.md").is_file():
                errors.append(f"{pid}: missing {role} skill {skill!r}")
            elif f"../{workflow}/reference/iterations/{pid}.md" not in (root / "skills" / skill / "SKILL.md").read_text():
                errors.append(f"{pid}: {role} skill does not load product iteration plan")
    installed = {p.stem for p in (root / "agents").glob("*.md")}
    retained_names = catalog.get("retainedAgents", [])
    retained = set(retained_names)
    if len(retained) != len(retained_names):
        errors.append("retained agent inventory contains duplicates")
    if "archivedAgents" in catalog:
        errors.append("use retainedAgents for installed specialists outside the README roster")
    if retained & set(owners):
        errors.append(f"featured product owners are also listed as retained: {sorted(retained & set(owners))}")
    for agent in sorted(retained):
        if not isinstance(agent, str) or not NAME.fullmatch(agent):
            errors.append(f"invalid retained agent name: {agent!r}")
            continue
        path = root / "agents" / f"{agent}.md"
        if not path.is_file():
            errors.append(f"missing installed retained agent: {agent}")
        else:
            fields = metadata(path)
            if fields.get("name") != agent:
                errors.append(f"{agent}: retained agent name disagrees with its file")
            if fields.get("product") or fields.get("role"):
                errors.append(f"{agent}: retained specialist cannot claim an uncataloged product role")
    expected_agents = set(owners) | retained
    if installed != expected_agents:
        errors.append(f"installed agents differ from featured and retained inventory: {sorted(installed ^ expected_agents)}")

    # Follow references from every installed agent, including those omitted from
    # the README, and check every local Markdown reference they load.
    pending = list((root / "agents").glob("*.md"))
    for product in catalog.get("products", []):
        for skill in product.get("skills", {}).values():
            if isinstance(skill, str):
                pending.append(root / "skills" / skill / "SKILL.md")
    checked: set[Path] = set()
    while pending:
        path = pending.pop().resolve()
        if path in checked or not path.is_file() or not path.is_relative_to(root.resolve()):
            continue
        checked.add(path)
        content = path.read_text()
        for match in re.finditer(r"\b(?:use|via|to|with|ask|invoke|delegate to)\s+[`*]*([a-z][a-z0-9-]*)[`*]*\b", content, re.I):
            target = match.group(1).lower()
            if target == "unown":
                errors.append(f"{path.relative_to(root)}: unavailable agent handoff to {target}")
        for target in re.findall(r"\]\(([^)]+\.md)(?:#[^)]*)?\)", content):
            if "://" in target:
                continue
            linked = (path.parent / target).resolve()
            if not linked.is_file():
                errors.append(f"{path.relative_to(root)}: missing reference {target}")
            else:
                pending.append(linked)
    return sorted(set(errors))


def render(catalog: dict) -> str:
    rows = [START, "", "| Product | What it does | Build and maintain | Configure and test |",
            "| --- | --- | --- | --- |"]
    for product in catalog["products"]:
        if product["status"] != "assigned":
            continue
        build, configure = (product["agents"][role] for role in ("build", "configure"))
        rows.append(f"| **{product['name']}** | {product['summary']} | [`{build}`](./agents/{build}.md) | [`{configure}`](./agents/{configure}.md) |")
    unassigned = ", ".join(p["name"] for p in catalog["products"] if p["status"] == "unassigned")
    rows += ["", "**Catalog products awaiting scoped ownership:** " + unassigned + ".",
             "", "Unassigned means no dedicated builder/configurer pair is assigned in this catalog. Retained specialists remain available; assignment does not establish deployment.",
             "", END]
    return "\n".join(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("check", "sync"), nargs="?", default="check")
    args = parser.parse_args()
    catalog = json.loads((ROOT / CATALOG).read_text())
    errors = validate(catalog)
    readme = ROOT / "README.md"
    text = readme.read_text()
    if text.count(START) != 1 or text.count(END) != 1:
        errors.append("README must contain exactly one product-catalog marker pair")
    else:
        before, rest = text.split(START)
        _, after = rest.split(END)
        expected = before + render(catalog) + after
        if args.command == "sync" and not errors:
            readme.write_text(expected)
        elif text != expected:
            errors.append("README product map is stale; run python3 scripts/product_catalog.py sync")
    if errors:
        print("\n".join(errors))
        return 1
    print(f"product catalog {args.command}: {len(catalog['products'])} products, "
          f"{sum(p['status'] == 'assigned' for p in catalog['products'])} featured pairs, "
          f"{len(catalog.get('retainedAgents', []))} retained agents")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
