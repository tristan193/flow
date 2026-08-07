/**
 * Per-source next-step playbooks.
 * Shared pipeline: shortlist → prompted action → link-out → debrief.
 * Any deal with a listing URL is actionable; Axial gets pursue-link rewrite.
 */

import type { DealRow } from "./model";

export type PlaybookId = "axial" | "listing";

export interface Playbook {
  id: PlaybookId;
  /** Button label */
  ctaLabel: string;
  /** Where to send the member */
  href: string;
  /** One-line how-to under the button */
  hint: string;
}

/**
 * Axial emails put Pass (action=decline) before Pursue. Older extracts stored
 * the Pass URL — rewrite to pursue so Open on Axial does not archive the deal.
 */
export function normalizeAxialHref(url: string | null | undefined): string | null {
  if (!url) return null;
  let href = url.trim().replace(/[).,;]+$/g, "");
  if (!href) return null;
  if (!/axial\.net/i.test(href)) return href;
  if (/action=decline/i.test(href)) {
    href = href.replace(/action=decline/gi, "action=pursue");
  }
  if (/utm_content=pass/i.test(href)) {
    href = href.replace(/utm_content=pass/gi, "utm_content=pursue");
  }
  return href;
}

function listingHref(deal: Pick<DealRow, "source" | "nickname" | "url">): string | null {
  const source = (deal.source || "").toLowerCase();
  const nick = (deal.nickname || "").toLowerCase();
  const isAxial = source.includes("axial") || nick === "axial";
  if (isAxial) return normalizeAxialHref(deal.url);
  const raw = (deal.url || "").trim().replace(/[).,;]+$/g, "");
  return raw || null;
}

export function resolvePlaybook(
  deal: Pick<DealRow, "source" | "nickname" | "url">,
): Playbook | null {
  const href = listingHref(deal);
  if (!href) return null;

  const source = (deal.source || "").toLowerCase();
  const nick = (deal.nickname || "").toLowerCase();
  const isAxial = source.includes("axial") || nick === "axial";

  if (isAxial) {
    return {
      id: "axial",
      ctaLabel: "Pursue on Axial →",
      href,
      hint: "Jump into Axial to sign the NDA or pull materials",
    };
  }

  const label = deal.nickname?.trim() || "listing";
  return {
    id: "listing",
    ctaLabel: `Open ${label} →`,
    href,
    hint: "Open the listing to request info, NDA, or materials",
  };
}

/** Early pipeline stages that still need an action prompt. */
export const ACTIONABLE_STAGES = new Set(["shortlist", "contacted", "nda"]);

/** On the Act deck when shortlisted (etc.) and a real listing URL exists. */
export function isActionableDeal(
  deal: Pick<DealRow, "stage" | "source" | "nickname" | "url">,
): boolean {
  return ACTIONABLE_STAGES.has(deal.stage) && resolvePlaybook(deal) != null;
}
