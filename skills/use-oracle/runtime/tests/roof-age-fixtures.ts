import type {
  RoofAgeEstimatorInput,
  RoofAgePermitEvidence,
  RoofAgeProfile,
} from "../src/roof-age/estimator.js";

export const representativeRoofAgeProfile = {
  version: "representative-roof-v1",
  sources: [
    {
      sourceSystem: "source-alpha",
      statusMappings: [
        { field: "status", value: "Finaled", status: "completed" },
        { field: "status", value: "Issued", status: "open" },
        { field: "status", value: "Cancelled", status: "other" },
      ],
      workMappings: [
        {
          field: "permit_type",
          value: "Reroof",
          classification: "primary_roof_replacement",
        },
        {
          field: "permit_type",
          value: "New residence",
          classification: "primary_roof_new_construction",
        },
        {
          field: "permit_type",
          value: "Roof repair",
          classification: "repair_or_coating",
        },
        {
          field: "permit_type",
          value: "Elastomeric roof coating",
          classification: "repair_or_coating",
        },
        {
          field: "permit_type",
          value: "Gazebo",
          classification: "accessory_roof",
        },
        {
          field: "permit_type",
          value: "Awning",
          classification: "accessory_roof",
        },
        {
          field: "permit_type",
          value: "Detached garage roof",
          classification: "accessory_roof",
        },
      ],
    },
    {
      sourceSystem: "source-beta",
      statusMappings: [
        { field: "workflow_status", value: "Complete", status: "completed" },
        { field: "workflow_status", value: "Active", status: "open" },
        { field: "workflow_status", value: "Void", status: "other" },
      ],
      workMappings: [
        {
          field: "work_class",
          value: "Residential roof replacement",
          classification: "primary_roof_replacement",
        },
        {
          field: "work_class",
          value: "New single-family dwelling",
          classification: "primary_roof_new_construction",
        },
        {
          field: "work_class",
          value: "Silicone roof coating",
          classification: "repair_or_coating",
        },
        {
          field: "work_class",
          value: "Pool cabana roof",
          classification: "accessory_roof",
        },
      ],
    },
  ],
} satisfies RoofAgeProfile;

export const missingDate = {
  value: null,
  evidenceState: "unknown",
} as const;

export function dateEvidence(
  value: string,
  evidenceState: "confirmed_present" | "invalid_quarantined" =
    "confirmed_present",
) {
  return { value, evidenceState } as const;
}

export function alphaPermit(
  sourceRecordId: string,
  {
    status = "Finaled",
    work = "Reroof",
    completionDate = missingDate,
    closeDate = missingDate,
    chronologyStartDate = null,
  }: {
    status?: string;
    work?: string;
    completionDate?: RoofAgePermitEvidence["completionDate"];
    closeDate?: RoofAgePermitEvidence["closeDate"];
    chronologyStartDate?: RoofAgePermitEvidence["chronologyStartDate"];
  } = {},
): RoofAgePermitEvidence {
  return {
    sourceSystem: "source-alpha",
    sourceRecordId,
    statusEvidence: [{ field: "status", value: status }],
    workEvidence: [{ field: "permit_type", value: work }],
    completionDate,
    closeDate,
    chronologyStartDate,
  };
}

export function betaPermit(
  sourceRecordId: string,
  {
    status = "Complete",
    work = "Residential roof replacement",
    completionDate = missingDate,
    closeDate = missingDate,
    chronologyStartDate = null,
  }: {
    status?: string;
    work?: string;
    completionDate?: RoofAgePermitEvidence["completionDate"];
    closeDate?: RoofAgePermitEvidence["closeDate"];
    chronologyStartDate?: RoofAgePermitEvidence["chronologyStartDate"];
  } = {},
): RoofAgePermitEvidence {
  return {
    sourceSystem: "source-beta",
    sourceRecordId,
    statusEvidence: [{ field: "workflow_status", value: status }],
    workEvidence: [{ field: "work_class", value: work }],
    completionDate,
    closeDate,
    chronologyStartDate,
  };
}

export function estimatorInput(
  permits: RoofAgePermitEvidence[],
  overrides: Partial<RoofAgeEstimatorInput> = {},
): RoofAgeEstimatorInput {
  return {
    asOfDate: "2026-09-14",
    builtYear: {
      year: 1998,
      evidenceState: "confirmed_present",
      sourceSystem: "property-appraiser",
      sourceRecordId: "parcel-1",
      field: "property_structure_built_year",
    },
    permits,
    historicalCoverage: { state: "complete", caveats: [] },
    ...overrides,
  };
}
