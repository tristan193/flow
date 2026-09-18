import { getDb } from "./db";
import { seedIfEmpty } from "./import";
import { seedNextIfEmpty } from "./next/import";

/**
 * Connection + run-once migrations happen inside getDb(); local PGlite also
 * seeds from db/seed-data.json. Everything is memoized per process — requests
 * never run DDL or backfills (those live in db/migrations/*.sql).
 */
const globalForBoot = globalThis as unknown as {
  __flowReady?: Promise<void>;
};

export async function ensureReady(): Promise<void> {
  if (!globalForBoot.__flowReady) {
    globalForBoot.__flowReady = (async () => {
      await getDb();
      await seedIfEmpty();
      await seedNextIfEmpty();
    })().catch((error) => {
      globalForBoot.__flowReady = undefined;
      throw error;
    });
  }
  await globalForBoot.__flowReady;
}
