/**
 * /next pipeline stages. Isolated so tests can import without the classic Review model.
 *
 * Closed = passed / dead / walked — not won or acquired.
 * Inbound (`inbox`) is the review queue, not a board column.
 * POF is not a stage; leftover `pof` rows land in NDA.
 */

export const NEXT_STAGES = [
  { id: "inbox", label: "Inbound", hint: "Waiting on a card verdict", board: false },
  { id: "shortlist", label: "Shortlisted", hint: "Worth pursuing", board: true },
  { id: "nda", label: "NDA", hint: "NDA requested or signed", board: true },
  { id: "cim", label: "CIM", hint: "Reviewing materials", board: true },
  { id: "pursuing", label: "Pursuing", hint: "Live work past CIM", board: true },
  { id: "closed", label: "Closed", hint: "Passed, dead, or walked", board: true },
] as const;

export type NextStageId = (typeof NEXT_STAGES)[number]["id"];

export const NEXT_BOARD_STAGES = NEXT_STAGES.filter((s) => s.board);

/** Retired /next ids (and aliases) folded onto the five-column board. */
const NEXT_STAGE_ALIASES: Record<string, NextStageId> = {
  inbox: "inbox",
  inbound: "inbox",
  shortlist: "shortlist",
  shortlisted: "shortlist",
  pof: "nda",
  proof_of_funds: "nda",
  nda: "nda",
  nda_to_sign: "nda",
  nda_signed: "nda",
  cim: "cim",
  data_room: "cim",
  cim_data_room: "cim",
  pursuing: "pursuing",
  pursue: "pursuing",
  awaiting_reply: "pursuing",
  active: "pursuing",
  closed: "closed",
  dead: "closed",
  pass: "closed",
  passed: "closed",
};

function normalizeNextStageKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[&]+/g, " ")
    .replace(/[\s/-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Map a current or legacy stage string onto the canonical board, or null if unknown. */
export function mapNextStage(value: unknown): NextStageId | null {
  const key = normalizeNextStageKey(value);
  if (!key) return null;
  if (NEXT_STAGE_ALIASES[key]) return NEXT_STAGE_ALIASES[key];
  return NEXT_STAGES.some((s) => s.id === key) ? (key as NextStageId) : null;
}

/** Same as mapNextStage — Dirk / ingest still call this name. */
export function canonicalizeNextStage(value: unknown): NextStageId | null {
  return mapNextStage(value);
}

/** Read path: never throw on old rows. Unknown strings land in inbound. */
export function coerceNextStage(value: unknown): NextStageId {
  return mapNextStage(value) ?? "inbox";
}

/**
 * Next Review swipe is inbound only. Shortlisted / NDA / CIM / Pursuing /
 * Closed live on the board — a missing verdict must not pull them back.
 */
export function isNextReviewStage(value: unknown): boolean {
  return coerceNextStage(value) === "inbox";
}

export function isNextStageId(value: unknown): value is NextStageId {
  return NEXT_STAGES.some((s) => s.id === value);
}

export function nextStageLabel(id: string): string {
  const canonical = coerceNextStage(id);
  return NEXT_STAGES.find((s) => s.id === canonical)?.label ?? id;
}

export function nextFollowupKind(stage: NextStageId): "nda" | "cim" | "broker_reply" | null {
  if (stage === "nda") return "nda";
  if (stage === "cim") return "cim";
  if (stage === "pursuing") return "broker_reply";
  return null;
}

/** Strip retired POF copy so stored next-action strings stay current. */
export function sanitizeNextAction(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/proof of funds|\bsend pof\b|request nda or send pof/i.test(text)) {
    return "Request NDA";
  }
  if (text === "Continue active review") return "Continue pursuit";
  return text;
}

export function defaultNextAction(stage: NextStageId): string | null {
  switch (stage) {
    case "inbox":
      return "Review the card";
    case "shortlist":
      return "Request NDA";
    case "nda":
      return "Sign the NDA";
    case "cim":
      return "Review CIM against buy box";
    case "pursuing":
      return "Continue pursuit";
    case "closed":
      return null;
    default:
      return null;
  }
}

/** Leftover NDA-lane copy: the pack is in, so we are no longer awaiting it. */
export function isAwaitCimAction(value: unknown): boolean {
  const text = sanitizeNextAction(value);
  if (!text) return false;
  return /await[\s\S]{0,24}cim|data\s*room/i.test(text);
}

/**
 * Closed stays closed when a pack is stamped. Pursuing is already past CIM —
 * do not pull it back. Every other live stage advances to CIM.
 */
export function shouldAdvanceToCimOnPack(stage: NextStageId): boolean {
  return stage !== "closed" && stage !== "pursuing";
}

/**
 * Read-path next action. A stamped CIM pack never displays "Await CIM / data room".
 */
export function resolveNextAction(
  stage: NextStageId,
  stored: unknown,
  cimUrl?: string | null,
): string | null {
  const cleaned = sanitizeNextAction(stored);
  const hasPack = Boolean(cimUrl && String(cimUrl).trim());
  if (hasPack && isAwaitCimAction(cleaned)) {
    if (stage === "pursuing") return defaultNextAction("pursuing");
    if (stage === "closed") return defaultNextAction("closed");
    return defaultNextAction("cim");
  }
  return cleaned ?? defaultNextAction(stage);
}

/** When moving to CIM because a pack arrived, drop stale pre-CIM defaults. */
export function nextActionAfterCimPack(
  stage: NextStageId,
  stored: unknown,
): string | null {
  const cleaned = sanitizeNextAction(stored);
  const fallback = defaultNextAction(stage);
  if (cleaned == null) return fallback;
  if (isAwaitCimAction(cleaned)) return fallback;
  if (
    stage === "cim" &&
    (cleaned === "Sign the NDA" || cleaned === "Request NDA" || cleaned === "Review the card")
  ) {
    return fallback;
  }
  return cleaned;
}
