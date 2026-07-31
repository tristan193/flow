import { query, queryOne } from "./db";
import {
  type Deal,
  type DealRow,
  type MemberId,
  type NoteRow,
  type StageEventRow,
  type StageId,
  type VerdictAction,
  type VerdictRow,
} from "./model";

/**
 * Timestamps arrive as Date objects from one driver and strings from the other,
 * and JSONB columns can arrive pre-parsed or as text. Normalising here means the
 * rest of the app only ever sees ISO strings and real arrays.
 */
function isoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  return new Date().toISOString();
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeDeal(row: Record<string, unknown>): DealRow {
  return {
    ...(row as unknown as DealRow),
    needs_llm: toStringArray(row.needs_llm),
    first_seen: isoString(row.first_seen),
    last_seen: isoString(row.last_seen),
    stage_changed_at: row.stage_changed_at ? isoString(row.stage_changed_at) : null,
    earnings_is_sde: Boolean(row.earnings_is_sde),
  };
}

function normalizeVerdict(row: Record<string, unknown>): VerdictRow {
  return {
    ...(row as unknown as VerdictRow),
    created_at: isoString(row.created_at),
    updated_at: isoString(row.updated_at),
  };
}

async function attachVerdicts(rows: DealRow[]): Promise<Deal[]> {
  if (rows.length === 0) return [];
  // Expanded placeholders rather than an array parameter: array binding differs
  // between the two drivers, while numbered placeholders behave identically.
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
  const verdicts = await query<Record<string, unknown>>(
    `SELECT * FROM verdicts WHERE deal_id IN (${placeholders})`,
    ids,
  );

  const byDeal = new Map<number, Deal["verdicts"]>();
  for (const raw of verdicts) {
    const verdict = normalizeVerdict(raw);
    const bucket = byDeal.get(verdict.deal_id) ?? {};
    bucket[verdict.member] = verdict;
    byDeal.set(verdict.deal_id, bucket);
  }

  return rows.map((row) => ({ ...row, verdicts: byDeal.get(row.id) ?? {} }));
}

/**
 * Every deal, best earnings first, with deals of unknown earnings last rather
 * than first — an undisclosed figure is not a large one.
 */
export async function listDeals(): Promise<Deal[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM v_deals
     ORDER BY earnings DESC NULLS LAST, last_seen DESC, id DESC`,
  );
  return attachVerdicts(rows.map(normalizeDeal));
}

export async function listBoardDeals(): Promise<Deal[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM v_deals
     WHERE stage <> 'inbox'
     ORDER BY earnings DESC NULLS LAST, id DESC`,
  );
  return attachVerdicts(rows.map(normalizeDeal));
}

export async function getDeal(id: number): Promise<Deal | null> {
  const row = await queryOne<Record<string, unknown>>("SELECT * FROM v_deals WHERE id = $1", [id]);
  if (!row) return null;
  const [deal] = await attachVerdicts([normalizeDeal(row)]);
  return deal ?? null;
}

/**
 * Records a verdict and, when it is a shortlist, moves the deal out of the inbox
 * onto the board. Shortlisting is the moment a listing becomes work, so making
 * that a separate manual step would just be a step people forget.
 */
export async function setVerdict(
  dealId: number,
  member: MemberId,
  action: VerdictAction,
  reason: string | null,
): Promise<void> {
  await query(
    `INSERT INTO verdicts (deal_id, member, action, reason)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (deal_id, member) DO UPDATE
       SET action = excluded.action,
           reason = excluded.reason,
           updated_at = now()`,
    [dealId, member, action, reason],
  );

  if (action === "short") {
    await moveStage(dealId, member, "shortlist", { onlyFrom: "inbox" });
  }
}

export async function clearVerdict(dealId: number, member: MemberId): Promise<void> {
  await query("DELETE FROM verdicts WHERE deal_id = $1 AND member = $2", [dealId, member]);
}

/**
 * Moves a deal to a stage and records the transition.
 *
 * `onlyFrom` guards the automatic promotion on shortlist: a deal already at NDA
 * must not be dragged backwards just because the other partner belatedly
 * shortlisted it.
 */
export async function moveStage(
  dealId: number,
  member: MemberId,
  stage: StageId,
  options: { onlyFrom?: StageId } = {},
): Promise<void> {
  const current = await queryOne<{ stage: StageId }>("SELECT stage FROM deals WHERE id = $1", [
    dealId,
  ]);
  if (!current) return;
  if (options.onlyFrom && current.stage !== options.onlyFrom) return;
  if (current.stage === stage) return;

  await query(
    `UPDATE deals
        SET stage = $1, stage_changed_at = now(), stage_changed_by = $2, updated_at = now()
      WHERE id = $3`,
    [stage, member, dealId],
  );
  await query(
    `INSERT INTO stage_events (deal_id, from_stage, to_stage, member) VALUES ($1, $2, $3, $4)`,
    [dealId, current.stage, stage, member],
  );
}

export async function addNote(dealId: number, member: MemberId, body: string): Promise<void> {
  await query("INSERT INTO notes (deal_id, member, body) VALUES ($1, $2, $3)", [
    dealId,
    member,
    body.trim(),
  ]);
}

export async function listNotes(dealId: number): Promise<NoteRow[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM notes WHERE deal_id = $1 ORDER BY created_at DESC",
    [dealId],
  );
  return rows.map((row) => ({
    ...(row as unknown as NoteRow),
    created_at: isoString(row.created_at),
  }));
}

export async function listStageEvents(dealId: number): Promise<StageEventRow[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM stage_events WHERE deal_id = $1 ORDER BY created_at DESC",
    [dealId],
  );
  return rows.map((row) => ({
    ...(row as unknown as StageEventRow),
    created_at: isoString(row.created_at),
  }));
}

export interface ReviewStats {
  total: number;
  toReview: number;
  shortlisted: number;
  passed: number;
  needsInfo: number;
}

/** Counts framed from the signed-in member's point of view. */
export function reviewStats(deals: Deal[], member: MemberId): ReviewStats {
  let toReview = 0;
  let shortlisted = 0;
  let passed = 0;
  let needsInfo = 0;

  for (const deal of deals) {
    const mine = deal.verdicts[member];
    if (!mine) toReview += 1;
    else if (mine.action === "short") shortlisted += 1;
    else if (mine.action === "pass") passed += 1;
    if (deal.needs_llm.length > 0) needsInfo += 1;
  }

  return { total: deals.length, toReview, shortlisted, passed, needsInfo };
}
