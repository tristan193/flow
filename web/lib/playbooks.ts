/**
 * Per-source next-step playbooks.
 * Axial: pursue URL is the action. Others: inbox artifacts when present,
 * else listing open (discovery bookmark, not a pursue portal).
 */

import type { DealRow } from "./model";
import { normalizeGmailThreadUrl } from "./gmail-thread";

export type PlaybookId = "axial" | "inbox" | "listing";

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
  deal: Pick<DealRow, "source" | "nickname" | "url" | "nda_url" | "gmail_thread_url">,
): Playbook | null {
  const source = (deal.source || "").toLowerCase();
  const nick = (deal.nickname || "").toLowerCase();
  const isAxial = source.includes("axial") || nick === "axial";

  if (isAxial) {
    const href = normalizeAxialHref(deal.url);
    if (!href) return null;
    return {
      id: "axial",
      ctaLabel: "Pursue on Axial →",
      href,
      hint: "Jump into Axial to sign the NDA or pull materials",
    };
  }

  // Non-Axial: inbox artifact is the real next step when we have one.
  if (deal.nda_url?.trim()) {
    return {
      id: "inbox",
      ctaLabel: "Sign NDA →",
      href: deal.nda_url.trim(),
      hint: "From Dirk mail — signing happens outside Flow",
    };
  }
  const thread = normalizeGmailThreadUrl(deal.gmail_thread_url);
  if (thread) {
    return {
      id: "inbox",
      ctaLabel: "Open in Dirk →",
      href: thread,
      hint: "Broker thread in the catcher inbox — log what you did after",
    };
  }

  const href = listingHref(deal);
  if (!href) return null;

  const label = deal.nickname?.trim() || "listing";
  return {
    id: "listing",
    ctaLabel: `Open ${label} →`,
    href,
    hint: "Listing bookmark — after you act, Flow watches Dirk for the reply",
  };
}

/** Early pipeline stages that still need an action prompt. */
export const ACTIONABLE_STAGES = new Set(["shortlist", "contacted", "nda"]);

/** On the Act deck when shortlisted (etc.) and a real next-step exists. */
export function isActionableDeal(
  deal: Pick<DealRow, "stage" | "source" | "nickname" | "url" | "nda_url" | "gmail_thread_url">,
): boolean {
  return ACTIONABLE_STAGES.has(deal.stage) && resolvePlaybook(deal) != null;
}
