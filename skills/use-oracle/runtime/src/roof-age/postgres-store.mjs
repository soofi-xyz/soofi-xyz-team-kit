const REQUIRED_COLUMNS = Object.freeze({
  parcels: ["parcel_id", "county_name", "state_code"],
  properties: [
    "property_id",
    "parcel_id",
    "source_system",
    "source_record_key",
    "property_structure_built_year",
  ],
  structures: [
    "structure_id",
    "property_id",
    "roof_date",
    "roof_age_years",
    "source_payload",
    "updated_at",
  ],
  property_improvements: [
    "property_id",
    "source_system",
    "source_record_key",
    "improvement_status",
    "improvement_type",
    "completion_date",
    "permit_close_date",
    "application_received_date",
    "permit_issue_date",
    "opened_date",
    "source_payload",
  ],
});

function buildScopeWhere(scope, values) {
  const clauses = [];
  const bind = (value) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (scope.propertyIds?.length) {
    clauses.push(`p.property_id = ANY(${bind(scope.propertyIds)}::uuid[])`);
  }
  if (scope.state) {
    clauses.push(`lower(pa.state_code) = lower(${bind(scope.state)})`);
  }
  if (scope.county) {
    clauses.push(`lower(pa.county_name) = lower(${bind(scope.county)})`);
  }
  if (scope.sourceSystem) {
    clauses.push(`p.source_system = ${bind(scope.sourceSystem)}`);
  }
  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}

export function createPostgresRoofAgeStore(client) {
  return {
    begin: ({ readOnly = false } = {}) =>
      client.query(readOnly ? "BEGIN READ ONLY" : "BEGIN"),
    commit: () => client.query("COMMIT"),
    rollback: () => client.query("ROLLBACK"),
    acquireLock: (scopeKey) =>
      client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`oracle-roof-age:${scopeKey}`],
      ),
    async validateSchema() {
      const result = await client.query(
        `/* roof-age:validate-schema */
         SELECT table_name, column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = ANY($1::text[])`,
        [Object.keys(REQUIRED_COLUMNS)],
      );
      const found = new Set(
        result.rows.map((row) => `${row.table_name}.${row.column_name}`),
      );
      for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
        for (const column of columns) {
          if (!found.has(`${table}.${column}`)) {
            throw new Error(
              `Roof-age target schema is missing public.${table}.${column}`,
            );
          }
        }
      }
    },
    async readRoofAgeRecords(scope = {}) {
      const values = [];
      const where = buildScopeWhere(scope, values);
      const limit =
        Number.isInteger(scope.limit) && scope.limit > 0
          ? scope.limit
          : 1000;
      const offset =
        Number.isInteger(scope.offset) && scope.offset >= 0
          ? scope.offset
          : 0;
      values.push(limit, offset);
      const lock = scope.forUpdate ? "FOR UPDATE OF p" : "";
      const result = await client.query(
        `/* roof-age:read-properties */
         SELECT p.property_id, p.source_system, p.source_record_key,
           p.property_structure_built_year,
           s.structure_id, s.roof_date, s.roof_age_years, s.source_payload
         FROM public.properties p
         JOIN public.parcels pa ON pa.parcel_id = p.parcel_id
         LEFT JOIN LATERAL (
           SELECT structure_id, roof_date, roof_age_years, source_payload
           FROM public.structures
           WHERE property_id = p.property_id
           ORDER BY source_system, source_record_key, structure_id
           LIMIT 1
         ) s ON true
         ${where}
         ORDER BY p.property_id
         LIMIT $${values.length - 1} OFFSET $${values.length}
         ${lock}`,
        values,
      );
      const propertyIds = result.rows.map((row) => row.property_id);
      const permitRows =
        propertyIds.length === 0
          ? []
          : (
              await client.query(
                `/* roof-age:read-permits */
                 SELECT property_id, source_system, source_record_key,
                   improvement_status, improvement_type, completion_date,
                   permit_close_date, application_received_date,
                   permit_issue_date, opened_date, source_payload
                 FROM public.property_improvements
                 WHERE property_id = ANY($1::uuid[])
                 ORDER BY property_id, source_system, source_record_key`,
                [propertyIds],
              )
            ).rows;
      const permitsByProperty = new Map();
      for (const row of permitRows) {
        const permits = permitsByProperty.get(row.property_id) ?? [];
        permits.push({
          sourceSystem: row.source_system,
          sourceRecordId: row.source_record_key,
          improvementStatus: row.improvement_status,
          improvementType: row.improvement_type,
          completionDate: row.completion_date,
          closeDate: row.permit_close_date,
          applicationDate: row.application_received_date,
          issueDate: row.permit_issue_date,
          openedDate: row.opened_date,
          sourcePayload: row.source_payload,
        });
        permitsByProperty.set(row.property_id, permits);
      }
      return result.rows.map((row) => ({
        propertyId: row.property_id,
        structureId: row.structure_id,
        sourceSystem: row.source_system,
        sourceRecordId: row.source_record_key,
        builtYear: row.property_structure_built_year,
        roofDate: row.roof_date,
        roofAgeYears: row.roof_age_years,
        sourcePayload: row.source_payload,
        permits: permitsByProperty.get(row.property_id) ?? [],
      }));
    },
    async countRoofAgeRecords(scope = {}) {
      const values = [];
      const where = buildScopeWhere(scope, values);
      const result = await client.query(
        `/* roof-age:count-properties */
         SELECT count(*)::bigint AS total
         FROM public.properties p
         JOIN public.parcels pa ON pa.parcel_id = p.parcel_id
         ${where}`,
        values,
      );
      return Number(result.rows[0]?.total ?? 0);
    },
    async writeRoofAgeUpdates(plans) {
      let updated = 0;
      for (const plan of plans) {
        if (!plan.changed || !plan.structureId) continue;
        const result = await client.query(
          `/* roof-age:update-structure */
           UPDATE public.structures
           SET roof_date = $2,
               roof_age_years = $3,
               source_payload = jsonb_set(
                 COALESCE(source_payload, '{}'::jsonb),
                 '{roof_age_lineage}',
                 $4::jsonb,
                 true
               ),
               updated_at = now()
           WHERE structure_id = $1
             AND (
               roof_date IS DISTINCT FROM $2
               OR roof_age_years IS DISTINCT FROM $3
               OR source_payload->'roof_age_lineage' IS DISTINCT FROM $4::jsonb
             )`,
          [
            plan.structureId,
            plan.after.roofDate,
            plan.after.roofAgeYears,
            JSON.stringify(plan.after.lineage),
          ],
        );
        updated += result.rowCount ?? 0;
      }
      return updated;
    },
  };
}
