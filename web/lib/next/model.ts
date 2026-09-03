/**
 * Next (experimental) vocabulary — stages, deal rows, next actions.
 * Isolated from the live Review/Pipeline model so old boards stay put.
 */

import {
  MEMBERS,
  PASS_REASONS,
  VERDICT_ACTIONS,
  VERDICT_LABELS,
  type MemberId,
  type VerdictAction,
  businessModelLabel,
  earningsLabel,
  isMemberId,
  isVerdictAction,
  locationLabel,
  memberLabel,
  money,
  otherMember,
  sourceBucket,
} from "../model";

export {
  MEMBERS,
  PASS_REASONS,
  VERDICT_ACTIONS,
  VERDICT_LABELS,
  businessModelLabel,
  earningsLabel,
  isMemberId,
  isVerdictAction,
  locationLabel,
  memberLabel,
  money,
  otherMember,
  sourceBucket,
};
export type { MemberId, VerdictAction };

import { isDriveFileUrl } from "../cim-pack-id";
import {
  NEXT_BOARD_STAGES,
  NEXT_STAGES,
  canonicalizeNextStage,
  coerceNextStage,
  defaultNextAction,
  isNextReviewStage,
  isNextStageId,
  mapNextStage,
  nextFollowupKind,
  nextStageLabel,
  sanitizeNextAction,
  type NextStageId,
} from "./stages";

export {
  NEXT_BOARD_STAGES,
  NEXT_STAGES,
  canonicalizeNextStage,
  coerceNextStage,
  defaultNextAction,
  isNextReviewStage,
  isNextStageId,
  mapNextStage,
  nextFollowupKind,
  nextStageLabel,
  sanitizeNextAction,
};
export type { NextStageId };

export function isTeamShortlist(
  deal: { verdicts: Partial<Record<MemberId, { action: VerdictAction }>> },
  member: MemberId,
  myAction?: VerdictAction | null,
): boolean {
  const mine = myAction !== undefined ? myAction : (deal.verdicts[member]?.action ?? null);
  const theirs = deal.verdicts[otherMember(member)]?.action ?? null;
  if (mine === "short" || theirs === "short") return true;
  if (mine === "discuss" && theirs === "discuss") return true;
  return false;
}

export type NextReviewOutcome = "inbox" | "shortlist" | "closed";

/**
 * Parallel /next Review decks share one board. Each partner's vote is stored
 * separately; this decides when the card leaves inbound.
 *
 * - Either Like (`short`) or Super Like → Shortlisted immediately
 * - Both Discuss (`?`) → Shortlisted
 * - Both finished, otherwise (Pass/Pass, Pass/?) → Closed
 * - Only one Pass or ? so far → stay inbox so the other deck still has it
 */
export function combineNextReview(input: {
  tristan?: VerdictAction | null;
  partner?: VerdictAction | null;
  superLiked?: boolean;
}): NextReviewOutcome {
  const tristan = input.tristan ?? null;
  const partner = input.partner ?? null;
  if (input.superLiked || tristan === "short" || partner === "short") return "shortlist";
  if (tristan === null || partner === null) return "inbox";
  if (tristan === "discuss" && partner === "discuss") return "shortlist";
  return "closed";
}

export type NextCimOutcome = "cim" | "pursuing" | "closed";

/**
 * Shared CIM board. Stricter than Review: the card stays at CIM until
 * Tristan AND Jim both Pass, or both Pursue. Hold, mixed votes, or one
 * vote never leave CIM. Super Like and Simon notes are not votes.
 */
export function combineNextCim(input: {
  tristan?: VerdictAction | null;
  partner?: VerdictAction | null;
}): NextCimOutcome {
  const tristan = input.tristan ?? null;
  const partner = input.partner ?? null;
  if (!tristan || !partner) return "cim";
  if (tristan === "pass" && partner === "pass") return "closed";
  if (tristan === "short" && partner === "short") return "pursuing";
  return "cim";
}

/** CIM card buttons — same stored actions as Review, different labels. */
export const CIM_VERDICT_LABELS: Record<VerdictAction, string> = {
  short: "Pursue",
  discuss: "Hold",
  pass: "Pass",
};

export function cimCombineHint(
  verdicts: Partial<Record<MemberId, { action: VerdictAction }>>,
): string {
  const tristan = verdicts.tristan?.action ?? null;
  const partner = verdicts.partner?.action ?? null;
  const outcome = combineNextCim({ tristan, partner });
  if (outcome === "closed") return "Both Pass — leaves CIM for Closed";
  if (outcome === "pursuing") return "Both Pursue — leaves CIM for Pursuing";
  if (!tristan && !partner) return "Stays at CIM until both Pass or both Pursue";
  if (!tristan || !partner) return "One vote — stays at CIM";
  if (tristan === "discuss" || partner === "discuss") return "Hold — stays at CIM";
  return "Disagreement — stays at CIM";
}

/**
 * CIM Review membership. Every deals_next row at stage CIM belongs here —
 * intake and /api/next/stage both make the card available immediately.
 * A stamped Drive file URL on a still-open board row (NDA / Shortlist)
 * also belongs so a pack is reviewable before the stage catch-up.
 * Inbound stays in New; Pursuing / Closed already left.
 */
export function isNextCimReviewCard(deal: {
  stage: string;
  cim_url?: string | null;
}): boolean {
  const stage = coerceNextStage(deal.stage);
  if (stage === "cim") return true;
  if (stage === "inbox" || stage === "closed" || stage === "pursuing") return false;
  return isDriveFileUrl(deal.cim_url);
}

/** Inbound cards this member has not voted on yet. Partner votes do not hide them. */
export function nextInboxDeck<
  T extends {
    stage: string;
    verdicts: Partial<Record<MemberId, { action: VerdictAction }>>;
  },
>(deals: T[], member: MemberId): T[] {
  return deals.filter((deal) => deal.stage === "inbox" && !deal.verdicts[member]);
}

/** CIM Review deck: pack/CIM card this member has not cast a CIM vote on. */
export function nextCimDeck<
  T extends {
    stage: string;
    cim_url?: string | null;
    cim_verdicts: Partial<Record<MemberId, { action: VerdictAction }>>;
  },
>(deals: T[], member: MemberId): T[] {
  return deals.filter((deal) => isNextCimReviewCard(deal) && !deal.cim_verdicts[member]);
}

export interface NextDealRow {
  id: number;
  deal_number: string;
  source_deal_id: string | null;
  source_ids: unknown[];
  alias_names: string[];
  gmail_thread_ids: string[];
  broker_firm: string | null;
  fingerprint: string | null;
  next_action: string | null;
  is_demo: boolean;
  title: string;
  /** CIM company / project / nickname. Null until Simon stamps intake. */
  cim_name: string | null;
  blurb: string | null;
  source: string | null;
  sub_source: string | null;
  nickname: string | null;
  sources: string | null;
  city: string | null;
  state: string | null;
  county: string | null;
  revenue: number | null;
  ebitda: number | null;
  sde: number | null;
  asking: number | null;
  business_model_type: string | null;
  needs_llm: string[];
  url: string | null;
  first_seen: string;
  last_seen: string;
  times_seen: number;
  stage: NextStageId;
  stage_changed_at: string | null;
  stage_changed_by: string | null;
  cim_url: string | null;
  nda_url: string | null;
  /** ISO timestamp when Super Liked. Null = not pinned. Not a verdict. */
  super_liked_at: string | null;
  earnings: number | null;
  earnings_basis: "EBITDA" | "SDE" | null;
  earnings_is_sde: boolean;
  margin: number | null;
}

export interface NextVerdictRow {
  deal_id: number;
  member: MemberId;
  action: VerdictAction;
  reason: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface NextNoteRow {
  id: number;
  deal_id: number;
  member: string;
  body: string;
  created_at: string;
}

/** Tristan / Jim notes only. Simon (and any other writer) never hits the CIM card. */
export function partnerNotesOnly<T extends { member: string }>(notes: T[]): T[] {
  return notes.filter((note) => isMemberId(note.member));
}

/** Notes on cards / detail only after the deal itself is at stage CIM. */
export function isCimStageForNotes(deal: { stage: string }): boolean {
  return coerceNextStage(deal.stage) === "cim";
}

/**
 * Tristan / Jim notes for a CIM-stage card. Empty before CIM (New, Shortlist,
 * NDA, …) and after it leaves CIM. Simon is never included.
 */
export function cimStagePartnerNotes<T extends { member: string }>(
  deal: { stage: string },
  notes: T[] | null | undefined,
): T[] {
  if (!isCimStageForNotes(deal)) return [];
  return partnerNotesOnly(notes ?? []);
}

/** Card labels: "Tristan notes" / "Jim notes" (first token of the member label). */
export function cimNoteSectionLabel(id: MemberId): string {
  const name = memberLabel(id).trim().split(/\s+/)[0] || memberLabel(id);
  return `${name} notes`;
}

export type CimPartnerNoteField<T> = {
  member: MemberId;
  label: string;
  notes: T[];
};

/**
 * Always two fields at CIM (Tristan, then Jim) so an empty card still shows
 * both labels. Null before / after CIM. Simon never appears in either field.
 */
export function cimPartnerNoteFields<T extends { member: string }>(
  deal: { stage: string },
  notes: T[] | null | undefined,
): CimPartnerNoteField<T>[] | null {
  if (!isCimStageForNotes(deal)) return null;
  const visible = partnerNotesOnly(notes ?? []);
  return MEMBERS.map((who) => ({
    member: who.id,
    label: cimNoteSectionLabel(who.id),
    notes: visible.filter((note) => note.member === who.id),
  }));
}

export interface NextStageEventRow {
  id: number;
  deal_id: number;
  from_stage: string | null;
  to_stage: string;
  member: string;
  created_at: string;
}

export interface NextDeal extends NextDealRow {
  verdicts: Partial<Record<MemberId, NextVerdictRow>>;
  /** CIM-lane votes only. Review Likes never live here. Simon never appears. */
  cim_verdicts: Partial<Record<MemberId, NextVerdictRow>>;
}

export type CimPackMetricSlot = { label: string; value: string };

/**
 * CIM Review numbers from the pack: revenue, EBITDA, margin, asking.
 * Omit a field when it is missing — never a "No financials" / "no earnings" flag.
 * EBITDA is deals_next.ebitda only (not coalesced SDE).
 */
export function cimPackMetricSlots(
  deal: Pick<NextDealRow, "revenue" | "ebitda" | "margin" | "asking">,
): CimPackMetricSlot[] {
  const slots: CimPackMetricSlot[] = [];
  const revenue = money(deal.revenue);
  if (revenue) slots.push({ label: "revenue", value: revenue });
  const ebitda = money(deal.ebitda);
  if (ebitda) slots.push({ label: "EBITDA", value: ebitda });
  if (deal.margin != null && Number.isFinite(deal.margin)) {
    slots.push({ label: "margin", value: `${Math.round(deal.margin * 100)}%` });
  }
  const asking = money(deal.asking);
  if (asking) slots.push({ label: "asking", value: asking });
  return slots;
}
