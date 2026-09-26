import { reconcileRoofAgeBatch } from "./integration.ts";
import { productionRoofAgeProfile } from "./production-profile.ts";

export async function runRoofAgeBackfill({
  store,
  state,
  county = null,
  sourceSystem = null,
  asOfDate,
  limit = 1000,
  offset = 0,
  apply = false,
  historicalCoverage = {
    state: "unknown",
    caveats: ["history_unknown"],
  },
}) {
  if (!/^[A-Z]{2}$/.test(state ?? "")) {
    throw new Error("Roof-age audit requires a two-letter --state");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate ?? "")) {
    throw new Error("Roof-age audit requires --as-of-date YYYY-MM-DD");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
    throw new Error("--limit must be an integer from 1 through 10000");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("--offset must be a non-negative integer");
  }
  let transactionStarted = false;
  try {
    await store.begin({ readOnly: !apply });
    transactionStarted = true;
    await store.validateSchema();
    if (apply) {
      await store.acquireLock(
        `${state}:${county ?? "*"}:${sourceSystem ?? "*"}`,
      );
    }
    const scopeTotalRows = await store.countRoofAgeRecords({
      state,
      county,
      sourceSystem,
    });
    const records = await store.readRoofAgeRecords({
      state,
      county,
      sourceSystem,
      limit,
      offset,
      forUpdate: apply,
    });
    const reconciliation = reconcileRoofAgeBatch(records, {
      asOfDate,
      historicalCoverage,
      profile: productionRoofAgeProfile,
    });
    const rowsWritten = apply
      ? await store.writeRoofAgeUpdates(reconciliation.plans)
      : 0;
    await store.commit();
    transactionStarted = false;
    return {
      schemaVersion: "elephant.roof-age-backfill-report.v1",
      mode: apply ? "apply" : "dry-run",
      scope: { state, county, sourceSystem, limit, offset },
      scopeTotalRows,
      asOfDate,
      historicalCoverage,
      ...reconciliation.summary,
      projectedUpdatedRows: reconciliation.summary.updatedRows,
      rowsWritten,
      beforeAfterReconciled:
        reconciliation.summary.missingAfter <=
        reconciliation.summary.missingBefore,
    };
  } catch (error) {
    if (transactionStarted) await store.rollback();
    throw error;
  }
}
