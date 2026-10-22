import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  exactAddressQuery,
  hostTargetedQueries,
  pageEvidenceTier,
  parseAddress,
  periodMatrixQueries,
} from "../src/enrichment/hoa-web-address.mjs";
import {
  FEE_KINDS,
  annualize,
  canonicalFrequency,
  decideFee,
  extractPageClaims,
  nonHoaAmount,
  publishableFeeTuple,
} from "../src/enrichment/hoa-web-fees.mjs";
import {
  cleanSubdivision,
  communityFromLegal,
  condoAssociationFromLegal,
  propertyKind,
} from "../src/enrichment/hoa-web-legal.mjs";
import {
  decideName,
  findPropagatedNames,
  selectSunbizEntity,
  textMentionsLocality,
  verifySunbizDetail,
} from "../src/enrichment/hoa-web-names.mjs";
import { AdaptiveLimiter, cacheKey, parseCheckpointLines, pendingRows } from "../src/enrichment/hoa-web-run.mjs";
import {
  coverageCounts,
  diagnoseObservations,
  diagnoseRawVersusOutput,
  feeGapPct,
  frequencyCorrectionCandidate,
  isReviewGap,
  minConfidence,
  observationsFromClaims,
  verifyOutputRows,
} from "../src/enrichment/hoa-web-scoring.mjs";
import { cleanMarkdown, contentBeforeSimilarHomes } from "../src/enrichment/hoa-web-text.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(path.join(here, "../../fixtures/hoa-web-evidence-cases.json"), "utf8"));

function rowFor(fixture) {
  return {
    property_id: fixture.id,
    full_address: fixture.requestedAddress,
    county: fixture.county ?? "example",
    legal_description: fixture.legalDescription ?? null,
    subdivision: fixture.subdivision ?? null,
    current_hoa_name: fixture.currentHoaName ?? null,
    hoa_name_status: fixture.currentHoaName ? "present" : null,
  };
}

const feeClaims = (claims) =>
  claims.filter((claim) => FEE_KINDS.has(claim.kind)).map(({ kind, amount, frequency }) => ({ kind, amount, frequency }));

function adjudicatePages(fixture) {
  const row = rowFor(fixture);
  const pages = fixture.pages.map((page) => {
    const { tier, reason } = pageEvidenceTier(row, page);
    return { ...extractPageClaims(page.url, page.markdown, page.title, { today: "2026-10-21" }), tier, reason, fixture: page };
  });
  return { row, pages, result: decideFee(row, pages, propertyKind(row, pages)) };
}

const evaluators = {
  observations(fixture) {
    for (const observation of fixture.observations) {
      const frequency = canonicalFrequency(observation.frequencyRaw);
      expect(frequency).toBe(observation.expectedFrequencyCanonical);
      expect(annualize(observation.amountUsd, frequency)).toBe(observation.expectedAnnualizedUsd);
    }
    expect(diagnoseObservations(fixture)).toBe(fixture.expectedDiagnostic);
    if ("expectedCombinedAnnualizedUsd" in fixture) {
      const combined = fixture.observations.reduce((sum, observation) => sum + observation.expectedAnnualizedUsd, 0);
      expect(combined).toBe(fixture.expectedCombinedAnnualizedUsd);
    }
  },
  rawVersusOutput(fixture) {
    expect(diagnoseRawVersusOutput(fixture)).toBe(fixture.expectedDiagnostic);
  },
  frequencyCandidate(fixture) {
    const candidate = frequencyCorrectionCandidate(fixture);
    expect(candidate?.frequency).toBe(fixture.expectedCandidateFrequency);
    expect(candidate.error).toBeLessThanOrEqual(fixture.expectedCandidateErrorAtMost);
    expect(candidate.storedError).toBeGreaterThan(fixture.storedFrequencyErrorGreaterThan);
  },
  netsuiteGap(fixture) {
    if ("expectedFeeGapPct" in fixture) expect(feeGapPct(fixture.actualDay, fixture.prismDay)).toBeCloseTo(fixture.expectedFeeGapPct, 6);
    expect(isReviewGap(fixture.actualDay, fixture.prismDay)).toBe(fixture.expectedReviewGap);
  },
  pageAdjudication(fixture) {
    const { pages, result } = adjudicatePages(fixture);
    for (const page of pages) {
      if ("expectedTier" in page.fixture) expect(page.tier, `${page.url}: ${page.reason}`).toBe(page.fixture.expectedTier);
      if (page.fixture.expectedClaims) expect(feeClaims(page.claims)).toEqual(page.fixture.expectedClaims);
    }
    const accepted = pages.filter((page) => page.tier > 0).flatMap((page) => page.claims);
    for (const amount of fixture.neverAmountUsd ?? []) {
      expect(accepted.map((claim) => claim.amount)).not.toContain(amount);
      expect(result.fee).not.toBe(amount);
    }
    const expected = fixture.expectedFinal;
    if (expected) {
      const actual = {
        fee: result.fee,
        frequency: result.frequency,
        annualizedUsd: result.annualized,
        basis: result.basis,
        confidence: result.confidence,
        secondFee: result.second?.fee,
        secondFrequency: result.second?.frequency,
        totalAnnualUsd: result.total,
      };
      for (const [key, value] of Object.entries(expected)) expect(actual[key], key).toBe(value);
    }
    for (const pattern of fixture.expectedPatterns ?? []) expect(result.patterns).toContain(pattern);
    if ("expectedPublishTuple" in fixture) expect(publishableFeeTuple(result)).toBe(fixture.expectedPublishTuple);
    if (fixture.expectedDiagnostic) {
      const exact = pages.filter((page) => page.tier === 2).flatMap((page) => page.claims);
      expect(diagnoseObservations({ scope: "exact_property", observations: observationsFromClaims(exact) })).toBe(fixture.expectedDiagnostic);
    }
  },
  nameAdjudication(fixture) {
    const row = rowFor(fixture);
    const legalCommunity = communityFromLegal(row.legal_description, row.subdivision);
    const subdivisionCommunity = cleanSubdivision(row.subdivision);
    const decided = decideName({ row, legalCommunity, subdivisionCommunity, candidates: fixture.candidates });
    expect(decided.name).toBe(fixture.expectedName);
    if (fixture.expectedBasis) expect(decided.basis).toBe(fixture.expectedBasis);
    if (fixture.expectedConfidence) expect(decided.confidence).toBe(fixture.expectedConfidence);
    const rejections = decided.rejected.map((candidate) => candidate.cls);
    for (const rejection of fixture.expectedRejections ?? []) expect(rejections).toContain(rejection);
  },
  placeholderPropagation(fixture) {
    expect(findPropagatedNames(fixture.rows).map((row) => row.id)).toEqual(fixture.expectedFlaggedIds);
  },
  legalCommunity(fixture) {
    for (const example of fixture.examples) {
      if ("expectedCommunity" in example) {
        expect(communityFromLegal(example.legalDescription, example.subdivision)).toBe(example.expectedCommunity);
      }
      if ("expectedSubdivisionCommunity" in example) {
        expect(cleanSubdivision(example.subdivision)).toBe(example.expectedSubdivisionCommunity);
      }
      if ("expectedInferredAssociation" in example) {
        const community = communityFromLegal(example.legalDescription, example.subdivision);
        expect(condoAssociationFromLegal(example.legalDescription, community, example.subdivision)).toBe(example.expectedInferredAssociation);
      }
    }
  },
};

describe("HOA web evidence regression fixtures", () => {
  it("uses only known evaluators and unique ids", () => {
    const ids = fixtures.cases.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const fixture of fixtures.cases) expect(Object.keys(evaluators)).toContain(fixture.check);
  });

  for (const fixture of fixtures.cases) {
    it(fixture.id, () => evaluators[fixture.check](fixture));
  }
});

describe("address parsing", () => {
  it.each([
    ["N 410 EXAMPLE PARKER AVE UNIT APT A201 SAMPLETON 32999", { house: "410", unit: "A201", city: "SAMPLETON", core: ["EXAMPLE", "PARKER"] }],
    ["4410 STEVENSON LANE SAMPLETON 32999", { core: ["STEVENSON"], unit: null, city: "SAMPLETON" }],
    ["731 UNITY DRIVE PORT SAMPLE 32999", { core: ["UNITY"], unit: null, city: "PORT SAMPLE" }],
    ["120 UNITAH CT SAMPLETON 32999", { core: ["UNITAH"], unit: null }],
    ["2207 AVENUE OF THE SAMPLES Sample Garden 32999", { core: ["AVENUE", "OF", "THE", "SAMPLES"], city: "SAMPLE GARDEN" }],
    ["5120 EXAMPLE DRIVE # 103 SAMPLETON 32999", { house: "5120", unit: "103", city: "SAMPLETON", postal: "32999" }],
  ])("%s", (raw, expected) => {
    expect(parseAddress(raw)).toMatchObject({ usable: true, ...expected });
  });

  it("builds pass-1 and pass-2 query shapes", () => {
    const address = parseAddress("950 Example Bay Blvd Unit 12, Sampleton, FL 32999");
    expect(exactAddressQuery(address, "example")).toBe('"950 EXAMPLE BAY" "#12" Sampleton 32999 Example FL HOA association fee');
    expect(periodMatrixQueries(address)).toHaveLength(4);
    const queries = hostTargetedQueries(address);
    expect(queries[0]).toEqual({ host: "homes.com", query: '"950 Example Bay Blvd" "Unit 12" Sampleton FL 32999 site:homes.com' });
    expect(queries[1].query).toBe('"950 Example Bay Boulevard" "#12" Sampleton FL 32999 site:compass.com');
    expect(queries.find((query) => query.host === "general").query).toBe('"950 Example Bay Blvd" "12" FL 32999 "HOA" OR "association fee"');
  });

  it("rejects pages for another city or ZIP", () => {
    const row = { full_address: "910 Example Heron Way, Sampleton, FL 32999" };
    const page = { url: "https://listing.example/910-example-heron-way-othertown-fl-30001", title: "910 Example Heron Way", markdown: "Othertown, GA 30001" };
    expect(pageEvidenceTier(row, page)).toEqual({ tier: 0, reason: "city and ZIP differ" });
  });

  it("caps condo confidence when the page shows the address but not the unit", () => {
    const row = { full_address: "960 Example Gulf Dr Apt 3B, Sampleton, FL 32999", legal_description: "UNIT 3B EXAMPLE GULF A CONDOMINIUM" };
    const page = { url: "https://listing.example/960-example-gulf-dr-sampleton-fl-32999", title: "960 Example Gulf Dr", markdown: "HOA Fee: $610\nHOA Fee Frequency: Monthly" };
    const { tier } = pageEvidenceTier(row, page);
    expect(tier).toBe(1);
    const result = decideFee(row, [{ ...extractPageClaims(page.url, page.markdown, page.title), tier }], "condo");
    expect(result).toMatchObject({ fee: 610, confidence: "low", basis: "structured_exact_property_single_unit_unconfirmed" });
  });
});

describe("fee extraction and adjudication", () => {
  const url = "https://listing-a.example/910-example";
  const page = (markdown, extra = {}) => ({ ...extractPageClaims(url, markdown, "", { today: "2026-10-21" }), tier: 2, ...extra });

  it("separates glued badge text before matching", () => {
    expect(cleanMarkdown("$376/moHOA Fees")).toContain("$376/mo HOA Fees");
  });

  it("cuts similar-homes carousels only at short heading lines", () => {
    const body = "Recently sold homes nearby often had higher fees than this listing, according to the agent's remarks today.\nHOA Fee: $90 Monthly\n## Similar Homes\nHOA Fee: $500 Monthly";
    expect(contentBeforeSimilarHomes(body)).toContain("$90");
    expect(contentBeforeSimilarHomes(body)).not.toContain("$500");
  });

  it("never defaults a missing period, and infers one only from a second agreeing signal", () => {
    const bare = decideFee({}, [page("HOA Fee: $400")], "sfh");
    expect(bare).toMatchObject({ fee: null, frequency: null, basis: "unresolved_frequency_missing" });
    const signalled = decideFee({ neighbour_suggested_fee: 400, neighbour_suggested_fee_frequency: "Quarterly" }, [page("HOA Fee: $400")], "sfh");
    expect(signalled).toMatchObject({ fee: 400, frequency: "Quarterly", basis: "frequency_inferred_two_signals" });
  });

  it("prefers the newest dated listing, then the majority", () => {
    const older = { ...page("Sold on 03/02/2019\nHOA Fee: $80\nHOA Fee Frequency: Monthly"), url: "https://a.example/x" };
    const newer = { ...page("Listed 06/01/2025\nHOA Fee: $95\nHOA Fee Frequency: Monthly"), url: "https://b.example/x" };
    older.claims = older.claims.map((claim) => ({ ...claim, url: older.url }));
    newer.claims = newer.claims.map((claim) => ({ ...claim, url: newer.url }));
    expect(decideFee({}, [older, newer], "sfh")).toMatchObject({ fee: 95, basis: "structured_most_recent_listing" });
  });

  it("raises an IDX conversion only with an agreeing neighbour", () => {
    const row = { neighbour_suggested_fee: 648, neighbour_suggested_fee_frequency: "Annually" };
    expect(decideFee(row, [page("HOA Fees $54/ann")], "sfh")).toMatchObject({ fee: 648, frequency: "Annually", confidence: "medium" });
  });

  it("flags rent, tax, and utility amounts accepted next to an HOA label", () => {
    expect(nonHoaAmount("Rent estimate $2,400/mo; HOA info below", 2400)).toBe(true);
    expect(nonHoaAmount("HOA Fee: $95 Monthly", 95)).toBe(false);
  });
});

describe("name evidence", () => {
  const row = { full_address: "980 Example Cypress Ct, Sampleton, FL 32999", county: "example" };

  it("requires the page to mention the property's city, ZIP, or county", () => {
    expect(textMentionsLocality(row, "Maplewood Glen HOA, Sampleton FL")).toBe(true);
    expect(textMentionsLocality(row, "Maplewood Glen HOA, Columbus OH 43004")).toBe(false);
  });

  it("selects one ACTIVE exact-base Sunbiz entity and keeps ambiguity explicit", () => {
    const results = [
      { name: "MAPLEWOOD GLEN HOMEOWNERS ASSOCIATION, INC.", status: "Active", documentNumber: "N1" },
      { name: "MAPLEWOOD GLEN HOMEOWNERS ASSOCIATION OF OHIO, INC.", status: "Active", documentNumber: "N2" },
      { name: "MAPLEWOOD GLEN COMMUNITY ASSOCIATION, INC.", status: "Inactive", documentNumber: "N3" },
    ];
    const selected = selectSunbizEntity("MAPLEWOOD GLEN", results);
    expect(selected).toMatchObject({ status: "candidate", entity: { documentNumber: "N1" } });
    const verified = verifySunbizDetail(selected.entity, "Status ACTIVE\nPrincipal Address\n1 Example St\nColumbus, OH 43004\nRegistered Agent", row);
    expect(verified).toMatchObject({ status: "matched", local: false });
    const twins = [results[0], { ...results[0], name: "MAPLEWOOD GLEN HOMEOWNERS' ASSOCIATION INC", documentNumber: "N4" }];
    expect(selectSunbizEntity("MAPLEWOOD GLEN", twins).status).toBe("not_unique");
    const inc = selectSunbizEntity("MAPLEWOOD GLEN", [{ name: "MAPLEWOOD GLEN, INC.", status: "Active" }]);
    expect(verifySunbizDetail(inc.entity, "Status ACTIVE\nFlorida Profit Corporation", row).status).toBe("inc_without_association_word_not_nonprofit");
  });
});

describe("run control and output", () => {
  it("ramps to the cap while saturated and backs off on 429", async () => {
    let clock = 0;
    const limiter = new AdaptiveLimiter({ start: 20, cap: 30, now: () => clock });
    for (let i = 0; i < 20; i += 1) await limiter.acquire();
    clock = 61_000;
    limiter.release(200);
    expect(limiter.limit).toBe(25);
    clock = 62_000;
    limiter.release(429);
    expect(limiter.limit).toBe(18);
    expect(limiter.history.map((entry) => entry.event)).toEqual(["raise", "429"]);
  });

  it("resumes only rows without a current-version, non-error checkpoint", () => {
    const records = parseCheckpointLines(
      [
        JSON.stringify({ property_id: "a", parserVersion: "v2", diagnostic: "confirmed_match" }),
        JSON.stringify({ property_id: "b", parserVersion: "v1", diagnostic: "confirmed_match" }),
        JSON.stringify({ property_id: "c", parserVersion: "v2", diagnostic: "fetch_error" }),
        '{"property_id": "d", "parserVer',
      ].join("\n"),
    );
    const { pending } = pendingRows([{ property_id: "a" }, { property_id: "b" }, { property_id: "c" }, { property_id: "d" }], records, "v2");
    expect(pending.map((row) => row.property_id)).toEqual(["b", "c", "d"]);
    expect(cacheKey("queries", "q")).toMatch(/^queries\/[0-9a-f]{64}\.json$/);
  });

  it("reports coverage and refuses unsafe output", () => {
    const before = [{ property_id: "a", final_hoa_name: null, final_fee: 10, final_fee_frequency: "Monthly", final_fee_basis: "exact_property" }];
    const after = [{ ...before[0], final_hoa_name: "Example HOA", decision_changed: true }];
    expect(coverageCounts(after).rows_with_name_fee_and_frequency).toBe(1);
    expect(verifyOutputRows(before, after)).toEqual([]);
    expect(verifyOutputRows(before, [{ ...after[0], final_fee_frequency: null, final_fee_basis: null, decision_changed: false }])).toContain(
      "fee without frequency: a",
    );
    expect(minConfidence("high", "low")).toBe("low");
  });
});
