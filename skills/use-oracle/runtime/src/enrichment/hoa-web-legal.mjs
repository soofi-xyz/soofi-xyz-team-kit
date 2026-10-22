// Legal-description and subdivision heuristics for HOA web enrichment. These
// produce search keys and validation communities, never an official identity.

import {
  collapse,
  communityOk,
  compact,
  sequenceRatio,
  stripChars,
  titleCase,
  upperSquash,
} from "./hoa-web-text.mjs";

export const NAME_TOKEN_STOP = new Set([
  "THE", "OF", "AND", "AT", "A", "AN", "FOR", "IN", "ON", "BY", "TO",
  "HOA", "POA", "COA", "INC", "LLC", "CORP", "ASSOC", "ASSN", "ASSOCIATION", "ASSOCIATIONS",
  "HOMEOWNER", "HOMEOWNERS", "HOMEOWNERSS", "OWNER", "OWNERS", "PROPERTY", "PROPERTIES",
  "CONDO", "CONDOS", "CONDOMINIUM", "CONDOMINIUMS", "CONDOMIN", "CONDOMINIU", "CONDOMIUM",
  "CONDOMINUM", "CONDOM", "CNDO", "COND",
  "COMMUNITY", "MASTER", "PHASE", "PH", "SECTION", "SEC", "UNIT", "UNITS", "NO", "NUMBER",
  "SUBDIVISION", "SUB", "PLAT", "REPLAT", "COUNTY", "FLORIDA", "FL", "CIVIC", "MAINTENANCE",
  "VILLAGE", "VILLAGES", "ESTATES", "TOWNHOMES", "TOWNHOME", "TOWNHOUSES", "TOWNHOUSE", "HOMES", "HOME",
  "APARTMENTS", "APTS", "VILLAS", "VILLA", "CLUB", "RESIDENTIAL", "RECREATION", "OPERATING", "NEIGHBORHOOD",
  "ADDITION", "ADDN", "ADD", "AMENDED", "REVISED", "RESUB", "TRACT", "PARCEL", "BLDG", "BUILDING", "LOT",
  "BLOCK", "BLK", "PARCELS", "TRACTS", "LOTS", "PHASES", "PUD", "ACTIVE", "ADULT", "HOMEOWNERS'",
  "OWNERS'", "INCREMENT",
]);

const NUMBER_WORDS = new Set([
  "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE",
  "FIRST", "SECOND", "THIRD", "FOURTH", "FIFTH", "II", "III", "IV", "VI", "VII", "VIII", "IX", "XI", "XII",
]);

// Geography words that are too common to identify a community on their own.
export const GENERIC_COMMUNITY_WORDS = new Set([
  "CREEK", "LAKE", "LAKES", "PARK", "OAKS", "OAK", "PLANTATION", "POINTE", "POINT", "PRESERVE", "RESERVE",
  "LANDING", "LANDINGS", "RIDGE", "HILLS", "HILL", "GROVE", "GROVES", "WOODS", "WOOD", "SPRINGS", "SPRING",
  "PINES", "PINE", "PALMS", "PALM", "GARDENS", "GARDEN", "PLACE", "TRACE", "CROSSING", "CROSSINGS", "COVE",
  "BAY", "HARBOR", "HARBOUR", "ISLAND", "ISLES", "RUN", "CHASE", "GLEN", "GLENN", "MEADOWS", "MEADOW",
  "FOREST", "TRAILS", "TRAIL", "SQUARE", "COMMONS", "COUNTRY", "GOLF", "RIVER", "WEST", "EAST", "NORTH",
  "SOUTH", "HEIGHTS", "MANOR", "SHORES", "BEACH", "GREEN", "GREENS", "HAMMOCK", "FARMS", "FARM", "RANCH",
  "STATION", "TERRACE", "COURT", "TOWNE", "TOWN", "CENTER", "CYPRESS", "WATER", "WATERS", "WATERFRONT",
  "BRANCH", "HOLLOW", "VIEW", "VISTA", "BLUFF", "COLONY", "KEY", "SHORE", "LANE", "WAY", "ROAD", "DRIVE",
  "ESTATE", "ACRES", "GATE", "GATES", "ISLE", "WALK", "PARKWAY", "OAKES", "NEW", "OLD", "GRAND", "ROYAL",
  "SAINT", "MOUNT", "LITTLE", "BIG", "UPPER", "LOWER", "CITY",
]);

const FUZZY_STOP = ["COMMUNITY", "ASSOCIATION", "HOMEOWNERS", "CONDOMINIUM"];

export function nameTokens(text) {
  let value = upperSquash(text).replace(/&/g, " AND ").replace(/@/g, " AT ");
  value = value
    .replace(/\bST\b\.?/g, "SAINT")
    .replace(/\bMT\b\.?/g, "MOUNT")
    .replace(/'S\b|’S\b/g, "S")
    .replace(/[^A-Z0-9 ]+/g, " ");
  const out = [];
  for (const token of value.split(" ").filter(Boolean)) {
    if (token.length < 3 || NAME_TOKEN_STOP.has(token) || NUMBER_WORDS.has(token)) continue;
    if (/^\d+$/.test(token) || /^(?:\d+[A-Z]?|[A-Z]\d+)$/.test(token)) continue;
    // OCR misspellings of association words ("ASSOCIATON", "CONDOMINIM").
    if (token.length >= 7 && FUZZY_STOP.some((word) => sequenceRatio(token, word) >= 0.85)) continue;
    out.push(token);
  }
  return out;
}

const LEGAL_DROP = [
  /\bPER\s+(?:AM)?CDO\s+BK\/PG:\s*[\d/]+/g,
  /\b(?:AM)?(?:CDO\s+)?BK\/PG:\s*[\d/]+/g,
  /\b(?:O\s*\/?\s*R|ORB|OR|OB|DB)\s*(?:BK\s*)?\d{3,}\s*(?:(?:PGS?|P\s*G)\s*[\d\- ]+|[-/]\s*\d+)/g,
  /\bPI#\S+/g,
  /\b(?:P\/?B|MB|PLAT BOOK)\s*\d+\s*(?:PGS?|PG|PAGES?)\s*[\d\-&\s]+(?:THRU\s*\d+)?/g,
  /\bPGS?\s*\d+(?:\s*-\s*\d+)?/g,
  /\b(?:COND(?:O)?\s+BK|CB|C\s+B)\s*\d+.*$/g,
  /\(.*?\)/g,
  /\b[A-Z]{1,2}\/\d+\b/g,
  /\b\d{1,5}\/\d{1,5}(?:-\d+)?\b/g,
  /\bTOGETHER WITH\b.*$/g,
  /\bLESS\b.*$/g,
  /\bINC\s+PER\b.*$/g,
  /\bPER\s+OR\b.*$/g,
  /[.\d/]+%?\s*(?:UNDIVIDED\s+)?INT(?:EREST)?\.?\s+(?:IN\s+)?(?:THE\s+)?COMMON\s+(?:ELEMENTS?|ELEM|AREAS?)\b/g,
  /\d+\/\d+(?:TH)?\s+INT\b.*$/g,
  /&?\s*\bPT\s+(?:OF\s+)?COMM?\s*ON\s*(?:AR\s*EA|AREA|S)\b/g,
  /\bCOMMON ELEMENTS?\b/g,
  /\b(?:AS|A\s+S)\s+REC(?:ORDED)?(?:\s+IN)?\b/g,
  /\bDESC(?:RIBED)?\s+(?:AS|IN)\b.*$/g,
  /\bCARRIED IN\b.*$/g,
  /\bLYING\b.*$/g,
  /\bSEE\s+\d[\d-]+.*$/g,
  /\bBEING\b.*$/g,
  /\bMORE PARTICULARLY\b.*$/g,
  /\b\d[\d-]*\s+THRU\s+\d[\d-]*/g,
  /\bTHRU\b.*$/g,
];

export function cleanSubdivision(value) {
  let text = upperSquash(value);
  if (!text) return null;
  text = text.replace(/^SHORT LEGAL:.*?LONG LEGAL:\s*/, "");
  // Leading county subdivision codes ("04521 SAMPLE TOWNHOMES ...").
  text = text.replace(/^\d{3,6}\s+/, "");
  text = text.replace(/^\(?(?:OR|ORB)?\s*\d+\/[\d-]+\)?\s+/, "");
  for (let i = 0; i < 3; i += 1) text = text.replace(/^(?:LOTS?|BLK|BLOCK|UNIT|BLDG)\s+\S+\s+/, "");
  text = text.replace(/\s+AS(?:\s+RE\s*C.*)?$/, "");
  text = text.replace(/\s*\bPB\s*\d+\s*\/\s*\d+.*$|\s*\S*\d+\/\d+\S*.*$/, "");
  text = text.replace(/\s+\d{4,}.*$|\s+THRU\b.*$/, "");
  text = text.replace(/\s+(?:COND\s+DECL|DECL|FILED)\b.*$|,.*$|\s+&\s+(?:I|II|III|IV|\d)\b.*$/, "");
  text = text.replace(/\b(?:CB|OR|ORB)\s*\d+\/\d+.*$/, "");
  text = text.replace(/\s+(?:[A-Z]{1,2}|\d{1,5})\/\d+.*$/, "");
  text = text.replace(/\bSUB\s+LOT\b.*$|\bLOT\s+\d+.*$|\bAMENDED\b.*$|\(THE\)/g, " ");
  text = text.replace(
    /\s+\b(?:PHASE|PHASES|PH|SECTION|SEC|UNIT|UNITS|UN|UT|BLDG|BLK|BLOCK|REPLAT|NO|INCREMENT|TRACT|PARCEL|PARCELS)\b.*$/,
    "",
  );
  text = text.replace(/\s+\d+[A-Z]?$/, "");
  text = stripChars(collapse(text), " -&,/");
  return communityOk(text) ? text : null;
}

export function legalSegments(legal) {
  let text = upperSquash(legal);
  text = text.replace(/^SHORT LEGAL:.*?LONG LEGAL:\s*/, "");
  text = text.replace(/(\d)([A-Z]{3,})/g, "$1 $2");
  text = text.replace(/\b(CONDOMINIUM|CONDO)(ORB|OR|PB|CB)\b/g, "$1 $2");
  text = text.replace(/\bUNIT\s+([A-Z])(THE)\b/g, "UNIT $1 $2");
  // OCR split of THE.
  text = text.replace(/\bTH\s+E\b/g, "THE");
  text = text.replace(/(?<=[A-Z])PB\s*\d+.*$/, "");
  for (const pattern of LEGAL_DROP) text = text.replace(pattern, " ");
  text = text.replace(/(?:\s+PER\b)+/g, " ");
  // Section-township-range prefix ("12-34 21-5S-28E;").
  text = text.replace(/^(?:\d+[-/\d]*\s+)+\d+[-\d]*[NS]\s*-\s*\d+[-\d]*[EW](?:\s*[.\d]+)?\s*;?\s*/, "");
  text = text.replace(/^\d+\/[\d-]+\s+/, "");
  text = text.replace(/^[\d-]+\s+(?=[A-Z])/, "");
  return text
    .split(/;|,(?=\s*(?:UNIT|LOT|BLDG|BLK|PHASE)\b)/)
    .map((part) => stripChars(part, " ,;"))
    .filter(Boolean);
}

export function cleanSegment(part) {
  let segment = part;
  for (let i = 0; i < 4; i += 1) {
    segment = segment.replace(
      /^(?:LOTS?|UNIT|UNITS|BLDG|BUILDING|DWELLING UNIT|GARAGE SPACE|PARCEL|TRACT|BLK|BLOCK|TYPE)\s+[\w-]+(?:\s*(?:&|AND)\s*[\w-]+)?\s*,?\s*/,
      "",
    );
    segment = segment.replace(/^(?:&|AND|OF|LEG|AS)\s+/, "");
  }
  // "CONDO 22 OF <name>" names the condominium after OF.
  segment = segment.replace(/^CONDO(?:MINIUM)?\s+\d+\s+OF\s+/, "");
  segment = segment.replace(/^THE\s+/, "THE ");
  segment = segment.replace(
    /\s+\b(?:PHASE|PH|SECTION|SEC|SUBPHASE|INCREMENT|UNIT|UN|BLK|BLOCK|LOT|LOTS|BLDG|BUILDING|PB|PG|PGS|SUB|S\/D|PLAT|TRACT|PARCEL|REPLAT|DWELLING|TYPE)\b.*$/,
    "",
  );
  segment = segment.replace(/\s+PH\d+.*$|\s+-\s*\d.*$|\s+=.*$|\s*\([^)]*$/, "");
  segment = segment.replace(/(?<!\bNO)(?<!\bNO\.)(?<!#)\s+\d+[A-Z]?$/, "");
  segment = segment.replace(/\s+NO\.?$/, "");
  segment = segment.replace(/\s+(?:AS|RE|C|U)$/, "");
  return stripChars(collapse(segment), " -&,/.");
}

const OCR_VOCAB = new Set([
  ...GENERIC_COMMUNITY_WORDS,
  "COTTAGES", "PLANTATION", "PRESERVE", "HARBOR", "VILLAGE", "TOWNHOMES", "CONDOMINIUM", "LANDING",
]);

// Rejoin OCR splits ("PLANTA TION") using generic vocabulary plus the words
// of the parcel's own subdivision field.
export function joinOcrSplits(text, subdivision) {
  const vocab = new Set([...OCR_VOCAB, ...(upperSquash(subdivision).match(/[A-Z]{4,}/g) ?? [])]);
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length; i += 1) {
    const joined = words[i] + (words[i + 1] ?? "");
    if (i + 1 < words.length && vocab.has(joined) && !vocab.has(words[i]) && !vocab.has(words[i + 1])) {
      out.push(joined);
      i += 1;
      continue;
    }
    out.push(words[i]);
  }
  return out.join(" ");
}

function distinctiveCount(text) {
  return nameTokens(text).filter((token) => !GENERIC_COMMUNITY_WORDS.has(token)).length;
}

// Choose the community a parcel belongs to from its legal description,
// using the subdivision field to repair truncations ("PLANTATIO") and to
// break ties when the two disagree.
export function communityFromLegal(legal, subdivision) {
  if (!legal) return null;
  const joined = joinOcrSplits(upperSquash(legal), subdivision);
  const candidates = legalSegments(joined)
    .map(cleanSegment)
    .filter((candidate) => communityOk(candidate) && !/^(?:INT|COMMON|ELEMENTS|AREA|\W)+$/.test(candidate));
  const sub = cleanSubdivision(subdivision);
  const rawCompact = compact(joined);
  if (sub && compact(sub).length >= 8 && rawCompact.includes(compact(sub))) {
    const subCompact = compact(sub);
    const containing = candidates.find((candidate) => compact(candidate).includes(subCompact));
    if (!containing) return sub;
    const candidateCompact = compact(containing);
    const at = candidateCompact.indexOf(subCompact);
    const prefix = candidateCompact.slice(0, at);
    const rest = candidateCompact.slice(at + subCompact.length);
    if (prefix || rest.length <= 2) {
      return sub + (rest.startsWith("CONDO") && !subCompact.includes("CONDO") ? " CONDOMINIUM" : "");
    }
    return containing;
  }
  if (!candidates.length) return null;
  const score = (candidate) => [
    /CONDO/.test(candidate) ? 1 : 0,
    distinctiveCount(candidate),
    nameTokens(candidate).length,
  ];
  let best = candidates[0];
  for (const candidate of candidates.slice(1)) {
    if (compareTuples(score(candidate), score(best)) > 0) best = candidate;
  }
  if (sub) {
    const subCompact = compact(sub);
    const bestCompact = compact(best);
    if (bestCompact.length >= 8 && subCompact.startsWith(bestCompact) && subCompact.length > bestCompact.length) {
      return sub;
    }
  }
  return best;
}

export function compareTuples(left, right) {
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

const CONDO_WORD =
  /\b(?:A\s+)?(?:CONDOMINIUMS?|CONDOMINIU|CONDOMINUM|CONDOMIUM|CONDOMIN|CONDOM|CONDOS?|CNDO)\b(?!\s+(?:ASSOCIATION|ASSN))/;

function condoAfterCommunity(legal, community) {
  const text = upperSquash(legal);
  const at = text.indexOf(community);
  if (at < 0) return false;
  const after = text.slice(at + community.length).split(" ").filter(Boolean).slice(0, 8);
  for (const word of after) {
    if (new RegExp(`^(?:${CONDO_WORD.source})$`).test(word) || word.startsWith("CONDO")) return true;
    if (
      ["A", "PHASE", "PH", "SECTION", "SEC", "UNIT", "NO", "&"].includes(word) ||
      /^(?:[IVX]{1,4}|\d+[A-Z]?(?:-[A-Z0-9]+)?|[A-Z])$/.test(word)
    ) {
      continue;
    }
    return false;
  }
  return false;
}

// Build "<Condo name> Association, Inc." from a condominium named in the
// legal description. The result is labelled inferred_from_legal and is never
// a verified legal name.
export function condoAssociationFromLegal(legal, community, subdivision = null) {
  if (!community) return null;
  let text = community;
  if (!/\bCONDO|\bCNDO/.test(text)) {
    if (legal && condoAfterCommunity(legal, text)) {
      text = `${text} CONDOMINIUM`;
    } else if (subdivision && /\bCONDO/.test(upperSquash(subdivision)) && compact(subdivision).includes(compact(text))) {
      text = cleanSubdivision(subdivision) ?? text;
      if (!/\bCONDO/.test(text)) return null;
    } else {
      return null;
    }
  } else if (!legal || !/\bCONDO/.test(upperSquash(legal))) {
    return null;
  }
  text = text.replace(/\bCONDO\s+\d+\s+OF\s+/, "");
  const match = CONDO_WORD.exec(text);
  if (!match) return null;
  const namePart = stripChars(text.slice(0, match.index), " ,");
  const tail = stripChars(text.slice(match.index + match[0].length), " ,");
  const word = /\bCONDOS\b|CONDOMINIUMS/.test(text) ? "Condominiums" : "Condominium";
  const number = tail.match(/^(?:NO\.?|NUMBER|#)\s*(\w+)/);
  const roman = tail.match(/^((?:[IVX]{1,4}|\d{1,2}))(?=\s+[A-Z]|$)/);
  const ofPart = tail.match(/^(OF|AT|ON)\s+(.+)$/);
  const name = titleCase(namePart.replace(/,/g, "").trim()).replace(/\s+A$/, "");
  if (!nameTokens(name).length) return null;
  let full = `${name} ${word}`;
  if (number) full += ` No. ${number[1]}`;
  else if (roman) full += ` ${roman[1]}`;
  else if (ofPart) full += ` ${ofPart[1].toLowerCase()} ${titleCase(ofPart[2])}`;
  return `${full} Association, Inc.`;
}

export function condoLike(row) {
  const legal = upperSquash(row?.legal_description);
  if (/CONDO|\bBLDG\b|\bBUILDING\b|COMMON\s+ELEM|DWELLING\s+UNIT|UNDIVIDED|\bINT\s+(?:IN\s+)?COMMON/.test(legal)) {
    return true;
  }
  return /\bUNIT\s+\S+/.test(legal) && !/\bLOT\b|\bBLK\b|\bBLOCK\b/.test(legal);
}

export function propertyKind(row, pages = []) {
  const blob = [row?.legal_description, row?.subdivision, row?.legal_evidence].filter(Boolean).join(" ").toUpperCase();
  for (const page of pages) {
    if (!page?.ptype) continue;
    const type = page.ptype.toLowerCase();
    if (type.includes("condo") || type.includes("co-op")) return "condo";
    if (type.includes("town") || type.includes("villa") || type.includes("attached")) return "townhome";
    if (type.includes("single") || type.includes("detached")) return "sfh";
  }
  if (/\bCONDO|\bUNIT\s+\w+.*\bBLDG\b|\bBLDG\b|\bCOMMON ELEMENTS?\b|UNDIVIDED INT/.test(blob)) return "condo";
  if (/TOWNHOM|TOWNHOUSE|VILLAS?\b/.test(blob)) return "townhome";
  return "sfh";
}

export function communityKey(row) {
  const community =
    communityFromLegal(row?.legal_description, row?.subdivision) ?? cleanSubdivision(row?.subdivision);
  return community ? `${row?.county ?? ""}|${compact(community)}` : null;
}
