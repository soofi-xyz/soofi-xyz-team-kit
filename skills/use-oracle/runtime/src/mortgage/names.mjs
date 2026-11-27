/**
 * Party-name rules for recorded mortgage indexes (shared by the mortgage transforms).
 *
 * Recorder indexes write people as "LAST FIRST [MIDDLE] [SUFFIX]" and lenders as free
 * text, sometimes with a trade name ("JRDB INC DBA BAYWAY MORTGAGE GROUP") or as two
 * separate grantee entries for the same lender ("JRDB INC", "BAYWAY MORTGAGE GROUP").
 *
 * @module src/mortgage/names
 */

const SUFFIXES = new Map([
  ["JR", "Jr."],
  ["SR", "Sr."],
  ["II", "II"],
  ["III", "III"],
  ["IV", "IV"],
  ["V", "V"],
  ["2ND", "II"],
  ["3RD", "III"],
]);

const ORGANIZATION = /\b(INC|LLC|L L C|LP|LLP|CORP|CORPORATION|COMPANY|CO|BANK|N A|NA|FSB|TRUST|TRUSTEE|ASSOCIATION|ASSN|CREDIT UNION|FCU|MORTGAGE|LENDING|LOANS?|FINANCIAL|FUNDING|SERVICES|SERVICING|CAPITAL|GROUP|PARTNERS|HOLDINGS|SYSTEMS|AUTHORITY|AGENCY|DEPARTMENT|SECRETARY|UNITED STATES|COUNTY|CITY|STATE)\b/;

/** Mortgage Electronic Registration Systems acts as nominee, never as the lender. */
export const MERS = /^(MERS|MERSN|MORTGAGE ELECTRONIC REGISTRATION SYSTEMS?)\b/;

/**
 * @param {string} name - Index party name.
 * @returns {boolean} Whether it names an organization rather than a person.
 */
export function isOrganization(name) {
  return ORGANIZATION.test(String(name).toUpperCase().replace(/[.,]/g, " ").replace(/\s+/g, " "));
}

/**
 * @param {string} word - Upper-case word.
 * @returns {string} Title case.
 */
const title = (word) => word.charAt(0) + word.slice(1).toLowerCase();

/**
 * Split an indexed person name ("LAST FIRST MIDDLE SUFFIX") into parts. A trailing
 * JR/SR/II/III/IV (with or without punctuation) is the suffix, never the middle name.
 *
 * @param {string} indexed - Name as indexed, e.g. "BROWN DARRYL JR".
 * @returns {{ last_name: string, first_name: string | null, middle_name: string | null, suffix_name: string | null } | null}
 *   Parts, or null for an organization or empty value.
 */
export function parseIndexedPersonName(indexed) {
  const clean = String(indexed ?? "").toUpperCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean || isOrganization(clean)) return null;
  const words = clean.split(" ");
  let suffix = null;
  if (words.length > 2 && SUFFIXES.has(words.at(-1))) suffix = SUFFIXES.get(words.pop());
  const [last, first, ...middle] = words;
  return {
    last_name: title(last),
    first_name: first ? title(first) : null,
    middle_name: middle.length ? middle.map(title).join(" ") : null,
    suffix_name: suffix,
  };
}

/**
 * Split "LEGAL NAME DBA TRADE NAME" (also D/B/A, D B A, AKA, FKA) into the legal name
 * and its other names. The legal entity is always the part before the marker.
 *
 * @param {string} name - Party name.
 * @returns {{ legalName: string, otherNames: string[] }} Legal name and trade/former names.
 */
export function splitTradeName(name) {
  const parts = String(name ?? "")
    .split(/\s+(?:D\/B\/A|D B A|DBA|A\/K\/A|AKA|F\/K\/A|FKA)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  return { legalName: parts[0] ?? "", otherNames: parts.slice(1) };
}

/**
 * Choose the lender from a mortgage's grantee list.
 *
 * Rule: drop MERS (nominee); split DBA markers; the lender is the first remaining
 * grantee that is an organization (or the first remaining one if none is), named by its
 * legal name. Every other non-MERS grantee and every trade name becomes an alias, so
 * "JRDB INC" + "BAYWAY MORTGAGE GROUP" yields lender "JRDB INC" with alias "BAYWAY
 * MORTGAGE GROUP".
 *
 * @param {readonly string[]} grantees - Grantee names in index order.
 * @returns {{ lenderName: string | null, aliases: string[], nominee: string | null }} Lender.
 */
export function chooseLender(grantees) {
  const nominee = grantees.find((name) => MERS.test(String(name).toUpperCase())) ?? null;
  const parties = grantees
    .filter((name) => name && !MERS.test(String(name).toUpperCase()))
    .map(splitTradeName);
  if (parties.length === 0) return { lenderName: null, aliases: [], nominee };
  const index = Math.max(0, parties.findIndex((party) => isOrganization(party.legalName)));
  const lender = parties[index];
  const aliases = [
    ...lender.otherNames,
    ...parties.filter((_, i) => i !== index).flatMap((party) => [party.legalName, ...party.otherNames]),
  ];
  return { lenderName: lender.legalName, aliases: [...new Set(aliases)], nominee };
}
