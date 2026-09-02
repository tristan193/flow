import { assessFit, isSurfaced, type Fit, type FitLevel } from "../fit";
import type { DealRow } from "../model";
import type { NextDeal, NextDealRow } from "./model";

/** Next deals have the same money/geo fields the live buy-box evaluator reads. */
export function assessNextFit(deal: NextDeal | NextDealRow): Fit {
  return assessFit(deal as unknown as DealRow);
}

const LEVEL_ORDER: Record<FitLevel, number> = {
  priority: 0,
  fits: 1,
  unknown: 2,
  low: 3,
  out: 4,
};

export function byFit<T extends { fit: Fit; earnings?: number | null }>(a: T, b: T): number {
  const level = LEVEL_ORDER[a.fit.level] - LEVEL_ORDER[b.fit.level];
  if (level !== 0) return level;
  return (b.earnings ?? -1) - (a.earnings ?? -1);
}

function pinMs(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Super Liked cards sit at the top of whichever stack they are in.
 * Newest Super Like first; everything else keeps the existing byFit order.
 */
export function byPinnedThenFit<
  T extends { fit: Fit; earnings?: number | null; super_liked_at?: string | null },
>(a: T, b: T): number {
  const pinned = pinMs(b.super_liked_at) - pinMs(a.super_liked_at);
  if (pinned !== 0) return pinned;
  return byFit(a, b);
}

/** Same pin rule for board columns (earnings, then id — the existing SQL order). */
export function byPinnedThenEarnings<
  T extends { earnings?: number | null; super_liked_at?: string | null; id?: number },
>(a: T, b: T): number {
  const pinned = pinMs(b.super_liked_at) - pinMs(a.super_liked_at);
  if (pinned !== 0) return pinned;
  const earn = (b.earnings ?? -1) - (a.earnings ?? -1);
  if (earn !== 0) return earn;
  return (b.id ?? 0) - (a.id ?? 0);
}

export { isSurfaced };
export type { Fit };
