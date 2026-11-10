import type { Kind, Meal } from "./food";

export const STARTER_PEOPLE = [
  { slug: "aleyna", name: "Aleyna", calorieTarget: 2000, proteinTarget: 120, sortOrder: 0 },
  { slug: "soofi", name: "Soofi", calorieTarget: 2000, proteinTarget: 120, sortOrder: 1 },
] as const;

export type StapleSeed = {
  name: string;
  kind: Kind;
  meal: Meal;
  calories: number;
  protein: number;
  sourceNote: string;
};

/** Rounded typical portions. The whey row is a common label, not a USDA standard. */
export const STARTER_STAPLES: StapleSeed[] = [
  {
    name: "Eggs, 2 large",
    kind: "food",
    meal: "breakfast",
    calories: 144,
    protein: 12.6,
    sourceNote: "Rounded from USDA egg, whole, raw, large, times two.",
  },
  {
    name: "Oatmeal, 1 cup cooked",
    kind: "food",
    meal: "breakfast",
    calories: 166,
    protein: 6,
    sourceNote: "Rounded from USDA oats cooked with water, 1 cup.",
  },
  {
    name: "Greek yogurt, plain nonfat, 170 g",
    kind: "food",
    meal: "breakfast",
    calories: 100,
    protein: 17.3,
    sourceNote: "Rounded from USDA yogurt, Greek, plain, nonfat, 170 g.",
  },
  {
    name: "Banana, medium",
    kind: "food",
    meal: "snack",
    calories: 105,
    protein: 1.3,
    sourceNote: "Rounded from USDA banana, medium, about 118 g.",
  },
  {
    name: "Chicken breast, cooked, 4 oz",
    kind: "food",
    meal: "lunch",
    calories: 187,
    protein: 35,
    sourceNote: "Rounded from USDA chicken breast, roasted, meat only, 4 oz.",
  },
  {
    name: "White rice, cooked, 1 cup",
    kind: "food",
    meal: "lunch",
    calories: 206,
    protein: 4.3,
    sourceNote: "Rounded from USDA white rice, cooked, 1 cup.",
  },
  {
    name: "Salmon, cooked, 4 oz",
    kind: "food",
    meal: "dinner",
    calories: 233,
    protein: 25,
    sourceNote: "Rounded from USDA Atlantic salmon, cooked, dry heat, 4 oz.",
  },
  {
    name: "Cottage cheese, 2%, 1/2 cup",
    kind: "food",
    meal: "snack",
    calories: 90,
    protein: 12,
    sourceNote: "Rounded from USDA cottage cheese, 2% milkfat, 1/2 cup.",
  },
  {
    name: "Peanut butter, 2 tbsp",
    kind: "food",
    meal: "snack",
    calories: 188,
    protein: 7,
    sourceNote: "Rounded from USDA peanut butter, smooth, 2 tbsp.",
  },
  {
    name: "Almonds, 1 oz",
    kind: "food",
    meal: "snack",
    calories: 164,
    protein: 6,
    sourceNote: "Rounded from USDA almonds, 1 oz.",
  },
  {
    name: "Whey protein, 1 scoop",
    kind: "food",
    meal: "snack",
    calories: 120,
    protein: 24,
    sourceNote: "Common 30 g whey label, about 120 kcal and 24 g protein. Brands differ.",
  },
  {
    name: "Black coffee, 8 fl oz",
    kind: "drink",
    meal: "drink",
    calories: 2,
    protein: 0.3,
    sourceNote: "Rounded from USDA coffee, brewed, 8 fl oz.",
  },
  {
    name: "Whole milk, 1 cup",
    kind: "drink",
    meal: "drink",
    calories: 149,
    protein: 8,
    sourceNote: "Rounded from USDA milk, whole, 1 cup.",
  },
  {
    name: "Orange juice, 8 fl oz",
    kind: "drink",
    meal: "drink",
    calories: 112,
    protein: 1.7,
    sourceNote: "Rounded from USDA orange juice, raw, 8 fl oz.",
  },
  {
    name: "Sparkling water, 12 fl oz",
    kind: "drink",
    meal: "drink",
    calories: 0,
    protein: 0,
    sourceNote: "Unsweetened sparkling water, 12 fl oz.",
  },
];
