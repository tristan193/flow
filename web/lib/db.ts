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
export type QueryFn = <T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<T[]>;

/** Query function plus a driver savepoint. Raw SAVEPOINT SQL is not enough on postgres.js. */
export type TxQuery = QueryFn & {
  savepoint<T>(fn: (q: TxQuery) => Promise<T>): Promise<T>;
};

export interface Db {
  query: QueryFn;
  exec(text: string): Promise<void>;
  withTransaction<T>(fn: (q: TxQuery) => Promise<T>): Promise<T>;
  readonly driver: "postgres" | "pglite";
}

function looksLikeUniqueViolation(error: object): boolean {
  const rec = error as { code?: unknown; message?: unknown; constraint_name?: unknown };
  if (String(rec.code ?? "") === "23505") return true;
  const constraint = String(rec.constraint_name ?? "").toLowerCase();
  const msg = String(rec.message ?? "").toLowerCase();
  if (constraint && (msg.includes("unique") || msg.includes("duplicate"))) return true;
  return msg.includes("unique") && (msg.includes("duplicate") || msg.includes("constraint"));
}

/**
 * Postgres unique_violation (23505). Walks `.cause` / `.error` / `.errors`
 * because some drivers wrap the PostgresError before it reaches the catch.
 */
export function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  const pending: unknown[] = [error];
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (looksLikeUniqueViolation(current)) return true;
    const rec = current as { cause?: unknown; error?: unknown; errors?: unknown };
    if (rec.cause) pending.push(rec.cause);
    if (rec.error) pending.push(rec.error);
    if (Array.isArray(rec.errors)) pending.push(...rec.errors);
  }
  return false;
}

function bindQuery(run: QueryFn): QueryFn {
  return async <T>(text: string, params: unknown[] = []) => run<T>(text, params);
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
    async withTransaction<T>(fn: (q: TxQuery) => Promise<T>): Promise<T> {
      return pg.transaction(async (tx) => {
        let seq = 0;
        const q = bindQuery(async <R>(text: string, params: unknown[] = []) => {
          const result = await tx.query(text, params);
          return result.rows as R[];
        }) as TxQuery;
        // PGlite has no uncaught-error flag. SQL SAVEPOINT is enough if we
        // roll back to it before the next statement.
        q.savepoint = async (inner) => {
          const name = `flow_sp_${++seq}`;
          await tx.query(`SAVEPOINT ${name}`);
          try {
            const result = await inner(q);
            await tx.query(`RELEASE SAVEPOINT ${name}`);
            return result;
          } catch (error) {
            try {
              await tx.query(`ROLLBACK TO SAVEPOINT ${name}`);
            } catch {
              // already aborted
            }
            throw error;
          }
        };
        return fn(q);
      });
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
    async withTransaction<T>(fn: (q: TxQuery) => Promise<T>): Promise<T> {
      // postgres.js begin() remembers every rejected query on that scope and
      // rethrows it after the callback, then ROLLBACKs the whole transaction.
      // A catch around raw SAVEPOINT SQL therefore still 500s. savepoint()
      // keeps the failure on an inner scope so the outer transaction can commit.
      return sql.begin(async (tx) => fn(bindPostgresTx(tx as PgRunner))) as Promise<T>;
    },
  };
}

// Next.js reloads modules on every edit in development. Caching the connection
// on globalThis keeps that from opening a new database handle each time.
const globalForDb = globalThis as unknown as { __flowDb?: Promise<Db> };

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL?.trim();
  const db = url ? await createPostgres(url) : await createPglite();
  // Run-once migrations (schema_migrations). Replaces the old per-request
  // applySchema — after this, requests never execute DDL.
  const { runMigrations } = await import("./migrations");
  await runMigrations(db);
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

interface PgRunner {
  unsafe(text: string, params?: unknown[]): Promise<unknown>;
  savepoint<T>(fn: (tx: PgRunner) => Promise<T>): Promise<T>;
}

function bindPostgresTx(runner: PgRunner): TxQuery {
  const q = bindQuery(async <R>(text: string, params: unknown[] = []) => {
    return (await runner.unsafe(text, params)) as R[];
  }) as TxQuery;
  q.savepoint = (inner) => runner.savepoint(async (sp) => inner(bindPostgresTx(sp)));
  return q;
}

export async function withTransaction<T>(fn: (q: TxQuery) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.withTransaction(fn);
}
