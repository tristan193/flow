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

/**
 * Real process board. `inbox` is inbound review (cards) and is not a column.
 */
export const NEXT_STAGES = [
  { id: "inbox", label: "Inbound", hint: "Waiting on a card verdict", board: false },
  { id: "shortlist", label: "Shortlisted", hint: "Worth pursuing", board: true },
  { id: "pof", label: "POF", hint: "Proof of funds — rare", board: true },
  { id: "nda_to_sign", label: "NDA to sign", hint: "NDA out, not signed yet", board: true },
  { id: "nda", label: "NDA signed", hint: "NDA done, awaiting CIM", board: true },
  { id: "cim", label: "CIM / data room", hint: "Reviewing materials", board: true },
  { id: "awaiting_reply", label: "Awaiting reply", hint: "Waiting on banker or seller", board: true },
  { id: "active", label: "Active review", hint: "Live work past CIM", board: true },
  { id: "dead", label: "Pass / dead", hint: "Passed or went nowhere", board: true },
] as const;

export type NextStageId = (typeof NEXT_STAGES)[number]["id"];

export const NEXT_BOARD_STAGES = NEXT_STAGES.filter((s) => s.board);

export function isNextStageId(value: unknown): value is NextStageId {
  return NEXT_STAGES.some((s) => s.id === value);
}

/**
 * Canonical ids on main: inbox, shortlist, pof, nda_to_sign, nda, cim,
 * awaiting_reply, active, dead.
 *
 * Dirk aliases (Simon Pursue/Pass/Hold language):
 *   closed | pass | passed  → dead          (PR #6 "Closed" is still `dead` here)
 *   pursuing                → awaiting_reply
 *   nda_signed              → nda
 */
export function canonicalizeNextStage(value: unknown): NextStageId | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (isNextStageId(raw)) return raw;
  if (raw === "closed" || raw === "pass" || raw === "passed") return "dead";
  if (raw === "pursuing" || raw === "pursue") return "awaiting_reply";
  if (raw === "nda_signed") return "nda";
  return null;
}

export function nextStageLabel(id: string): string {
  return NEXT_STAGES.find((s) => s.id === id)?.label ?? id;
}

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

export function defaultNextAction(stage: NextStageId): string | null {
  switch (stage) {
    case "inbox":
      return "Review the card";
    case "shortlist":
      return "Request NDA or send POF";
    case "pof":
      return "Send proof of funds";
    case "nda_to_sign":
      return "Sign the NDA";
    case "nda":
      return "Await CIM / data room";
    case "cim":
      return "Review CIM against buy box";
    case "awaiting_reply":
      return "Follow up with broker";
    case "active":
      return "Continue active review";
    case "dead":
      return null;
    default:
      return null;
  }
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
