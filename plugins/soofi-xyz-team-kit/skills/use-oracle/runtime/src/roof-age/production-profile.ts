import type { RoofAgeProfile } from "./estimator.ts";

export const PRODUCTION_ROOF_AGE_PROFILE_VERSION =
  "oracle-production-roof-profile-v1";

const COMPLETED_STATUSES = ["Complete", "Completed", "Closed", "Finaled"];
const OPEN_STATUSES = ["Active", "Applied", "Issued", "Open", "Pending"];
const OTHER_STATUSES = ["Cancelled", "Canceled", "Expired", "Void", "Withdrawn"];

const REPLACEMENT_WORK = [
  "Commercial Roof Upgrade",
  "Re-Roof",
  "Reroof",
  "Residential Miscellaneous - Residential New Roof",
  "Residential New Roof",
  "Residential Roof Upgrade",
  "Roof Replacement",
  "Roof Upgrade",
];
const NEW_CONSTRUCTION_WORK = [
  "Commercial New Construction",
  "New Single Family Residence",
  "New Single-Family Dwelling",
  "New Single-Family Residence",
];
const REPAIR_WORK = [
  "Elastomeric Roof Coating",
  "Roof Coating",
  "Roof Repair",
  "Silicone Roof Coating",
];
const ACCESSORY_WORK = [
  "Awning",
  "Detached Garage Roof",
  "Gazebo",
  "Pool Cabana Roof",
];

export const PRODUCTION_ROOF_AGE_SOURCE_SYSTEMS = Object.freeze([
  "broward_pembroke_pines_tyler_permits",
  "broward_sunrise_tyler_permits",
]);

export const PRODUCTION_APPRAISAL_ROOF_SEMANTICS = Object.freeze({
  duval_appraiser: {
    roofDateIsConstructionYearAlias: true,
  },
});

function statusMappings(
  values: readonly string[],
  status: "completed" | "open" | "other",
): RoofAgeProfile["sources"][number]["statusMappings"] {
  return values.map((value) => ({
    field: "improvement_status",
    value,
    status,
  }));
}

function workMappings(
  values: readonly string[],
  classification:
    | "primary_roof_replacement"
    | "primary_roof_new_construction"
    | "repair_or_coating"
    | "accessory_roof",
): RoofAgeProfile["sources"][number]["workMappings"] {
  return values.map((value) => ({
    field: "improvement_type",
    value,
    classification,
  }));
}

export const productionRoofAgeProfile = {
  version: PRODUCTION_ROOF_AGE_PROFILE_VERSION,
  sources: PRODUCTION_ROOF_AGE_SOURCE_SYSTEMS.map((sourceSystem) => ({
    sourceSystem,
    statusMappings: [
      ...statusMappings(COMPLETED_STATUSES, "completed"),
      ...statusMappings(OPEN_STATUSES, "open"),
      ...statusMappings(OTHER_STATUSES, "other"),
    ],
    workMappings: [
      ...workMappings(
        REPLACEMENT_WORK,
        "primary_roof_replacement",
      ),
      ...workMappings(
        NEW_CONSTRUCTION_WORK,
        "primary_roof_new_construction",
      ),
      ...workMappings(
        REPAIR_WORK,
        "repair_or_coating",
      ),
      ...workMappings(
        ACCESSORY_WORK,
        "accessory_roof",
      ),
    ],
  })),
} satisfies RoofAgeProfile;
