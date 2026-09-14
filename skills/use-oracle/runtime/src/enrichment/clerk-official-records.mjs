import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const SCHEMA_VERSION = "elephant.clerk-recorded-community-names.v1";
const INSTRUMENT_TYPES = new Set(["plat", "declaration"]);
const NAME_KINDS = new Set(["plat_name", "declaration_name"]);
const APPROVED_SOURCE_PROFILES = new Map([
  [
    "duval-official-records-pilot-v1",
    {
      county: "duval",
      sourceUrl: "https://or.duvalclerk.com/",
      nameSource: "recorded_plat_or_declaration_name",
    },
  ],
]);

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Clerk official-records input requires ${field}`);
  }
  return value.trim();
}

function normalizeRecordedName(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validateManifest(manifest, countyKey, recordsBody) {
  if (manifest?.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Clerk source manifest must use ${SCHEMA_VERSION}`);
  }
  if (manifest.county !== countyKey) {
    throw new Error(
      `Clerk source county mismatch: expected ${countyKey}, received ${manifest.county ?? "missing"}`,
    );
  }
  if (manifest.authoritative !== true) {
    throw new Error("Clerk source manifest must be authoritative");
  }
  if (manifest.linkMethod !== "parcel_identifier") {
    throw new Error("Clerk records must link by exact parcel_identifier");
  }
  if (manifest.nameSource !== "recorded_plat_or_declaration_name") {
    throw new Error(
      "Clerk records must use recorded plat/declaration names, never party names",
    );
  }
  const approvedProfile = APPROVED_SOURCE_PROFILES.get(
    manifest.sourceProfileId,
  );
  if (!approvedProfile) {
    throw new Error(
      `Clerk source profile ${manifest.sourceProfileId ?? "missing"} is not approved`,
    );
  }
  for (const field of ["county", "sourceUrl", "nameSource"]) {
    if (manifest[field] !== approvedProfile[field]) {
      throw new Error(
        `Clerk source profile ${manifest.sourceProfileId} does not approve ${field}`,
      );
    }
  }
  if (!Number.isSafeInteger(manifest.recordCount) || manifest.recordCount < 0) {
    throw new Error("Clerk source manifest requires a non-negative recordCount");
  }
  const digest = createHash("sha256").update(recordsBody).digest("hex");
  if (manifest.recordsSha256 !== digest) {
    throw new Error("Clerk records digest does not match the source manifest");
  }
  return {
    ...manifest,
    sourceProfileId: requiredString(
      manifest.sourceProfileId,
      "sourceProfileId",
    ),
    sourceUrl: requiredString(manifest.sourceUrl, "sourceUrl"),
    extractId: requiredString(manifest.extractId, "extractId"),
    sourceRetrievedAt: requiredString(
      manifest.sourceRetrievedAt,
      "sourceRetrievedAt",
    ),
  };
}

function validateRecord(record, lineNumber, manifest) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`Clerk record ${lineNumber} must be a JSON object`);
  }
  const parcelIdentifier = requiredString(
    record.parcel_identifier,
    `record ${lineNumber} parcel_identifier`,
  );
  const recordedName = requiredString(
    record.recorded_name,
    `record ${lineNumber} recorded_name`,
  );
  const normalizedName = normalizeRecordedName(recordedName);
  if (!normalizedName) {
    throw new Error(`Clerk record ${lineNumber} has an empty recorded_name`);
  }
  const instrumentType = requiredString(
    record.instrument_type,
    `record ${lineNumber} instrument_type`,
  ).toLowerCase();
  const nameKind = requiredString(
    record.name_kind,
    `record ${lineNumber} name_kind`,
  ).toLowerCase();
  if (!INSTRUMENT_TYPES.has(instrumentType)) {
    throw new Error(
      `Clerk record ${lineNumber} instrument_type must be plat or declaration`,
    );
  }
  if (
    !NAME_KINDS.has(nameKind) ||
    (instrumentType === "plat" && nameKind !== "plat_name") ||
    (instrumentType === "declaration" && nameKind !== "declaration_name")
  ) {
    throw new Error(
      `Clerk record ${lineNumber} must identify a structured plat/declaration name, never a party`,
    );
  }
  return {
    parcelIdentifier,
    recordedName,
    normalizedName,
    instrumentType,
    nameKind,
    instrumentNumber: requiredString(
      record.instrument_number,
      `record ${lineNumber} instrument_number`,
    ),
    evidenceReference: requiredString(
      record.evidence_reference,
      `record ${lineNumber} evidence_reference`,
    ),
    sourceProfileId: manifest.sourceProfileId,
    sourceUrl: manifest.sourceUrl,
  };
}

export function emptyClerkOfficialRecords() {
  return {
    byParcel: new Map(),
    summary: {
      sourceProfileId: null,
      extractId: null,
      recordCount: 0,
      parcelCount: 0,
    },
  };
}

export async function loadClerkOfficialRecords({
  countyKey,
  recordsPath,
  sourceManifestPath,
}) {
  const [recordsBody, manifestBody] = await Promise.all([
    readFile(recordsPath, "utf8"),
    readFile(sourceManifestPath, "utf8"),
  ]);
  const manifest = validateManifest(
    JSON.parse(manifestBody),
    countyKey,
    recordsBody,
  );
  const byParcel = new Map();
  let recordCount = 0;
  for (const line of recordsBody.split(/\r?\n/)) {
    if (!line.trim()) continue;
    recordCount += 1;
    const record = validateRecord(JSON.parse(line), recordCount, manifest);
    const records = byParcel.get(record.parcelIdentifier) ?? [];
    records.push(record);
    byParcel.set(record.parcelIdentifier, records);
  }
  if (recordCount !== manifest.recordCount) {
    throw new Error(
      `Clerk record count ${recordCount} does not match manifest ${manifest.recordCount}`,
    );
  }
  return {
    byParcel,
    summary: {
      sourceProfileId: manifest.sourceProfileId,
      extractId: manifest.extractId,
      sourceUrl: manifest.sourceUrl,
      sourceRetrievedAt: manifest.sourceRetrievedAt,
      recordCount,
      parcelCount: byParcel.size,
      recordsSha256: manifest.recordsSha256,
    },
  };
}

export function recordedCommunityEvidenceForParcel(records, parcelIdentifier) {
  const candidates = records.byParcel.get(String(parcelIdentifier ?? "").trim()) ?? [];
  if (candidates.length === 0) return { status: "no_record", evidence: null };
  const byName = new Map();
  for (const candidate of candidates) {
    const matches = byName.get(candidate.normalizedName) ?? [];
    matches.push(candidate);
    byName.set(candidate.normalizedName, matches);
  }
  if (byName.size !== 1) {
    return {
      status: "not_unique",
      evidence: null,
      recordedNames: [...byName.keys()].sort(),
    };
  }
  const matches = [...byName.values()][0];
  const first = matches[0];
  return {
    status: "matched",
    evidence: {
      recordedName: first.recordedName,
      normalizedName: first.normalizedName,
      sourceProfileId: first.sourceProfileId,
      sourceUrl: first.sourceUrl,
      instruments: matches.map((record) => ({
        instrumentType: record.instrumentType,
        instrumentNumber: record.instrumentNumber,
        evidenceReference: record.evidenceReference,
      })),
    },
  };
}
