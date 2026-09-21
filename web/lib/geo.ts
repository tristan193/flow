/**
 * Location shapes we store: real City/ST, and Axial/census *region* prose.
 * Region is additional — never a substitute for a real state.
 */

export const USPS_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
  "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
  "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY", "DC",
]);

/** In-region band for this shop (TX / OK / LA / AR / NM). */
export const TOLA = new Set(["TX", "OK", "LA", "AR", "NM"]);

const KNOWN_REGION_STATES: Record<string, readonly string[]> = {
  "new england": ["CT", "ME", "MA", "NH", "RI", "VT"],
  "middle atlantic": ["NJ", "NY", "PA"],
  "mid atlantic": ["NJ", "NY", "PA"],
  "east north central": ["IL", "IN", "MI", "OH", "WI"],
  "eastern midwest": ["IL", "IN", "MI", "OH", "WI"],
  "midwest east": ["IL", "IN", "MI", "OH", "WI"],
  "west north central": ["IA", "KS", "MN", "MO", "NE", "ND", "SD"],
  "western midwest": ["IA", "KS", "MN", "MO", "NE", "ND", "SD"],
  "midwest west": ["IA", "KS", "MN", "MO", "NE", "ND", "SD"],
  "south atlantic": ["DE", "DC", "FL", "GA", "MD", "NC", "SC", "VA", "WV"],
  "east south central": ["AL", "KY", "MS", "TN"],
  "west south central": ["AR", "LA", "OK", "TX"],
  "south central": ["AR", "LA", "OK", "TX"],
  mountain: ["AZ", "CO", "ID", "MT", "NV", "NM", "UT", "WY"],
  pacific: ["AK", "CA", "HI", "OR", "WA"],
  "west coast": ["CA", "OR", "WA"],
};

const REGION_RE =
  /([A-Z][A-Za-z]+(?:[ \t]+[A-Z][A-Za-z]+){0,4})[ \t]*\(([A-Z]{2}(?:[ \t]*,[ \t]*[A-Z]{2})+(?:[ \t]*,[ \t]*(?:\.\.\.|…))?)[ \t]*\)/;

const STATE_IN_LIST = /\b([A-Z]{2})\b/g;

function normLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isUspsCode(value: string | null | undefined): boolean {
  const v = (value || "").trim().toUpperCase();
  return v.length === 2 && USPS_STATES.has(v);
}

/** Real ST / City, ST. Two USPS codes (IA, KS) are a misfiled region list. */
export function isRealState(
  state: string | null | undefined,
  city?: string | null,
): boolean {
  if (!isUspsCode(state)) return false;
  if (city && isUspsCode(city)) return false;
  return true;
}

export function looksLikeRegion(text: string | null | undefined): boolean {
  const raw = (text || "").trim();
  if (!raw) return false;
  if (REGION_RE.test(raw)) return true;
  return Object.prototype.hasOwnProperty.call(KNOWN_REGION_STATES, normLabel(raw));
}

export function statesOfRegion(text: string | null | undefined): string[] {
  const raw = (text || "").trim();
  if (!raw) return [];
  const listed = new Set<string>();
  let truncated = false;
  let label = "";
  const m = raw.match(REGION_RE);
  if (m) {
    label = m[1] ?? "";
    const body = m[2] ?? "";
    truncated = body.includes("...") || body.includes("…");
    for (const code of body.match(STATE_IN_LIST) ?? []) {
      if (USPS_STATES.has(code)) listed.add(code);
    }
  } else {
    label = raw;
  }
  const known = KNOWN_REGION_STATES[normLabel(label)] ?? [];
  if (listed.size && !truncated) return [...listed];
  for (const code of known) listed.add(code);
  return [...listed];
}

/** Region field, or a city value that is actually region prose. */
export function regionTextOf(deal: {
  city?: string | null;
  region?: string | null;
}): string | null {
  const region = (deal.region || "").trim();
  if (region) return region;
  const city = (deal.city || "").trim();
  if (looksLikeRegion(city)) return city;
  return null;
}

export function slugGeoToken(value: string | null | undefined): string {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
