import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { Db } from "./db";

/**
 * Run-once migrations. Replaces the old "apply schema.sql on every request".
 *
 * Files in db/migrations/*.sql run in name order; each is recorded in
 * schema_migrations and never re-run. Statements are still written
 * idempotently (IF NOT EXISTS / guarded UPDATEs) so an interrupted run can
 * resume safely. On hosted Postgres an advisory lock keeps concurrent cold
 * starts from migrating twice; the first instance does the work, the rest
 * wait and see an up-to-date version table.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");
const ADVISORY_LOCK_KEY = 727_501;

export async function runMigrations(db: Db): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  if (db.driver === "postgres") {
    await db.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
  }
  try {
    const applied = new Set(
      (await db.query<{ version: string }>("SELECT version FROM schema_migrations")).map(
        (row) => row.version,
      ),
    );
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      await db.exec(sql);
      await db.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
    }
  } finally {
    if (db.driver === "postgres") {
      await db.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    }
  }
}
