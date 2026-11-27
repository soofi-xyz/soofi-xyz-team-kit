/**
 * Link a recorded mortgage to a parcel.
 *
 * The county recorder index does not carry a parcel number as its own field, but the
 * legal description often embeds one. For Duval FL the description carries a PIN
 * (e.g. "PIN 162222-1215 L42 HICKORY LAKES U1"); stripping the dash and adding the "R"
 * suffix yields the Persist `parcel_identifier` (e.g. "1622221215R").
 *
 * @module src/mortgage/parcel-link
 */

/**
 * Extract a normalized parcel identifier from a mortgage index record's legal description.
 *
 * @param {{ county?: string, legalDescriptions?: string[] }} record - Index record.
 * @returns {{ parcelId: string, evidence: string } | null} The Persist parcel_identifier
 *   and the text it came from, or null when no parcel number is present.
 */
export function parcelIdFromRecord(record) {
  const county = String(record.county ?? "").toLowerCase();
  const legal = (record.legalDescriptions ?? []).join(" ");
  if (!legal) return null;
  if (county === "duval") {
    // Duval PIN: 6 digits, a dash, 4 digits → Persist parcel_identifier is "ddddddddddR".
    const m = /\bPIN\s*(\d{6})-?(\d{4})\b/i.exec(legal);
    if (m) return { parcelId: `${m[1]}${m[2]}R`, evidence: m[0] };
  }
  return null;
}

/**
 * @param {string} parcelId - A normalized parcel_identifier.
 * @returns {string} A read-only Gremlin traversal that returns the matching property, if any.
 */
export function parcelLookupGremlin(parcelId) {
  const safe = String(parcelId).replace(/[^0-9A-Za-z]/g, "");
  return `g.V().hasLabel('property').has('parcel_identifier','${safe}').limit(1)` +
    `.valueMap('parcel_identifier','property_type','zoning','property_structure_built_year')`;
}
