import { query, queryOne } from "../db";
import { normalizeAxialHref } from "../playbooks";
import { gmailAllHref } from "./identity";
import {
  type MemberId,
  type NextDeal,
  type NextDealRow,
  type NextNoteRow,
  type NextStageEventRow,
  type NextStageId,
  type NextVerdictRow,
  type VerdictAction,
  coerceNextStage,
  combineNextCim,
  combineNextReview,
  defaultNextAction,
  isMemberId,
  isNextCimReviewCard,
  nextActionAfterCimPack,
  nextFollowupKind,
  resolveNextAction,
  sanitizeNextAction,
  shouldAdvanceToCimOnPack,
} from "./model";

function isoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  return new Date().toISOString();
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
      return value.trim() ? [value.trim()] : [];
    }
  }
  return [];
}

function toJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeDeal(row: Record<string, unknown>): NextDealRow {
  const rawUrl = row.url == null ? null : String(row.url);
  const stageRaw = row.stage == null ? "inbox" : String(row.stage);
  return {
    id: Number(row.id),
    deal_number: String(row.deal_number ?? ""),
    source_deal_id: row.source_deal_id == null ? null : String(row.source_deal_id),
    source_ids: toJsonArray(row.source_ids),
    alias_names: toStringArray(row.alias_names),
    gmail_thread_ids: toStringArray(row.gmail_thread_ids),
    broker_firm: row.broker_firm == null ? null : String(row.broker_firm),
    fingerprint: row.fingerprint == null ? null : String(row.fingerprint),
    next_action: resolveNextAction(
      coerceNextStage(stageRaw),
      row.next_action,
      row.cim_url == null ? null : String(row.cim_url),
    ),
    is_demo: Boolean(row.is_demo),
    title: String(row.title ?? ""),
    cim_name: row.cim_name == null || String(row.cim_name).trim() === "" ? null : String(row.cim_name).trim(),
    blurb: row.blurb == null ? null : String(row.blurb),
    source: row.source == null ? null : String(row.source),
    sub_source: row.sub_source == null ? null : String(row.sub_source),
    nickname: row.nickname == null ? null : String(row.nickname),
    sources: row.sources == null ? null : String(row.sources),
    city: row.city == null ? null : String(row.city),
    state: row.state == null ? null : String(row.state),
    county: row.county == null ? null : String(row.county),
    revenue: row.revenue == null ? null : Number(row.revenue),
    ebitda: row.ebitda == null ? null : Number(row.ebitda),
    sde: row.sde == null ? null : Number(row.sde),
    asking: row.asking == null ? null : Number(row.asking),
    business_model_type: row.business_model_type == null ? "" : String(row.business_model_type),
    needs_llm: toStringArray(row.needs_llm),
    url: normalizeAxialHref(rawUrl) ?? rawUrl,
    first_seen: isoString(row.first_seen),
    last_seen: isoString(row.last_seen),
    times_seen: Number(row.times_seen ?? 1),
    stage: coerceNextStage(stageRaw),
    stage_changed_at: row.stage_changed_at ? isoString(row.stage_changed_at) : null,
    stage_changed_by: row.stage_changed_by == null ? null : String(row.stage_changed_by),
    cim_url: row.cim_url == null ? null : String(row.cim_url),
    nda_url: row.nda_url == null ? null : String(row.nda_url),
    super_liked_at: row.super_liked_at ? isoString(row.super_liked_at) : null,
    earnings: row.earnings == null ? null : Number(row.earnings),
    earnings_basis:
      row.earnings_basis === "EBITDA" || row.earnings_basis === "SDE"
        ? row.earnings_basis
        : null,
    earnings_is_sde: Boolean(row.earnings_is_sde),
    margin: resolveMargin(row),
  };
}

/** Dirk-stamped deals_next.margin wins; otherwise ebitda|sde / revenue (old view). */
function resolveMargin(row: Record<string, unknown>): number | null {
  if (row.margin != null && row.margin !== "") {
    const stored = Number(row.margin);
    if (Number.isFinite(stored)) return stored;
  }
  const revenue = row.revenue == null ? null : Number(row.revenue);
  const earnings =
    row.ebitda != null ? Number(row.ebitda) : row.sde != null ? Number(row.sde) : null;
  if (revenue != null && revenue > 0 && earnings != null && Number.isFinite(earnings)) {
    return Math.round((earnings / revenue) * 1e4) / 1e4;
  }
  return null;
}

function normalizeVerdict(row: Record<string, unknown>): NextVerdictRow | null {
  if (!isMemberId(row.member)) return null;
  return {
    deal_id: Number(row.deal_id),
    member: row.member,
    action: row.action as VerdictAction,
    reason: row.reason == null ? null : String(row.reason),
    note: row.note == null ? null : String(row.note),
    created_at: isoString(row.created_at),
    updated_at: isoString(row.updated_at),
  };
}

async function attachVerdicts(rows: NextDealRow[]): Promise<NextDeal[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
  const verdicts = await query<Record<string, unknown>>(
    `SELECT * FROM verdicts_next WHERE deal_id IN (${placeholders})`,
    ids,
  );
  const byDeal = new Map<number, NextDeal["verdicts"]>();
  for (const raw of verdicts) {
    const verdict = normalizeVerdict(raw);
    if (!verdict) continue;
    const bucket = byDeal.get(verdict.deal_id) ?? {};
    bucket[verdict.member] = verdict;
    byDeal.set(verdict.deal_id, bucket);
  }
  const cimVerdicts = await query<Record<string, unknown>>(
    `SELECT * FROM cim_verdicts_next WHERE deal_id IN (${placeholders})`,
    ids,
  );
  const cimByDeal = new Map<number, NextDeal["cim_verdicts"]>();
  for (const raw of cimVerdicts) {
    const verdict = normalizeVerdict(raw);
    if (!verdict) continue;
    const bucket = cimByDeal.get(verdict.deal_id) ?? {};
    bucket[verdict.member] = verdict;
    cimByDeal.set(verdict.deal_id, bucket);
  }
  return rows.map((row) => ({
    ...row,
    verdicts: byDeal.get(row.id) ?? {},
    cim_verdicts: cimByDeal.get(row.id) ?? {},
  }));
}

export async function listNextDeals(): Promise<NextDeal[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM v_deals_next
     ORDER BY super_liked_at DESC NULLS LAST, earnings DESC NULLS LAST, last_seen DESC, id DESC`,
  );
  return attachVerdicts(rows.map(normalizeDeal));
}

/** Inbound queue for `/next` Review → New. Board stages never belong here. */
export async function listNextInboxDeals(): Promise<NextDeal[]> {
  const deals = await listNextDeals();
  return deals.filter((deal) => deal.stage === "inbox");
}

/** CIM Review swipe. Same deals_next rows as intake — every stage CIM card. */
export async function listNextCimDeals(): Promise<NextDeal[]> {
  const deals = await listNextDeals();
  return deals.filter(isNextCimReviewCard);
}

export async function listNextBoardDeals(): Promise<NextDeal[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM v_deals_next
     WHERE stage <> 'inbox'
     ORDER BY super_liked_at DESC NULLS LAST, earnings DESC NULLS LAST, id DESC`,
  );
  const deals = await attachVerdicts(rows.map(normalizeDeal));
  return deals.filter((deal) => deal.stage !== "inbox");
}

export async function getNextDeal(id: number): Promise<NextDeal | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM v_deals_next WHERE id = $1",
    [id],
  );
  if (!row) return null;
  const [deal] = await attachVerdicts([normalizeDeal(row)]);
  return deal ?? null;
}

export async function setNextVerdict(
  dealId: number,
  member: MemberId,
  action: VerdictAction,
  reason: string | null,
  note: string | null = null,
): Promise<void> {
  await query(
    `INSERT INTO verdicts_next (deal_id, member, action, reason, note)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (deal_id, member) DO UPDATE
       SET action = excluded.action,
           reason = excluded.reason,
           note = excluded.note,
           updated_at = now()`,
    [dealId, member, action, reason, note],
  );

  if (action === "short" || action === "pass") {
    await clearNextSuperLike(dealId);
  }

  await applyNextReviewOutcome(dealId, member);
}

export async function clearNextVerdict(dealId: number, member: MemberId): Promise<void> {
  await query("DELETE FROM verdicts_next WHERE deal_id = $1 AND member = $2", [dealId, member]);
}

/**
 * Pin a deal to the top of whichever stack it lives in.
 * On inbound Review, Super Like also shortlists immediately (same as a Like)
 * so the other partner does not have to wait. Not a verdict — pin stays until
 * a later Pass / Pursue / Closed decision.
 */
export async function setNextSuperLike(
  dealId: number,
  liked: boolean,
  member: string = "tristan",
): Promise<string | null> {
  if (!liked) {
    await clearNextSuperLike(dealId);
    return null;
  }
  const rows = await query<{ super_liked_at: unknown }>(
    `UPDATE deals_next
        SET super_liked_at = now(), updated_at = now()
      WHERE id = $1
    RETURNING super_liked_at`,
    [dealId],
  );
  const raw = rows[0]?.super_liked_at;
  const at = raw ? isoString(raw) : null;
  await applyNextReviewOutcome(dealId, member);
  return at;
}

/** Apply Tristan/Jim combine rules. Only moves inbound cards forward. */
export async function applyNextReviewOutcome(dealId: number, actor: string): Promise<void> {
  const deal = await getNextDeal(dealId);
  if (!deal || deal.stage !== "inbox") return;
  const outcome = combineNextReview({
    tristan: deal.verdicts.tristan?.action ?? null,
    partner: deal.verdicts.partner?.action ?? null,
    superLiked: Boolean(deal.super_liked_at),
  });
  if (outcome === "inbox") return;
  await moveNextStage(dealId, actor, outcome, { onlyFrom: "inbox" });
}

export async function setNextCimVerdict(
  dealId: number,
  member: MemberId,
  action: VerdictAction,
  note: string | null = null,
): Promise<void> {
  if (!isMemberId(member)) return;
  await query(
    `INSERT INTO cim_verdicts_next (deal_id, member, action, note)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (deal_id, member) DO UPDATE
       SET action = excluded.action,
           note = excluded.note,
           updated_at = now()`,
    [dealId, member, action, note],
  );
  await applyNextCimOutcome(dealId, member);
}

export async function clearNextCimVerdict(dealId: number, member: MemberId): Promise<void> {
  if (!isMemberId(member)) return;
  await query("DELETE FROM cim_verdicts_next WHERE deal_id = $1 AND member = $2", [dealId, member]);
}

/** CIM stays put until both partners agree (Pass→Closed, Pursue→Pursuing). Notes never call this. */
export async function applyNextCimOutcome(dealId: number, actor: string): Promise<void> {
  const deal = await getNextDeal(dealId);
  if (!deal || deal.stage !== "cim") return;
  const outcome = combineNextCim({
    tristan: deal.cim_verdicts.tristan?.action ?? null,
    partner: deal.cim_verdicts.partner?.action ?? null,
  });
  if (outcome === "cim") return;
  await moveNextStage(dealId, actor, outcome, { onlyFrom: "cim" });
}

export async function clearNextSuperLike(dealId: number): Promise<void> {
  await query(
    `UPDATE deals_next
        SET super_liked_at = NULL, updated_at = now()
      WHERE id = $1 AND super_liked_at IS NOT NULL`,
    [dealId],
  );
}

export async function moveNextStage(
  dealId: number,
  member: string,
  stage: NextStageId,
  options: { onlyFrom?: NextStageId } = {},
): Promise<void> {
  const current = await queryOne<{ stage: string; next_action: string | null }>(
    "SELECT stage, next_action FROM deals_next WHERE id = $1",
    [dealId],
  );
  if (!current) return;
  const from = coerceNextStage(current.stage);
  if (options.onlyFrom && from !== options.onlyFrom) return;
  if (stage === "closed") {
    await clearNextSuperLike(dealId);
  }

  if (from === stage) {
    if (current.stage !== stage) {
      await query(`UPDATE deals_next SET stage = $1, updated_at = now() WHERE id = $2`, [
        stage,
        dealId,
      ]);
    }
    return;
  }

  const nextAction = nextActionAfterCimPack(stage, current.next_action) ?? defaultNextAction(stage);

  await query(
    `UPDATE deals_next
        SET stage = $1,
            stage_changed_at = now(),
            stage_changed_by = $2,
            next_action = $3,
            updated_at = now()
      WHERE id = $4`,
    [stage, member, nextAction, dealId],
  );
  await query(
    `INSERT INTO stage_events_next (deal_id, from_stage, to_stage, member)
     VALUES ($1, $2, $3, $4)`,
    [dealId, from, stage, member],
  );

  const kind = nextFollowupKind(stage);
  if (kind) {
    await query(
      `INSERT INTO next_followups (deal_id, kind, status, armed_by)
       SELECT $1, $2, 'open', $3
        WHERE NOT EXISTS (
          SELECT 1 FROM next_followups
           WHERE deal_id = $1 AND kind = $2 AND status = 'open'
        )`,
      [dealId, kind, member],
    );
  }

  if (stage === "cim") {
    await applyNextCimOutcome(dealId, member);
  }
}

export async function setNextAction(
  dealId: number,
  nextAction: string | null,
): Promise<void> {
  await query(`UPDATE deals_next SET next_action = $1, updated_at = now() WHERE id = $2`, [
    sanitizeNextAction(nextAction),
    dealId,
  ]);
}

const MAX_CIM_BYTES = 4 * 1024 * 1024;

export async function saveNextDealFile(
  dealId: number,
  member: MemberId,
  file: { filename: string; contentType: string; bytes: Uint8Array },
  kind: string = "cim",
  options: { moveToCim?: boolean } = {},
): Promise<{ id: number; url: string }> {
  if (file.bytes.byteLength > MAX_CIM_BYTES) {
    throw new Error(`File too large — max ${MAX_CIM_BYTES / (1024 * 1024)}MB`);
  }
  const rows = await query<{ id: number }>(
    `INSERT INTO deal_files_next (deal_id, member, kind, filename, content_type, bytes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [dealId, member, kind, file.filename, file.contentType, Buffer.from(file.bytes)],
  );
  const id = Number(rows[0]?.id);
  if (!id) throw new Error("Could not store file");
  const url = `/api/next/cim-files/${id}`;
  await query(`UPDATE deals_next SET cim_url = $1, updated_at = now() WHERE id = $2`, [
    url,
    dealId,
  ]);
  if (options.moveToCim !== false) {
    const current = await queryOne<{ stage: string }>(
      "SELECT stage FROM deals_next WHERE id = $1",
      [dealId],
    );
    if (current && shouldAdvanceToCimOnPack(coerceNextStage(current.stage))) {
      await moveNextStage(dealId, member, "cim");
    }
  }
  return { id, url };
}

export async function saveNextCimLink(
  dealId: number,
  member: MemberId,
  url: string,
): Promise<void> {
  const trimmed = url.trim();
  if (!trimmed) return;
  await query(`UPDATE deals_next SET cim_url = $1, updated_at = now() WHERE id = $2`, [
    trimmed,
    dealId,
  ]);
  const current = await queryOne<{ stage: string }>(
    "SELECT stage FROM deals_next WHERE id = $1",
    [dealId],
  );
  if (current && shouldAdvanceToCimOnPack(coerceNextStage(current.stage))) {
    await moveNextStage(dealId, member, "cim");
  }
}

export async function getNextDealFile(id: number): Promise<{
  id: number;
  deal_id: number;
  filename: string;
  content_type: string;
  bytes: Uint8Array;
} | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT id, deal_id, filename, content_type, bytes FROM deal_files_next WHERE id = $1`,
    [id],
  );
  if (!row) return null;
  const raw = row.bytes;
  let bytes: Uint8Array;
  if (raw instanceof Uint8Array) bytes = raw;
  else if (Buffer.isBuffer(raw)) bytes = new Uint8Array(raw);
  else if (typeof raw === "string") bytes = Buffer.from(raw, "base64");
  else bytes = new Uint8Array(0);
  return {
    id: Number(row.id),
    deal_id: Number(row.deal_id),
    filename: String(row.filename),
    content_type: String(row.content_type || "application/octet-stream"),
    bytes,
  };
}

/**
 * Partner (or Simon) note only. Must not write cim_verdicts_next, must not
 * call applyNextCimOutcome, and must not move stage.
 */
export async function addNextNote(dealId: number, member: string, body: string): Promise<void> {
  await query("INSERT INTO notes_next (deal_id, member, body) VALUES ($1, $2, $3)", [
    dealId,
    member,
    body.trim(),
  ]);
}

function noteFromRow(row: Record<string, unknown>): NextNoteRow {
  return {
    id: Number(row.id),
    deal_id: Number(row.deal_id),
    member: String(row.member),
    body: String(row.body),
    created_at: isoString(row.created_at),
  };
}

export async function listNextNotes(dealId: number): Promise<NextNoteRow[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM notes_next WHERE deal_id = $1 ORDER BY created_at DESC",
    [dealId],
  );
  return rows.map(noteFromRow);
}

export async function listNextNotesForDeals(
  dealIds: number[],
): Promise<Map<number, NextNoteRow[]>> {
  const out = new Map<number, NextNoteRow[]>();
  if (dealIds.length === 0) return out;
  const placeholders = dealIds.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM notes_next WHERE deal_id IN (${placeholders}) ORDER BY created_at DESC`,
    dealIds,
  );
  for (const row of rows) {
    const note = noteFromRow(row);
    const bucket = out.get(note.deal_id) ?? [];
    bucket.push(note);
    out.set(note.deal_id, bucket);
  }
  return out;
}

export async function listNextStageEvents(dealId: number): Promise<NextStageEventRow[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM stage_events_next WHERE deal_id = $1 ORDER BY created_at DESC",
    [dealId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    deal_id: Number(row.deal_id),
    from_stage: row.from_stage == null ? null : String(row.from_stage),
    to_stage: String(row.to_stage),
    member: String(row.member),
    created_at: isoString(row.created_at),
  }));
}

export function gmailThreadHrefs(ids: string[]): string[] {
  return ids.filter(Boolean).map(gmailAllHref);
}
