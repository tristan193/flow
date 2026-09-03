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
} from "./stages";
import type { NextStageId } from "./stages";
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
 * Tristan AND Jim both Pass, or both Pursue. Hold, disagreement, or one
 * vote never leave CIM. Super Like and Simon's written review are not votes.
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

/** Inbound cards this member has not voted on yet. Partner votes do not hide them. */
export function nextInboxDeck<
  T extends {
    stage: string;
    verdicts: Partial<Record<MemberId, { action: VerdictAction }>>;
  },
>(deals: T[], member: MemberId): T[] {
  return deals.filter((deal) => deal.stage === "inbox" && !deal.verdicts[member]);
}

/** CIM Review deck: stage CIM and this member has not cast a CIM vote. */
export function nextCimDeck<
  T extends {
    stage: string;
    cim_verdicts: Partial<Record<MemberId, { action: VerdictAction }>>;
  },
>(deals: T[], member: MemberId): T[] {
  return deals.filter((deal) => deal.stage === "cim" && !deal.cim_verdicts[member]);
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
  /** CIM-lane votes only. Review Likes never live here. */
  cim_verdicts: Partial<Record<MemberId, NextVerdictRow>>;
}
