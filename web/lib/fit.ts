/**
 * The buy box, evaluated for display.
 *
 * The card leads with "keep reading?" — that answer is geography, financial
 * floor, and excluded/strategic categories from pipeline/buybox.yaml. The
 * pipeline already scores these rules but drops the result on export, so this
 * is a second reading of the box for the UI rather than a cache of the first.
 */

import type { DealRow } from "./model";

export type FitLevel = "priority" | "fits" | "unknown" | "low" | "out";

export interface Fit {
  level: FitLevel;
  /** Two or three words, the same shape on every card. */
  headline: string;
  /** Specifics behind the headline, e.g. "Central Texas · clears T2". */
  detail: string;
  geoTier: "G1" | "G2" | "G3" | null;
  geoLabel: string | null;
  finTier: "T1" | "T2" | "T3" | "T4" | null;
  /** Earnings after the SDE haircut — what the floor is compared to. */
  adjustedEarnings: number | null;
  /** Asking ÷ earnings. */
  multiple: number | null;
  margin: number | null;
  strategic: boolean;
  disqualifier: string | null;
}

const TOLA = new Set(["TX", "OK", "LA", "AR"]);

const CENTRAL_TX_COUNTIES = new Set([
  "travis", "williamson", "hays", "bexar", "comal", "guadalupe", "bell",
  "mclennan", "burnet", "llano", "blanco", "caldwell", "bastrop", "brazos",
  "gillespie", "kendall",
]);

const CENTRAL_TX_METROS = new Set([
  "austin", "san antonio", "waco", "temple", "killeen", "harker heights",
  "belton", "georgetown", "round rock", "cedar park", "pflugerville",
  "leander", "kyle", "buda", "san marcos", "new braunfels", "seguin",
  "bastrop", "lockhart", "marble falls", "fredericksburg", "bryan",
  "college station", "brenham", "boerne", "kerrville",
]);

const EXCLUDED: Array<{ category: string; keywords: string[] }> = [
  {
    category: "restaurant",
    keywords: [
      "restaurant", "cafe", "pizzeria", "bakery", "coffee shop", "taqueria",
      "food truck", "catering", "taproom", "sports bar", "bar & grill",
      "diner", "steakhouse",
    ],
  },
  {
    category: "retail",
    keywords: [
      "retail store", "storefront", "boutique", "gift shop",
      "convenience store", "gas station", "c-store", "liquor store",
      "smoke shop", "apparel store",
    ],
  },
  {
    category: "franchise",
    keywords: [
      "franchise resale", "franchise opportunity", "franchisee",
      "territory available", "franchise fee", "royalty fee",
    ],
  },
  {
    category: "DTC ecommerce",
    keywords: [
      "direct to consumer", "shopify store", "amazon fba", "dropship",
      "ecommerce brand", "online store",
    ],
  },
  {
    category: "software",
    keywords: [
      "saas", "software as a service", "mobile app", "web app",
      "software company", "software platform",
    ],
  },
];

const STRATEGIC = [
  "water filtration", "water filter", "filtration system", "water treatment",
  "water purification", "reverse osmosis", "legionella", "waterborne pathogen",
  "water testing", "water quality", "potable water", "water hygiene",
  "backflow prevention", "water management plan", "industrial filtration",
  "air filtration", "membrane", "filter media", "cartridge filter",
  "filter service", "hospital facility management", "medical facility services",
  "healthcare facilities management", "clinical environmental services",
  "correctional facility", "prison services", "detention facility",
  "senior living management", "skilled nursing", "assisted living",
  "long-term care facility", "sells to hospitals", "sells to health systems",
  "gpo contract", "institutional contract", "government contract",
];

const SDE_HAIRCUT = 0.85;

const FLOOR_BY_GEO: Record<"G1" | "G2" | "G3", "T2" | "T3"> = {
  G1: "T3",
  G2: "T2",
  G3: "T2",
};

const TIER_RANK: Record<"T1" | "T2" | "T3" | "T4", number> = {
  T1: 4, T2: 3, T3: 2, T4: 1,
};

function hit(haystack: string, needles: string[]): string | null {
  for (const needle of needles) {
    if (haystack.includes(needle)) return needle;
  }
  return null;
}

function geographyOf(deal: DealRow): { tier: Fit["geoTier"]; label: string | null } {
  const state = (deal.state || "").trim().toUpperCase();
  const city = (deal.city || "").trim().toLowerCase();
  const county = (deal.county || "").trim().toLowerCase().replace(/\s+county$/, "");

  if (state === "TX" && (CENTRAL_TX_METROS.has(city) || CENTRAL_TX_COUNTIES.has(county))) {
    return { tier: "G1", label: "Central Texas" };
  }
  if (TOLA.has(state)) return { tier: "G2", label: "TOLA" };
  if (state) return { tier: "G3", label: "National" };
  return { tier: null, label: null };
}

export function assessFit(deal: DealRow): Fit {
  const text = `${deal.title} ${deal.blurb ?? ""}`.toLowerCase();
  const strategicHit = hit(text, STRATEGIC);
  const strategic = strategicHit != null;
  const geo = geographyOf(deal);
  const margin = deal.margin;

  const adjustedEarnings =
    deal.ebitda != null
      ? deal.ebitda
      : deal.sde != null
        ? Math.round(deal.sde * SDE_HAIRCUT)
        : null;

  const multiple =
    deal.asking != null && deal.earnings != null && deal.earnings > 0
      ? deal.asking / deal.earnings
      : null;

  let finTier: Fit["finTier"] = null;
  if (adjustedEarnings != null) {
    if (adjustedEarnings >= 1_000_000 && (margin == null || margin >= 0.15)) finTier = "T1";
    else if (adjustedEarnings >= 750_000) finTier = "T2";
    else if (adjustedEarnings >= 500_000) finTier = "T3";
    else finTier = "T4";
  }

  const base: Omit<Fit, "level" | "headline" | "detail"> = {
    geoTier: geo.tier,
    geoLabel: geo.label,
    finTier,
    adjustedEarnings,
    multiple,
    margin,
    strategic,
    disqualifier: null,
  };

  if (!strategic) {
    for (const group of EXCLUDED) {
      if (hit(text, group.keywords)) {
        return {
          ...base,
          level: "out",
          headline: "Out of box",
          detail: `Excluded category · ${group.category}`,
          disqualifier: `excluded category: ${group.category}`,
        };
      }
    }
  }

  const isLocalService = (deal.business_model_type || "").trim() === "LOCAL_SERVICE";
  if (isLocalService && geo.tier === "G3") {
    return {
      ...base,
      level: "out",
      headline: "Out of box",
      detail: "Local service outside TOLA",
      disqualifier: "local service outside TOLA",
    };
  }

  if (strategic) {
    return {
      ...base,
      level: "priority",
      headline: "Priority",
      detail: `Strategic · ${strategicHit}`,
    };
  }

  if (finTier == null) {
    return {
      ...base,
      level: "unknown",
      headline: "No financials",
      detail: geo.label ? `${geo.label} · nothing disclosed` : "Nothing disclosed",
    };
  }

  const floor = geo.tier ? FLOOR_BY_GEO[geo.tier] : "T2";
  const clears = TIER_RANK[finTier] >= TIER_RANK[floor];
  const where = geo.label ?? "Location unknown";

  if (!clears) {
    return {
      ...base,
      level: "low",
      headline: "Below floor",
      detail: `${where} · needs ${floor}`,
    };
  }

  if (geo.tier === "G1" || finTier === "T1") {
    return {
      ...base,
      level: "priority",
      headline: "Priority",
      detail: `${where} · clears ${finTier}`,
    };
  }

  return {
    ...base,
    level: "fits",
    headline: "In the box",
    detail: `${where} · clears ${finTier}`,
  };
}

const LEVEL_ORDER: Record<FitLevel, number> = {
  priority: 0,
  fits: 1,
  unknown: 2,
  low: 3,
  out: 4,
};

/** Best fit first; within a level, bigger earnings win. */
export function byFit(a: DealRow & { fit: Fit }, b: DealRow & { fit: Fit }): number {
  const level = LEVEL_ORDER[a.fit.level] - LEVEL_ORDER[b.fit.level];
  if (level !== 0) return level;
  return (b.earnings ?? -1) - (a.earnings ?? -1);
}

export function multipleLabel(fit: Fit): string | null {
  if (fit.multiple == null) return null;
  return `${fit.multiple.toFixed(1)}×`;
}

export function marginLabel(fit: Fit): string | null {
  if (fit.margin == null) return null;
  return `${Math.round(fit.margin * 100)}%`;
}

/** First sentence of the blurb — enough to know what the business does. */
export function leadSentence(blurb: string | null): string | null {
  if (!blurb) return null;
  const text = blurb.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const end = text.search(/[.!?](?=\s|$)/);
  if (end === -1 || end > 240) return text.slice(0, 200).trim();
  return text.slice(0, end + 1);
}
