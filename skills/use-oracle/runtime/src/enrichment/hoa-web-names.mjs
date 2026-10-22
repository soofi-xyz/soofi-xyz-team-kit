// HOA name validation for web enrichment. A candidate name must share the
// community's distinctive words, come from an in-area source, and survive the
// placeholder, manager, and city-only rules before it can be proposed.

import { parseAddress } from "./hoa-web-address.mjs";
import { GENERIC_COMMUNITY_WORDS as GENERIC, compareTuples, condoAssociationFromLegal, nameTokens } from "./hoa-web-legal.mjs";
import {
  collapse,
  compact,
  countyLabel,
  distinctiveTokens,
  normalizeName,
  sequenceRatio,
  stripChars,
  titleCase,
  upperSquash,
} from "./hoa-web-text.mjs";

// Place names that never distinguish one community from another.
export const PLACE_WORDS = new Set([
  "ALACHUA", "BAKER", "BREVARD", "BROWARD", "CHARLOTTE", "CITRUS", "CLAY", "COLLIER", "DUVAL", "FLAGLER", "HERNANDO",
  "HILLSBOROUGH", "MANATEE", "MARION", "MARTIN", "NASSAU", "OSCEOLA", "PASCO", "PINELLAS", "POLK", "SARASOTA",
  "VOLUSIA", "JACKSONVILLE", "JAX", "TAMPA", "ORLANDO", "RIVERVIEW", "BRANDON", "DAVENPORT", "KISSIMMEE", "LAKELAND",
  "CLERMONT", "SANFORD", "APOPKA", "OCALA", "VALRICO", "RUSKIN", "WIMAUMA", "BRADENTON", "VENICE",
  "OCOEE", "OVIEDO", "DELAND", "DELTONA", "AUGUSTINE", "MIDDLEBURG", "YULEE",
  "FERNANDINA", "HUDSON", "ODESSA", "LUTZ", "ZEPHYRHILLS", "AUBURNDALE", "MINNEOLA",
  "MASCOTTE", "GROVELAND", "TAVARES", "EUSTIS", "LEESBURG", "FLORIDA", "INC",
]);

const MANAGER_NAMES =
  /\b(?:management|mgmt|mangagment|managers?|realty|realtors?|firstservice|first service|castle group|realmanage|real manage|inframark|associa|accounting|law firm|law offices?|attorneys?|p\.?a\.?$|esq|cam\b|homeowner services|property services|properties inc|properties, inc)\b/i;
const ASSOCIATION_WORD = /\b(?:association|assoc|assn|hoa|poa|coa)\b/i;
const PERSON_NAME = /^[A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+$/;
// Scraped sentences that only look like names ("X has offered exceptional
// Community Association management").
const SENTENCE_FRAGMENT =
  /\b(?:has|have|had|offered|located|welcome|is|was|are|were|exceptional|provides|including|please|click)\b/i;

export function tokenMatch(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a))) return true;
  return Math.min(a.length, b.length) >= 6 && sequenceRatio(a, b) >= 0.85;
}

const inText = (token, squashed) => token.length >= 5 && squashed.includes(token);

function splitAt(community) {
  const text = upperSquash(community);
  const match = /\s+(?:AT|@)\s+/.exec(text);
  return match ? [text.slice(0, match.index), text.slice(match.index + match[0].length)] : [text];
}

export const NAME_CLASS_RANK = Object.freeze({ strong: 4, brand: 3, brand_weak: 2, parent: 2, parent_weak: 1 });
const RANK = NAME_CLASS_RANK;
const rank = (cls) => RANK[cls] ?? 0;

// strong | brand (adds words) | parent (covers part) | reject_*.
export function classifyName(name, community) {
  const nameT = nameTokens(name);
  const communityT = nameTokens(community);
  if (!community || !communityT.length) return { cls: "no_community", detail: {} };
  if (!nameT.length) return { cls: "reject_placeholder", detail: {} };
  const squashedCommunity = compact(community);
  const squashedName = compact(name);
  const shared = nameT.filter((t) => communityT.some((c) => tokenMatch(t, c)) || inText(t, squashedCommunity));
  const matched = communityT.filter((c) => nameT.some((t) => tokenMatch(c, t)) || inText(c, squashedName));
  const extra = nameT.filter((t) => !shared.includes(t) && !PLACE_WORDS.has(t));
  const missing = communityT.filter((c) => !matched.includes(c));
  const detail = { shared, extra, missing };
  if (!shared.length) return { cls: "reject_no_overlap", detail };
  const split = splitAt(community);
  if (split.length === 2 && !extra.length) {
    const headT = nameTokens(split[0]);
    const tailT = nameTokens(split[1]);
    const headDistinct = headT.filter((h) => !GENERIC.has(h)).length ? headT.filter((h) => !GENERIC.has(h)) : headT;
    const coversTail = tailT.length > 0 && nameT.every((t) => tailT.some((x) => tokenMatch(t, x)));
    const coversHead = headDistinct.some((h) => nameT.some((t) => tokenMatch(h, t)));
    if (coversTail && headDistinct.length && !coversHead) return { cls: "parent", detail };
  }
  if (shared.every((t) => GENERIC.has(t)) && communityT.some((c) => !GENERIC.has(c))) return { cls: "reject_generic_only", detail };
  if ((extra.length && missing.length) || extra.length >= 3) return { cls: "reject_other_community", detail };
  const headMissing = missing.length > 0 && missing[0] === communityT[0];
  if (!extra.length && (!missing.length || (missing.every((m) => GENERIC.has(m)) && !headMissing))) return { cls: "strong", detail };
  if (!extra.length && split.length === 2) {
    const headTokens = nameTokens(split[0]).filter((t) => !GENERIC.has(t)).length
      ? nameTokens(split[0]).filter((t) => !GENERIC.has(t))
      : nameTokens(split[0]);
    if (headTokens.length && headTokens.every((h) => nameT.some((t) => tokenMatch(h, t))) && headTokens.some((h) => !GENERIC.has(h))) {
      return { cls: "strong", detail };
    }
  }
  if (extra.length) return { cls: communityT.length === 1 ? "brand_weak" : "brand", detail };
  const head = communityT.find((c) => !GENERIC.has(c)) ?? communityT[0];
  return { cls: !missing.includes(head) || matched.length * 2 >= communityT.length ? "parent" : "parent_weak", detail };
}

export function bestClass(name, communities) {
  let best = { cls: "reject_no_overlap", detail: {}, community: null };
  for (const community of communities) {
    if (!community) continue;
    const { cls, detail } = classifyName(name, community);
    if (rank(cls) > rank(best.cls) || (best.community === null && !rank(best.cls))) best = { cls, detail, community };
  }
  return best;
}

export function isManager(name) {
  if (MANAGER_NAMES.test(name) && !ASSOCIATION_WORD.test(name)) return true;
  if (/\b(?:management|mgmt|mgt)\b/i.test(name)) return true;
  return /community development district|\bCDD\b|development distri/i.test(name);
}

export function genericPlaceholder(name) {
  const text = normalizeName(name);
  if (text.includes("BY A CONDOMINIUM") || text === "CONDOMINIUM OR HOMEOWNER ASSOCIATION") return true;
  return distinctiveTokens(name).size === 0;
}

export function placeholderName(name, status = null) {
  if (!name) return true;
  if (status === "catch-all or placeholder name") return true;
  if (/BY A CONDOMINIUM|USES AN HOA|CARRIES BOTH|^MONTHLY HOA$|\.\s*HOA$|^HOA$|^NONE$|^N\/?A$/.test(String(name).toUpperCase())) return true;
  return genericPlaceholder(name);
}

// Strip captions and page furniture from a scraped name. Court-caption
// prefixes are removed; the remainder still needs every validation gate.
export function tidyName(raw) {
  if (!raw) return null;
  let name = stripChars(collapse(raw), " -,.:|");
  name = stripChars(name.split(/(?:HOA Phone|HOA phone|Has an HOA|HOA Fee|Association for this|Association Phone)/)[0], " -,.:|");
  name = name.replace(/\s+-\s+[A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+$/, "");
  if (name.includes("/")) {
    const parts = name.split("/").map((part) => part.trim()).filter(Boolean);
    const keep = parts.filter((part) => /\b(?:association|assoc|assn|hoa|poa|coa|condominium)\b/i.test(part) && !isManager(part));
    name = keep[0] ?? parts[0] ?? "";
  }
  for (let i = 0; i < 2; i += 1) {
    name = name.replace(
      /^(?:frequently asked questions about|about|welcome to(?: the)?|photos? of|overview of|plaintiff|defendant|petitioner|respondent|hoa name|association name|by-?laws of(?: the)?|(?:pm )?the annual meeting of(?: the)?|minutes of(?: the)?|board of directors of(?: the)?|what|visit(?: the)?|home \d+|bod|(?:best|top) \d+)\s*:?\s+/i,
      "",
    );
  }
  name = name.replace(/\bAssoc(?:i(?:a(?:t(?:i(?:o)?)?)?)?)?\.?$/i, "Association");
  name = name.replace(/,?\s+(?:In|I)$/, ", Inc").replace(/\s+Inc\.?$/, ", Inc").replace(/,\s*,/g, ",");
  let words = name.split(" ").filter(Boolean);
  for (let size = Math.min(4, Math.floor(words.length / 2)); size > 0; size -= 1) {
    const head = words.slice(0, size).map((w) => w.toUpperCase()).join(" ");
    const next = words.slice(size, 2 * size).map((w) => w.toUpperCase()).join(" ");
    if (head === next) {
      words = words.slice(size);
      break;
    }
  }
  name = words.join(" ");
  if (name === name.toUpperCase() || name === name.toLowerCase()) name = titleCase(name);
  else if (words.filter((w) => w.length > 3 && w === w.toUpperCase()).length >= 2) {
    name = words.map((w) => (w.length > 3 && w === w.toUpperCase() ? titleCase(w) : w)).join(" ");
  }
  return name || null;
}

// True when the community's words are only the city, county, or a known place
// ("PALM COAST" in Palm Coast): such a community cannot validate a
// "<City> Homeowners Association" name.
export function placeLike(row, community) {
  const words = nameTokens(community);
  if (!words.length) return true;
  const address = parseAddress(row?.full_address) ?? {};
  const place = new Set([...nameTokens(address.city), ...nameTokens(countyLabel(row?.county ?? "")), ...PLACE_WORDS]);
  return words.every((word) => place.has(word));
}

// Pages proposing a name must mention the property's ZIP, city, or county.
export function textMentionsLocality(row, text) {
  const words = ` ${normalizeName(text).replace(/SAINT/g, "ST")} `;
  const address = parseAddress(row?.full_address) ?? {};
  const city = normalizeName(address.city ?? "").replace(/SAINT/g, "ST");
  const county = normalizeName(countyLabel(row?.county ?? "")).replace(/SAINT/g, "ST");
  return Boolean(
    (address.postal && words.includes(` ${address.postal} `)) ||
      (city && words.includes(` ${city} `)) ||
      (county && words.includes(` ${county} COUNTY `)),
  );
}

const SOURCE_RANK = {
  exact_property_page: 6,
  sunbiz_record: 5,
  exact_property_page_second: 4,
  association_level_page: 4,
  same_community_page: 3,
  original_value: 3,
  inferred_from_legal: 2,
  neighbour_suggested: 1,
};
const BASIS = {
  exact_property_page: "exact_property_page",
  exact_property_page_second: "exact_property_page",
  association_level_page: "association_level_validated",
  same_community_page: "same_community_validated",
  original_value: "original_validated",
  inferred_from_legal: "inferred_from_legal",
  neighbour_suggested: "neighbour_suggested_validated",
  sunbiz_record: "sunbiz_active_validated",
};
const LISTING_URL = /\/(?:realestate\/details|homedetails|property|properties|listing|listings|idx|sold-listing|home|homes-for-sale)\/|\/\d{2,6}[-_][A-Za-z]/i;

/**
 * Decide one property's HOA name.
 *
 * candidates: [{ name, source, url?, quote?, local?, mentionsLocality? }] with
 * source one of exact_property_page, exact_property_page_second, sunbiz_record,
 * association_level_page, same_community_page. The row's original name, its
 * neighbour-suggested name, and a condominium inferred from the legal
 * description are added here.
 */
export function decideName({ row, legalCommunity = null, subdivisionCommunity = null, candidates = [] }) {
  const allCommunities = [...new Set([legalCommunity, subdivisionCommunity].filter(Boolean))];
  const realCommunities = allCommunities.filter((community) => !placeLike(row, community));
  const anyTokens = allCommunities.some((community) => nameTokens(community).length);
  const pool = [];
  const reject = (name, source, url, cls) => pool.push({ name, source, url, cls, detail: {} });

  const consider = (raw, source, url = null, meta = {}) => {
    const name = tidyName(raw);
    if (!name) return;
    const exact = source.startsWith("exact_property_page");
    if (SENTENCE_FRAGMENT.test(name) && !exact) return reject(name, source, url, "reject_sentence_fragment");
    if (!exact && source !== "sunbiz_record" && meta.mentionsLocality === false) {
      return reject(name, source, url, "reject_out_of_area");
    }
    if (placeholderName(name) && !(exact && !anyTokens && /association|hoa|condo/i.test(name) && name.split(" ").length >= 3)) {
      return reject(name, source, url, "reject_placeholder");
    }
    const communities = exact ? allCommunities : realCommunities;
    if (isManager(name) || (PERSON_NAME.test(name) && rank(bestClass(name, communities).cls) < 2)) {
      return reject(name, source, url, "reject_manager");
    }
    if (!exact && !realCommunities.length && allCommunities.length) return reject(name, source, url, "reject_city_only_community");
    let { cls, detail, community } = bestClass(name, communities);
    if (!exact && source !== "inferred_from_legal" && !/\b(?:association|assoc|assn|hoa|poa|coa|oa|condominium|condo|homeowners|owners|club|community|master|inc)\b/i.test(name) && rank(cls) < 3) {
      return reject(name, source, url, "reject_not_association");
    }
    if (community === null && !anyTokens) cls = exact ? "brand" : "parent_weak";
    pool.push({ name, source, url, cls, detail, community, ...meta });
  };

  for (const candidate of candidates) {
    let source = candidate.source;
    if (source === "association_level_page" && LISTING_URL.test(candidate.url ?? "")) source = "same_community_page";
    consider(candidate.name, source, candidate.url ?? null, {
      quote: candidate.quote,
      local: candidate.local ?? true,
      mentionsLocality: candidate.mentionsLocality,
    });
  }
  if (row?.current_hoa_name && !placeholderName(row.current_hoa_name, row.hoa_name_status)) {
    consider(row.current_hoa_name, "original_value");
  } else if (row?.current_hoa_name) {
    reject(row.current_hoa_name, "original_value", null, "reject_placeholder");
  }
  const inferred = realCommunities.length
    ? condoAssociationFromLegal(row?.legal_description, legalCommunity, row?.subdivision)
    : null;
  if (inferred) {
    const { cls, detail } = bestClass(inferred, realCommunities);
    pool.push({ name: inferred, source: "inferred_from_legal", url: null, cls: rank(cls) ? cls : "strong", detail });
  }
  const neighbour = tidyName(row?.neighbour_suggested_hoa_name);
  const neighbourOk =
    Boolean(neighbour) && !placeholderName(neighbour) && !isManager(neighbour) && rank(bestClass(neighbour, realCommunities).cls) >= 3;
  if (neighbourOk) {
    const { cls, detail } = bestClass(neighbour, realCommunities);
    pool.push({ name: neighbour, source: "neighbour_suggested", url: null, cls, detail });
  }

  const score = (candidate) => {
    const r = rank(candidate.cls);
    if (candidate.source === "inferred_from_legal") return [r >= 3 ? 1 : 0, 2.5, r];
    return [r >= 3 ? 1 : 0, (SOURCE_RANK[candidate.source] ?? 0) + (r === 4 ? 1 : 0), r];
  };
  const byScore = (a, b) => compareTuples(score(b), score(a));
  const good = pool.filter((candidate) => rank(candidate.cls) >= 3).sort(byScore);
  const parents = pool.filter((candidate) => ["parent", "parent_weak", "brand_weak"].includes(candidate.cls)).sort(byScore);
  const rejected = pool.filter((candidate) => !rank(candidate.cls));
  const label = titleCase(legalCommunity ?? subdivisionCommunity ?? "") || "unknown";
  const result = { name: null, basis: "none", confidence: "low", sources: [], rationale: "", parent: null, rejected };

  if (good.length) {
    let top = good[0];
    const number = (legalCommunity ?? "").match(/\bNO\.?\s*(\w+)/);
    let lacksNumber = false;
    if (number) {
      const wanted = new Set([number[1].toUpperCase()]);
      for (const [word, digit] of SB_NUMBERS) {
        if (wanted.has(word)) wanted.add(digit);
        if (wanted.has(digit)) wanted.add(word);
      }
      lacksNumber = ![...wanted].some((value) => new RegExp(`\\b${value}\\b`, "i").test(top.name));
    }
    const masterLike = /\bmaster\b/i.test(top.name);
    const condoInferred = pool.find((candidate) => candidate.source === "inferred_from_legal");
    // A condominium named in the legal description beats a weaker page name,
    // a master association, or a name missing the condo's number.
    if (top.source !== "inferred_from_legal" && condoInferred && /CONDO/.test(legalCommunity ?? "") &&
        ((top.cls !== "strong" && !/condo/i.test(top.name)) || masterLike || lacksNumber)) {
      parents.unshift(top);
      top = { ...condoInferred, cls: rank(condoInferred.cls) >= 3 ? condoInferred.cls : "strong" };
    }
    const agree = good.filter((candidate) => candidate !== top && candidate.name !== top.name && rank(bestClass(candidate.name, [top.name]).cls) >= 3);
    const basis = BASIS[top.source];
    let confidence;
    if (basis === "exact_property_page") confidence = top.cls === "strong" ? "high" : "medium";
    else if (basis === "sunbiz_active_validated") confidence = !top.local || top.cls !== "strong" ? "low" : agree.length ? "high" : "medium";
    else if (basis === "neighbour_suggested_validated") confidence = "low";
    else if (basis === "inferred_from_legal") {
      const subMatch = subdivisionCommunity && rank(bestClass(top.name, [subdivisionCommunity]).cls) >= 3;
      confidence = subMatch || agree.length ? "medium" : "low";
    } else if (basis === "association_level_validated") confidence = "medium";
    else if (basis === "original_validated") confidence = top.cls === "strong" && (agree.length || neighbourOk) ? "high" : "medium";
    else confidence = top.cls === "strong" && (agree.length || neighbourOk) ? "medium" : "low";
    let why = `'${top.name}' (${basis}) matches the legal/subdivision community '${label}' (${top.cls})`;
    if (basis === "sunbiz_active_validated" && !top.local) why += "; its Sunbiz addresses are outside the property's area";
    if (agree.length) why += `; ${agree.length} other source(s) agree`;
    const parent = parents.find((candidate) => candidate.name !== top.name);
    if (parent) result.parent = parent.name;
    Object.assign(result, { name: top.name, basis, confidence, sources: top.url ? [top.url] : [], rationale: `${why}.` });
    return result;
  }
  if (parents.length) {
    const top = parents[0];
    Object.assign(result, {
      name: top.name,
      basis: top.cls === "brand_weak" ? "weak_match_only" : "parent_association_only",
      confidence: "low",
      sources: top.url ? [top.url] : [],
      rationale: `Only a partial or likely master association ('${top.name}') matches '${label}'.`,
    });
    return result;
  }
  const cityOnly = allCommunities.length > 0 && !realCommunities.length;
  const blanked = rejected.some((candidate) => ["original_value", "association_level_page", "same_community_page"].includes(candidate.source));
  Object.assign(result, {
    basis: blanked ? "blanked" : "none",
    rationale: cityOnly
      ? `The community '${label}' is only a city or place name, so a community-level name cannot be validated.`
      : `No association name matches the community '${label}'.`,
  });
  return result;
}

// Names stamped on many unrelated communities (one HOA name propagated across
// a ZIP or a county) are placeholders for every row whose own community does
// not share its distinctive words.
export function findPropagatedNames(rows, { minCommunities = 3, nameField = "current_hoa_name", communityOf } = {}) {
  const communityFor = communityOf ?? ((row) => row.community ?? row.subdivision);
  const byName = new Map();
  for (const row of rows) {
    const name = row[nameField];
    const community = communityFor(row);
    if (!name || !community) continue;
    const key = normalizeName(name);
    if (!byName.has(key)) byName.set(key, { communities: new Set(), rows: [] });
    const entry = byName.get(key);
    entry.communities.add(compact(community));
    entry.rows.push(row);
  }
  const flagged = [];
  for (const { communities, rows: named } of byName.values()) {
    if (communities.size < minCommunities) continue;
    for (const row of named) {
      if (!rank(classifyName(row[nameField], communityFor(row)).cls)) flagged.push(row);
    }
  }
  return flagged;
}

const SB_GENERIC = new Set([
  "THE", "OF", "AT", "AND", "A", "AN", "IN", "ON", "HOMEOWNERS", "HOMEOWNER", "HOMEOWNERSS", "OWNERS", "OWNER",
  "PROPERTY", "ASSOCIATION", "ASSOCIATIONS", "ASSN", "ASSOC", "INC", "INCORPORATED", "CORP", "CORPORATION", "LLC",
  "CONDOMINIUM", "CONDOMINIUMS", "CONDO", "CONDOS", "HOA", "POA", "COA", "COMMUNITY", "MAINTENANCE", "CIVIC",
  "NO", "NUMBER", "CNDO",
]);
const SB_NUMBERS = new Map(Object.entries({
  ONE: "1", TWO: "2", THREE: "3", FOUR: "4", FIVE: "5", SIX: "6", SEVEN: "7", EIGHT: "8", NINE: "9", TEN: "10",
  I: "1", II: "2", III: "3", IV: "4", V: "5", VI: "6", VII: "7", VIII: "8", IX: "9", X: "10",
  FIRST: "1", SECOND: "2", THIRD: "3",
}));
const SB_STEM = new Map(Object.entries({
  TOWNHOMES: "TOWNHOME", TOWNHOUSES: "TOWNHOUSE", VILLAS: "VILLA", HOMES: "HOME", ESTATES: "ESTATE",
  APARTMENTS: "APARTMENT", TOWNHOMS: "TOWNHOME",
}));

// Normalized name base used for an exact Sunbiz comparison: generic entity
// words dropped, numbers and plurals canonicalized, tokens sorted.
export function sunbizBase(name) {
  const text = upperSquash(name).replace(/&/g, " AND ").replace(/@/g, " AT ").replace(/'S\b|’S\b/g, "S").replace(/[^A-Z0-9 ]+/g, " ");
  const out = [];
  for (let token of text.split(" ").filter(Boolean)) {
    token = { ST: "SAINT", MT: "MOUNT" }[token] ?? token;
    token = SB_NUMBERS.get(token) ?? token;
    token = SB_STEM.get(token) ?? token;
    if (!SB_GENERIC.has(token)) out.push(token);
  }
  return out.sort();
}

export function sunbizSearchTerms(community) {
  let text = upperSquash(community).replace(/@/g, " AT ").replace(/^THE\s+/, "");
  text = text.replace(/\s+(?:A\s+)?(?:CONDOMINIUMS?|CONDOS?|CNDO|HOMEOWNERS?\s+ASSOCIATION|ASSOCIATION|HOA|INC)\.?\s*$/, "");
  text = text.replace(/\s+(?:A\s+)?(?:CONDOMINIUMS?|CONDOS?|CNDO)\s+.*$/, " CONDO");
  text = collapse(text.replace(/[^A-Z0-9 &']+/g, " "));
  if (text.length < 4) return [];
  const base = sunbizBase(text);
  const distinctive = base.filter((token) => token.length >= 4 && !GENERIC.has(token) && !/^\d+$/.test(token));
  if (!distinctive.length && base.length < 2) return [];
  const terms = [text];
  const lead = text.match(/^(TOWN\s?HOMES|TOWN\s?HOUSES|VILLAS|VILLAGES?|CONDOMINIUMS?|HOMES|COTTAGES|ESTATES|RESIDENCES)\s+(?:OF|AT|ON)\s+(.+)$/);
  if (lead) terms.push(`${lead[2]} ${lead[1]}`);
  return terms;
}

const SB_ASSOC_WORD = /\b(?:ASSOCIATION|ASSN|ASSOC|HOA|POA|COA)\b/;
const SB_COMMERCIAL = /\b(?:LLC|L\.L\.C|LP|LLLP|LTD|P\.?A|PLLC|CORP|CORPORATION|COMPANY|CO)\b\.?/;

// Select one ACTIVE Sunbiz entity whose normalized base equals the
// community. Several matches stay not_unique unless the condo/HOA type of the
// property leaves exactly one.
export function selectSunbizEntity(community, results, { condo = false } = {}) {
  const want = sunbizBase(community).join(" ");
  const matches = [];
  for (const result of results) {
    if (String(result.status ?? "").trim().toLowerCase() !== "active") continue;
    if (sunbizBase(result.name).join(" ") !== want) continue;
    const upper = result.name.toUpperCase();
    if (SB_ASSOC_WORD.test(upper)) matches.push({ ...result, needsNonprofit: false });
    else if (/\bINC\b/.test(upper) && !SB_COMMERCIAL.test(upper.replace("INC", ""))) matches.push({ ...result, needsNonprofit: true });
  }
  let choices = [...new Map(matches.map((match) => [match.name.toUpperCase().replace(/ /g, ""), match])).values()];
  if (choices.length > 1) {
    const typed = choices.filter((match) => /CONDO/.test(match.name.toUpperCase()) === condo);
    if (typed.length === 1) choices = typed;
  }
  if (choices.length !== 1) return { status: choices.length ? "not_unique" : "no_active_exact_match", matches: matches.map((m) => m.name) };
  return { status: "candidate", entity: choices[0], matches: matches.map((m) => m.name) };
}

// Confirm the selected entity from its detail page. Principal/mailing
// addresses outside the property's ZIP3 and city mark it out of area (low).
export function verifySunbizDetail(entity, detailText, row) {
  const text = String(detailText ?? "");
  if (!/\bStatus\s*\n*\s*ACTIVE\b/i.test(text) && !text.toUpperCase().includes("ACTIVE")) return { status: "detail_not_active" };
  if (entity.needsNonprofit && !/Not\s+For\s+Profit/i.test(text)) return { status: "inc_without_association_word_not_nonprofit" };
  const address = parseAddress(row?.full_address) ?? {};
  const block = text.split(/Registered Agent/)[0];
  const zips = [...block.matchAll(/\bFL\s+(\d{5})/g)].map((match) => match[1]);
  const city = (address.city ?? "").toUpperCase();
  const local = Boolean(
    (address.postal && zips.some((zip) => zip.slice(0, 3) === address.postal.slice(0, 3))) || (city && block.toUpperCase().includes(city)),
  );
  return { status: "matched", name: entity.name, documentNumber: entity.documentNumber ?? null, local };
}
