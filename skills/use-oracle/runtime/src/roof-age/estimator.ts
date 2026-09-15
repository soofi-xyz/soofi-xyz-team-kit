import { createHash } from "node:crypto";

import { z } from "zod";

export const ROOF_AGE_ESTIMATE_SCHEMA_VERSION =
  "elephant.roof-age-estimate.v1";
export const ROOF_AGE_POLICY_VERSION = "oracle.roof-age-policy.v1";

// Source-system values are existing Query DB provenance, not county slugs.
// Permit adapters legitimately emit names such as "JaxEPICS" and
// "BS&A Online"; reject control characters but preserve the exact source.
const SOURCE_KEY_PATTERN = /^[^\u0000-\u001f\u007f]+$/;
const PROFILE_VERSION_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const fieldEvidenceStateSchema = z.enum([
  "confirmed_present",
  "confirmed_empty",
  "unavailable",
  "stale",
  "conflicting",
  "invalid_quarantined",
  "unknown",
]);

export const permitStatusSchema = z.enum([
  "completed",
  "open",
  "other",
  "needs_review",
]);

export const roofWorkClassificationSchema = z.enum([
  "primary_roof_replacement",
  "primary_roof_new_construction",
  "repair_or_coating",
  "accessory_roof",
  "other",
  "needs_review",
]);

const sourceTermSchema = z
  .object({
    field: z.string().regex(FIELD_KEY_PATTERN),
    value: z.string().trim().min(1),
  })
  .strict();

const dateEvidenceSchema = z
  .object({
    value: z.string().trim().min(1).nullable(),
    evidenceState: fieldEvidenceStateSchema,
  })
  .strict()
  .superRefine((evidence, context) => {
    if (
      evidence.evidenceState === "confirmed_present" &&
      evidence.value === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "confirmed_present date evidence requires a source value",
      });
    }
    if (
      ["confirmed_empty", "unavailable", "unknown"].includes(
        evidence.evidenceState,
      ) &&
      evidence.value !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: `${evidence.evidenceState} date evidence cannot carry a usable value`,
      });
    }
  });

const builtYearEvidenceSchema = z
  .object({
    year: z.number().finite().nullable(),
    evidenceState: fieldEvidenceStateSchema,
    sourceSystem: z.string().regex(SOURCE_KEY_PATTERN),
    sourceRecordId: z.string().trim().min(1),
    field: z.string().regex(FIELD_KEY_PATTERN),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (
      evidence.evidenceState === "confirmed_present" &&
      evidence.year === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["year"],
        message: "confirmed_present built-year evidence requires a value",
      });
    }
    if (
      ["confirmed_empty", "unavailable", "unknown"].includes(
        evidence.evidenceState,
      ) &&
      evidence.year !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["year"],
        message: `${evidence.evidenceState} built-year evidence cannot carry a usable value`,
      });
    }
  });

export const roofAgePermitEvidenceSchema = z
  .object({
    sourceSystem: z.string().regex(SOURCE_KEY_PATTERN),
    sourceRecordId: z.string().trim().min(1),
    statusEvidence: z.array(sourceTermSchema).min(1),
    workEvidence: z.array(sourceTermSchema).min(1),
    completionDate: dateEvidenceSchema,
    closeDate: dateEvidenceSchema,
    chronologyStartDate: dateEvidenceSchema.nullable(),
  })
  .strict();

const statusMappingSchema = sourceTermSchema
  .extend({ status: permitStatusSchema.exclude(["needs_review"]) })
  .strict();

const workMappingSchema = sourceTermSchema
  .extend({
    classification: roofWorkClassificationSchema.exclude(["needs_review"]),
  })
  .strict();

const sourceProfileSchema = z
  .object({
    sourceSystem: z.string().regex(SOURCE_KEY_PATTERN),
    statusMappings: z.array(statusMappingSchema).min(1),
    workMappings: z.array(workMappingSchema).min(1),
  })
  .strict();

export const roofAgeProfileSchema = z
  .object({
    version: z.string().regex(PROFILE_VERSION_PATTERN),
    sources: z.array(sourceProfileSchema).min(1),
  })
  .strict();

export const historicalCoverageCaveatSchema = z.enum([
  "archive_gap",
  "history_unknown",
  "history_unavailable",
  "partial_history",
  "predecessor_gap",
  "source_cap",
  "unreconciled_inventory",
]);

export const historicalCoverageSchema = z
  .object({
    state: z.enum(["complete", "partial", "unknown", "unavailable"]),
    caveats: z.array(historicalCoverageCaveatSchema),
  })
  .strict()
  .superRefine((coverage, context) => {
    if (coverage.state === "complete" && coverage.caveats.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["caveats"],
        message: "Complete historical coverage cannot carry gap caveats",
      });
    }
  });

export const roofAgeEstimatorInputSchema = z
  .object({
    asOfDate: z.string().regex(ISO_DATE_PATTERN),
    builtYear: builtYearEvidenceSchema.nullable(),
    permits: z.array(roofAgePermitEvidenceSchema),
    historicalCoverage: historicalCoverageSchema,
  })
  .strict();

const permitAnchorSchema = z
  .object({
    type: z.literal("permit_terminal_date"),
    date: z.string().regex(ISO_DATE_PATTERN),
    source: z
      .object({
        sourceSystem: z.string().regex(SOURCE_KEY_PATTERN),
        sourceRecordId: z.string().min(1),
        dateField: z.enum(["completionDate", "closeDate"]),
      })
      .strict(),
  })
  .strict();

const builtYearAnchorSchema = z
  .object({
    type: z.literal("property_built_year"),
    year: z.number().int().min(1000).max(9999),
    source: z
      .object({
        sourceSystem: z.string().regex(SOURCE_KEY_PATTERN),
        sourceRecordId: z.string().min(1),
        field: z.string().regex(FIELD_KEY_PATTERN),
      })
      .strict(),
  })
  .strict();

const permitOutcomeCountsSchema = z
  .object({
    acceptedPrimaryRoofReplacement: z.number().int().nonnegative(),
    acceptedPrimaryRoofNewConstruction: z.number().int().nonnegative(),
    excludedOpenPrimaryRoofReplacement: z.number().int().nonnegative(),
    excludedNonCompletedResettingWork: z.number().int().nonnegative(),
    excludedNonResettingWork: z.number().int().nonnegative(),
    excludedNeedsReview: z.number().int().nonnegative(),
    excludedMissingTerminalDate: z.number().int().nonnegative(),
    excludedInvalidOrQuarantinedTerminalDate: z.number().int().nonnegative(),
    excludedFutureTerminalDate: z.number().int().nonnegative(),
    excludedChronologyInvalidTerminalDate: z.number().int().nonnegative(),
  })
  .strict();

export const roofAgeEstimateSchema = z
  .object({
    schemaVersion: z.literal(ROOF_AGE_ESTIMATE_SCHEMA_VERSION),
    asOfDate: z.string().regex(ISO_DATE_PATTERN),
    anchor: z.union([permitAnchorSchema, builtYearAnchorSchema]).nullable(),
    estimatedAgeYears: z.number().int().nonnegative().nullable(),
    confidence: z.enum(["high", "medium", "low", "none"]),
    workClassification: roofWorkClassificationSchema
      .exclude(["needs_review"])
      .nullable(),
    eligibility: z
      .object({
        eligible: z.boolean(),
        reason: z.enum([
          "accepted_completed_primary_roof_replacement",
          "accepted_completed_primary_roof_new_construction",
          "accepted_property_built_year",
          "no_valid_anchor",
        ]),
      })
      .strict(),
    historicalCoverage: historicalCoverageSchema,
    evidence: z
      .object({
        permitCount: z.number().int().nonnegative(),
        permitOutcomeCounts: permitOutcomeCountsSchema,
      })
      .strict(),
    policy: z
      .object({
        version: z.literal(ROOF_AGE_POLICY_VERSION),
        profileVersion: z.string().regex(PROFILE_VERSION_PATTERN),
        profileSha256: z.string().regex(SHA256_PATTERN),
      })
      .strict(),
  })
  .strict()
  .superRefine((estimate, context) => {
    const outcomeTotal = Object.values(
      estimate.evidence.permitOutcomeCounts,
    ).reduce((total, count) => total + count, 0);
    if (outcomeTotal !== estimate.evidence.permitCount) {
      context.addIssue({
        code: "custom",
        path: ["evidence", "permitOutcomeCounts"],
        message: "Permit outcome counts must reconcile to permitCount",
      });
    }
    if (!estimate.eligibility.eligible) {
      if (
        estimate.anchor !== null ||
        estimate.estimatedAgeYears !== null ||
        estimate.confidence !== "none" ||
        estimate.workClassification !== null ||
        estimate.eligibility.reason !== "no_valid_anchor"
      ) {
        context.addIssue({
          code: "custom",
          path: ["eligibility"],
          message: "Ineligible estimates cannot carry an accepted anchor or age",
        });
      }
      return;
    }
    if (estimate.anchor === null || estimate.estimatedAgeYears === null) {
      context.addIssue({
        code: "custom",
        path: ["anchor"],
        message: "Eligible estimates require an anchor and estimated age",
      });
      return;
    }
    if (estimate.anchor.type === "property_built_year") {
      if (
        estimate.confidence !== "low" ||
        estimate.workClassification !== null ||
        estimate.eligibility.reason !== "accepted_property_built_year"
      ) {
        context.addIssue({
          code: "custom",
          path: ["anchor"],
          message: "Built-year anchors require low confidence and no work class",
        });
      }
      return;
    }
    if (
      estimate.workClassification === "primary_roof_replacement" &&
      (estimate.confidence !== "high" ||
        estimate.eligibility.reason !==
          "accepted_completed_primary_roof_replacement")
    ) {
      context.addIssue({
        code: "custom",
        path: ["confidence"],
        message: "Replacement anchors require high confidence",
      });
    } else if (
      estimate.workClassification === "primary_roof_new_construction" &&
      (estimate.confidence !== "medium" ||
        estimate.eligibility.reason !==
          "accepted_completed_primary_roof_new_construction")
    ) {
      context.addIssue({
        code: "custom",
        path: ["confidence"],
        message: "New-construction anchors require medium confidence",
      });
    } else if (
      ![
        "primary_roof_replacement",
        "primary_roof_new_construction",
      ].includes(estimate.workClassification ?? "")
    ) {
      context.addIssue({
        code: "custom",
        path: ["workClassification"],
        message: "Permit anchors require an accepted resetting work class",
      });
    }
  });

export type FieldEvidenceState = z.infer<typeof fieldEvidenceStateSchema>;
export type PermitStatus = z.infer<typeof permitStatusSchema>;
export type RoofWorkClassification = z.infer<
  typeof roofWorkClassificationSchema
>;
export type RoofAgeProfile = z.infer<typeof roofAgeProfileSchema>;
export type RoofAgePermitEvidence = z.infer<
  typeof roofAgePermitEvidenceSchema
>;
export type RoofAgeEstimatorInput = z.infer<
  typeof roofAgeEstimatorInputSchema
>;
export type RoofAgeEstimate = z.infer<typeof roofAgeEstimateSchema>;

interface CanonicalStatusMapping {
  field: string;
  value: string;
  status: Exclude<PermitStatus, "needs_review">;
}

interface CanonicalWorkMapping {
  field: string;
  value: string;
  classification: Exclude<RoofWorkClassification, "needs_review">;
}

interface CanonicalSourceProfile {
  sourceSystem: string;
  statusMappings: readonly CanonicalStatusMapping[];
  workMappings: readonly CanonicalWorkMapping[];
}

export interface CompiledRoofAgeProfile {
  version: string;
  sha256: string;
  sources: readonly CanonicalSourceProfile[];
}

export interface ClassifiedRoofAgePermit extends RoofAgePermitEvidence {
  status: PermitStatus;
  workClassification: RoofWorkClassification;
}

interface ParsedDate {
  value: string;
  year: number;
  month: number;
  day: number;
  epochMilliseconds: number;
}

type PermitOutcome = keyof z.infer<typeof permitOutcomeCountsSchema>;

interface AcceptedPermitAnchor {
  permit: ClassifiedRoofAgePermit;
  date: ParsedDate;
  dateField: "completionDate" | "closeDate";
  outcome:
    | "acceptedPrimaryRoofReplacement"
    | "acceptedPrimaryRoofNewConstruction";
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value))}\n`;
}

function normalizeField(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeSourceValue(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
}

function mappingKey(field: string, value: string): string {
  return `${normalizeField(field)}\u0000${normalizeSourceValue(value)}`;
}

function sortMappings<T extends { field: string; value: string }>(
  mappings: readonly T[],
): T[] {
  return [...mappings].sort((left, right) => {
    const byField = left.field.localeCompare(right.field);
    if (byField !== 0) return byField;
    return left.value.localeCompare(right.value);
  });
}

function uniqueMappings<
  T extends { field: string; value: string },
  K extends keyof T,
>(
  mappings: readonly T[],
  targetKey: K,
  sourceSystem: string,
): T[] {
  const byKey = new Map<string, T>();
  for (const mapping of mappings) {
    const key = mappingKey(mapping.field, mapping.value);
    const previous = byKey.get(key);
    if (previous && previous[targetKey] !== mapping[targetKey]) {
      throw new Error(
        `Conflicting ${String(targetKey)} mapping for ${sourceSystem}:${mapping.field}:${mapping.value}`,
      );
    }
    byKey.set(key, mapping);
  }
  return sortMappings([...byKey.values()]);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function compileRoofAgeProfile(
  input: RoofAgeProfile,
): CompiledRoofAgeProfile {
  const parsed = roofAgeProfileSchema.parse(input);
  const sourceSystems = new Set<string>();
  const sources = parsed.sources
    .map((source): CanonicalSourceProfile => {
      if (sourceSystems.has(source.sourceSystem)) {
        throw new Error(
          `Duplicate roof-age source profile: ${source.sourceSystem}`,
        );
      }
      sourceSystems.add(source.sourceSystem);
      const statusMappings = uniqueMappings(
        source.statusMappings.map((mapping) => ({
          field: normalizeField(mapping.field),
          value: normalizeSourceValue(mapping.value),
          status: mapping.status,
        })),
        "status",
        source.sourceSystem,
      );
      const workMappings = uniqueMappings(
        source.workMappings.map((mapping) => ({
          field: normalizeField(mapping.field),
          value: normalizeSourceValue(mapping.value),
          classification: mapping.classification,
        })),
        "classification",
        source.sourceSystem,
      );
      return {
        sourceSystem: source.sourceSystem,
        statusMappings,
        workMappings,
      };
    })
    .sort((left, right) =>
      left.sourceSystem.localeCompare(right.sourceSystem),
    );
  const canonicalProfile = { version: parsed.version, sources };
  return deepFreeze({
    ...canonicalProfile,
    sha256: createHash("sha256")
      .update(canonicalJson(canonicalProfile))
      .digest("hex"),
  }) as CompiledRoofAgeProfile;
}

function resolveClassification<T extends string>(
  evidence: readonly z.infer<typeof sourceTermSchema>[],
  mappings: readonly { field: string; value: string; target: T }[],
  needsReview: T,
): T {
  const byKey = new Map(
    mappings.map((mapping) => [
      mappingKey(mapping.field, mapping.value),
      mapping.target,
    ]),
  );
  const targets = new Set<T>();
  for (const term of evidence) {
    const target = byKey.get(mappingKey(term.field, term.value));
    if (!target) return needsReview;
    targets.add(target);
  }
  return targets.size === 1 ? [...targets][0]! : needsReview;
}

export function classifyRoofAgePermit(
  input: RoofAgePermitEvidence,
  profile: CompiledRoofAgeProfile,
): ClassifiedRoofAgePermit {
  const permit = roofAgePermitEvidenceSchema.parse(input);
  const sourceProfile = profile.sources.find(
    (source) => source.sourceSystem === permit.sourceSystem,
  );
  if (!sourceProfile) {
    return deepFreeze({
      ...permit,
      status: "needs_review",
      workClassification: "needs_review",
    }) as ClassifiedRoofAgePermit;
  }
  const status = resolveClassification(
    permit.statusEvidence,
    sourceProfile.statusMappings.map((mapping) => ({
      field: mapping.field,
      value: mapping.value,
      target: mapping.status,
    })),
    "needs_review",
  );
  const workClassification = resolveClassification(
    permit.workEvidence,
    sourceProfile.workMappings.map((mapping) => ({
      field: mapping.field,
      value: mapping.value,
      target: mapping.classification,
    })),
    "needs_review",
  );
  return deepFreeze({
    ...permit,
    status,
    workClassification,
  }) as ClassifiedRoofAgePermit;
}

function parseIsoDate(value: string): ParsedDate | null {
  if (!ISO_DATE_PATTERN.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    year < 1000 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const epochMilliseconds = Date.UTC(year, month - 1, day);
  const date = new Date(epochMilliseconds);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { value, year, month, day, epochMilliseconds };
}

function validChronologyStart(
  evidence: RoofAgePermitEvidence["chronologyStartDate"],
): ParsedDate | null {
  if (
    evidence === null ||
    evidence.evidenceState !== "confirmed_present" ||
    evidence.value === null
  ) {
    return null;
  }
  return parseIsoDate(evidence.value);
}

function terminalDate(
  permit: ClassifiedRoofAgePermit,
  asOf: ParsedDate,
):
  | {
      accepted: true;
      date: ParsedDate;
      dateField: "completionDate" | "closeDate";
    }
  | {
      accepted: false;
      outcome:
        | "excludedMissingTerminalDate"
        | "excludedInvalidOrQuarantinedTerminalDate"
        | "excludedFutureTerminalDate"
        | "excludedChronologyInvalidTerminalDate";
    } {
  const chronologyStart = validChronologyStart(permit.chronologyStartDate);
  const candidates: {
    date: ParsedDate;
    dateField: "completionDate" | "closeDate";
  }[] = [];
  const rejected = new Set<PermitOutcome>();

  for (const dateField of ["completionDate", "closeDate"] as const) {
    const evidence = permit[dateField];
    if (evidence.value === null) {
      rejected.add("excludedMissingTerminalDate");
      continue;
    }
    if (evidence.evidenceState !== "confirmed_present") {
      rejected.add("excludedInvalidOrQuarantinedTerminalDate");
      continue;
    }
    const parsed = parseIsoDate(evidence.value);
    if (!parsed) {
      rejected.add("excludedInvalidOrQuarantinedTerminalDate");
      continue;
    }
    if (parsed.epochMilliseconds > asOf.epochMilliseconds) {
      rejected.add("excludedFutureTerminalDate");
      continue;
    }
    if (
      chronologyStart &&
      parsed.epochMilliseconds < chronologyStart.epochMilliseconds
    ) {
      rejected.add("excludedChronologyInvalidTerminalDate");
      continue;
    }
    candidates.push({ date: parsed, dateField });
  }

  candidates.sort((left, right) => {
    const byDate =
      right.date.epochMilliseconds - left.date.epochMilliseconds;
    if (byDate !== 0) return byDate;
    return left.dateField === "completionDate" ? -1 : 1;
  });
  const accepted = candidates[0];
  if (accepted) return { accepted: true, ...accepted };

  const outcomePriority = [
    "excludedChronologyInvalidTerminalDate",
    "excludedFutureTerminalDate",
    "excludedInvalidOrQuarantinedTerminalDate",
    "excludedMissingTerminalDate",
  ] as const;
  return {
    accepted: false,
    outcome:
      outcomePriority.find((outcome) => rejected.has(outcome)) ??
      "excludedMissingTerminalDate",
  };
}

function evaluatePermit(
  permit: ClassifiedRoofAgePermit,
  asOf: ParsedDate,
):
  | { accepted: true; anchor: AcceptedPermitAnchor }
  | { accepted: false; outcome: PermitOutcome } {
  if (
    permit.status === "needs_review" ||
    permit.workClassification === "needs_review"
  ) {
    return { accepted: false, outcome: "excludedNeedsReview" };
  }
  if (
    ["repair_or_coating", "accessory_roof", "other"].includes(
      permit.workClassification,
    )
  ) {
    return { accepted: false, outcome: "excludedNonResettingWork" };
  }
  if (permit.status !== "completed") {
    if (
      permit.status === "open" &&
      permit.workClassification === "primary_roof_replacement"
    ) {
      return {
        accepted: false,
        outcome: "excludedOpenPrimaryRoofReplacement",
      };
    }
    return {
      accepted: false,
      outcome: "excludedNonCompletedResettingWork",
    };
  }
  const terminal = terminalDate(permit, asOf);
  if (!terminal.accepted) {
    return { accepted: false, outcome: terminal.outcome };
  }
  const outcome =
    permit.workClassification === "primary_roof_replacement"
      ? "acceptedPrimaryRoofReplacement"
      : "acceptedPrimaryRoofNewConstruction";
  return {
    accepted: true,
    anchor: {
      permit,
      date: terminal.date,
      dateField: terminal.dateField,
      outcome,
    },
  };
}

function emptyOutcomeCounts(): z.infer<typeof permitOutcomeCountsSchema> {
  return {
    acceptedPrimaryRoofReplacement: 0,
    acceptedPrimaryRoofNewConstruction: 0,
    excludedOpenPrimaryRoofReplacement: 0,
    excludedNonCompletedResettingWork: 0,
    excludedNonResettingWork: 0,
    excludedNeedsReview: 0,
    excludedMissingTerminalDate: 0,
    excludedInvalidOrQuarantinedTerminalDate: 0,
    excludedFutureTerminalDate: 0,
    excludedChronologyInvalidTerminalDate: 0,
  };
}

function sortAcceptedAnchors(
  anchors: readonly AcceptedPermitAnchor[],
): AcceptedPermitAnchor[] {
  return [...anchors].sort((left, right) => {
    const byDate =
      right.date.epochMilliseconds - left.date.epochMilliseconds;
    if (byDate !== 0) return byDate;
    const bySystem = left.permit.sourceSystem.localeCompare(
      right.permit.sourceSystem,
    );
    if (bySystem !== 0) return bySystem;
    const byRecord = left.permit.sourceRecordId.localeCompare(
      right.permit.sourceRecordId,
    );
    if (byRecord !== 0) return byRecord;
    return left.dateField === "completionDate" ? -1 : 1;
  });
}

function wholeYearsBetween(anchor: ParsedDate, asOf: ParsedDate): number {
  let years = asOf.year - anchor.year;
  if (
    asOf.month < anchor.month ||
    (asOf.month === anchor.month && asOf.day < anchor.day)
  ) {
    years -= 1;
  }
  return years;
}

function normalizedHistoricalCoverage(
  coverage: z.infer<typeof historicalCoverageSchema>,
): z.infer<typeof historicalCoverageSchema> {
  const caveats = new Set(coverage.caveats);
  if (coverage.state === "partial") caveats.add("partial_history");
  if (coverage.state === "unknown") caveats.add("history_unknown");
  if (coverage.state === "unavailable") caveats.add("history_unavailable");
  return {
    state: coverage.state,
    caveats: [...caveats].sort(),
  };
}

function isValidBuiltYear(
  evidence: z.infer<typeof builtYearEvidenceSchema> | null,
  asOfYear: number,
): evidence is z.infer<typeof builtYearEvidenceSchema> & { year: number } {
  return (
    evidence !== null &&
    evidence.evidenceState === "confirmed_present" &&
    evidence.year !== null &&
    Number.isInteger(evidence.year) &&
    evidence.year >= 1000 &&
    evidence.year <= asOfYear
  );
}

export function estimateRoofAge(
  input: RoofAgeEstimatorInput,
  profileInput: RoofAgeProfile | CompiledRoofAgeProfile,
): RoofAgeEstimate {
  const parsed = roofAgeEstimatorInputSchema.parse(input);
  const asOf = parseIsoDate(parsed.asOfDate);
  if (!asOf) {
    throw new Error(`asOfDate must be a valid ISO calendar date: ${parsed.asOfDate}`);
  }
  const profile =
    "sha256" in profileInput
      ? profileInput
      : compileRoofAgeProfile(profileInput);
  if (!SHA256_PATTERN.test(profile.sha256)) {
    throw new Error("Compiled roof-age profile has an invalid SHA-256 digest");
  }

  const permits = parsed.permits.map((permit) =>
    classifyRoofAgePermit(permit, profile),
  );
  const counts = emptyOutcomeCounts();
  const accepted: AcceptedPermitAnchor[] = [];
  for (const permit of permits) {
    const result = evaluatePermit(permit, asOf);
    if (result.accepted) {
      counts[result.anchor.outcome] += 1;
      accepted.push(result.anchor);
    } else {
      counts[result.outcome] += 1;
    }
  }

  const replacements = sortAcceptedAnchors(
    accepted.filter(
      (anchor) => anchor.outcome === "acceptedPrimaryRoofReplacement",
    ),
  );
  const newConstruction = sortAcceptedAnchors(
    accepted.filter(
      (anchor) => anchor.outcome === "acceptedPrimaryRoofNewConstruction",
    ),
  );
  const selected = replacements[0] ?? newConstruction[0] ?? null;
  const historicalCoverage = normalizedHistoricalCoverage(
    parsed.historicalCoverage,
  );
  const evidence = {
    permitCount: permits.length,
    permitOutcomeCounts: counts,
  };
  const policy = {
    version: ROOF_AGE_POLICY_VERSION,
    profileVersion: profile.version,
    profileSha256: profile.sha256,
  };

  if (selected) {
    const isReplacement =
      selected.outcome === "acceptedPrimaryRoofReplacement";
    return deepFreeze(
      roofAgeEstimateSchema.parse({
        schemaVersion: ROOF_AGE_ESTIMATE_SCHEMA_VERSION,
        asOfDate: parsed.asOfDate,
        anchor: {
          type: "permit_terminal_date",
          date: selected.date.value,
          source: {
            sourceSystem: selected.permit.sourceSystem,
            sourceRecordId: selected.permit.sourceRecordId,
            dateField: selected.dateField,
          },
        },
        estimatedAgeYears: wholeYearsBetween(selected.date, asOf),
        confidence: isReplacement ? "high" : "medium",
        workClassification: selected.permit.workClassification,
        eligibility: {
          eligible: true,
          reason: isReplacement
            ? "accepted_completed_primary_roof_replacement"
            : "accepted_completed_primary_roof_new_construction",
        },
        historicalCoverage,
        evidence,
        policy,
      }),
    ) as RoofAgeEstimate;
  }

  if (isValidBuiltYear(parsed.builtYear, asOf.year)) {
    return deepFreeze(
      roofAgeEstimateSchema.parse({
        schemaVersion: ROOF_AGE_ESTIMATE_SCHEMA_VERSION,
        asOfDate: parsed.asOfDate,
        anchor: {
          type: "property_built_year",
          year: parsed.builtYear.year,
          source: {
            sourceSystem: parsed.builtYear.sourceSystem,
            sourceRecordId: parsed.builtYear.sourceRecordId,
            field: parsed.builtYear.field,
          },
        },
        estimatedAgeYears: asOf.year - parsed.builtYear.year,
        confidence: "low",
        workClassification: null,
        eligibility: {
          eligible: true,
          reason: "accepted_property_built_year",
        },
        historicalCoverage,
        evidence,
        policy,
      }),
    ) as RoofAgeEstimate;
  }

  return deepFreeze(
    roofAgeEstimateSchema.parse({
      schemaVersion: ROOF_AGE_ESTIMATE_SCHEMA_VERSION,
      asOfDate: parsed.asOfDate,
      anchor: null,
      estimatedAgeYears: null,
      confidence: "none",
      workClassification: null,
      eligibility: { eligible: false, reason: "no_valid_anchor" },
      historicalCoverage,
      evidence,
      policy,
    }),
  ) as RoofAgeEstimate;
}
