/**
 * Mortgage source profiles: one per county Clerk/Recorder Official Records
 * portal that the mortgage harvest can read.
 *
 * `requestIdentifierPrefix` matches the loan `request_identifier` already in
 * Persist (`<prefix>:<instrument>`, for example `duval-or:2025129715`), so a
 * harvested document joins to its existing loan.
 *
 * @module src/counties/mortgage-profiles
 */

/**
 * @typedef {{
 *   county: string,
 *   state: string,
 *   vendor: "acclaim" | "publicsearch",
 *   baseUrl: string,
 *   host?: string,
 *   bookType?: string,
 *   requestIdentifierPrefix: string,
 *   mortgageDocTypeCodes: readonly string[],
 *   verifiedAt: string,
 *   notes: string,
 * }} MortgageProfile
 */

/**
 * @param {string} county - County key.
 * @param {string} name - Display name.
 * @returns {MortgageProfile} Texas publicsearch.us profile.
 */
function texasPublicsearch(county, name) {
  return Object.freeze({
    county,
    state: "TX",
    vendor: "publicsearch",
    baseUrl: `https://${county}.tx.publicsearch.us`,
    host: `${county}.tx.publicsearch.us`,
    requestIdentifierPrefix: `${county}-or`,
    // DT = DEED OF TRUST, the Texas mortgage instrument.
    mortgageDocTypeCodes: Object.freeze(["DT"]),
    verifiedAt: "2026-11-26",
    notes: `${name} County Clerk on Neumo publicsearch.us. Cloudflare non-interactive check; data over the same-origin WebSocket. Index has no loan amount ($0.00 consideration); the amount is in the document image.`,
  });
}

/** @type {Readonly<Record<string, MortgageProfile>>} */
export const MORTGAGE_PROFILES = Object.freeze({
  duval: Object.freeze({
    county: "duval",
    state: "FL",
    vendor: "acclaim",
    baseUrl: "https://or.duvalclerk.com",
    bookType: "OR",
    requestIdentifierPrefix: "duval-or",
    // MTGTF = "TAX FREE MORTGAGE" (Florida intangible/doc-stamp exempt), seen in the pilot.
    mortgageDocTypeCodes: Object.freeze(["MTG", "MTGTF"]),
    verifiedAt: "2026-11-26",
    notes:
      "Acclaim portal. Disclaimer acceptance required per session. The whole-document PDF is scanned images (no text layer) and took about 52 s for 21 pages. US hosting egress timed out until the operator changed networks.",
  }),
  bexar: texasPublicsearch("bexar", "Bexar"),
  collin: texasPublicsearch("collin", "Collin"),
  dallas: texasPublicsearch("dallas", "Dallas"),
  denton: texasPublicsearch("denton", "Denton"),
  tarrant: texasPublicsearch("tarrant", "Tarrant"),
});

/**
 * @param {string} county - County key.
 * @returns {MortgageProfile} Profile.
 */
export function requireMortgageProfile(county) {
  const profile = MORTGAGE_PROFILES[county];
  if (!profile) {
    throw new Error(
      `No mortgage profile for county "${county}". Known: ${Object.keys(MORTGAGE_PROFILES).join(", ")}`,
    );
  }
  return profile;
}
