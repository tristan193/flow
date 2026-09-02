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
}
