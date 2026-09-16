import { describe, expect, it } from "vitest";

import {
  estimateRoofAge,
  roofAgeEstimateSchema,
} from "../src/roof-age/estimator.js";
import {
  alphaPermit,
  dateEvidence,
  estimatorInput,
  missingDate,
  representativeRoofAgeProfile,
} from "./roof-age-fixtures.js";

describe("county-neutral roof-age precedence", () => {
  it("selects the latest completed replacement before newer new construction", () => {
    const result = estimateRoofAge(
      estimatorInput([
        alphaPermit("replacement-old", {
          closeDate: dateEvidence("2018-04-02"),
        }),
        alphaPermit("new-construction-newer", {
          work: "New residence",
          completionDate: dateEvidence("2024-01-10"),
        }),
        alphaPermit("replacement-latest", {
          completionDate: dateEvidence("2022-06-20"),
        }),
      ]),
      representativeRoofAgeProfile,
    );

    expect(result.anchor).toEqual({
      type: "permit_terminal_date",
      date: "2022-06-20",
      source: {
        sourceSystem: "source-alpha",
        sourceRecordId: "replacement-latest",
        dateField: "completionDate",
      },
    });
    expect(result.estimatedAgeYears).toBe(4);
    expect(result.confidence).toBe("high");
    expect(result.workClassification).toBe("primary_roof_replacement");
    expect(result.eligibility).toEqual({
      eligible: true,
      reason: "accepted_completed_primary_roof_replacement",
    });
  });

  it("uses the latest completed new construction only when no replacement qualifies", () => {
    const result = estimateRoofAge(
      estimatorInput([
        alphaPermit("new-old", {
          work: "New residence",
          closeDate: dateEvidence("2005-03-10"),
        }),
        alphaPermit("new-latest", {
          work: "New residence",
          completionDate: dateEvidence("2010-07-01"),
        }),
      ]),
      representativeRoofAgeProfile,
    );

    expect(result.anchor).toMatchObject({
      type: "permit_terminal_date",
      date: "2010-07-01",
      source: { sourceRecordId: "new-latest" },
    });
    expect(result.confidence).toBe("medium");
    expect(result.workClassification).toBe(
      "primary_roof_new_construction",
    );
  });

  it("is stable across permit input order and deterministic ties", () => {
    const permits = [
      alphaPermit("record-b", {
        completionDate: dateEvidence("2020-01-02"),
      }),
      alphaPermit("record-a", {
        completionDate: dateEvidence("2020-01-02"),
      }),
    ];
    const forward = estimateRoofAge(
      estimatorInput(permits),
      representativeRoofAgeProfile,
    );
    const reversed = estimateRoofAge(
      estimatorInput([...permits].reverse()),
      representativeRoofAgeProfile,
    );

    expect(forward).toStrictEqual(reversed);
    expect(forward.anchor).toMatchObject({
      source: { sourceRecordId: "record-a" },
    });
  });
});

describe("excluded permit evidence", () => {
  it("does not let an open replacement reset age", () => {
    const result = estimateRoofAge(
      estimatorInput([
        alphaPermit("open-replacement", {
          status: "Issued",
          completionDate: dateEvidence("2025-02-01"),
        }),
      ]),
      representativeRoofAgeProfile,
    );

    expect(result.anchor).toMatchObject({
      type: "property_built_year",
      year: 1998,
    });
    expect(result.confidence).toBe("low");
    expect(
      result.evidence.permitOutcomeCounts
        .excludedOpenPrimaryRoofReplacement,
    ).toBe(1);
  });

  it.each([
    "Roof repair",
    "Elastomeric roof coating",
    "Gazebo",
    "Awning",
    "Detached garage roof",
  ])("never treats %s as a primary-roof reset", (work) => {
    const result = estimateRoofAge(
      estimatorInput([
        alphaPermit(`excluded-${work}`, {
          work,
          completionDate: dateEvidence("2025-05-01"),
        }),
      ]),
      representativeRoofAgeProfile,
    );

    expect(result.anchor?.type).toBe("property_built_year");
    expect(
      result.evidence.permitOutcomeCounts.excludedNonResettingWork,
    ).toBe(1);
  });

  it("does not synthesize a terminal date when completion and close are missing", () => {
    const result = estimateRoofAge(
      estimatorInput([
        alphaPermit("missing-terminal", {
          completionDate: missingDate,
          closeDate: missingDate,
        }),
      ]),
      representativeRoofAgeProfile,
    );

    expect(result.anchor?.type).toBe("property_built_year");
    expect(
      result.evidence.permitOutcomeCounts.excludedMissingTerminalDate,
    ).toBe(1);
  });

  it("excludes quarantined, impossible, future, and chronologically invalid dates", () => {
    const result = estimateRoofAge(
      estimatorInput([
        alphaPermit("quarantined", {
          completionDate: dateEvidence(
            "2020-01-01",
            "invalid_quarantined",
          ),
        }),
        alphaPermit("impossible", {
          completionDate: dateEvidence("2023-02-30"),
        }),
        alphaPermit("future", {
          completionDate: dateEvidence("2026-09-15"),
        }),
        alphaPermit("chronology-invalid", {
          completionDate: dateEvidence("2020-01-01"),
          chronologyStartDate: dateEvidence("2020-01-02"),
        }),
      ]),
      representativeRoofAgeProfile,
    );

    expect(result.anchor?.type).toBe("property_built_year");
    expect(result.evidence.permitOutcomeCounts).toMatchObject({
      excludedInvalidOrQuarantinedTerminalDate: 2,
      excludedFutureTerminalDate: 1,
      excludedChronologyInvalidTerminalDate: 1,
    });
  });
});

describe("fallback, as-of, and coverage semantics", () => {
  it("uses a valid property built year as a low-confidence fallback", () => {
    const result = estimateRoofAge(
      estimatorInput([]),
      representativeRoofAgeProfile,
    );

    expect(result.anchor).toEqual({
      type: "property_built_year",
      year: 1998,
      source: {
        sourceSystem: "property-appraiser",
        sourceRecordId: "parcel-1",
        field: "property_structure_built_year",
      },
    });
    expect(result.estimatedAgeYears).toBe(28);
    expect(result.confidence).toBe("low");
    expect(result.eligibility.reason).toBe("accepted_property_built_year");
  });

  it("returns an ineligible no-anchor result instead of guessing", () => {
    const result = estimateRoofAge(
      estimatorInput([], { builtYear: null }),
      representativeRoofAgeProfile,
    );

    expect(result).toMatchObject({
      anchor: null,
      estimatedAgeYears: null,
      confidence: "none",
      workClassification: null,
      eligibility: { eligible: false, reason: "no_valid_anchor" },
    });
    expect(() => roofAgeEstimateSchema.parse(result)).not.toThrow();
  });

  it("rejects a future built year as an anchor", () => {
    const result = estimateRoofAge(
      estimatorInput([], {
        builtYear: {
          year: 2027,
          evidenceState: "confirmed_present",
          sourceSystem: "property-appraiser",
          sourceRecordId: "parcel-1",
          field: "home_year",
        },
      }),
      representativeRoofAgeProfile,
    );

    expect(result.eligibility).toEqual({
      eligible: false,
      reason: "no_valid_anchor",
    });
  });

  it("uses whole elapsed years at the as-of boundary", () => {
    const permit = alphaPermit("boundary", {
      completionDate: dateEvidence("2020-09-15"),
    });
    const beforeAnniversary = estimateRoofAge(
      estimatorInput([permit], { asOfDate: "2026-09-14" }),
      representativeRoofAgeProfile,
    );
    const onAnniversary = estimateRoofAge(
      estimatorInput([permit], { asOfDate: "2026-09-15" }),
      representativeRoofAgeProfile,
    );

    expect(beforeAnniversary.estimatedAgeYears).toBe(5);
    expect(onAnniversary.estimatedAgeYears).toBe(6);
  });

  it("qualifies partial history without changing anchor confidence or eligibility", () => {
    const result = estimateRoofAge(
      estimatorInput(
        [
          alphaPermit("replacement", {
            completionDate: dateEvidence("2020-01-01"),
          }),
        ],
        {
          historicalCoverage: {
            state: "partial",
            caveats: ["source_cap", "predecessor_gap"],
          },
        },
      ),
      representativeRoofAgeProfile,
    );

    expect(result.confidence).toBe("high");
    expect(result.eligibility.eligible).toBe(true);
    expect(result.historicalCoverage).toEqual({
      state: "partial",
      caveats: ["partial_history", "predecessor_gap", "source_cap"],
    });
  });

  it.each([
    ["unknown", "history_unknown"],
    ["unavailable", "history_unavailable"],
  ] as const)("encodes %s historical coverage explicitly", (state, caveat) => {
    const result = estimateRoofAge(
      estimatorInput([], {
        historicalCoverage: { state, caveats: [] },
      }),
      representativeRoofAgeProfile,
    );

    expect(result.historicalCoverage.caveats).toContain(caveat);
    expect(result.eligibility.eligible).toBe(true);
  });
});
