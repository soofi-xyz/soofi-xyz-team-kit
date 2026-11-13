export const MEALS = ["breakfast", "lunch", "dinner", "snack", "drink"] as const;
export type Meal = (typeof MEALS)[number];
export const KINDS = ["food", "drink"] as const;
export type Kind = (typeof KINDS)[number];

export const MEAL_LABEL: Record<Meal, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
  drink: "Drink",
};

export const TRACKER_NOTE =
  "Starter portions are rounded from USDA FoodData Central. The whey scoop is a common 30 g label, and brands differ. Aleyna's goals are no more than 1,500 kcal and at least 170 g protein. Soofi's goals are no more than 2,200 kcal and at least 200 g protein. This page adds up what you log. It does not replace advice from your own clinician.";

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Person = {
  id: string;
  slug: string;
  name: string;
  calorieTarget: number;
  proteinTarget: number;
};

export type Staple = {
  id: string;
  name: string;
  kind: Kind;
  meal: Meal;
  calories: number;
  protein: number;
  sourceNote: string;
};

export type Entry = {
  id: string;
  personId: string;
  date: string;
  meal: Meal;
  kind: Kind;
  name: string;
  calories: number;
  protein: number;
  servings: number;
};

export type DailyTotal = {
  id: string;
  personId: string;
  date: string;
  calories: number;
  protein: number;
};

export type Board = {
  date: string;
  people: Person[];
  staples: Staple[];
  entries: Entry[];
  dailyTotals: DailyTotal[];
};

export type AddInput = {
  personId: string;
  date: string;
  meal: Meal;
  kind: Kind;
  name: string;
  calories: number;
  protein: number;
  servings: number;
  saveStaple: boolean;
};

export type CopyInput = {
  personId: string;
  from: string;
  to: string;
};

export type EntryPatch = {
  id: string;
  personId?: string;
  meal?: Meal;
  kind?: Kind;
  name?: string;
  calories?: number;
  protein?: number;
  servings?: number;
};

export type StapleInput = {
  name: string;
  meal: Meal;
  kind: Kind;
  calories: number;
  protein: number;
};

export type PersonPatch = {
  id: string;
  name: string;
  calorieTarget: number;
  proteinTarget: number;
};

export type DailyTotalInput = {
  personId: string;
  date: string;
  calories: number;
  protein: number;
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

export function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return Number.NaN;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isMeal(value: unknown): value is Meal {
  return typeof value === "string" && (MEALS as readonly string[]).includes(value);
}

export function isKind(value: unknown): value is Kind {
  return value === "food" || value === "drink";
}

export function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 2020 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return value;
}

export function parseId(value: unknown): string | null {
  return typeof value === "string" && ID_RE.test(value) ? value : null;
}

export function shiftDate(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatLongDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function weekdayShort(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
}

export function dayNumber(iso: string): string {
  return String(Number(iso.slice(8, 10)));
}

export function mealForHour(hour: number): Meal {
  if (hour >= 5 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 15) return "lunch";
  if (hour >= 17 && hour < 22) return "dinner";
  return "snack";
}

export function formatProtein(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatKcal(value: number): string {
  return `${Math.round(value).toLocaleString("en-US")} kcal`;
}

export function formatServings(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function lineTotals(
  calories: number,
  protein: number,
  servings: number,
): { calories: number; protein: number } {
  return {
    calories: Math.round(calories * servings),
    protein: Math.round(protein * servings * 10) / 10,
  };
}

export function sumEntries(entries: { calories: number; protein: number; servings: number }[]): {
  calories: number;
  protein: number;
} {
  return entries.reduce(
    (total, entry) => {
      const line = lineTotals(entry.calories, entry.protein, entry.servings);
      return {
        calories: total.calories + line.calories,
        protein: Math.round((total.protein + line.protein) * 10) / 10,
      };
    },
    { calories: 0, protein: 0 },
  );
}

export function effectiveTotals(
  entries: Entry[],
  dailyTotals: DailyTotal[],
  personId: string,
  date: string,
): { calories: number; protein: number; manual: boolean } {
  const manual = dailyTotals.find((total) => total.personId === personId && total.date === date);
  if (manual) {
    return { calories: manual.calories, protein: manual.protein, manual: true };
  }
  return {
    ...sumEntries(entries.filter((entry) => entry.personId === personId && entry.date === date)),
    manual: false,
  };
}

export function dailyRead(input: {
  name: string;
  calories: number;
  calorieTarget: number;
  protein: number;
  proteinTarget: number;
  staples: { name: string; calories: number; protein: number }[];
  loggedCount: number;
}): { headline: string; detail: string } {
  if (input.loggedCount === 0) {
    return {
      headline: `${input.name} has nothing logged for this day.`,
      detail: "Tap a staple to add its calories and protein to the selected meal.",
    };
  }

  const calLeft = input.calorieTarget - input.calories;
  const proLeft = Math.round((input.proteinTarget - input.protein) * 10) / 10;
  const proteinStaples = input.staples.filter((staple) => staple.protein > 0 && staple.calories > 0);
  const fitting = proteinStaples
    .filter((staple) => staple.calories <= Math.max(calLeft, 0))
    .sort((a, b) => b.protein / b.calories - a.protein / a.calories);
  const richest = [...proteinStaples].sort((a, b) => b.protein - a.protein)[0];

  if (proLeft <= 0 && calLeft > 0) {
    return {
      headline: `${input.name} has met the protein target with ${formatKcal(calLeft)} still open.`,
      detail: `${formatProtein(input.protein)} g protein logged. Calorie total is ${formatKcal(input.calories)}.`,
    };
  }
  if (proLeft <= 0 && calLeft === 0) {
    return {
      headline: `${input.name} has met both targets.`,
      detail: `${formatKcal(input.calories)} and ${formatProtein(input.protein)} g protein.`,
    };
  }
  if (proLeft <= 0 && calLeft < 0) {
    return {
      headline: `${input.name} has met the protein target and is ${formatKcal(-calLeft)} over on calories.`,
      detail: `${formatProtein(input.protein)} g protein logged. Calorie total is ${formatKcal(input.calories)}.`,
    };
  }
  if (calLeft < 0) {
    return {
      headline: `${input.name} is ${formatProtein(proLeft)} g short on protein and ${formatKcal(-calLeft)} over on calories.`,
      detail: "The calorie target is already past, so another full staple would add more calories.",
    };
  }
  if (calLeft === 0) {
    return {
      headline: `${input.name} is ${formatProtein(proLeft)} g short on protein and the calorie target is met.`,
      detail: "The calorie target is met, so another full staple would add more calories.",
    };
  }

  const best = fitting[0];
  if (!best) {
    return {
      headline: `${input.name} is ${formatProtein(proLeft)} g short on protein with ${formatKcal(calLeft)} left.`,
      detail: "None of the saved staples fit in the calories that are left. Add a smaller portion, or save a new staple.",
    };
  }

  let detail = `${best.name} still fits and adds ${formatProtein(best.protein)} g protein for ${formatKcal(best.calories)}.`;
  if (best.protein < 8 && proLeft > 15 && richest && richest.name !== best.name) {
    detail = `${best.name} fits in the calories left and adds ${formatProtein(best.protein)} g protein. ${richest.name} adds ${formatProtein(richest.protein)} g and costs ${formatKcal(richest.calories)}.`;
  }
  return {
    headline: `${input.name} is ${formatProtein(proLeft)} g short on protein with ${formatKcal(calLeft)} left.`,
    detail,
  };
}

export function dayAsText(input: {
  name: string;
  dateLabel: string;
  calories: number;
  calorieTarget: number;
  protein: number;
  proteinTarget: number;
  groups: { meal: Meal; lines: { name: string; servings: number; calories: number; protein: number }[] }[];
}): string {
  const lines = [
    `${input.name} — ${input.dateLabel}`,
    `Calories: ${Math.round(input.calories).toLocaleString("en-US")} / ${Math.round(input.calorieTarget).toLocaleString("en-US")}`,
    `Protein: ${formatProtein(input.protein)} g / ${formatProtein(input.proteinTarget)} g`,
    "",
  ];
  for (const group of input.groups) {
    lines.push(MEAL_LABEL[group.meal]);
    if (group.lines.length === 0) {
      lines.push("- (nothing logged)");
    } else {
      for (const line of group.lines) {
        lines.push(
          `- ${line.name} × ${formatServings(line.servings)} — ${Math.round(line.calories).toLocaleString("en-US")} kcal, ${formatProtein(line.protein)} g protein`,
        );
      }
    }
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

function fail(error: string): ParseResult<never> {
  return { ok: false, error };
}

function cleanName(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, " ");
  if (name.length === 0 || name.length > limit) return null;
  return name;
}

function caloriesOf(value: unknown): number | null {
  const n = asNumber(value);
  if (!Number.isFinite(n)) return null;
  const calories = Math.round(n);
  if (calories < 0 || calories > 8000) return null;
  return calories;
}

function proteinOf(value: unknown): number | null {
  const n = asNumber(value);
  if (!Number.isFinite(n)) return null;
  const protein = Math.round(n * 10) / 10;
  if (protein < 0 || protein > 500) return null;
  return protein;
}

function servingsOf(value: unknown): number | null {
  const n = asNumber(value);
  if (!Number.isFinite(n)) return null;
  const servings = Math.round(n * 100) / 100;
  if (servings < 0.25 || servings > 10) return null;
  return servings;
}

export function parseAdd(body: unknown): ParseResult<AddInput> {
  if (!isRecord(body)) return fail("Expected an item.");
  const personId = parseId(body.personId);
  const date = parseDate(body.date);
  const name = cleanName(body.name, 80);
  const calories = caloriesOf(body.calories);
  const protein = proteinOf(body.protein);
  const servings = servingsOf(body.servings ?? 1);
  if (!personId) return fail("Choose a person.");
  if (!date) return fail("Choose a valid day.");
  if (!isMeal(body.meal)) return fail("Choose a meal.");
  if (!isKind(body.kind)) return fail("Choose food or drink.");
  if (!name) return fail("Enter a name up to 80 characters.");
  if (calories === null) return fail("Enter calories from 0 to 8,000.");
  if (protein === null) return fail("Enter protein grams from 0 to 500.");
  if (servings === null) return fail("Enter servings from 0.25 to 10.");
  return {
    ok: true,
    value: {
      personId,
      date,
      meal: body.meal,
      kind: body.kind,
      name,
      calories,
      protein,
      servings,
      saveStaple: body.saveStaple === true,
    },
  };
}

export function parseCopy(body: unknown): ParseResult<CopyInput> {
  if (!isRecord(body)) return fail("Expected a day to copy.");
  const personId = parseId(body.personId);
  const from = parseDate(body.from);
  const to = parseDate(body.to);
  if (!personId) return fail("Choose a person.");
  if (!from || !to) return fail("Choose a valid day.");
  if (from === to) return fail("Choose a different day to copy.");
  return { ok: true, value: { personId, from, to } };
}

export function parseEntryPatch(body: unknown): ParseResult<EntryPatch> {
  if (!isRecord(body)) return fail("Expected an item.");
  const id = parseId(body.id);
  if (!id) return fail("That item could not be found.");
  const patch: EntryPatch = { id };
  if (body.personId !== undefined) {
    const personId = parseId(body.personId);
    if (!personId) return fail("Choose a person.");
    patch.personId = personId;
  }
  if (body.meal !== undefined) {
    if (!isMeal(body.meal)) return fail("Choose a meal.");
    patch.meal = body.meal;
  }
  if (body.kind !== undefined) {
    if (!isKind(body.kind)) return fail("Choose food or drink.");
    patch.kind = body.kind;
  }
  if (body.name !== undefined) {
    const name = cleanName(body.name, 80);
    if (!name) return fail("Enter a name up to 80 characters.");
    patch.name = name;
  }
  if (body.calories !== undefined) {
    const calories = caloriesOf(body.calories);
    if (calories === null) return fail("Enter calories from 0 to 8,000.");
    patch.calories = calories;
  }
  if (body.protein !== undefined) {
    const protein = proteinOf(body.protein);
    if (protein === null) return fail("Enter protein grams from 0 to 500.");
    patch.protein = protein;
  }
  if (body.servings !== undefined) {
    const servings = servingsOf(body.servings);
    if (servings === null) return fail("Enter servings from 0.25 to 10.");
    patch.servings = servings;
  }
  if (Object.keys(patch).length === 1) return fail("Change something before saving.");
  return { ok: true, value: patch };
}

export function parseStaple(body: unknown): ParseResult<StapleInput> {
  if (!isRecord(body)) return fail("Expected a staple.");
  const name = cleanName(body.name, 80);
  const calories = caloriesOf(body.calories);
  const protein = proteinOf(body.protein);
  if (!name) return fail("Enter a name up to 80 characters.");
  if (!isMeal(body.meal)) return fail("Choose a meal.");
  if (!isKind(body.kind)) return fail("Choose food or drink.");
  if (calories === null) return fail("Enter calories from 0 to 8,000.");
  if (protein === null) return fail("Enter protein grams from 0 to 500.");
  return { ok: true, value: { name, meal: body.meal, kind: body.kind, calories, protein } };
}

export function parsePerson(body: unknown): ParseResult<PersonPatch> {
  if (!isRecord(body)) return fail("Expected a person.");
  const id = parseId(body.id);
  const name = cleanName(body.name, 40);
  const calorieTarget = caloriesOf(body.calorieTarget);
  const proteinRaw = proteinOf(body.proteinTarget);
  const proteinTarget = proteinRaw === null ? null : Math.round(proteinRaw);
  if (!id) return fail("Choose a person.");
  if (!name) return fail("Enter a name up to 40 characters.");
  if (calorieTarget === null || calorieTarget < 1) return fail("Enter a calorie target from 1 to 8,000.");
  if (proteinTarget === null || proteinTarget > 400) return fail("Enter a protein target from 0 to 400 g.");
  return {
    ok: true,
    value: { id, name, calorieTarget, proteinTarget },
  };
}

export function parseDailyTotal(body: unknown): ParseResult<DailyTotalInput> {
  if (!isRecord(body)) return fail("Expected a daily total.");
  const personId = parseId(body.personId);
  const date = parseDate(body.date);
  const calories = caloriesOf(body.calories);
  const protein = proteinOf(body.protein);
  if (!personId) return fail("Choose a person.");
  if (!date) return fail("Choose a valid day.");
  if (calories === null) return fail("Enter calories from 0 to 8,000.");
  if (protein === null) return fail("Enter protein grams from 0 to 500.");
  return { ok: true, value: { personId, date, calories, protein } };
}
