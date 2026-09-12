/**
 * Listing / deal URLs — including Axial matrix params (`;id=…;tab=…`).
 *
 * Never split or strip on `;`. Older punctuation scrub treated `;` like a
 * trailing wrapper and some open paths parsed the string as if `;` started
 * a query. Axial Pursue links use matrix form:
 *   https://network.axial.net/received-deals/new;id={hex};tab=details;action=pursue
 * Percent-encoding `;` → `%3B` has failed against Axial historically, so
 * encodeURI (which leaves `;` in the path) is the open-path normalizer.
 */

import { isUnmodifiedPrimaryClick } from "./cim-new-tab";

export const LISTING_NEW_TAB_REL = "noopener noreferrer";
export const LISTING_NEW_TAB_FEATURES = "noopener,noreferrer";

/** Sentence-wrapper punctuation only — `;` is a matrix delimiter, not a wrapper. */
const LEADING_WRAP = /^[<(\["']+/;
const TRAILING_WRAP = /[>).,'"]+$/;

function stripWrappers(raw: string): string {
  let href = raw.trim();
  href = href.replace(LEADING_WRAP, "").replace(TRAILING_WRAP, "");
  // Lone trailing `;` from "see url;" — keep `;key=` matrix segments.
  if (/;$/.test(href) && !/;[a-z][\w-]*=/i.test(href)) {
    href = href.replace(/;+$/g, "");
  }
  return href;
}

function rewriteAxialPursue(href: string): string {
  if (!/axial\.net/i.test(href)) return href;
  let out = href;
  if (/action=decline/i.test(out)) {
    out = out.replace(/action=decline/gi, "action=pursue");
  }
  if (/utm_content=pass/i.test(out)) {
    out = out.replace(/utm_content=pass/gi, "utm_content=pursue");
  }
  return out;
}

/**
 * Stored / in-memory listing URL. Preserves matrix `;` params. Does not
 * percent-encode. Safe to run on import and on every deal read.
 */
export function normalizeListingHref(url: string | null | undefined): string | null {
  if (url == null) return null;
  const href = stripWrappers(String(url));
  if (!href) return null;
  if (/^(javascript|data|vbscript):/i.test(href)) return null;
  return rewriteAxialPursue(href);
}

/**
 * href / window.open form. encodeURI keeps path `;` (unlike encodeURIComponent).
 * WHATWG URL is used only to confirm the string still contains those segments —
 * we never rebuild from pathname/search pieces that would drop matrix params.
 */
export function listingOpenHref(url: string | null | undefined): string | null {
  const href = normalizeListingHref(url);
  if (!href) return null;

  try {
    const parsed = new URL(href);
    if (href.includes(";") && !parsed.href.includes(";")) {
      return encodeURI(href);
    }
    return encodeURI(parsed.href);
  } catch {
    try {
      return encodeURI(href);
    } catch {
      return href;
    }
  }
}

/** Axial Pass → Pursue plus matrix-safe normalize. Kept as the read-path name. */
export function normalizeAxialHref(url: string | null | undefined): string | null {
  return normalizeListingHref(url);
}

export function openListingUrl(
  url: string,
  event?: {
    preventDefault(): void;
    stopPropagation(): void;
    defaultPrevented: boolean;
    button: number;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  },
): void {
  const href = listingOpenHref(url);
  if (!href) return;
  if (event && !isUnmodifiedPrimaryClick(event)) return;
  event?.preventDefault();
  event?.stopPropagation();
  window.open(href, "_blank", LISTING_NEW_TAB_FEATURES);
}
