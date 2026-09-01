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

export { isSurfaced };
export type { Fit };
