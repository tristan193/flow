import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * One query interface over two Postgres drivers.
 *
 * Production sets DATABASE_URL and talks to hosted Postgres over TCP. Local
 * development uses in-memory PGlite (Postgres compiled to WebAssembly). Both
 * speak the same dialect and take the same $1/$2 placeholders.
 *
 * Local data is in-memory on purpose: PGlite's on-disk mode has been unreliable
 * under Windows + OneDrive setups. Restarting the dev server re-seeds from
 * db/seed-data.json. Hosted deploys use DATABASE_URL and keep data for real.
 */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  exec(text: string): Promise<void>;
  readonly driver: "postgres" | "pglite";
}

async function createPglite(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = await PGlite.create();
  return {
    driver: "pglite",
    async query<T>(text: string, params: unknown[] = []) {
      const result = await pg.query(text, params);
      return result.rows as T[];
    },
    async exec(text: string) {
      await pg.exec(text);
    },
  };
}

async function createPostgres(url: string): Promise<Db> {
  const { default: postgres } = await import("postgres");
  // prepare:false keeps this compatible with connection poolers, which most
  // hosted Postgres providers put in front of the database.
  const sql = postgres(url, { max: 3, idle_timeout: 20, prepare: false });
  return {
    driver: "postgres",
    async query<T>(text: string, params: unknown[] = []) {
      return (await sql.unsafe(text, params as never[])) as unknown as T[];
    },
    async exec(text: string) {
      await sql.unsafe(text);
    },
  };
}

// Next.js reloads modules on every edit in development. Caching the connection
// on globalThis keeps that from opening a new database handle each time.
const globalForDb = globalThis as unknown as { __flowDb?: Promise<Db> };

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL?.trim();
  const db = url ? await createPostgres(url) : await createPglite();
  // Schema is multi-statement; query() rejects that, exec() does not.
  await db.exec(readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8"));
  return db;
}

export function getDb(): Promise<Db> {
  if (!globalForDb.__flowDb) {
    globalForDb.__flowDb = connect().catch((error) => {
      globalForDb.__flowDb = undefined;
      throw error;
    });
  }
  return globalForDb.__flowDb;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const db = await getDb();
  return db.query<T>(text, params);
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
