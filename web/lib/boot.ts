import { applySchema, getDb, query } from "./db";
import { seedIfEmpty } from "./import";

/**
 * Applies the schema and, on a genuinely empty database, migrates the deals the
 * Python pipeline already collected. Connection + seed run once per process;
 * schema is re-applied on every call so new tables (e.g. deal_files) land after
 * HMR without a full restart.
 */
const globalForBoot = globalThis as unknown as {
  __flowReady?: Promise<void>;
  __axialUrlsFixed?: boolean;
};

/** Pass→Pursue param swap on stored Axial URLs (same deal id). Idempotent. */
async function fixAxialPassUrls(): Promise<void> {
  if (globalForBoot.__axialUrlsFixed) return;
  try {
    await query(
      `UPDATE deals
          SET url = regexp_replace(
                regexp_replace(url, 'action=decline', 'action=pursue', 'gi'),
                'utm_content=pass', 'utm_content=pursue', 'gi'
              ),
              updated_at = now()
        WHERE url ILIKE '%axial.net%'
          AND (
            url ILIKE '%action=decline%'
            OR url ILIKE '%utm_content=pass%'
          )`,
    );
    globalForBoot.__axialUrlsFixed = true;
  } catch {
    // Older DBs / drivers without regexp_replace flags — UI still rewrites on read.
  }
}

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
  await fixAxialPassUrls();
}
