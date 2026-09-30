#!/usr/bin/env python3
"""Exercise product/role ownership failures without modifying the working tree."""

import copy
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import product_catalog as catalog


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads((catalog.ROOT / catalog.CATALOG).read_text())

    def product(self, name):
        return next(p for p in self.data["products"] if p["id"] == name)

    def test_current_roster_has_distinct_complete_pairs(self):
        self.assertEqual(catalog.validate(self.data), [])
        self.assertEqual(self.product("persist")["agents"]["build"], "conkeldurr")
        self.assertEqual(self.product("system")["agents"]["build"], "zygarde")

    def test_same_agent_cannot_own_two_products(self):
        self.product("system")["agents"]["build"] = "conkeldurr"
        self.assertTrue(any("duplicate ownership" in e for e in catalog.validate(self.data)))

    def test_role_swaps_do_not_silently_change_ownership(self):
        p = self.product("connect")
        p["agents"]["build"], p["agents"]["configure"] = p["agents"]["configure"], p["agents"]["build"]
        self.assertTrue(any("frontmatter disagrees" in e for e in catalog.validate(self.data)))

    def test_missing_or_archived_agent_cannot_be_assigned(self):
        for name in ("not-installed", "arceus"):
            with self.subTest(name=name):
                data = copy.deepcopy(self.data)
                data["products"][0]["status"] = "assigned"
                data["products"][0]["agents"] = {"build": name, "configure": "missing-configurer"}
                self.assertTrue(any("missing agent" in e for e in catalog.validate(data)))

    def test_alias_cannot_create_a_second_model_product(self):
        duplicate = copy.deepcopy(self.product("model"))
        duplicate["id"] = "second-model"
        self.data["products"].append(duplicate)
        self.assertTrue(any("ambiguous" in e for e in catalog.validate(self.data)))

    def test_unassigned_product_cannot_promise_an_agent(self):
        self.product("environment")["agents"]["build"] = "conkeldurr"
        self.assertTrue(any("unassigned product has an active" in e for e in catalog.validate(self.data)))

    def test_assigned_product_requires_its_own_iteration_plan(self):
        self.product("persist").pop("iterationGuide")
        self.assertTrue(any("persist: iterationGuide" in e for e in catalog.validate(self.data)))
        self.product("persist")["iterationGuide"] = self.product("system")["iterationGuide"]
        self.assertTrue(any("persist: iterationGuide" in e for e in catalog.validate(self.data)))

    def test_product_plan_cannot_point_outside_the_kit(self):
        self.product("persist")["iterationGuide"] = "../../external.md"
        self.assertTrue(any("persist: iterationGuide" in e for e in catalog.validate(self.data)))

    def test_retired_handoff_in_active_dependency_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(catalog.ROOT / "agents", root / "agents")
            shutil.copytree(catalog.ROOT / "archive/agents", root / "archive/agents")
            # Only the required lightweight skill entrypoints are needed here.
            for name in {self.data["workflowSkill"], *(
                skill for p in self.data["products"] for skill in p["skills"].values() if skill
            )}:
                target = root / "skills" / name / "SKILL.md"
                target.parent.mkdir(parents=True)
                target.write_text(f"---\nname: {name}\ndescription: Test fixture\n---\n")
            target = root / "skills/build-persist-service/SKILL.md"
            target.write_text(target.read_text() + "Use `machamp` for this work.\n")
            self.assertTrue(any("retired agent handoff to machamp" in e for e in catalog.validate(self.data, root)))


if __name__ == "__main__":
    unittest.main()
