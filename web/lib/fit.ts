/**
 * The buy box, evaluated for display + visibility.
 *
 * Visibility floors decide whether a deal appears in Review at all.
 * Fit levels decide how it is labeled once it is shown.
 * Rules live in pipeline/buybox.yaml — keep this file in sync.
 */

import type { DealRow } from "./model";

export type FitLevel = "priority" | "fits" | "unknown" | "low" | "out";

export interface Fit {
  level: FitLevel;
  /** Two or three words, the same shape on every card. */
  headline: string;
  /** Specifics behind the headline, e.g. "Austin / SA corridor · clears $350K". */
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
  /** Passes the app visibility floor (or strategic / unknown). */
  surfaced: boolean;
  disqualifier: string | null;
}

const TOLA = new Set(["TX", "OK", "LA", "AR"]);

/** Austin / San Antonio / Waco corridor — brokers rarely write "Central Texas". */
const CORRIDOR_METROS = [
  "austin", "san antonio", "waco", "temple", "killeen", "harker heights",
  "belton", "georgetown", "round rock", "cedar park", "pflugerville",
  "leander", "kyle", "buda", "san marcos", "new braunfels", "seguin",
  "bastrop", "lockhart", "marble falls", "fredericksburg", "bryan",
  "college station", "brenham", "boerne", "kerrville",
  "dripping springs", "bee cave", "lakeway", "west lake hills", "manor",
  "elgin", "hutto", "taylor", "liberty hill", "jarrell", "salado",
  "copperas cove", "gatesville", "schertz", "cibolo", "converse",
  "universal city", "live oak", "selma", "helotes", "bulverde",
  "canyon lake", "fair oaks ranch", "alamo heights", "terrell hills",
  "windcrest", "leon valley", "garden ridge", "floresville", "gonzales",
  "uhland", "niederwald", "wimberley", "spring branch", "johnson city",
  "blanco", "burnet", "lampasas", "cameron", "rockdale", "hearne",
  "caldwell", "navasota",
];

const CORRIDOR_COUNTIES = new Set([
  "travis", "williamson", "hays", "bexar", "comal", "guadalupe", "bell",
  "mclennan", "burnet", "llano", "blanco", "caldwell", "bastrop", "brazos",
  "gillespie", "kendall", "kerr", "bandera", "wilson", "atascosa", "medina",
  "gonzales", "lee", "milam", "falls", "coryell", "lampasas", "san saba",
  "mason", "washington", "burleson", "robertson",
]);

const CORRIDOR_LABEL = "Austin / SA / Waco";

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

/** Water / filtration / purification / legionella — always visible. */
const STRATEGIC = [
  "water filtration", "water filter", "filtration system", "water treatment",
  "water purification", "water purifying", "reverse osmosis", "legionella",
  "waterborne pathogen", "water testing", "water quality", "potable water",
  "water hygiene", "water safety", "cooling tower water", "water disinfection",
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

/** App visibility floors (EBITDA; SDE is haircut first). */
const VISIBILITY_FLOOR_CORRIDOR = 350_000;
const VISIBILITY_FLOOR_ELSEWHERE = 750_000;

/** Hard mins when earnings missing (see buybox.yaml visibility:). */
const ASKING_MIN_CORRIDOR = 700_000;
const ASKING_MIN_ELSEWHERE = 1_875_000;
const REVENUE_MIN_CORRIDOR = 700_000;
const REVENUE_MIN_ELSEWHERE = 1_500_000;

const TIER_MIN: Record<"T1" | "T2" | "T3" | "T4", number> = {
  T1: 1_000_000,
  T2: 750_000,
  T3: 350_000,
  T4: 0,
};

function hit(haystack: string, needles: string[]): string | null {
  for (const needle of needles) {
    if (haystack.includes(needle)) return needle;
  }
  return null;
}

function cityLooksLikeCorridor(city: string): boolean {
  if (!city) return false;
  if (CORRIDOR_METROS.includes(city)) return true;
  // "North Austin", "New Braunfels TX", "San Antonio Metro"
  return CORRIDOR_METROS.some(
    (metro) =>
      city === metro ||
      city.startsWith(`${metro} `) ||
      city.endsWith(` ${metro}`) ||
      city.includes(` ${metro} `),
  );
}

function blobMentionsCorridor(blob: string): boolean {
  return CORRIDOR_METROS.some((metro) => {
    if (metro.length < 5) return blob.includes(metro); // short names still ok in city field path
    return (
      blob.includes(metro) ||
      blob.includes(`${metro}, tx`) ||
      blob.includes(`${metro} texas`) ||
      blob.includes(`${metro} metro`) ||
      blob.includes(`${metro} area`)
    );
  });
}

function geographyOf(deal: DealRow): { tier: Fit["geoTier"]; label: string | null } {
  const state = (deal.state || "").trim().toUpperCase();
  const city = (deal.city || "").trim().toLowerCase();
  const county = (deal.county || "").trim().toLowerCase().replace(/\s+county$/, "");
  const placeBlob = `${city} ${county} ${deal.title ?? ""} ${deal.blurb ?? ""}`.toLowerCase();

  const inCorridor =
    (state === "TX" || state === "") &&
    (cityLooksLikeCorridor(city) ||
      CORRIDOR_COUNTIES.has(county) ||
      (state === "TX" && blobMentionsCorridor(placeBlob)));

  if (inCorridor && (state === "TX" || state === "")) {
    return { tier: "G1", label: CORRIDOR_LABEL };
  }
  if (state === "TX") return { tier: "G2", label: "Texas" };
  if (TOLA.has(state)) return { tier: "G2", label: "TOLA" };
  if (state) return { tier: "G3", label: "National" };
  return { tier: null, label: null };
}

function visibilityFloor(geoTier: Fit["geoTier"]): number {
  return geoTier === "G1" ? VISIBILITY_FLOOR_CORRIDOR : VISIBILITY_FLOOR_ELSEWHERE;
}

function askingMin(geoTier: Fit["geoTier"]): number {
  return geoTier === "G1" ? ASKING_MIN_CORRIDOR : ASKING_MIN_ELSEWHERE;
}

function revenueMin(geoTier: Fit["geoTier"]): number {
  return geoTier === "G1" ? REVENUE_MIN_CORRIDOR : REVENUE_MIN_ELSEWHERE;
}

function moneyShort(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  return `$${Math.round(n / 1000)}K`;
}

/**
 * Visibility when EBITDA/SDE is missing.
 * Show if asking or revenue clears its hard min; if neither exists, still show.
 */
function clearsProxyVisibility(deal: DealRow, geoTier: Fit["geoTier"]): boolean {
  const hasAsking = deal.asking != null;
  const hasRevenue = deal.revenue != null;
  if (!hasAsking && !hasRevenue) return true;
  const askOk = hasAsking && deal.asking! >= askingMin(geoTier);
  const revOk = hasRevenue && deal.revenue! >= revenueMin(geoTier);
  return Boolean(askOk || revOk);
}

/**
 * Whether Review should show this deal at all.
 * Strategic water lane: always.
 * Earnings present: must clear geo earnings floor.
 * Earnings missing: asking/revenue hard mins (or show if nothing to proxy).
 */
export function isSurfaced(deal: DealRow, fit?: Fit): boolean {
  const assessed = fit ?? assessFit(deal);
  return assessed.surfaced;
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
    else if (adjustedEarnings >= 350_000) finTier = "T3";
    else finTier = "T4";
  }

  const floor = visibilityFloor(geo.tier);
  const clearsVisibility = strategic
    ? true
    : adjustedEarnings != null
      ? adjustedEarnings >= floor
      : clearsProxyVisibility(deal, geo.tier);

  const base: Omit<Fit, "level" | "headline" | "detail"> = {
    geoTier: geo.tier,
    geoLabel: geo.label,
    finTier,
    adjustedEarnings,
    multiple,
    margin,
    strategic,
    surfaced: clearsVisibility,
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
      surfaced: true,
      level: "priority",
      headline: "Priority",
      detail: `Strategic · ${strategicHit}`,
    };
  }

  const where = geo.label ?? "Location unknown";

  if (finTier == null) {
    if (!clearsVisibility) {
      return {
        ...base,
        surfaced: false,
        level: "low",
        headline: "Below floor",
        detail: `${where} · needs ${moneyShort(askingMin(geo.tier))} asking or ${moneyShort(revenueMin(geo.tier))} revenue`,
        disqualifier: "below asking/revenue visibility floor",
      };
    }
    return {
      ...base,
      surfaced: true,
      level: "unknown",
      headline: "No financials",
      detail: geo.label ? `${geo.label} · nothing disclosed` : "Nothing disclosed",
    };
  }

  if (!clearsVisibility) {
    return {
      ...base,
      surfaced: false,
      level: "low",
      headline: "Below floor",
      detail: `${where} · needs ${moneyShort(floor)} to show`,
      disqualifier: `below visibility floor ${moneyShort(floor)}`,
    };
  }

  if (geo.tier === "G1" || finTier === "T1") {
    return {
      ...base,
      level: "priority",
      headline: "Priority",
      detail: `${where} · clears ${moneyShort(TIER_MIN[finTier])}+`,
    };
  }

  return {
    ...base,
    level: "fits",
    headline: "In the box",
    detail: `${where} · clears ${moneyShort(floor)}`,
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
