import { queryOne } from "../db";

export type NextDealStats = {
  totalTly: number;
  austinTx: number;
  byStage: Record<string, number>;
};

/**
 * Live counts over deals_next (one row per TLY; v_deals_next is that same set).
 * COUNT only — does not load deal rows.
 */
export async function loadNextDealStats(): Promise<NextDealStats> {
  const row = await queryOne<{
    total_tly: unknown;
    austin_tx: unknown;
    by_stage: unknown;
  }>(
    `SELECT
       (SELECT COUNT(*)::int FROM deals_next) AS total_tly,
       (
         SELECT COUNT(*)::int
         FROM deals_next
         WHERE (city ILIKE '%austin%' OR region ILIKE '%austin%')
           AND (state IS NULL OR state ILIKE '%tx%' OR state ILIKE '%texas%')
       ) AS austin_tx,
       (
         SELECT COALESCE(jsonb_object_agg(stage, n), '{}'::jsonb)
         FROM (
           SELECT stage, COUNT(*)::int AS n
           FROM deals_next
           GROUP BY stage
         ) stages
       ) AS by_stage`,
  );

  return {
    totalTly: asCount(row?.total_tly),
    austinTx: asCount(row?.austin_tx),
    byStage: asStageMap(row?.by_stage),
  };
}

function asCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asStageMap(value: unknown): Record<string, number> {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return {};
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [stage, count] of Object.entries(raw as Record<string, unknown>)) {
    if (!stage) continue;
    out[stage] = asCount(count);
  }
  return out;
}
