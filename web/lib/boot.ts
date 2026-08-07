import { applySchema, getDb } from "./db";
import { seedIfEmpty } from "./import";

/**
 * Applies the schema and, on a genuinely empty database, migrates the deals the
 * Python pipeline already collected. Connection + seed run once per process;
 * schema is re-applied on every call so new tables (e.g. deal_files) land after
 * HMR without a full restart.
 */
const globalForBoot = globalThis as unknown as { __flowReady?: Promise<void> };

export async function ensureReady(): Promise<void> {
  if (!globalForBoot.__flowReady) {
    globalForBoot.__flowReady = (async () => {
      await getDb();
      await seedIfEmpty();
    })().catch((error) => {
      globalForBoot.__flowReady = undefined;
      throw error;
    });
  }
  await globalForBoot.__flowReady;
  await applySchema();
}
