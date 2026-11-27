import { describe, expect, it } from "vitest";

import { parcelIdFromRecord, parcelLookupGremlin } from "../src/mortgage/parcel-link.mjs";

describe("parcel link", () => {
  it("turns a Duval PIN in the legal description into the Persist parcel_identifier", () => {
    expect(parcelIdFromRecord({ county: "duval", legalDescriptions: ["PIN 162222-1215 L42 HICKORY LAKES U1"] }))
      .toEqual({ parcelId: "1622221215R", evidence: "PIN 162222-1215" });
    // Dash is optional.
    expect(parcelIdFromRecord({ county: "duval", legalDescriptions: ["PIN 0166160000 L11 B5 CEDAR HILLS"] }))
      .toMatchObject({ parcelId: "0166160000R" });
  });

  it("returns null when there is no parcel number (lot/subdivision only)", () => {
    expect(parcelIdFromRecord({ county: "duval", legalDescriptions: ["L 110 CROSSROADS STATION"] })).toBeNull();
    expect(parcelIdFromRecord({ county: "duval", legalDescriptions: [] })).toBeNull();
  });

  it("only links counties whose format is known", () => {
    expect(parcelIdFromRecord({ county: "dallas", legalDescriptions: ["PIN 162222-1215"] })).toBeNull();
  });

  it("builds a safe parcel lookup traversal", () => {
    expect(parcelLookupGremlin("1622221215R")).toContain("has('parcel_identifier','1622221215R')");
    // strips anything that is not alphanumeric (no injection)
    expect(parcelLookupGremlin("1')x//")).toContain("has('parcel_identifier','1x')");
  });
});
