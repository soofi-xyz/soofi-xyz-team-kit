import fs from "node:fs";
import path from "node:path";

import type {
  FieldEvidenceState,
  RoofAgeEstimate,
  RoofAgePermitEvidence,
  RoofAgeProfile,
} from "./estimator.ts";
import { estimateRoofAge } from "./estimator.ts";
import {
  PRODUCTION_APPRAISAL_ROOF_SEMANTICS,
  productionRoofAgeProfile,
} from "./production-profile.ts";

export const ROOF_AGE_LINEAGE_SCHEMA_VERSION =
  "elephant.roof-age-lineage.v1";

export const ROOF_AGE_QUERY_TABLE_SCHEMA_FIELDS = Object.freeze({
  roof_date: { type: "UTF8", optional: true },
  roof_date_precision: { type: "UTF8", optional: true },
  roof_age_years: { type: "INT64", optional: true },
  roof_age_source: { type: "UTF8", optional: true },
  roof_age_confidence: { type: "UTF8", optional: true },
  roof_age_policy_version: { type: "UTF8", optional: true },
  roof_age_profile_version: { type: "UTF8", optional: true },
  roof_age_profile_sha256: { type: "UTF8", optional: true },
  roof_age_permit_source_system: { type: "UTF8", optional: true },
  roof_age_permit_id: { type: "UTF8", optional: true },
  roof_age_historical_coverage_state: { type: "UTF8", optional: true },
  roof_age_historical_coverage_caveats: { type: "UTF8", optional: true },
  roof_age_as_of_date: { type: "UTF8", optional: true },
  roof_age_eligible: { type: "BOOLEAN", optional: true },
  roof_age_eligibility_reason: { type: "UTF8", optional: true },
});

export type RoofAgeLineageSource =
  | "explicit_parcel_roof_date"
  | "explicit_parcel_roof_age"
  | "construction_year_default"
  | "permit_updated"
  | "none";

export interface RoofAgeHistoricalCoverage {
  state: "complete" | "partial" | "unknown" | "unavailable";
  caveats: (
    | "archive_gap"
    | "history_unknown"
    | "history_unavailable"
    | "partial_history"
    | "predecessor_gap"
    | "source_cap"
    | "unreconciled_inventory"
  )[];
}

export interface RoofAgeSourceEvidence {
  roofDate: string | null;
  roofDateEvidenceState: FieldEvidenceState;
  roofAgeYears: number | null;
  roofAgeEvidenceState: FieldEvidenceState;
}

export interface CanonicalRoofAgeLineage {
  schemaVersion: typeof ROOF_AGE_LINEAGE_SCHEMA_VERSION;
  asOfDate: string;
  source: RoofAgeLineageSource;
  roofDate: string | null;
  roofDatePrecision: "day" | "year" | "none";
  roofAgeYears: number | null;
  confidence: "high" | "medium" | "low" | "none";
  eligibility: {
    eligible: boolean;
    reason:
      | "accepted_explicit_parcel_roof_date"
      | "accepted_explicit_parcel_roof_age"
      | "accepted_completed_primary_roof_replacement"
      | "accepted_completed_primary_roof_new_construction"
      | "accepted_property_built_year"
      | "no_valid_anchor";
  };
  selectedPermit: {
    sourceSystem: string;
    sourceRecordId: string;
    dateField: "completionDate" | "closeDate";
  } | null;
  policy: RoofAgeEstimate["policy"];
  historicalCoverage: RoofAgeHistoricalCoverage;
  sourceEvidence: RoofAgeSourceEvidence;
  estimatorEvidence: RoofAgeEstimate["evidence"];
}

export interface RoofAgePermitRow {
  sourceSystem: string;
  sourceRecordId: string;
  improvementStatus: string | null;
  improvementType: string | null;
  completionDate: string | Date | null;
  closeDate: string | Date | null;
  applicationDate?: string | Date | null;
  issueDate?: string | Date | null;
  openedDate?: string | Date | null;
  sourcePayload?: Record<string, unknown> | null;
}

export interface RoofAgePropertyRecord {
  propertyId: string;
  structureId: string | null;
  sourceSystem: string;
  sourceRecordId: string;
  builtYear: number | null;
  roofDate: string | null;
  roofAgeYears: number | null;
  sourcePayload: Record<string, unknown> | null;
  permits: RoofAgePermitRow[];
}

export interface RoofAgeUpdatePlan {
  propertyId: string;
  structureId: string | null;
  before: {
    roofDate: string | null;
    roofAgeYears: number | null;
    lineage: CanonicalRoofAgeLineage | null;
  };
  after: {
    roofDate: string | null;
    roofAgeYears: number | null;
    lineage: CanonicalRoofAgeLineage;
  };
  changed: boolean;
  blockedReason: "missing_structure" | "no_valid_anchor" | null;
  staleDefaultSuperseded: boolean;
}

interface ParsedRoofDate {
  value: string;
  precision: "day" | "year";
  year: number;
  epochMilliseconds: number | null;
}

function parseIsoDay(value: string): ParsedRoofDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const epochMilliseconds = Date.UTC(year, month - 1, day);
  const parsed = new Date(epochMilliseconds);
  if (
    year < 1000 ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return { value, precision: "day", year, epochMilliseconds };
}

function parseRoofDate(value: string | null, asOfDate: string): ParsedRoofDate | null {
  if (value === null) return null;
  const trimmed = value.trim();
  const asOf = parseIsoDay(asOfDate);
  if (!asOf) throw new Error(`Invalid roof-age as-of date: ${asOfDate}`);
  if (/^\d{4}$/.test(trimmed)) {
    const year = Number(trimmed);
    return year >= 1000 && year <= asOf.year
      ? { value: trimmed, precision: "year", year, epochMilliseconds: null }
      : null;
  }
  const parsed = parseIsoDay(trimmed);
  return parsed &&
    parsed.epochMilliseconds !== null &&
    parsed.epochMilliseconds <= asOf.epochMilliseconds!
    ? parsed
    : null;
}

function validAge(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 500
    ? Number(value)
    : null;
}

function validYear(value: unknown, asOfDate: string): number | null {
  const asOf = parseIsoDay(asOfDate);
  if (!asOf) throw new Error(`Invalid roof-age as-of date: ${asOfDate}`);
  return Number.isInteger(value) &&
    Number(value) >= 1000 &&
    Number(value) <= asOf.year
    ? Number(value)
    : null;
}

function wholeYearsBetween(anchor: ParsedRoofDate, asOfDate: string): number {
  const asOf = parseIsoDay(asOfDate);
  if (!asOf) throw new Error(`Invalid roof-age as-of date: ${asOfDate}`);
  if (anchor.precision === "year") return asOf.year - anchor.year;
  const date = new Date(anchor.epochMilliseconds!);
  const asOfValue = new Date(asOf.epochMilliseconds!);
  let years = asOfValue.getUTCFullYear() - date.getUTCFullYear();
  if (
    asOfValue.getUTCMonth() < date.getUTCMonth() ||
    (asOfValue.getUTCMonth() === date.getUTCMonth() &&
      asOfValue.getUTCDate() < date.getUTCDate())
  ) {
    years -= 1;
  }
  return years;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function priorLineage(value: unknown): CanonicalRoofAgeLineage | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as { schemaVersion?: unknown }).schemaVersion !==
      ROOF_AGE_LINEAGE_SCHEMA_VERSION
  ) {
    return null;
  }
  return value as CanonicalRoofAgeLineage;
}

function sourceEvidence(record: RoofAgePropertyRecord): RoofAgeSourceEvidence {
  const previous = priorLineage(record.sourcePayload?.roof_age_lineage);
  if (previous) return structuredClone(previous.sourceEvidence);
  const rawRoofDate = text(record.roofDate);
  const appraisalSemantics =
    PRODUCTION_APPRAISAL_ROOF_SEMANTICS[
      record.sourceSystem as keyof typeof PRODUCTION_APPRAISAL_ROOF_SEMANTICS
    ];
  const roofDate =
    appraisalSemantics?.roofDateIsConstructionYearAlias === true &&
    rawRoofDate === String(record.builtYear)
      ? null
      : rawRoofDate;
  const roofAgeYears = validAge(record.roofAgeYears);
  return {
    roofDate,
    roofDateEvidenceState:
      roofDate === null ? "confirmed_empty" : "confirmed_present",
    roofAgeYears,
    roofAgeEvidenceState:
      roofAgeYears === null ? "confirmed_empty" : "confirmed_present",
  };
}

function isoDate(value: string | Date | null | undefined): string | null {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  return text(value);
}

function dateEvidence(
  value: string | Date | null | undefined,
  state: unknown,
): RoofAgePermitEvidence["completionDate"] {
  const normalized = isoDate(value);
  const evidenceState =
    typeof state === "string"
      ? (state as FieldEvidenceState)
      : normalized === null
        ? "unknown"
        : "confirmed_present";
  return { value: normalized, evidenceState };
}

function evidenceState(
  payload: Record<string, unknown> | null | undefined,
  field: string,
): unknown {
  const states = payload?.roofAgeEvidenceStates;
  return states && typeof states === "object" && !Array.isArray(states)
    ? (states as Record<string, unknown>)[field]
    : undefined;
}

function chronologyStart(row: RoofAgePermitRow): RoofAgePermitEvidence["chronologyStartDate"] {
  const candidates = [row.applicationDate, row.issueDate, row.openedDate]
    .map(isoDate)
    .filter((value): value is string => value !== null)
    .sort()
    .reverse();
  return candidates[0]
    ? { value: candidates[0], evidenceState: "confirmed_present" }
    : null;
}

export function permitRowToRoofAgeEvidence(
  row: RoofAgePermitRow,
): RoofAgePermitEvidence {
  return {
    sourceSystem: row.sourceSystem,
    sourceRecordId: row.sourceRecordId,
    statusEvidence: [
      {
        field: "improvement_status",
        value: text(row.improvementStatus) ?? "UNKNOWN",
      },
    ],
    workEvidence: [
      {
        field: "improvement_type",
        value: text(row.improvementType) ?? "UNKNOWN",
      },
    ],
    completionDate: dateEvidence(
      row.completionDate,
      evidenceState(row.sourcePayload, "completionDate"),
    ),
    closeDate: dateEvidence(
      row.closeDate,
      evidenceState(row.sourcePayload, "closeDate"),
    ),
    chronologyStartDate: chronologyStart(row),
  };
}

function permitNewerThanExplicit(
  estimate: RoofAgeEstimate,
  explicit: ParsedRoofDate,
): boolean {
  if (
    estimate.anchor?.type !== "permit_terminal_date" ||
    estimate.workClassification !== "primary_roof_replacement"
  ) {
    return false;
  }
  const permitDate = parseIsoDay(estimate.anchor.date);
  if (!permitDate) return false;
  return explicit.precision === "year"
    ? permitDate.year > explicit.year
    : permitDate.epochMilliseconds! > explicit.epochMilliseconds!;
}

function lineageFromEstimate(
  estimate: RoofAgeEstimate,
  source: RoofAgeLineageSource,
  evidence: RoofAgeSourceEvidence,
): CanonicalRoofAgeLineage {
  let roofDate: string | null = null;
  let roofDatePrecision: "day" | "year" | "none" = "none";
  let selectedPermit: CanonicalRoofAgeLineage["selectedPermit"] = null;
  if (estimate.anchor?.type === "permit_terminal_date") {
    roofDate = estimate.anchor.date;
    roofDatePrecision = "day";
    selectedPermit = estimate.anchor.source;
  } else if (estimate.anchor?.type === "property_built_year") {
    roofDate = String(estimate.anchor.year);
    roofDatePrecision = "year";
  }
  return {
    schemaVersion: ROOF_AGE_LINEAGE_SCHEMA_VERSION,
    asOfDate: estimate.asOfDate,
    source,
    roofDate,
    roofDatePrecision,
    roofAgeYears: estimate.estimatedAgeYears,
    confidence: estimate.confidence,
    eligibility: estimate.eligibility,
    selectedPermit,
    policy: estimate.policy,
    historicalCoverage: estimate.historicalCoverage,
    sourceEvidence: evidence,
    estimatorEvidence: estimate.evidence,
  };
}

export function resolveCanonicalRoofAge(
  record: RoofAgePropertyRecord,
  options: {
    asOfDate: string;
    historicalCoverage: RoofAgeHistoricalCoverage;
    profile?: RoofAgeProfile;
  },
): CanonicalRoofAgeLineage {
  const observedEvidence = sourceEvidence(record);
  const explicitDate = parseRoofDate(
    observedEvidence.roofDate,
    options.asOfDate,
  );
  const explicitAge = validAge(observedEvidence.roofAgeYears);
  const evidence: RoofAgeSourceEvidence = {
    ...observedEvidence,
    roofDateEvidenceState:
      observedEvidence.roofDate !== null && explicitDate === null
        ? "invalid_quarantined"
        : observedEvidence.roofDateEvidenceState,
    roofAgeEvidenceState:
      observedEvidence.roofAgeYears !== null && explicitAge === null
        ? "invalid_quarantined"
        : observedEvidence.roofAgeEvidenceState,
  };
  const builtYear = validYear(record.builtYear, options.asOfDate);
  const estimate = estimateRoofAge(
    {
      asOfDate: options.asOfDate,
      builtYear: {
        year: builtYear,
        evidenceState:
          builtYear === null ? "unknown" : "confirmed_present",
        sourceSystem: record.sourceSystem,
        sourceRecordId: record.sourceRecordId,
        field: "property_structure_built_year",
      },
      permits: record.permits.map(permitRowToRoofAgeEvidence),
      historicalCoverage: options.historicalCoverage,
    },
    options.profile ?? productionRoofAgeProfile,
  );

  if (explicitDate) {
    if (permitNewerThanExplicit(estimate, explicitDate)) {
      return lineageFromEstimate(estimate, "permit_updated", evidence);
    }
    return {
      schemaVersion: ROOF_AGE_LINEAGE_SCHEMA_VERSION,
      asOfDate: options.asOfDate,
      source: "explicit_parcel_roof_date",
      roofDate: explicitDate.value,
      roofDatePrecision: explicitDate.precision,
      roofAgeYears:
        explicitAge ?? wholeYearsBetween(explicitDate, options.asOfDate),
      confidence: "high",
      eligibility: {
        eligible: true,
        reason: "accepted_explicit_parcel_roof_date",
      },
      selectedPermit: null,
      policy: estimate.policy,
      historicalCoverage: estimate.historicalCoverage,
      sourceEvidence: evidence,
      estimatorEvidence: estimate.evidence,
    };
  }

  if (explicitAge !== null) {
    return {
      schemaVersion: ROOF_AGE_LINEAGE_SCHEMA_VERSION,
      asOfDate: options.asOfDate,
      source: "explicit_parcel_roof_age",
      roofDate: null,
      roofDatePrecision: "none",
      roofAgeYears: explicitAge,
      confidence: "medium",
      eligibility: {
        eligible: true,
        reason: "accepted_explicit_parcel_roof_age",
      },
      selectedPermit: null,
      policy: estimate.policy,
      historicalCoverage: estimate.historicalCoverage,
      sourceEvidence: evidence,
      estimatorEvidence: estimate.evidence,
    };
  }

  const source =
    estimate.anchor?.type === "permit_terminal_date"
      ? "permit_updated"
      : estimate.anchor?.type === "property_built_year"
        ? "construction_year_default"
        : "none";
  return lineageFromEstimate(estimate, source, evidence);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function reconcileRoofAgeBatch(
  records: readonly RoofAgePropertyRecord[],
  options: {
    asOfDate: string;
    historicalCoverage: RoofAgeHistoricalCoverage;
    profile?: RoofAgeProfile;
  },
) {
  const plans = records.map((record): RoofAgeUpdatePlan => {
    const beforeLineage = priorLineage(record.sourcePayload?.roof_age_lineage);
    const afterLineage = resolveCanonicalRoofAge(record, options);
    const blockedReason =
      record.structureId === null
        ? "missing_structure"
        : afterLineage.eligibility.eligible
          ? null
          : "no_valid_anchor";
    const changed =
      blockedReason === null &&
      (record.roofDate !== afterLineage.roofDate ||
        record.roofAgeYears !== afterLineage.roofAgeYears ||
        stableJson(beforeLineage) !== stableJson(afterLineage));
    return {
      propertyId: record.propertyId,
      structureId: record.structureId,
      before: {
        roofDate: record.roofDate,
        roofAgeYears: record.roofAgeYears,
        lineage: beforeLineage,
      },
      after: {
        roofDate: afterLineage.roofDate,
        roofAgeYears: afterLineage.roofAgeYears,
        lineage: afterLineage,
      },
      changed,
      blockedReason,
      staleDefaultSuperseded:
        beforeLineage?.source === "construction_year_default" &&
        afterLineage.source === "permit_updated",
    };
  });
  return {
    plans,
    summary: {
      evaluatedRows: plans.length,
      missingBefore: plans.filter(
        (plan) =>
          plan.before.roofDate === null && plan.before.roofAgeYears === null,
      ).length,
      missingAfter: plans.filter(
        (plan) =>
          plan.after.roofDate === null && plan.after.roofAgeYears === null,
      ).length,
      explicitParcelValues: plans.filter((plan) =>
        plan.after.lineage.source.startsWith("explicit_parcel_"),
      ).length,
      constructionYearDefaults: plans.filter(
        (plan) => plan.after.lineage.source === "construction_year_default",
      ).length,
      permitUpdatedValues: plans.filter(
        (plan) => plan.after.lineage.source === "permit_updated",
      ).length,
      staleDefaultsSuperseded: plans.filter(
        (plan) => plan.staleDefaultSuperseded,
      ).length,
      updatedRows: plans.filter((plan) => plan.changed).length,
      unchangedRows: plans.filter(
        (plan) => !plan.changed && plan.blockedReason === null,
      ).length,
      skippedOrBlockedRows: plans.filter(
        (plan) => plan.blockedReason !== null,
      ).length,
      incompletePermitHistory: plans.filter(
        (plan) => plan.after.lineage.historicalCoverage.state !== "complete",
      ).length,
    },
  };
}

function primaryFile(
  files: readonly string[],
  pattern: RegExp,
): string | null {
  return (
    files
      .filter((name) => pattern.test(name))
      .sort((left, right) => {
        const leftNumber = Number(left.match(/\d+/)?.[0] ?? 0);
        const rightNumber = Number(right.match(/\d+/)?.[0] ?? 0);
        return leftNumber - rightNumber;
      })[0] ?? null
  );
}

export function applyRoofAgeToTransformedData(options: {
  dataDir: string;
  sourceSystem: string;
  asOfDate: string;
  historicalCoverage?: RoofAgeHistoricalCoverage;
}): CanonicalRoofAgeLineage | null {
  const names = fs.readdirSync(options.dataDir);
  const structureName = primaryFile(names, /^structure_\d+\.json$/);
  if (!structureName) return null;
  const read = (name: string) =>
    JSON.parse(fs.readFileSync(path.join(options.dataDir, name), "utf8")) as Record<
      string,
      unknown
    >;
  const structure = read(structureName);
  const property = names.includes("property.json") ? read("property.json") : {};
  const layoutName = primaryFile(names, /^layout_\d+\.json$/);
  const layout = layoutName ? read(layoutName) : {};
  const sourcePayload =
    structure.source_payload &&
    typeof structure.source_payload === "object" &&
    !Array.isArray(structure.source_payload)
      ? (structure.source_payload as Record<string, unknown>)
      : {};
  const sourceRecordId =
    text(structure.request_identifier) ??
    text(property.request_identifier) ??
    text(property.parcel_identifier) ??
    structureName;
  const record: RoofAgePropertyRecord = {
    propertyId: sourceRecordId,
    structureId: structureName,
    sourceSystem: options.sourceSystem,
    sourceRecordId,
    builtYear:
      validYear(property.property_structure_built_year, options.asOfDate) ??
      validYear(layout.built_year, options.asOfDate),
    roofDate: text(structure.roof_date),
    roofAgeYears: validAge(structure.roof_age_years),
    sourcePayload,
    permits: [],
  };
  const lineage = resolveCanonicalRoofAge(record, {
    asOfDate: options.asOfDate,
    historicalCoverage: options.historicalCoverage ?? {
      state: "unknown",
      caveats: ["history_unknown"],
    },
  });
  if (!lineage.eligibility.eligible) return lineage;
  structure.roof_date = lineage.roofDate;
  structure.roof_age_years = lineage.roofAgeYears;
  structure.source_payload = {
    ...sourcePayload,
    roof_age_lineage: lineage,
  };
  fs.writeFileSync(
    path.join(options.dataDir, structureName),
    `${JSON.stringify(structure, null, 2)}\n`,
    "utf8",
  );
  return lineage;
}

export function roofAgeQueryFields(structure: Record<string, unknown>) {
  const payload =
    structure.source_payload &&
    typeof structure.source_payload === "object" &&
    !Array.isArray(structure.source_payload)
      ? (structure.source_payload as Record<string, unknown>)
      : {};
  const lineage = priorLineage(payload.roof_age_lineage);
  return {
    roof_date: text(structure.roof_date),
    roof_date_precision: lineage?.roofDatePrecision ?? null,
    roof_age_years: validAge(structure.roof_age_years),
    roof_age_source: lineage?.source ?? null,
    roof_age_confidence: lineage?.confidence ?? null,
    roof_age_policy_version: lineage?.policy.version ?? null,
    roof_age_profile_version: lineage?.policy.profileVersion ?? null,
    roof_age_profile_sha256: lineage?.policy.profileSha256 ?? null,
    roof_age_permit_source_system:
      lineage?.selectedPermit?.sourceSystem ?? null,
    roof_age_permit_id: lineage?.selectedPermit?.sourceRecordId ?? null,
    roof_age_historical_coverage_state:
      lineage?.historicalCoverage.state ?? null,
    roof_age_historical_coverage_caveats: lineage
      ? JSON.stringify(lineage.historicalCoverage.caveats)
      : null,
    roof_age_as_of_date: lineage?.asOfDate ?? null,
    roof_age_eligible: lineage?.eligibility.eligible ?? null,
    roof_age_eligibility_reason: lineage?.eligibility.reason ?? null,
  };
}
