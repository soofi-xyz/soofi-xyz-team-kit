import { describe, expect, it } from "vitest";

import { cleanMin, luhnValidMin, normalizeExtraction, termFromDates } from "../src/mortgage/extract.mjs";

describe("mortgage extract", () => {
  it("validates real MERS MINs by their Luhn check digit", () => {
    for (const m of ["100459100008813091", "101553410008258749", "100196399053001572"]) {
      expect(luhnValidMin(m)).toBe(true);
    }
    // a single transposed digit fails the checksum
    expect(luhnValidMin("100459100008813092")).toBe(false);
    expect(luhnValidMin("12345")).toBe(false);
    expect(luhnValidMin(null)).toBe(false);
  });

  it("cleans a MIN to 18 digits or null", () => {
    expect(cleanMin("1004591-0000881309-1")).toBe("100459100008813091");
    expect(cleanMin("not a min")).toBeNull();
  });

  it("derives term from note and maturity, snapped to whole years", () => {
    expect(termFromDates("2026-11-06", "2056-12-01")).toBe(360);
    expect(termFromDates("2026-11-03", "2041-12-01")).toBe(180);
    expect(termFromDates(null, "2056-12-01")).toBeNull();
  });

  it("keeps a MERS only when it passes the checksum, and flags a bad one for review", () => {
    const good = normalizeExtraction({ loan_amount: 409900, mers_min: "101553410008258749", program: "VA", note_date: "2026-11-06", maturity_date: "2056-12-01" });
    expect(good.mers_min).toBe("101553410008258749");
    expect(good.mortgage_type).toBe("Va");
    expect(good.prepayment_penalty_indicator).toBe(false); // VA rule
    expect(good.term_months).toBe(360);
    expect(good.needs_review).toBe(false);

    const badMin = normalizeExtraction({ loan_amount: 250000, mers_min: "101553410008258748" });
    expect(badMin.mers_min).toBeNull(); // checksum fails -> dropped
    expect(badMin.needs_review).toBe(true);
  });

  it("prefers index names (lender from grantee, dropping MERS)", () => {
    const rec = normalizeExtraction(
      { loan_amount: 300000, lender_name: "WRONG BANK" },
      { index: { grantors: ["JANE DOE"], grantees: ["MERS AS NOMINEE", "REAL LENDER LLC"] } },
    );
    expect(rec.lender_name).toBe("REAL LENDER LLC");
    expect(rec.borrower_name).toBe("JANE DOE");
  });

  it("flags a missing amount for review", () => {
    expect(normalizeExtraction({ loan_amount: null, note_date: "2026-01-01" }).needs_review).toBe(true);
  });
});
