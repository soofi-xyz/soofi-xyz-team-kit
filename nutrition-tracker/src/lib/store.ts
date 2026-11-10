import "server-only";
import { STARTER_PEOPLE, STARTER_STAPLES } from "./catalog";
import { sql, withTx, type Query } from "./db";
import {
  InputError,
  asNumber,
  isKind,
  isMeal,
  type AddInput,
  type Board,
  type CopyInput,
  type Entry,
  type EntryPatch,
  type Person,
  type PersonPatch,
  type Staple,
  type StapleInput,
} from "./food";

type PersonRow = {
  id: string;
  slug: string;
  display_name: string;
  calorie_target: number;
  protein_target_g: number;
};

type StapleRow = {
  id: string;
  name: string;
  kind: string;
  meal: string;
  calories: number;
  protein_g: unknown;
  source_note: string;
};

type EntryRow = {
  id: string;
  person_id: string;
  eaten_on: string;
  meal: string;
  kind: string;
  name: string;
  calories: number;
  protein_g: unknown;
  servings: unknown;
};

const ENTRY_CAP = 80;
const STAPLE_CAP = 80;

function mapPerson(row: PersonRow): Person {
  return {
    id: row.id,
    slug: row.slug,
    name: row.display_name,
    calorieTarget: asNumber(row.calorie_target),
    proteinTarget: asNumber(row.protein_target_g),
  };
}

function mapStaple(row: StapleRow): Staple {
  if (!isMeal(row.meal) || !isKind(row.kind)) {
    throw new InputError("A saved staple is unreadable.");
  }
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    meal: row.meal,
    calories: asNumber(row.calories),
    protein: Math.round(asNumber(row.protein_g) * 10) / 10,
    sourceNote: row.source_note,
  };
}

function mapEntry(row: EntryRow): Entry {
  if (!isMeal(row.meal) || !isKind(row.kind)) {
    throw new InputError("A logged item is unreadable.");
  }
  return {
    id: row.id,
    personId: row.person_id,
    date: String(row.eaten_on).slice(0, 10),
    meal: row.meal,
    kind: row.kind,
    name: row.name,
    calories: asNumber(row.calories),
    protein: Math.round(asNumber(row.protein_g) * 10) / 10,
    servings: Math.round(asNumber(row.servings) * 100) / 100,
  };
}

function countOf(value: unknown): number {
  const count = asNumber(value);
  if (!Number.isFinite(count)) throw new InputError("Could not read the log.");
  return count;
}

function rethrow(error: unknown): never {
  if (error instanceof InputError) throw error;
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  if (code === "23514") throw new InputError("That number is outside the range this log accepts.");
  if (code === "23503") throw new InputError("That person is not on this log.");
  throw error;
}

async function personExists(query: Query, householdId: string, personId: string): Promise<void> {
  const rows = await query<{ id: string }>("select id from people where id = $1 and household_id = $2", [
    personId,
    householdId,
  ]);
  if (rows.length === 0) throw new InputError("That person is not on this log.");
}

async function stapleNameTaken(query: Query, householdId: string, name: string, exceptId?: string): Promise<void> {
  const rows = await query<{ id: string }>(
    "select id from staples where household_id = $1 and lower(name) = lower($2) and id <> $3",
    [householdId, name, exceptId ?? ""],
  );
  if (rows.length > 0) {
    throw new InputError("A staple with that name already exists. Rename it, or add the item without saving a staple.");
  }
}

export async function ensureHousehold(householdId: string): Promise<void> {
  await withTx(async (query) => {
    await query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [householdId]);
    const existing = await query<{ household_id: string }>(
      "select household_id from households where household_id = $1",
      [householdId],
    );
    if (existing.length > 0) return;
    await query("insert into households (household_id) values ($1)", [householdId]);
    for (const person of STARTER_PEOPLE) {
      await query(
        `insert into people (id, household_id, slug, display_name, calorie_target, protein_target_g, sort_order)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          crypto.randomUUID(),
          householdId,
          person.slug,
          person.name,
          person.calorieTarget,
          person.proteinTarget,
          person.sortOrder,
        ],
      );
    }
    for (const staple of STARTER_STAPLES) {
      await query(
        `insert into staples (id, household_id, name, kind, meal, calories, protein_g, source_note)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          crypto.randomUUID(),
          householdId,
          staple.name,
          staple.kind,
          staple.meal,
          staple.calories,
          staple.protein,
          staple.sourceNote,
        ],
      );
    }
  }).catch(rethrow);
}

export async function getBoard(householdId: string, date: string): Promise<Board> {
  await ensureHousehold(householdId);
  const people = (
    await sql<PersonRow>(
      `select id, slug, display_name, calorie_target, protein_target_g
       from people
       where household_id = $1
       order by sort_order asc, display_name asc`,
      [householdId],
    )
  ).map(mapPerson);
  const staples = (
    await sql<StapleRow>(
      `select id, name, kind, meal, calories, protein_g::float8 as protein_g, source_note
       from staples
       where household_id = $1
       order by name asc`,
      [householdId],
    )
  ).map(mapStaple);
  const entries = (
    await sql<EntryRow>(
      `select id, person_id, eaten_on::text as eaten_on, meal, kind, name, calories,
              protein_g::float8 as protein_g, servings::float8 as servings
       from entries
       where household_id = $1
         and eaten_on between $2::date - 6 and $2::date
       order by created_at asc, id asc`,
      [householdId, date],
    )
  ).map(mapEntry);
  return { date, people, staples, entries };
}

export async function addEntry(householdId: string, input: AddInput): Promise<void> {
  await withTx(async (query) => {
    await personExists(query, householdId, input.personId);
    const counts = await query<{ n: unknown }>(
      "select count(*)::int as n from entries where household_id = $1 and person_id = $2 and eaten_on = $3::date",
      [householdId, input.personId, input.date],
    );
    if (countOf(counts[0]?.n) >= ENTRY_CAP) {
      throw new InputError("This day already has 80 items. Remove one before adding another.");
    }
    await query(
      `insert into entries (id, household_id, person_id, eaten_on, meal, kind, name, calories, protein_g, servings)
       values ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10)`,
      [
        crypto.randomUUID(),
        householdId,
        input.personId,
        input.date,
        input.meal,
        input.kind,
        input.name,
        input.calories,
        input.protein,
        input.servings,
      ],
    );
    if (input.saveStaple) {
      await insertStaple(query, householdId, {
        name: input.name,
        meal: input.meal,
        kind: input.kind,
        calories: input.calories,
        protein: input.protein,
      });
    }
  }).catch(rethrow);
}

export async function copyDay(householdId: string, input: CopyInput): Promise<number> {
  try {
    return await withTx(async (query) => {
      await personExists(query, householdId, input.personId);
      const rows = await query<EntryRow>(
        `select id, person_id, eaten_on::text as eaten_on, meal, kind, name, calories,
                protein_g::float8 as protein_g, servings::float8 as servings
         from entries
         where household_id = $1 and person_id = $2 and eaten_on = $3::date
         order by created_at asc, id asc`,
        [householdId, input.personId, input.from],
      );
      if (rows.length === 0) throw new InputError("That day has nothing to copy.");
      const counts = await query<{ n: unknown }>(
        "select count(*)::int as n from entries where household_id = $1 and person_id = $2 and eaten_on = $3::date",
        [householdId, input.personId, input.to],
      );
      if (countOf(counts[0]?.n) + rows.length > ENTRY_CAP) {
        throw new InputError("Copying that day would pass 80 items. Remove a few items first.");
      }
      for (const row of rows) {
        const entry = mapEntry(row);
        await query(
          `insert into entries (id, household_id, person_id, eaten_on, meal, kind, name, calories, protein_g, servings)
           values ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10)`,
          [
            crypto.randomUUID(),
            householdId,
            input.personId,
            input.to,
            entry.meal,
            entry.kind,
            entry.name,
            entry.calories,
            entry.protein,
            entry.servings,
          ],
        );
      }
      return rows.length;
    });
  } catch (error) {
    rethrow(error);
  }
}

export async function updateEntry(householdId: string, patch: EntryPatch): Promise<void> {
  try {
    await withTx(async (query) => {
      const rows = await query<EntryRow>(
        `select id, person_id, eaten_on::text as eaten_on, meal, kind, name, calories,
                protein_g::float8 as protein_g, servings::float8 as servings
         from entries
         where id = $1 and household_id = $2`,
        [patch.id, householdId],
      );
      if (rows.length === 0) throw new InputError("That item is already gone.");
      const current = mapEntry(rows[0]);
      const next: Entry = {
        ...current,
        personId: patch.personId ?? current.personId,
        meal: patch.meal ?? current.meal,
        kind: patch.kind ?? current.kind,
        name: patch.name ?? current.name,
        calories: patch.calories ?? current.calories,
        protein: patch.protein ?? current.protein,
        servings: patch.servings ?? current.servings,
      };
      if (next.personId !== current.personId) {
        await personExists(query, householdId, next.personId);
        const counts = await query<{ n: unknown }>(
          "select count(*)::int as n from entries where household_id = $1 and person_id = $2 and eaten_on = $3::date",
          [householdId, next.personId, next.date],
        );
        if (countOf(counts[0]?.n) >= ENTRY_CAP) {
          throw new InputError("That person's day already has 80 items.");
        }
      }
      const updated = await query<{ id: string }>(
        `update entries
         set person_id = $3, meal = $4, kind = $5, name = $6, calories = $7, protein_g = $8, servings = $9
         where id = $1 and household_id = $2
         returning id`,
        [next.id, householdId, next.personId, next.meal, next.kind, next.name, next.calories, next.protein, next.servings],
      );
      if (updated.length === 0) throw new InputError("That item is already gone.");
    });
  } catch (error) {
    rethrow(error);
  }
}

export async function deleteEntry(householdId: string, id: string): Promise<void> {
  const rows = await sql<{ id: string }>("delete from entries where id = $1 and household_id = $2 returning id", [
    id,
    householdId,
  ]).catch(rethrow);
  if (rows.length === 0) throw new InputError("That item is already gone.");
}

async function insertStaple(query: Query, householdId: string, input: StapleInput, sourceNote = ""): Promise<void> {
  const counts = await query<{ n: unknown }>("select count(*)::int as n from staples where household_id = $1", [
    householdId,
  ]);
  if (countOf(counts[0]?.n) >= STAPLE_CAP) {
    throw new InputError("There are already 80 staples. Remove one before saving another.");
  }
  await stapleNameTaken(query, householdId, input.name);
  await query(
    `insert into staples (id, household_id, name, kind, meal, calories, protein_g, source_note)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [crypto.randomUUID(), householdId, input.name, input.kind, input.meal, input.calories, input.protein, sourceNote],
  );
}

export async function addStaple(householdId: string, input: StapleInput): Promise<void> {
  await withTx(async (query) => {
    await insertStaple(query, householdId, input);
  }).catch(rethrow);
}

export async function updateStaple(householdId: string, id: string, input: StapleInput): Promise<void> {
  await withTx(async (query) => {
    await stapleNameTaken(query, householdId, input.name, id);
    const rows = await query<{ id: string }>(
      `update staples
       set name = $3, kind = $4, meal = $5, calories = $6, protein_g = $7
       where id = $1 and household_id = $2
       returning id`,
      [id, householdId, input.name, input.kind, input.meal, input.calories, input.protein],
    );
    if (rows.length === 0) throw new InputError("That staple is already gone.");
  }).catch(rethrow);
}

export async function deleteStaple(householdId: string, id: string): Promise<void> {
  const rows = await sql<{ id: string }>("delete from staples where id = $1 and household_id = $2 returning id", [
    id,
    householdId,
  ]).catch(rethrow);
  if (rows.length === 0) throw new InputError("That staple is already gone.");
}

export async function updatePerson(householdId: string, patch: PersonPatch): Promise<void> {
  const rows = await sql<{ id: string }>(
    `update people
     set display_name = $3, calorie_target = $4, protein_target_g = $5
     where id = $1 and household_id = $2
     returning id`,
    [patch.id, householdId, patch.name, patch.calorieTarget, patch.proteinTarget],
  ).catch(rethrow);
  if (rows.length === 0) throw new InputError("That person is not on this log.");
}
