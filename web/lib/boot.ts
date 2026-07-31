import { getDb } from "./db";
import { seedIfEmpty } from "./import";

/**
 * Applies the schema and, on a genuinely empty database, migrates the deals the
 * Python pipeline already collected. Runs once per process; every page and route
 * awaits it so there is no ordering requirement between them.
 */
const globalForBoot = globalThis as unknown as { __flowReady?: Promise<void> };

export function ensureReady(): Promise<void> {
  if (!globalForBoot.__flowReady) {
    globalForBoot.__flowReady = (async () => {
      await getDb();
      await seedIfEmpty();
    })().catch((error) => {
      // Drop the cached rejection so the next request can retry after a fix
      // (e.g. creating the local data directory) instead of failing forever.
      globalForBoot.__flowReady = undefined;
      throw error;
    });
  }
  return globalForBoot.__flowReady;
}
