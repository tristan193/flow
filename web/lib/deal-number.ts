import { query, queryOne } from "./db";
import { formatDealNumber, parseDealNumber } from "./identity";

async function ensureCounter(): Promise<void> {
  await query(
    `INSERT INTO deal_counters (key, next_n) VALUES ('tly', 1)
     ON CONFLICT (key) DO NOTHING`,
  );
}

/** Reserve the next TLY-NNN. Bumps the counter atomically. */
export async function allocateDealNumber(): Promise<string> {
  await ensureCounter();
  const row = await queryOne<{ reserved: number }>(
    `UPDATE deal_counters
        SET next_n = next_n + 1
      WHERE key = 'tly'
      RETURNING next_n - 1 AS reserved`,
  );
  const n = Number(row?.reserved ?? 1);
  return formatDealNumber(n > 0 ? n : 1);
}

/** If Dirk posts TLY-042, keep the counter at least 43. */
export async function bumpCounterToAtLeast(dealNumber: string): Promise<void> {
  const n = parseDealNumber(dealNumber);
  if (!n) return;
  await ensureCounter();
  await query(
    `UPDATE deal_counters SET next_n = GREATEST(next_n, $1) WHERE key = 'tly'`,
    [n + 1],
  );
}

/** Assign TLY-NNN to every deal that landed before identity existed. */
export async function backfillDealNumbers(): Promise<number> {
  await ensureCounter();
  const missing = await query<{ id: number }>(
    `SELECT id FROM deals WHERE deal_number IS NULL OR deal_number = '' ORDER BY id`,
  );
  if (missing.length === 0) {
    const maxRow = await queryOne<{ n: string | null }>(
      `SELECT MAX(CAST(SUBSTRING(deal_number FROM 5) AS INTEGER))::text AS n
         FROM deals
        WHERE deal_number ~ '^TLY-[0-9]+$'`,
    );
    const maxN = Number(maxRow?.n ?? 0);
    if (maxN > 0) await bumpCounterToAtLeast(formatDealNumber(maxN));
    return 0;
  }

  for (const row of missing) {
    const num = await allocateDealNumber();
    await query(`UPDATE deals SET deal_number = $1 WHERE id = $2`, [num, row.id]);
  }
  return missing.length;
}
