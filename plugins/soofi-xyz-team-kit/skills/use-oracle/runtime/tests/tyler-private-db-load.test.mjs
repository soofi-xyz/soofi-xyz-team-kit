import { describe, expect, it } from "vitest";

import {
  assertPrivatePermitBundle,
  createPostgresTylerPrivateStore,
  loadTylerPrivateDatabase,
  PRIVATE_LOAD_SQL,
  resolvePrivateDatabaseUrl,
  verifyTylerPrivateLoad,
} from "../src/permits/private-db-load.mjs";

function identityKey(sourceSystem, sourceRecordKey) {
  return `${sourceSystem}\u0000${sourceRecordKey}`;
}

function sampleBundle() {
  const permits = [
    {
      countyKey: "broward",
      jurisdictionKey: "pembroke-pines",
      source_system: "broward_pembroke_pines_tyler_permits",
      sourceRecordId: "permit-a",
      permit_number: "RL23-04374",
      parcel_identifier: "514005211940",
    },
    {
      countyKey: "broward",
      jurisdictionKey: "pembroke-pines",
      source_system: "broward_pembroke_pines_tyler_permits",
      sourceRecordId: "permit-b",
      permit_number: "RL23-04447",
      parcel_identifier: "514005211940",
    },
    {
      countyKey: "broward",
      jurisdictionKey: "sunrise",
      source_system: "broward_sunrise_tyler_permits",
      sourceRecordId: "permit-c",
      permit_number: "C-MECH-009303-2026",
      parcel_identifier: "494026050080",
    },
    {
      countyKey: "broward",
      jurisdictionKey: "sunrise",
      source_system: "broward_sunrise_tyler_permits",
      sourceRecordId: "permit-d",
      permit_number: "C-STRU-008439-2026",
      parcel_identifier: "494026050080",
    },
    {
      countyKey: "broward",
      jurisdictionKey: "sunrise",
      source_system: "broward_sunrise_tyler_permits",
      sourceRecordId: "permit-e",
      permit_number: "C-STRU-005996-2026",
      parcel_identifier: "494026050080",
    },
    {
      countyKey: "broward",
      jurisdictionKey: "sunrise",
      source_system: "broward_sunrise_tyler_permits",
      sourceRecordId: "permit-f",
      permit_number: "C-STRU-005992-2026",
      parcel_identifier: "494026050080",
    },
  ];
  const contacts = [
    {
      parentSourceSystem: permits[0].source_system,
      parentSourceRecordKey: permits[0].sourceRecordId,
      sourceSystem: permits[0].source_system,
      sourceRecordKey: "contact-a",
      contactRole: "Contractor",
      companyId: null,
      rawName: "Z Roofing & Waterproofing",
      qualifierName: "ESPOSITO AGUSTIN",
      phone: null,
      email: null,
      licenseNumber: null,
      sourcePayload: {},
    },
    {
      parentSourceSystem: permits[1].source_system,
      parentSourceRecordKey: permits[1].sourceRecordId,
      sourceSystem: permits[1].source_system,
      sourceRecordKey: "contact-b",
      contactRole: "Contractor",
      companyId: null,
      rawName: "Z Roofing & Waterproofing",
      qualifierName: "ESPOSITO AGUSTIN",
      phone: null,
      email: null,
      licenseNumber: null,
      sourcePayload: {},
    },
    {
      parentSourceSystem: permits[2].source_system,
      parentSourceRecordKey: permits[2].sourceRecordId,
      sourceSystem: permits[2].source_system,
      sourceRecordKey: "contact-c",
      contactRole: "Contractor",
      companyId: null,
      rawName: "Spectrum Renovations AC",
      qualifierName: null,
      phone: null,
      email: null,
      licenseNumber: null,
      sourcePayload: {},
    },
    {
      parentSourceSystem: permits[3].source_system,
      parentSourceRecordKey: permits[3].sourceRecordId,
      sourceSystem: permits[3].source_system,
      sourceRecordKey: "contact-d",
      contactRole: "Contractor",
      companyId: null,
      rawName: "Weather-Tech Roofing",
      qualifierName: null,
      phone: null,
      email: null,
      licenseNumber: null,
      sourcePayload: {},
    },
    {
      parentSourceSystem: permits[3].source_system,
      parentSourceRecordKey: permits[3].sourceRecordId,
      sourceSystem: permits[3].source_system,
      sourceRecordKey: "contact-e",
      contactRole: "Contractor",
      companyId: null,
      rawName: "Management Resource Systems",
      qualifierName: null,
      phone: null,
      email: null,
      licenseNumber: null,
      sourcePayload: {},
    },
    ...[4, 5].map((permitIndex) => ({
      parentSourceSystem: permits[permitIndex].source_system,
      parentSourceRecordKey: permits[permitIndex].sourceRecordId,
      sourceSystem: permits[permitIndex].source_system,
      sourceRecordKey: `contact-${permitIndex + 2}`,
      contactRole: "Contractor",
      companyId: null,
      rawName: "Weather Guard Industries",
      qualifierName: null,
      phone: null,
      email: null,
      licenseNumber: null,
      sourcePayload: {},
    })),
  ];
  for (const permit of permits) {
    Object.assign(permit, {
      improvement_type: "Mechanical",
      improvement_status: "Issued",
      improvement_action: null,
      application_received_date: "2023-01-01",
      permit_issue_date: "2023-01-10",
      permit_close_date: null,
      completion_date: null,
      sourcePayload: {},
    });
  }
  Object.assign(permits[0], {
    improvement_type: "Roof Upgrade",
    improvement_status: "Complete",
    permit_close_date: "2023-11-01",
  });
  return {
    manifest: { countyKey: "broward", permitCount: 6 },
    permits,
    contacts,
  };
}

class MemoryStore {
  constructor({ failSchema = false, omitParent = null } = {}) {
    this.failSchema = failSchema;
    this.omitParent = omitParent;
    this.permits = new Map();
    this.contacts = new Map();
    this.parents = new Map([
      [
        "514005211940",
        {
          propertyId: "property-a",
          parcelId: "parcel-a",
          parcelIdentifier: "514005211940",
        },
      ],
      [
        "494026050080",
        {
          propertyId: "property-b",
          parcelId: "parcel-b",
          parcelIdentifier: "494026050080",
        },
      ],
    ]);
    this.structures = new Map([
      [
        "property-a",
        {
          propertyId: "property-a",
          structureId: "structure-a",
          sourceSystem: "broward_appraiser",
          sourceRecordId: "parcel-a",
          builtYear: 2000,
          roofDate: null,
          roofAgeYears: null,
          sourcePayload: {},
        },
      ],
      [
        "property-b",
        {
          propertyId: "property-b",
          structureId: "structure-b",
          sourceSystem: "broward_appraiser",
          sourceRecordId: "parcel-b",
          builtYear: 1990,
          roofDate: null,
          roofAgeYears: null,
          sourcePayload: {},
        },
      ],
    ]);
    this.commits = 0;
    this.rollbacks = 0;
  }

  async begin() {
    this.snapshot = {
      permits: new Map(this.permits),
      contacts: new Map(this.contacts),
      structures: structuredClone(this.structures),
    };
  }

  async commit() {
    this.commits += 1;
    this.snapshot = null;
  }

  async rollback() {
    this.rollbacks += 1;
    this.permits = this.snapshot.permits;
    this.contacts = this.snapshot.contacts;
    this.structures = this.snapshot.structures;
    this.snapshot = null;
  }

  async validateSchema() {
    if (this.failSchema) throw new Error("schema mismatch");
  }

  async acquireLock() {}

  async resolveParents(parcelIdentifiers) {
    return parcelIdentifiers
      .filter((identifier) => identifier !== this.omitParent)
      .map((identifier) => this.parents.get(identifier))
      .filter(Boolean);
  }

  async findPermits(identities) {
    return identities
      .map((identity) =>
        this.permits.get(
          identityKey(identity.sourceSystem, identity.sourceRecordKey),
        ),
      )
      .filter(Boolean);
  }

  async upsertPermit(record, parent) {
    const key = identityKey(record.source_system, record.sourceRecordId);
    const existing = this.permits.get(key);
    const row = {
      propertyImprovementId:
        existing?.propertyImprovementId ??
        `improvement-${this.permits.size + 1}`,
      propertyId: parent.propertyId,
      parcelId: parent.parcelId,
      parcelIdentifier: record.parcel_identifier,
      permitNumber: record.permit_number,
      sourceSystem: record.source_system,
      sourceRecordKey: record.sourceRecordId,
      contractorCompanyId: existing?.contractorCompanyId ?? null,
      record: structuredClone(record),
    };
    this.permits.set(key, row);
    return row;
  }

  async findContacts(identities) {
    return identities
      .map((identity) =>
        this.contacts.get(
          identityKey(identity.sourceSystem, identity.sourceRecordKey),
        ),
      )
      .filter(Boolean);
  }

  async upsertContact(contact, propertyImprovementId) {
    const key = identityKey(
      contact.sourceSystem,
      contact.sourceRecordKey,
    );
    const existing = this.contacts.get(key);
    const row = {
      permitContactId:
        existing?.permitContactId ?? `contact-${this.contacts.size + 1}`,
      propertyImprovementId,
      companyId: existing?.companyId ?? null,
      contactRole: contact.contactRole,
      rawName: contact.rawName,
      phone: contact.phone,
      email: contact.email,
      licenseNumber: contact.licenseNumber,
      sourceSystem: contact.sourceSystem,
      sourceRecordKey: contact.sourceRecordKey,
    };
    this.contacts.set(key, row);
    return row;
  }

  readPermits(identities) {
    return this.findPermits(identities);
  }

  readContacts(identities) {
    return this.findContacts(identities);
  }

  async readRoofAgeRecords({ propertyIds }) {
    return propertyIds.map((propertyId) => ({
      ...structuredClone(this.structures.get(propertyId)),
      permits: [...this.permits.values()]
        .filter((permit) => permit.propertyId === propertyId)
        .map((permit) => ({
          sourceSystem: permit.sourceSystem,
          sourceRecordId: permit.sourceRecordKey,
          improvementStatus: permit.record.improvement_status,
          improvementType: permit.record.improvement_type,
          completionDate: permit.record.completion_date,
          closeDate: permit.record.permit_close_date,
          applicationDate: permit.record.application_received_date,
          issueDate: permit.record.permit_issue_date,
          sourcePayload: permit.record.sourcePayload,
        })),
    }));
  }

  async writeRoofAgeUpdates(plans) {
    let updated = 0;
    for (const plan of plans) {
      if (!plan.changed) continue;
      const structure = this.structures.get(plan.propertyId);
      structure.roofDate = plan.after.roofDate;
      structure.roofAgeYears = plan.after.roofAgeYears;
      structure.sourcePayload.roof_age_lineage = plan.after.lineage;
      updated += 1;
    }
    return updated;
  }
}

describe("Tyler private database loader", () => {
  it("loads every permit and contact and reruns idempotently", async () => {
    const bundle = sampleBundle();
    const store = new MemoryStore();
    expect(await loadTylerPrivateDatabase({
      bundle,
      store,
      asOfDate: "2026-09-14",
    })).toMatchObject({
      permitCount: 6,
      contractorCount: 7,
      linkedPropertyCount: 2,
      roofAge: {
        permitUpdatedValues: 1,
        constructionYearDefaults: 1,
        rowsWritten: 2,
      },
    });
    expect(store.permits.size).toBe(6);
    expect(store.contacts.size).toBe(7);
    const contactsPerPermit = new Map();
    for (const row of store.contacts.values()) {
      contactsPerPermit.set(
        row.propertyImprovementId,
        (contactsPerPermit.get(row.propertyImprovementId) ?? 0) + 1,
      );
    }
    expect([...contactsPerPermit.values()]).toContain(2);
    expect(
      [...store.contacts.values()].every(
        (row) => row.companyId === null,
      ),
    ).toBe(true);
    expect(await loadTylerPrivateDatabase({
      bundle,
      store,
      asOfDate: "2026-09-14",
    })).toMatchObject({
      permitCount: 6,
      contractorCount: 7,
      linkedPropertyCount: 2,
      roofAge: { rowsWritten: 0 },
    });
    expect(store.permits.size).toBe(6);
    expect(store.contacts.size).toBe(7);
    expect(store.commits).toBe(2);
    expect(
      await verifyTylerPrivateLoad({ bundle, store }),
    ).toEqual({ permitCount: 6, contractorCount: 7 });
  });

  it("rolls back on schema and parent mismatches", async () => {
    const bundle = sampleBundle();
    for (const store of [
      new MemoryStore({ failSchema: true }),
      new MemoryStore({ omitParent: "494026050080" }),
    ]) {
      await expect(
        loadTylerPrivateDatabase({
          bundle,
          store,
          asOfDate: "2026-09-14",
        }),
      ).rejects.toThrow(/schema mismatch|No complete Broward appraisal parent/);
      expect(store.permits.size).toBe(0);
      expect(store.contacts.size).toBe(0);
      expect(store.commits).toBe(0);
      expect(store.rollbacks).toBe(1);
    }
  });

  it("requires an explicit valid database URL environment variable", () => {
    expect(() =>
      resolvePrivateDatabaseUrl({
        environmentName: "",
        environment: {},
      }),
    ).toThrow(/explicit --database-url-env/);
    expect(() =>
      resolvePrivateDatabaseUrl({
        environmentName: "DATABASE_URL",
        environment: {},
      }),
    ).toThrow(/DATABASE_URL is not set/);
    expect(
      resolvePrivateDatabaseUrl({
        environmentName: "DATABASE_URL",
        environment: {
          DATABASE_URL: "postgresql://example.invalid/database",
        },
      }),
    ).toBe("postgresql://example.invalid/database");
  });

  it("uses stable upserts without changing company links", () => {
    for (const sql of [
      PRIVATE_LOAD_SQL.upsertPermit,
      PRIVATE_LOAD_SQL.upsertContact,
    ]) {
      expect(sql).toMatch(
        /ON CONFLICT \(source_system, source_record_key\) DO UPDATE SET/,
      );
    }
    expect(
      PRIVATE_LOAD_SQL.upsertPermit
        .split("DO UPDATE SET")[1]
        .split("RETURNING")[0],
    ).not.toMatch(/contractor_company_id/);
    expect(
      PRIVATE_LOAD_SQL.upsertContact
        .split("DO UPDATE SET")[1]
        .split("RETURNING")[0],
    ).not.toMatch(/\bcompany_id\b/);
  });

  it("accepts only the explicitly approved source, parcel, and permits", () => {
    const bundle = sampleBundle();
    const expectedScope = {
      countyKey: "broward",
      sourceSystem: "broward_pembroke_pines_tyler_permits",
      parcelIdentifier: "514005211940",
      permitNumbers: ["RL23-04374", "RL23-04447"],
    };
    const scopedBundle = {
      ...bundle,
      permits: bundle.permits.slice(0, 2),
    };
    expect(() =>
      assertPrivatePermitBundle(scopedBundle, expectedScope),
    ).not.toThrow();
    expect(() =>
      assertPrivatePermitBundle(scopedBundle, {
        ...expectedScope,
        permitNumbers: ["RL23-04374", "UNEXPECTED"],
      }),
    ).toThrow(/explicitly approved/);
  });

  it("fails closed when reflected database columns are missing", async () => {
    const calls = [];
    const store = createPostgresTylerPrivateStore({
      async query(sql, values) {
        calls.push({ sql, values });
        return { rows: [] };
      },
    });
    await expect(store.validateSchema()).rejects.toThrow(
      /target schema is missing|Target schema mismatch/i,
    );
    expect(calls[0].sql).toMatch(/information_schema\.columns/);
  });
});
