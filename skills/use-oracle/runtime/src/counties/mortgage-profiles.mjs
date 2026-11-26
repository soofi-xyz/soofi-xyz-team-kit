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
 *   vendor: "acclaim" | "publicsearch" | "hillsclerk-ori" | "maricopa-recorder-api" | "harris-cclerk-rp" | "aumentum-recorder",
 *   defaultWindow?: "day" | "month" | "year",
 *   earliest?: string,
 *   baseUrl: string,
 *   host?: string,
 *   bookType?: string,
 *   requestIdentifierPrefix: string,
 *   mortgageDocTypeCodes: readonly string[],
 *   extraMortgageDocTypeCodes?: readonly string[],
 *   acclaimDocTypeIds?: readonly number[],
 *   verifiedAt: string,
 *   notes: string,
 * }} MortgageProfile
 */

/**
 * @param {string} county - County key.
 * @param {string} name - Display name.
 * @returns {MortgageProfile} Texas publicsearch.us profile.
 */
function texasPublicsearch(county, name, extra = []) {
  return Object.freeze({
    county,
    state: "TX",
    vendor: "publicsearch",
    baseUrl: `https://${county}.tx.publicsearch.us`,
    host: `${county}.tx.publicsearch.us`,
    requestIdentifierPrefix: `${county}-or`,
    // DT = DEED OF TRUST, the Texas mortgage instrument.
    mortgageDocTypeCodes: Object.freeze(["DT"]),
    // Other new-loan instrument codes seen in the county's own doc-type counts (2026-11-26).
    // Modifications (MODT), releases and trustee deeds are deliberately excluded.
    extraMortgageDocTypeCodes: Object.freeze(extra),
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
    // Other mortgage codes with their Acclaim doc-type ids (MTGCU 111, EMTG 93, MTGG 112, MTGND 155, MTGNI 113).
    extraMortgageDocTypeCodes: Object.freeze(["MTGCU", "EMTG", "MTGG", "MTGND", "MTGNI"]),
    // Acclaim doc-type ids for the listing search: MTG 110, MTGTF 114, MTGCU 111, EMTG 93,
    // MTGG 112, MTGND 155, MTGNI 113. Releases (SAT 129, SATNF 130, RELEASE 126,
    // PTL REL 125) are known but not harvested until that decision is made.
    acclaimDocTypeIds: Object.freeze([110, 114, 111, 93, 112, 155, 113]),
    defaultWindow: "month",
    verifiedAt: "2026-11-26",
    notes:
      "Acclaim portal. Disclaimer acceptance required per session. The whole-document PDF is scanned images (no text layer) and took about 52 s for 21 pages. US hosting egress timed out until the operator changed networks.",
  }),
  bexar: texasPublicsearch("bexar", "Bexar", ["MORTG", "M MORTG"]),
  collin: texasPublicsearch("collin", "Collin"),
  dallas: texasPublicsearch("dallas", "Dallas", ["CORR DT", "D/T & ASGMT", "MTG", "MDT", "MORTGAGE"]),
  denton: texasPublicsearch("denton", "Denton", ["MTG", "MDT", "ASSUMED MORTGAG", "COLLATERAL MTG", "AMENDED MORTGAG"]),
  // DTU in Tarrant is UCC filings, not deeds of trust.
  tarrant: texasPublicsearch("tarrant", "Tarrant", ["MDT"]),
  hillsborough: Object.freeze({
    county: "hillsborough",
    state: "FL",
    vendor: "hillsclerk-ori",
    baseUrl: "https://publicaccess.hillsclerk.com",
    requestIdentifierPrefix: "hillsborough-or",
    mortgageDocTypeCodes: Object.freeze(["MTG", "MTGNDOC", "MTGNT", "MTGNIT", "MTGREV"]),
    defaultWindow: "month",
    earliest: "19640826",
    verifiedAt: "2026-11-26",
    notes: "Open JSON search API, no gate. Whole result set per call; Truncated or a cut JSON response means split. Free daily D/P bulk files keep about two months.",
  }),
  maricopa: Object.freeze({
    county: "maricopa",
    state: "AZ",
    vendor: "maricopa-recorder-api",
    baseUrl: "https://publicapi.recorder.maricopa.gov",
    requestIdentifierPrefix: "maricopa-or",
    mortgageDocTypeCodes: Object.freeze(["DT"]),
    defaultWindow: "day",
    earliest: "19470101",
    verifiedAt: "2026-11-26",
    notes: "Public JSON API, pages of 200, no offset cap. Names need one detail call per record. No APN, legal description or amount.",
  }),
  mecklenburg: Object.freeze({
    county: "mecklenburg",
    state: "NC",
    vendor: "aumentum-recorder",
    baseUrl: "https://meckrod.manatron.com",
    requestIdentifierPrefix: "mecklenburg-or",
    mortgageDocTypeCodes: Object.freeze(["D/T", "MTG"]),
    defaultWindow: "day",
    earliest: "19900301",
    verifiedAt: "2026-11-26",
    notes: "Aumentum Recorder; disclaimer accepted with operator approval. Infragistics form needs real Chrome. 20 rows per page with a TotalRows count. Pre-1990 is image-only (meckrodhistorical.com).",
  }),
  harris: Object.freeze({
    county: "harris",
    state: "TX",
    vendor: "harris-cclerk-rp",
    baseUrl: "https://www.cclerk.hctx.net/applications/websearch",
    requestIdentifierPrefix: "harris-or",
    mortgageDocTypeCodes: Object.freeze(["D/T"]),
    defaultWindow: "day",
    earliest: "19600101",
    verifiedAt: "2026-11-26",
    notes: "ASP.NET WebForms search, 200 rows per page with Next postbacks. Multi-day ranges warn 'too many records'. Images need login. Bulk FTP sold by County Clerk Data Sales.",
  }),
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
