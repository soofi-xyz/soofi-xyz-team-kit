// Raw-observation diagnosis, NetSuite paid-truth scoring, and row
// confidence for HOA web enrichment.

import { PERIOD_MULTIPLIER, annualize, canonicalFrequency, close } from "./hoa-web-fees.mjs";

const PROPERTY_SCOPES = new Set(["exact_property", "association_property_roster"]);

// Diagnose the explicit tuples captured for one property before any
// adjudication picks a value.
export function diagnoseObservations({ scope, observations = [] }) {
  if (!PROPERTY_SCOPES.has(scope)) return "insufficient_evidence";
  const tuples = observations.map((observation) => {
    const frequency = canonicalFrequency(observation.frequencyRaw);
    return { ...observation, frequency, annualized: annualize(observation.amountUsd, frequency) };
  });
  const eligible = tuples.filter((tuple) => tuple.annualized !== null);
  if (!eligible.length) return "insufficient_evidence";
  const associations = new Set(eligible.map((tuple) => tuple.associationCandidate).filter(Boolean));
  if (associations.size > 1) return "association_scope_difference";
  const distinct = [];
  for (const tuple of eligible) {
    if (!distinct.some((value) => close(value, tuple.annualized))) distinct.push(tuple.annualized);
  }
  if (distinct.length > 1) return "source_conflict";
  return eligible.length === 1 ? "confirmed_match" : "equivalent_period_representation";
}

// Structured claims from accepted pages as diagnosable observations. Badges,
// widgets, and totals are derived views and are left out.
export function observationsFromClaims(claims) {
  return claims
    .filter((claim) => ["primary", "text_billing", "secondary", "master"].includes(claim.kind))
    .map((claim) => ({
      associationCandidate: claim.kind === "secondary" || claim.kind === "master" ? claim.assocName ?? claim.label ?? claim.kind : "primary",
      amountUsd: claim.amount,
      frequencyRaw: claim.frequency,
      sourceUrl: claim.url,
      evidenceQuote: claim.quote,
    }));
}

const sameTuple = (a, b) =>
  Boolean(a && b) && Number(a.amountUsd) === Number(b.amountUsd) && (canonicalFrequency(a.frequencyRaw) ?? a.frequencyCanonical) === (b.frequencyCanonical ?? canonicalFrequency(b.frequencyRaw));

// Decide whether a discrepancy entered in the source or in conversion.
export function diagnoseRawVersusOutput({ rawObservation, transformedOutput, controlOutput, comparisonValue }) {
  if (transformedOutput) return sameTuple(rawObservation, transformedOutput) ? "confirmed_match" : "transformation_problem";
  if (controlOutput && comparisonValue) {
    if (sameTuple(rawObservation, controlOutput)) {
      return sameTuple(rawObservation, comparisonValue) ? "confirmed_match" : "temporal_scope_difference";
    }
    return "source_conflict";
  }
  return "insufficient_evidence";
}

// NetSuite paid truth: actual_day = -unit_holding_hoa_dues_cost. Never use
// actual_dip as the hold duration.
export function prismDay(annualizedUsd) {
  return annualizedUsd === null || annualizedUsd === undefined ? null : annualizedUsd / 365.25;
}

export function feeGapPct(actualDay, prism) {
  if (prism === null || prism === undefined || !(actualDay > 0)) return null;
  return Math.abs(prism - actualDay) / actualDay;
}

export function isReviewGap(actualDay, prism, threshold = 0.075) {
  if (prism === null || prism === undefined || prism <= 0) return true;
  return feeGapPct(actualDay, prism) > threshold;
}

// Score the same dollar amount under every recurring period. A candidate is
// a review lead only; apply it after an exact-property page confirms it.
export function frequencyCorrectionCandidate({ amountUsd, storedFrequency, actualDay }) {
  if (!(amountUsd > 0) || !(actualDay > 0)) return null;
  const errors = Object.fromEntries(
    Object.entries(PERIOD_MULTIPLIER).map(([period, multiplier]) => [
      period,
      Math.abs((amountUsd * multiplier) / 365.25 - actualDay) / actualDay,
    ]),
  );
  if (!(errors[storedFrequency] > 0.075)) return null;
  const alternatives = Object.entries(errors).filter(([period, error]) => period !== storedFrequency && error <= 0.02);
  if (alternatives.length !== 1) return null;
  const [[frequency, error]] = alternatives;
  return { frequency, error, storedError: errors[storedFrequency] };
}

const ORDER = { low: 0, medium: 1, high: 2 };

// Row confidence is the minimum of the name and fee confidences.
export function minConfidence(...values) {
  const present = values.filter(Boolean);
  if (!present.length) return "low";
  return present.reduce((low, value) => (ORDER[value] < ORDER[low] ? value : low));
}

const filled = (row) => ({ name: Boolean(row.final_hoa_name), fee: row.final_fee !== null && row.final_fee !== undefined });

// Coverage counts reported before and after every pass.
export function coverageCounts(rows) {
  const counts = { rows: rows.length, missing_both: 0, name_only_missing: 0, fee_only_missing: 0, rows_with_name_fee_and_frequency: 0 };
  for (const row of rows) {
    const { name, fee } = filled(row);
    if (!name && !fee) counts.missing_both += 1;
    else if (!name) counts.name_only_missing += 1;
    else if (!fee) counts.fee_only_missing += 1;
    if (name && fee && row.final_fee_frequency) counts.rows_with_name_fee_and_frequency += 1;
  }
  return counts;
}

// Output invariants checked before a versioned output is written.
export function verifyOutputRows(previousRows, rows) {
  const problems = [];
  if (previousRows.length !== rows.length) problems.push("row count changed");
  rows.forEach((row, index) => {
    const before = previousRows[index];
    if (before && before.property_id !== row.property_id) problems.push(`row order changed at ${index}`);
    if (row.final_fee !== null && row.final_fee !== undefined && !row.final_fee_frequency) problems.push(`fee without frequency: ${row.property_id}`);
    if (row.final_fee_frequency && !row.final_fee_basis) problems.push(`frequency without basis: ${row.property_id}`);
    for (const field of ["final_hoa_name", "final_fee", "final_fee_frequency"]) {
      const old = before?.[field];
      if (old !== null && old !== undefined && old !== "" && old !== row[field] && !row.decision_changed) {
        problems.push(`${field} changed without decision_changed: ${row.property_id}`);
      }
    }
  });
  return problems;
}
