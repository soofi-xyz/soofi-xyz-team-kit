#!/usr/bin/env python3
"""Test evidence distinctions using synthetic records; does not execute AWS workflows."""

import copy
import importlib.util
import json
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("acceptance", Path(__file__).with_name("check-system-acceptance.py"))
acceptance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(acceptance)


class AcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.scenarios = json.loads(acceptance.SCENARIOS.read_text())
        self.records = [{
            "phase": "framework-acceptance",
            "scenarioId": scenario["id"], "caseId": case["id"],
            "configurationId": f"synthetic-{case['configuration']}", "requestId": "synthetic-test-request",
            "iteration": 1, "featureId": case["featureId"], "invokedBy": "user",
            "logReference": f"synthetic-log/{scenario['id']}/{case['id']}",
            "executionArn": f"arn:aws:states:us-east-2:000000000000:execution:synthetic-test:{scenario['id']}-{case['id']}",
            "actualResponse": copy.deepcopy(case["expectedResponse"]),
            "observedSteps": list(case["expectedSteps"]),
            "humanObservation": "Synthetic test record; no human walkthrough was performed.",
            "mocked": True,
        } for scenario in self.scenarios["scenarios"] for case in scenario["cases"]]

    def test_complete_record_matches_expected_outcomes(self):
        self.assertEqual(acceptance.check(self.records, self.scenarios), [])

    def test_demonstration_does_not_prove_framework_acceptance(self):
        self.records[0]["phase"] = "demonstration"
        self.assertTrue(any("not framework acceptance" in e for e in acceptance.check(self.records, self.scenarios)))

    def test_missing_binding_case_does_not_complete_scenario_coverage(self):
        records = [r for r in self.records if r["featureId"] != "template-bindings"]
        self.assertTrue(any("alternate-binding: missing" in e for e in acceptance.check(records, self.scenarios)))

    def test_aws_logs_and_user_invocation_are_required(self):
        self.records[0].pop("logReference")
        self.records[0]["invokedBy"] = "agent"
        errors = acceptance.check(self.records, self.scenarios)
        self.assertTrue(any("logReference" in e for e in errors))
        self.assertTrue(any("user-run" in e for e in errors))

    def test_wrong_feature_cannot_substitute_for_required_case(self):
        self.records[0]["featureId"] = "retry-policy"
        self.assertTrue(any("expected product feature" in e for e in acceptance.check(self.records, self.scenarios)))

    def test_feature_plan_can_have_more_than_four_pieces(self):
        for index, record in enumerate(self.records, start=5):
            record["iteration"] = index
        self.assertEqual(acceptance.check(self.records, self.scenarios), [])

    def test_reordering_or_subdividing_preserves_case_evidence(self):
        for index, record in enumerate(reversed(self.records), start=1):
            record["iteration"] = index * 2
        self.assertEqual(acceptance.check(self.records, self.scenarios), [])

    def test_missing_or_invalid_iteration_is_rejected(self):
        for value in (None, 0, -1, True, "4"):
            with self.subTest(iteration=value):
                self.records[0]["iteration"] = value
                self.assertTrue(any("positive index" in e for e in acceptance.check(self.records, self.scenarios)))

    def test_same_configuration_cannot_prove_four_variants(self):
        for record in self.records:
            record["configurationId"] = "one-configuration"
        self.assertTrue(any("distinct configuration identities" in e for e in acceptance.check(self.records, self.scenarios)))

    def test_alternate_binding_must_change_observed_behavior(self):
        variant = next(r for r in self.records if r["caseId"] == "alternate-binding")
        variant["actualResponse"]["amount"] = 12.5
        self.assertTrue(any("response differs" in e for e in acceptance.check(self.records, self.scenarios)))

    def test_missing_human_observation_and_trace_fail(self):
        self.records[0].pop("humanObservation")
        self.records[0].pop("executionArn")
        errors = acceptance.check(self.records, self.scenarios)
        self.assertTrue(any("humanObservation" in e for e in errors))
        self.assertTrue(any("execution ARN" in e for e in errors))

    def test_rejected_input_cannot_schedule_or_persist(self):
        rejected = next(r for r in self.records if r["caseId"] == "rejected")
        rejected["actualResponse"]["scheduled"] = 1
        rejected["observedSteps"].append("Persist")
        errors = acceptance.check(self.records, self.scenarios)
        self.assertTrue(any("response differs" in e for e in errors))
        self.assertTrue(any("steps differ" in e for e in errors))

    def test_missing_failure_case_cannot_be_replaced_by_duplicate_success(self):
        self.records.pop()
        self.records.append(copy.deepcopy(self.records[0]))
        errors = acceptance.check(self.records, self.scenarios)
        self.assertTrue(any("duplicate evidence" in e for e in errors))
        self.assertTrue(any("all-failed: missing" in e for e in errors))

    def test_local_and_real_tests_do_not_stand_in_for_mock_execution(self):
        self.records[0]["executionArn"] = "local-simulator"
        self.records[0]["mocked"] = False
        self.assertGreaterEqual(len(acceptance.check(self.records, self.scenarios)), 2)

    def test_boolean_cannot_replace_a_count(self):
        eligible = next(r for r in self.records if r["caseId"] == "eligible")
        eligible["actualResponse"]["scheduled"] = True
        self.assertTrue(any("response differs" in e for e in acceptance.check(self.records, self.scenarios)))


if __name__ == "__main__":
    unittest.main()
