import type { QueryFn } from "../db";
import { query } from "../db";
import { formatDealNumber, parseDealNumber } from "./identity";

async function ensureCounter(q: QueryFn): Promise<void> {
  await q(
    `INSERT INTO next_deal_counters (key, next_n) VALUES ('tly', 1)
     ON CONFLICT (key) DO NOTHING`,
  );
}

/** Reserve the next TLY-NNN on the Next counter only. */
export async function allocateDealNumber(q: QueryFn = query): Promise<string> {
  await ensureCounter(q);
  const rows = await q<{ reserved: number }>(
    `UPDATE next_deal_counters
        SET next_n = next_n + 1
      WHERE key = 'tly'
      RETURNING next_n - 1 AS reserved`,
  );
  const n = Number(rows[0]?.reserved ?? 1);
  return formatDealNumber(n > 0 ? n : 1);
}

/** If Dirk posts TLY-042, keep the Next counter at least 43. */
export async function bumpCounterToAtLeast(
  dealNumber: string,
  q: QueryFn = query,
): Promise<void> {
  const n = parseDealNumber(dealNumber);
  if (!n) return;
  await ensureCounter(q);
  await q(
    `UPDATE next_deal_counters SET next_n = GREATEST(next_n, $1) WHERE key = 'tly'`,
    [n + 1],
  );
}
