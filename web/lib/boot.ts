import { applySchema, getDb, query } from "./db";
import { normalizeGmailThreadUrl } from "./gmail-thread";
import { seedIfEmpty } from "./import";
import { seedNextIfEmpty } from "./next/import";

/**
 * Applies the schema and, on a genuinely empty database, migrates the deals the
 * Python pipeline already collected. Connection + seed run once per process;
 * schema is re-applied on every call so new tables (e.g. deal_files) land after
 * HMR without a full restart.
 */
const globalForBoot = globalThis as unknown as {
  __flowReady?: Promise<void>;
  __axialUrlsFixed?: boolean;
  __gmailUrlsFixed?: boolean;
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

/** Rewrite stored Gmail links that open Tristan's /u/0 instead of dirk@. */
async function fixGmailThreadUrls(): Promise<void> {
  if (globalForBoot.__gmailUrlsFixed) return;
  try {
    const tables = [
      { table: "deals", col: "gmail_thread_url" },
      { table: "crm_events", col: "gmail_thread_url" },
    ] as const;
    for (const { table, col } of tables) {
      const rows = await query<{ id: number; url: string }>(
        `SELECT id, ${col} AS url FROM ${table}
          WHERE ${col} IS NOT NULL AND btrim(${col}) <> ''`,
      );
      for (const row of rows) {
        const next = normalizeGmailThreadUrl(row.url);
        if (!next || next === row.url) continue;
        const stamp = table === "deals" ? ", updated_at = now()" : "";
        await query(`UPDATE ${table} SET ${col} = $1${stamp} WHERE id = $2`, [next, row.id]);
      }
    }
    globalForBoot.__gmailUrlsFixed = true;
  } catch {
    // Read-path rewrite still covers UI if a table is missing on an old DB.
  }
}

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
  await applySchema();
  await fixAxialPassUrls();
  await fixGmailThreadUrls();
}
