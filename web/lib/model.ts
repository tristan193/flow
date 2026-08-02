/**
 * Shared vocabulary for Flow App: who the reviewers are, what stages a deal can
 * be in, and the row shapes coming back from the database.
 */

/**
 * Member ids are stable strings, not display names, because verdicts already in
 * the database are keyed to them. Renaming a partner in the UI must never
 * orphan their history, so only the label is configurable.
 */
export const MEMBERS = [
  { id: "tristan", label: process.env.FLOW_MEMBER_TRISTAN_LABEL || "Tristan" },
  { id: "partner", label: process.env.FLOW_MEMBER_PARTNER_LABEL || "Partner" },
] as const;

export type MemberId = (typeof MEMBERS)[number]["id"];

export function isMemberId(value: unknown): value is MemberId {
  return MEMBERS.some((m) => m.id === value);
}

export function memberLabel(id: string): string {
  return MEMBERS.find((m) => m.id === id)?.label ?? id;
}

export function otherMember(id: MemberId): MemberId {
  return id === "tristan" ? "partner" : "tristan";
}

export const VERDICT_ACTIONS = ["short", "discuss", "pass"] as const;
export type VerdictAction = (typeof VERDICT_ACTIONS)[number];

export function isVerdictAction(value: unknown): value is VerdictAction {
  return VERDICT_ACTIONS.includes(value as VerdictAction);
}

export const VERDICT_LABELS: Record<VerdictAction, string> = {
  short: "Shortlist",
  discuss: "Discuss",
  pass: "Pass",
};

/**
 * Why a deal was passed. Captured as a fixed list rather than free text so the
 * reasons can eventually be counted — that count is what a buy box gets tuned
 * against, which is why passing without a reason is allowed but discouraged.
 */
export const PASS_REASONS = [
  "Too small",
  "Too expensive",
  "Wrong geography",
  "Owner-dependent",
  "Customer concentration",
  "Wrong industry",
  "Licensure",
  "Declining",
  "Already seen",
] as const;

/**
 * Why a listing looks wrong to a human. Fixed list so we can count modes of
 * failure in the harvest later — free text lives in train_flags.detail.
 */
export const TRAIN_REASONS = [
  "Wrong earnings",
  "Wrong asking / revenue",
  "Wrong location",
  "Wrong title / blurb",
  "Duplicate listing",
  "Not a real deal",
  "Garbled / bad parse",
  "Other",
] as const;

export type TrainReason = (typeof TRAIN_REASONS)[number];

export function isTrainReason(value: unknown): value is TrainReason {
  return (TRAIN_REASONS as readonly string[]).includes(value as string);
}

export interface TrainFlagRow {
  deal_id: number;
  member: MemberId;
  reason: string;
  detail: string | null;
  format_id: string | null;
  inspection: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/**
 * The deal pipeline. `inbox` is pre-triage and is not shown on the board;
 * everything from `shortlist` onward is live work.
 */
export const STAGES = [
  { id: "inbox", label: "Inbox", hint: "Not yet triaged", board: false },
  { id: "shortlist", label: "Shortlisted", hint: "Worth pursuing, no outreach yet", board: true },
  { id: "contacted", label: "Contacted", hint: "Reached out to broker or seller", board: true },
  { id: "nda", label: "NDA", hint: "NDA signed, awaiting materials", board: true },
  { id: "cim", label: "CIM", hint: "Reviewing financials", board: true },
  { id: "offer", label: "Offer", hint: "LOI or offer out", board: true },
  { id: "closed", label: "Closed", hint: "Deal done", board: true },
  { id: "dead", label: "Dead", hint: "Went nowhere", board: true },
] as const;

export type StageId = (typeof STAGES)[number]["id"];

export const BOARD_STAGES = STAGES.filter((s) => s.board);

export function isStageId(value: unknown): value is StageId {
  return STAGES.some((s) => s.id === value);
}

export function stageLabel(id: string): string {
  return STAGES.find((s) => s.id === id)?.label ?? id;
}

export interface DealRow {
  id: number;
  ext_id: string;
  title: string;
  blurb: string | null;
  /** Sender domain, e.g. bizbuysell.com */
  source: string | null;
  /** Sender email address, e.g. bizalert@bizbuysell.com */
  sub_source: string | null;
  /** Human-facing label, e.g. BizBuySell */
  nickname: string | null;
  /** Concat of provider domains seen for this deal */
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
  stage: StageId;
  stage_changed_at: string | null;
  stage_changed_by: string | null;
  earnings: number | null;
  earnings_basis: "EBITDA" | "SDE" | null;
  earnings_is_sde: boolean;
  margin: number | null;
}

export interface VerdictRow {
  deal_id: number;
  member: MemberId;
  action: VerdictAction;
  reason: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface NoteRow {
  id: number;
  deal_id: number;
  member: string;
  body: string;
  created_at: string;
}

export interface StageEventRow {
  id: number;
  deal_id: number;
  from_stage: string | null;
  to_stage: string;
  member: string;
  created_at: string;
}

/** A deal plus both partners' verdicts and any train-AI flags. */
export interface Deal extends DealRow {
  verdicts: Partial<Record<MemberId, VerdictRow>>;
  trainFlags: Partial<Record<MemberId, TrainFlagRow>>;
}

/**
 * Attribution triad (organizational contract):
 *   source     = sender domain
 *   sub_source = sender email address
 *   nickname   = human-facing label (pill text)
 *
 * Pill colour keys off domain / nickname heuristics — not the old routing
 * "bucket" string that used to live in `source`.
 */
export function sourceBucket(deal: {
  source?: string | null;
  sub_source?: string | null;
  nickname?: string | null;
  sources?: string | null;
} | string | null): string {
  const blob =
    typeof deal === "string" || deal == null
      ? String(deal || "")
      : [deal.source, deal.sub_source, deal.nickname, deal.sources]
          .filter(Boolean)
          .join(" ");
  const s = blob.toLowerCase().replace(/\s+/g, "");
  for (const key of ["bizbuysell", "businessexits", "benchmark", "axial", "bizquest", "dealstream"]) {
    if (s.includes(key)) return key === "bizquest" || key === "dealstream" ? "newsletter" : key;
  }
  return "newsletter";
}

/** Compact money for dense mobile cards: $1.2M, $840K. */
export function money(value: number | null | undefined): string | null {
  if (value == null) return null;
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }
  return `$${Math.round(value / 1000)}K`;
}

/**
 * Earnings as displayed. The trailing asterisk means the figure is SDE, which
 * includes owner compensation and is therefore not comparable to EBITDA.
 */
export function earningsLabel(deal: Pick<DealRow, "ebitda" | "sde">): string {
  if (deal.ebitda != null) return money(deal.ebitda)!;
  if (deal.sde != null) return `${money(deal.sde)}*`;
  return "—";
}

export function locationLabel(deal: Pick<DealRow, "city" | "state">): string {
  return [deal.city, deal.state].filter(Boolean).join(", ") || "Location not disclosed";
}

/** Local / regional / national when known; null when unset or legacy labels. */
export function businessModelLabel(
  deal: Pick<DealRow, "business_model_type">,
): string | null {
  const t = (deal.business_model_type || "").trim();
  if (!t || t === "AMBIGUOUS" || t === "LOCATION_AGNOSTIC") return null;
  if (t === "LOCAL_SERVICE") return "local service";
  if (t === "REGIONAL") return "regional";
  if (t === "NATIONAL") return "national";
  return t.toLowerCase().replace(/_/g, " ");
}
