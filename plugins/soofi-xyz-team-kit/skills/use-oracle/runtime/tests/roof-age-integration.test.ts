import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  compileRoofAgeProfile,
  estimateRoofAge,
  roofAgeEstimateSchema,
  roofAgeEstimatorInputSchema,
  roofAgeProfileSchema,
} from "../src/roof-age/estimator.js";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "fixtures",
  "roof-age-estimator",
  "runtime-integration.json",
);

describe("roof-age runtime integration contract", () => {
  it("maps profile-owned source vocabulary and emits the versioned product contract", async () => {
    const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8")) as {
      profile: unknown;
      input: unknown;
      expected: Record<string, unknown> & {
        policy: Record<string, unknown>;
      };
    };
    const profile = compileRoofAgeProfile(
      roofAgeProfileSchema.parse(fixture.profile),
    );
    const result = estimateRoofAge(
      roofAgeEstimatorInputSchema.parse(fixture.input),
      profile,
    );
    const expected = structuredClone(fixture.expected);
    expected.policy.profileSha256 = profile.sha256;

    expect(result).toStrictEqual(expected);
    expect(roofAgeEstimateSchema.parse(result)).toStrictEqual(result);
  });
});
