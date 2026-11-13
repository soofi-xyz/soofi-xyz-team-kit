import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

pg.types.setTypeParser(1082, (value) => value);

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
let pool: pg.Pool | undefined;

type LocalState = { local?: Promise<PGlite>; chain: Promise<void> };
const localState: LocalState = ((globalThis as { __dailyPlate?: LocalState }).__dailyPlate ??= {
  chain: Promise.resolve(),
});

function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
    pool.on("error", () => {
      console.error("database pool error");
    });
  }
  return pool;
}

export type Query = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = localState.chain.then(fn);
  localState.chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  if (databaseUrl !== "") {
    return (await getPool().query(text, params)).rows as T[];
  }
  return enqueue(async () => {
    const db = await localDb();
    return (await db.query<T>(text, params)).rows;
  });
}

export async function withTx<T>(fn: (query: Query) => Promise<T>): Promise<T> {
  if (databaseUrl !== "") {
    const client = await getPool().connect();
    const query: Query = async (text, params = []) => (await client.query(text, params)).rows as never[];
    try {
      await client.query("begin");
      const result = await fn(query);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  return enqueue(async () => {
    const db = await localDb();
    const query: Query = async <T,>(text: string, params: unknown[] = []) =>
      (await db.query(text, params)).rows as T[];
    await db.query("begin");
    try {
      const result = await fn(query);
      await db.query("commit");
      return result;
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  });
}

async function localDb(): Promise<PGlite> {
  localState.local ??= startLocal().catch((error: unknown) => {
    localState.local = undefined;
    throw error;
  });
  return localState.local;
}

async function startLocal(): Promise<PGlite> {
  const db = new PGlite();
  const directory = path.join(process.cwd(), "migrations");
  const files = (await readdir(directory).catch(() => [])).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    await db.exec(await readFile(path.join(directory, file), "utf8"));
  }
  return db;
}
