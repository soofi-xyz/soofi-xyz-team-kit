/**
 * Pure state transitions for the `CountyLedger` virtual object (single writer
 * of per-parcel status). The object handler only loads the previous entry,
 * calls `applyRecord`, and stores the result plus the count deltas.
 *
 * Status ∈ pending | ready | dead | invalid | failed (+ blocked, permits only).
 * - appraisal stages (capture, transform, validate, ready, eligibility) track
 *   the parcel; `ready` requires the validated artifact hash and transform
 *   version.
 * - `stage: "permits"` tracks the permit-link result separately, so a permit
 *   outcome never changes the parcel's appraisal status. `blocked` (permits
 *   only) means the jurisdiction's source is blocked (captcha, login,
 *   custodian-only): harvestable later, unlike `dead` (no profile, not
 *   eligible, unrouted).
 * - a parcel that was ever ready and is now dead/invalid is a TOMBSTONE: it
 *   must be excluded from group directories; a later ready clears it.
 * - re-recording an identical status is a no-op (idempotent retries).
 */

export const LEDGER_STATUSES = ["pending", "ready", "dead", "invalid", "failed", "blocked"] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];

export const APPRAISAL_STAGES = ["capture", "transform", "validate", "ready", "eligibility"] as const;
export const PERMIT_STAGE = "permits";
export type LedgerStage = (typeof APPRAISAL_STAGES)[number] | typeof PERMIT_STAGE;

export type LedgerRecordInput = {
  parcel_id: string;
  stage: LedgerStage;
  status: LedgerStatus;
  reason?: string | null;
  artifactHash?: string | null;
  transformVersion?: string | null;
  detail?: Record<string, unknown> | null;
};

export type LedgerEntry = {
  parcel_id: string;
  stage: LedgerStage;
  status: LedgerStatus;
  reason: string | null;
  artifactHash: string | null;
  transformVersion: string | null;
  detail: Record<string, unknown> | null;
  previousStatus: LedgerStatus | null;
  wasReady: boolean;
  tombstoned: boolean;
  transitions: number;
  updatedAt: string;
};

export type StatusCounts = Record<LedgerStatus, number>;

export const emptyCounts = (): StatusCounts => ({
  pending: 0,
  ready: 0,
  dead: 0,
  invalid: 0,
  failed: 0,
  blocked: 0,
});

/** State key of a parcel's entry (appraisal) or permit-link entry. */
export function entryKey(stage: LedgerStage, parcelId: string): string {
  return stage === PERMIT_STAGE ? `permit:${parcelId}` : `p:${parcelId}`;
}

export class LedgerInputError extends Error {}

const HASH = /^[a-f0-9]{64}$/;

/** Validate and normalize a `record` payload; throws LedgerInputError. */
export function parseRecordInput(value: unknown): LedgerRecordInput {
  if (!value || typeof value !== "object") throw new LedgerInputError("record payload must be an object");
  const input = value as Record<string, unknown>;
  const parcelId = typeof input.parcel_id === "string" ? input.parcel_id.trim() : "";
  if (!parcelId) throw new LedgerInputError("parcel_id is required");
  const stage = input.stage as LedgerStage;
  if (stage !== PERMIT_STAGE && !(APPRAISAL_STAGES as readonly string[]).includes(stage)) {
    throw new LedgerInputError(`unknown stage ${String(input.stage)}`);
  }
  const status = input.status as LedgerStatus;
  if (!(LEDGER_STATUSES as readonly string[]).includes(status)) {
    throw new LedgerInputError(`status must be one of ${LEDGER_STATUSES.join(", ")}`);
  }
  const text = (key: string) =>
    typeof input[key] === "string" && (input[key] as string).trim() ? (input[key] as string).trim() : null;
  const reason = text("reason");
  const artifactHash = text("artifactHash");
  const transformVersion = text("transformVersion");
  if (stage !== PERMIT_STAGE && status === "ready") {
    if (!artifactHash || !HASH.test(artifactHash)) {
      throw new LedgerInputError("ready requires artifactHash (sha256 of the validated transformed.zip)");
    }
    if (!transformVersion) throw new LedgerInputError("ready requires transformVersion");
  }
  if (status === "blocked" && stage !== PERMIT_STAGE) {
    throw new LedgerInputError("blocked is a permits-stage status");
  }
  if ((status === "dead" || status === "invalid" || status === "failed" || status === "blocked") && !reason) {
    throw new LedgerInputError(`${status} requires a reason`);
  }
  const detail =
    input.detail && typeof input.detail === "object" && !Array.isArray(input.detail)
      ? (input.detail as Record<string, unknown>)
      : null;
  return { parcel_id: parcelId, stage, status, reason, artifactHash, transformVersion, detail };
}

export type ApplyResult = {
  next: LedgerEntry;
  changed: boolean;
  countsDelta: Partial<StatusCounts>;
  tombstoneDelta: number;
};

/** Apply one record to the previous entry (null when unseen). */
export function applyRecord(
  previous: LedgerEntry | null,
  input: LedgerRecordInput,
  nowIso: string,
): ApplyResult {
  const isPermit = input.stage === PERMIT_STAGE;
  const sameAsBefore =
    previous !== null &&
    previous.status === input.status &&
    previous.stage === input.stage &&
    previous.reason === (input.reason ?? null) &&
    previous.artifactHash === (input.artifactHash ?? null) &&
    previous.transformVersion === (input.transformVersion ?? null) &&
    JSON.stringify(previous.detail) === JSON.stringify(input.detail ?? null);
  if (previous && sameAsBefore) {
    return { next: previous, changed: false, countsDelta: {}, tombstoneDelta: 0 };
  }
  const wasReady = !isPermit && ((previous?.wasReady ?? false) || input.status === "ready");
  const tombstoned =
    !isPermit && wasReady && (input.status === "dead" || input.status === "invalid");
  const next: LedgerEntry = {
    parcel_id: input.parcel_id,
    stage: input.stage,
    status: input.status,
    reason: input.reason ?? null,
    artifactHash: input.artifactHash ?? null,
    transformVersion: input.transformVersion ?? null,
    detail: input.detail ?? null,
    previousStatus: previous?.status ?? null,
    wasReady,
    tombstoned,
    transitions: (previous?.transitions ?? 0) + (previous && previous.status !== input.status ? 1 : 0),
    updatedAt: nowIso,
  };
  const countsDelta: Partial<StatusCounts> = {};
  if (!previous || previous.status !== next.status) {
    if (previous) countsDelta[previous.status] = -1;
    countsDelta[next.status] = (countsDelta[next.status] ?? 0) + 1;
  }
  const tombstoneDelta = (next.tombstoned ? 1 : 0) - (previous?.tombstoned ? 1 : 0);
  return { next, changed: true, countsDelta, tombstoneDelta };
}

export function addCounts(counts: StatusCounts, delta: Partial<StatusCounts>): StatusCounts {
  const next = { ...counts };
  for (const status of LEDGER_STATUSES) next[status] += delta[status] ?? 0;
  return next;
}

export type LedgerSummary = {
  key: string;
  parcels: number;
  counts: StatusCounts;
  tombstones: number;
  permits: { parcels: number; counts: StatusCounts };
  updatedAt: string | null;
};

export function summarize(
  key: string,
  counts: StatusCounts | null,
  permitCounts: StatusCounts | null,
  tombstones: number | null,
  updatedAt: string | null,
): LedgerSummary {
  const appraisal = counts ?? emptyCounts();
  const permits = permitCounts ?? emptyCounts();
  const total = (value: StatusCounts) => LEDGER_STATUSES.reduce((sum, status) => sum + value[status], 0);
  return {
    key,
    parcels: total(appraisal),
    counts: appraisal,
    tombstones: tombstones ?? 0,
    permits: { parcels: total(permits), counts: permits },
    updatedAt,
  };
}
