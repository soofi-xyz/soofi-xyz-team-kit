#!/usr/bin/env python3

import unittest

import validate_atlas_migration as atlas


class AtlasMigrationValidationTest(unittest.TestCase):
    def test_repository_satisfies_migration_contract(self):
        self.assertEqual(atlas.validate(), [])

    def test_rejects_legacy_mcp_maps_and_specialized_tools(self):
        text = """
        PROPERTY_QUERY_TABLE_MAP={}
        Call queryPlaces and getPermitQuerySchema.
        """
        findings = atlas.legacy_findings(text)
        self.assertIn("legacy MCP environment", findings)
        self.assertIn("retired specialized MCP tool", findings)

    def test_rejects_every_retired_specialized_tool(self):
        tools = (
            "getPropertyPermits",
            "getDatasetQueryCapabilities",
            "executeDatasetQueryPlan",
            "queryHoas",
            "getHoaQuerySchema",
            "queryPlaces",
            "analyzePlaceColocation",
            "discoverPlaceColocationCandidates",
            "getPlaceQuerySchema",
            "queryPermits",
            "getPermitQuerySchema",
            "getPermitCoverage",
        )
        for tool in tools:
            with self.subTest(tool=tool):
                self.assertIn(
                    "retired specialized MCP tool",
                    atlas.legacy_findings(f"Call {tool}."),
                )

    def test_rejects_retired_publication_skills_and_county_pointers(self):
        text = """
        Run county-query-table-publish, then move oracle-query-table-lee.
        """
        findings = atlas.legacy_findings(text)
        self.assertIn("retired public skill", findings)
        self.assertIn("per-county publication pointer", findings)

    def test_rejects_external_runtime_prerequisite(self):
        findings = atlas.legacy_findings(
            "Clone " + "oracle" + "-node into a sibling checkout before running ingestion."
        )
        self.assertIn("external ingestion repository prerequisite", findings)

    def test_rejects_per_county_publication_instructions(self):
        findings = atlas.legacy_findings(
            "Publish each county to its own IPNS publication pointer."
        )
        self.assertIn("per-county publication instruction", findings)

    def test_allows_explicit_rejection_of_per_county_publication(self):
        findings = atlas.legacy_findings(
            "Do not create a per-county IPNS publication pointer."
        )
        self.assertNotIn("per-county publication instruction", findings)

    def test_allows_negative_external_runtime_constraint(self):
        findings = atlas.legacy_findings(
            "Never clone oracle-node; use the bundled runtime."
        )
        self.assertNotIn("external ingestion repository prerequisite", findings)


if __name__ == "__main__":
    unittest.main()
