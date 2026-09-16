import { describe, expect, it } from "vitest";

import {
  reconcileRoofAgeBatch,
  resolveCanonicalRoofAge,
  type RoofAgePermitRow,
  type RoofAgePropertyRecord,
} from "../src/roof-age/integration.js";
import { productionRoofAgeProfile } from "../src/roof-age/production-profile.js";

const coverage = { state: "complete", caveats: [] } satisfies {
  state: "complete";
  caveats: [];
};

function permit(
  id: string,
  overrides: Partial<RoofAgePermitRow> = {},
): RoofAgePermitRow {
  return {
    sourceSystem: "broward_pembroke_pines_tyler_permits",
    sourceRecordId: id,
    improvementStatus: "Complete",
    improvementType: "Roof Replacement",
    completionDate: "2022-06-15",
    closeDate: null,
    applicationDate: "2022-05-01",
    ...overrides,
  };
}

function property(
  overrides: Partial<RoofAgePropertyRecord> = {},
): RoofAgePropertyRecord {
  return {
    propertyId: "property-1",
    structureId: "structure-1",
    sourceSystem: "broward_appraiser",
    sourceRecordId: "parcel-1",
    builtYear: 1998,
    roofDate: null,
    roofAgeYears: null,
    sourcePayload: {},
    permits: [],
    ...overrides,
  };
}

function resolve(record: RoofAgePropertyRecord) {
  return resolveCanonicalRoofAge(record, {
    asOfDate: "2026-09-14",
    historicalCoverage: coverage,
    profile: productionRoofAgeProfile,
  });
}

describe("roof-age ingest integration", () => {
  it("preserves explicit date and age and rejects older permit regression", () => {
    const result = resolve(
      property({
        roofDate: "2021-08-20",
        roofAgeYears: 4,
        permits: [
          permit("older", {
            completionDate: "2020-01-10",
            applicationDate: "2019-12-01",
          }),
        ],
      }),
    );
    expect(result.source).toBe("explicit_parcel_roof_date");
    expect(result.roofDate).toBe("2021-08-20");
    expect(result.roofAgeYears).toBe(4);
    expect(result.selectedPermit).toBeNull();
  });

  it("overlays only a later completed replacement or upgrade", () => {
    for (const improvementType of ["Roof Replacement", "Roof Upgrade"]) {
      const result = resolve(
        property({
          roofDate: "2018",
          roofAgeYears: 8,
          permits: [permit(improvementType, { improvementType })],
        }),
      );
      expect(result.source).toBe("permit_updated");
      expect(result.roofDate).toBe("2022-06-15");
      expect(result.roofDatePrecision).toBe("day");
      expect(result.roofAgeYears).toBe(4);
      expect(result.selectedPermit?.sourceRecordId).toBe(improvementType);
    }
  });

  it("does not synthesize a date from explicit age alone", () => {
    const result = resolve(
      property({
        roofAgeYears: 7,
        permits: [permit("cannot-compare")],
      }),
    );
    expect(result.source).toBe("explicit_parcel_roof_age");
    expect(result.roofDate).toBeNull();
    expect(result.roofDatePrecision).toBe("none");
    expect(result.roofAgeYears).toBe(7);
  });

  it("uses construction year with year precision when source roof evidence is absent", () => {
    const result = resolve(property({ builtYear: 1998 }));
    expect(result).toMatchObject({
      source: "construction_year_default",
      roofDate: "1998",
      roofDatePrecision: "year",
      roofAgeYears: 28,
      confidence: "low",
      eligibility: { reason: "accepted_property_built_year" },
    });
  });

  it("excludes open, repair, coating, and accessory work", () => {
    const records = [
      permit("open", { improvementStatus: "Issued" }),
      permit("repair", { improvementType: "Roof Repair" }),
      permit("coating", { improvementType: "Silicone Roof Coating" }),
      permit("gazebo", { improvementType: "Gazebo" }),
      permit("awning", { improvementType: "Awning" }),
      permit("garage", { improvementType: "Detached Garage Roof" }),
    ];
    const result = resolve(property({ permits: records }));
    expect(result.source).toBe("construction_year_default");
    expect(result.estimatorEvidence.permitOutcomeCounts).toMatchObject({
      excludedOpenPrimaryRoofReplacement: 1,
      excludedNonResettingWork: 5,
    });
  });

  it("rejects invalid, quarantined, future, and chronology-invalid dates", () => {
    const records = [
      permit("invalid", { completionDate: "2022-02-30" }),
      permit("quarantined", {
        completionDate: "2022-06-01",
        sourcePayload: {
          roofAgeEvidenceStates: {
            completionDate: "invalid_quarantined",
          },
        },
      }),
      permit("future", { completionDate: "2027-01-01" }),
      permit("chronology", {
        completionDate: "2022-01-01",
        applicationDate: "2022-02-01",
      }),
    ];
    const result = resolve(property({ permits: records }));
    expect(result.source).toBe("construction_year_default");
    expect(result.estimatorEvidence.permitOutcomeCounts).toMatchObject({
      excludedInvalidOrQuarantinedTerminalDate: 2,
      excludedFutureTerminalDate: 1,
      excludedChronologyInvalidTerminalDate: 1,
    });
    const invalidExplicit = resolve(
      property({ roofDate: "2027-01-01", builtYear: 2001 }),
    );
    expect(invalidExplicit.source).toBe("construction_year_default");
    expect(invalidExplicit.sourceEvidence.roofDateEvidenceState).toBe(
      "invalid_quarantined",
    );
  });

  it("is stable under shuffled permit order and detects stale defaults", () => {
    const permits = [
      permit("a", { completionDate: "2020-01-01" }),
      permit("b", { completionDate: "2024-03-01" }),
      permit("c", { completionDate: "2023-05-01" }),
    ];
    const first = resolve(property({ permits }));
    const second = resolve(property({ permits: [...permits].reverse() }));
    expect(second).toEqual(first);

    const prior = resolve(property());
    const reconciliation = reconcileRoofAgeBatch(
      [
        property({
          roofDate: prior.roofDate,
          roofAgeYears: prior.roofAgeYears,
          sourcePayload: { roof_age_lineage: prior },
          permits: [permit("new", { completionDate: "2024-03-01" })],
        }),
      ],
      {
        asOfDate: "2026-09-14",
        historicalCoverage: coverage,
        profile: productionRoofAgeProfile,
      },
    );
    expect(reconciliation.summary).toMatchObject({
      staleDefaultsSuperseded: 1,
      permitUpdatedValues: 1,
      updatedRows: 1,
    });
  });
});
