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

    def test_missing_agent_cannot_be_assigned(self):
        self.product("persist")["agents"]["build"] = "not-installed"
        self.assertTrue(any("missing agent not-installed" in e for e in catalog.validate(self.data)))

    def test_retained_specialists_remain_available_outside_the_readme_roster(self):
        self.assertTrue({"arceus", "oracle", "hoopa", "mew"} <= set(self.data["retainedAgents"]))
        rendered = catalog.render(self.data)
        for name in self.data["retainedAgents"]:
            with self.subTest(agent=name):
                self.assertTrue((catalog.ROOT / "agents" / f"{name}.md").is_file())
                self.assertNotIn(f"(./agents/{name}.md)", rendered)
        self.assertIn("(./agents/conkeldurr.md)", rendered)

    def test_retained_specialist_cannot_silently_replace_product_owner(self):
        self.product("persist")["agents"]["build"] = "arceus"
        errors = catalog.validate(self.data)
        self.assertTrue(any("frontmatter disagrees" in e for e in errors))
        self.assertTrue(any("also listed as retained" in e for e in errors))

    def test_retained_inventory_cannot_reference_an_uninstalled_agent(self):
        self.data["retainedAgents"].append("not-installed")
        self.assertTrue(any("missing installed retained agent: not-installed" in e for e in catalog.validate(self.data)))

    def test_installed_agent_cannot_disappear_from_inventory(self):
        self.data["retainedAgents"].remove("oracle")
        self.assertTrue(any("installed agents differ" in e and "oracle" in e for e in catalog.validate(self.data)))

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

    def test_unavailable_handoff_in_dependency_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(catalog.ROOT / "agents", root / "agents")
            # Only the required lightweight skill entrypoints are needed here.
            for name in {self.data["workflowSkill"], *(
                skill for p in self.data["products"] for skill in p["skills"].values() if skill
            )}:
                target = root / "skills" / name / "SKILL.md"
                target.parent.mkdir(parents=True)
                target.write_text(f"---\nname: {name}\ndescription: Test fixture\n---\n")
            target = root / "skills/build-persist-service/SKILL.md"
            target.write_text(target.read_text() + "Use `unown` for this work.\n")
            self.assertTrue(any("unavailable agent handoff to unown" in e for e in catalog.validate(self.data, root)))


if __name__ == "__main__":
    unittest.main()
