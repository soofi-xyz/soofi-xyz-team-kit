import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STARTER_PEOPLE, STARTER_STAPLES } from "./catalog";
import {
  dailyRead,
  dayAsText,
  formatLongDate,
  lineTotals,
  parseAdd,
  parsePerson,
  shiftDate,
  sumEntries,
} from "./food";

const personId = "11111111-1111-4111-8111-111111111111";

describe("dates and totals", () => {
  it("formats 10 November 2026 as a Tuesday", () => {
    assert.equal(formatLongDate("2026-11-10"), "Tuesday, November 10, 2026");
  });

  it("shifts across month boundaries", () => {
    assert.equal(shiftDate("2026-11-10", -10), "2026-10-31");
    assert.equal(shiftDate("2026-11-10", 25), "2026-12-05");
  });

  it("rounds each line before summing protein", () => {
    assert.deepEqual(lineTotals(100, 17.3, 0.5), { calories: 50, protein: 8.7 });
    assert.deepEqual(
      sumEntries([
        { calories: 144, protein: 12.6, servings: 1 },
        { calories: 100, protein: 17.3, servings: 0.5 },
      ]),
      { calories: 194, protein: 21.3 },
    );
  });
});

describe("daily read", () => {
  const staples = [
    { name: "Banana, medium", calories: 105, protein: 1.3 },
    { name: "Greek yogurt, plain nonfat, 170 g", calories: 100, protein: 17.3 },
    { name: "Chicken breast, cooked, 4 oz", calories: 187, protein: 35 },
  ];

  it("asks for a staple when the day is empty", () => {
    const read = dailyRead({
      name: "Aleyna",
      calories: 0,
      calorieTarget: 2000,
      protein: 0,
      proteinTarget: 120,
      staples,
      loggedCount: 0,
    });
    assert.match(read.headline, /nothing logged/);
  });

  it("names the densest staple that still fits", () => {
    const read = dailyRead({
      name: "Aleyna",
      calories: 1800,
      calorieTarget: 2000,
      protein: 80,
      proteinTarget: 120,
      staples,
      loggedCount: 2,
    });
    assert.match(read.headline, /40 g short/);
    assert.match(read.detail, /Chicken breast/);
  });

  it("offers a richer staple when the fitting one is low in protein", () => {
    const read = dailyRead({
      name: "Soofi",
      calories: 1890,
      calorieTarget: 2000,
      protein: 90,
      proteinTarget: 120,
      staples: [staples[0], staples[2]],
      loggedCount: 3,
    });
    assert.match(read.detail, /Banana, medium/);
    assert.match(read.detail, /Chicken breast/);
  });

  it("states both targets when the numbers land on them", () => {
    const read = dailyRead({
      name: "Aleyna",
      calories: 2000,
      calorieTarget: 2000,
      protein: 120,
      proteinTarget: 120,
      staples,
      loggedCount: 4,
    });
    assert.equal(read.headline, "Aleyna has met both targets.");
  });

  it("keeps protein and calorie news in one line when calories are over", () => {
    const read = dailyRead({
      name: "Soofi",
      calories: 2200,
      calorieTarget: 2000,
      protein: 80,
      proteinTarget: 120,
      staples,
      loggedCount: 4,
    });
    assert.match(read.headline, /40 g short/);
    assert.match(read.headline, /200 kcal over/);
  });
});

describe("day text", () => {
  it("keeps an empty meal in the copied template", () => {
    const text = dayAsText({
      name: "Aleyna",
      dateLabel: "Tuesday, November 10, 2026",
      calories: 144,
      calorieTarget: 2000,
      protein: 12.6,
      proteinTarget: 120,
      groups: [
        { meal: "breakfast", lines: [{ name: "Eggs, 2 large", servings: 1, calories: 144, protein: 12.6 }] },
        { meal: "lunch", lines: [] },
      ],
    });
    assert.match(text, /Eggs, 2 large × 1 — 144 kcal, 12.6 g protein/);
    assert.match(text, /Lunch\n- \(nothing logged\)/);
  });
});

describe("parsers", () => {
  it("rounds calories and protein on the way in", () => {
    const parsed = parseAdd({
      personId,
      date: "2026-11-10",
      meal: "lunch",
      kind: "food",
      name: "  Rice   bowl ",
      calories: 206.2,
      protein: 4.26,
      servings: 1,
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.name, "Rice bowl");
    assert.equal(parsed.value.calories, 206);
    assert.equal(parsed.value.protein, 4.3);
  });

  it("rejects a calorie target of zero", () => {
    const parsed = parsePerson({ id: personId, name: "Aleyna", calorieTarget: 0, proteinTarget: 120 });
    assert.equal(parsed.ok, false);
  });
});

describe("starter catalog", () => {
  it("fits the database limits and keeps each person's goals", () => {
    assert.deepEqual(
      STARTER_PEOPLE.map(({ slug, calorieTarget, proteinTarget }) => ({
        slug,
        calorieTarget,
        proteinTarget,
      })),
      [
        { slug: "aleyna", calorieTarget: 1500, proteinTarget: 170 },
        { slug: "soofi", calorieTarget: 2200, proteinTarget: 200 },
      ],
    );
    const names = new Set<string>();
    for (const staple of STARTER_STAPLES) {
      assert.equal(names.has(staple.name.toLowerCase()), false);
      names.add(staple.name.toLowerCase());
      assert.ok(staple.name.length <= 80);
      assert.ok(staple.sourceNote.length <= 200);
      assert.ok(staple.calories >= 0 && staple.calories <= 8000);
      assert.ok(staple.protein >= 0 && staple.protein <= 500);
    }
  });
});
