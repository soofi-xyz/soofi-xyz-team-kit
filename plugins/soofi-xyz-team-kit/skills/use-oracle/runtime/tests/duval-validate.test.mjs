import { describe, expect, it } from "vitest";

import {
  DUVAL_VALIDATION_BBOX,
  parseStaticPartSelectors,
  collectGeometryPoints,
  assertGeometryInCounty,
  scoreLabeledFieldCoverage,
  classifyValidationGap,
  assertManifestReconciled,
  assertUniqueParcelIds,
} from "../src/counties/duval/validate.mjs";

describe("parseStaticPartSelectors", () => {
  it("parses one quoted CSS selector per row and skips the header", () => {
    const csv = 'cssSelector\n"#__VIEWSTATEGENERATOR"\n"#hd"\n\n';
    expect(parseStaticPartSelectors(csv)).toEqual(["#__VIEWSTATEGENERATOR", "#hd"]);
  });

  it("returns an empty list for empty input", () => {
    expect(parseStaticPartSelectors("")).toEqual([]);
  });
});

describe("collectGeometryPoints", () => {
  it("collects a centroid and every polygon vertex", () => {
    const record = {
      latitude: 30.31,
      longitude: -81.72,
      polygon: [
        { latitude: 30.309, longitude: -81.721 },
        { latitude: 30.311, longitude: -81.719 },
      ],
    };
    expect(collectGeometryPoints(record)).toEqual([
      { latitude: 30.31, longitude: -81.72 },
      { latitude: 30.309, longitude: -81.721 },
      { latitude: 30.311, longitude: -81.719 },
    ]);
  });

  it("returns an empty list for a record with no usable coordinates", () => {
    expect(collectGeometryPoints({})).toEqual([]);
    expect(collectGeometryPoints(null)).toEqual([]);
  });
});

describe("assertGeometryInCounty", () => {
  it("passes for points inside the Duval validation bbox", () => {
    expect(() => assertGeometryInCounty([{ latitude: 30.31, longitude: -81.72 }])).not.toThrow();
  });

  it("fails closed on a missing geometry", () => {
    expect(() => assertGeometryInCounty([])).toThrow(/missing a centroid or polygon/);
  });

  it("fails closed on a point outside the Duval bbox", () => {
    expect(() =>
      assertGeometryInCounty([{ latitude: DUVAL_VALIDATION_BBOX.maxLat + 1, longitude: -81.72 }]),
    ).toThrow(/outside the Duval bbox/);
  });
});

describe("scoreLabeledFieldCoverage", () => {
  const html = `<html><body>
    <span id="ctl00_cphBody_lblRealEstateNumber">096925-0000</span>
    <span id="ctl00_cphBody_lblPropertyUse">0100 SINGLE FAMILY</span>
    <span id="ctl00_cphBody_lblSubdivision">RIVERSIDE</span>
  </body></html>`;

  it("counts labeled fields captured in the transform JSON, excluding static chrome", () => {
    const coverage = scoreLabeledFieldCoverage(
      html,
      ["#ctl00_cphBody_lblRealEstateNumber"],
      JSON.stringify({ subdivision: "RIVERSIDE", property_usage_type: "0100 SINGLE FAMILY" }),
    );
    expect(coverage.onPage).toBe(2);
    expect(coverage.inTransform).toBe(2);
    expect(coverage.ratio).toBe(1);
    expect(coverage.missing).toEqual([]);
  });

  it("reports a missing label when it never made it into the transform JSON", () => {
    const coverage = scoreLabeledFieldCoverage(html, ["#ctl00_cphBody_lblRealEstateNumber"], JSON.stringify({}));
    expect(coverage.onPage).toBe(2);
    expect(coverage.inTransform).toBe(0);
    expect(coverage.ratio).toBe(0);
    expect(coverage.missing).toEqual(["0100 SINGLE FAMILY", "RIVERSIDE"]);
  });
});

describe("classifyValidationGap", () => {
  it("classifies lexicon/schema failures", () => {
    expect(classifyValidationGap("must be equal to one of the allowed values (enum)")).toBe("lexicon");
    expect(classifyValidationGap("missing required property 'foo'")).toBe("lexicon");
  });

  it("classifies capture failures", () => {
    expect(classifyValidationGap("labeled field is absent from json")).toBe("capture");
  });

  it("falls back to extractor for anything else", () => {
    expect(classifyValidationGap("unexpected TypeError in mapping")).toBe("extractor");
  });
});

describe("assertManifestReconciled (Global Constraint)", () => {
  it("passes when seed = success + permanent_failure + retryable_failure", () => {
    expect(() =>
      assertManifestReconciled({ seedRows: 3, success: 1, permanentFailure: 1, retryableFailure: 1 }),
    ).not.toThrow();
  });

  it("fails closed on any mismatch", () => {
    expect(() =>
      assertManifestReconciled({ seedRows: 3, success: 1, permanentFailure: 1, retryableFailure: 0 }),
    ).toThrow(/manifest seedRows/);
  });
});

describe("assertUniqueParcelIds (Global Constraint)", () => {
  it("passes for distinct parcel ids", () => {
    expect(() => assertUniqueParcelIds([{ parcelId: "a" }, { parcelId: "b" }])).not.toThrow();
  });

  it("fails closed on a duplicate parcel id", () => {
    expect(() => assertUniqueParcelIds([{ parcelId: "a" }, { parcelId: "a" }])).toThrow(/duplicate parcelId/);
  });
});
