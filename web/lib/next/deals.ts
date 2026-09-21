import { query, queryOne } from "../db";
import { normalizeAxialHref } from "../playbooks";
import { logDealChange } from "./change-log";
import { formatDealNumber, gmailAllHref, parseDealNumber } from "./identity";
import {
  type MemberId,
  type NextDeal,
  type NextDealRow,
  type NextNoteRow,
  type NextStageEventRow,
  type NextStageId,
  type NextVerdictRow,
  type NextWatch,
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
import { formatDuplicateOf, isNextRemintCard, parseIngestDisposition } from "./remint";

/**
 * Storage is the two-table model: deals_next holds current state (votes and
 * notes are member columns — members are fixed), deal_log is the append-only
 * audit trail. The in-memory NextDeal shape (verdict maps, note rows) is
 * unchanged, synthesized from columns, so decks/boards/cards read as before.
 */

/** Member id → column prefix. Jim's member id is 'partner'. */
const MEMBER_PREFIX: Record<MemberId, "tristan" | "jim"> = {
  tristan: "tristan",
  partner: "jim",
};

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

function toWatches(value: unknown): NextWatch[] {
  return toJsonArray(value)
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      kind: String(item.kind ?? ""),
      status: String(item.status ?? "open"),
      armed_by: item.armed_by == null ? null : String(item.armed_by),
      armed_at: item.armed_at == null ? null : isoString(item.armed_at),
      due_at: item.due_at == null ? null : isoString(item.due_at),
      note: item.note == null ? null : String(item.note),
    }))
    .filter((watch) => watch.kind);
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
    alias_numbers: toStringArray(row.alias_numbers),
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
    cim_name:
      row.cim_name == null || String(row.cim_name).trim() === ""
        ? null
        : String(row.cim_name).trim(),
    blurb: row.blurb == null ? null : String(row.blurb),
    source: row.source == null ? null : String(row.source),
    sub_source: row.sub_source == null ? null : String(row.sub_source),
    nickname: row.nickname == null ? null : String(row.nickname),
    source_domains: toStringArray(row.source_domains),
    city: row.city == null ? null : String(row.city),
    state: row.state == null ? null : String(row.state),
    county: row.county == null ? null : String(row.county),
    region: row.region == null ? null : String(row.region),
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
    cim_access_note: row.cim_access_note == null ? null : String(row.cim_access_note),
    nda_url: row.nda_url == null ? null : String(row.nda_url),
    super_liked_at: row.super_liked_at ? isoString(row.super_liked_at) : null,
    super_liked_by: row.super_liked_by == null ? null : String(row.super_liked_by),
    watches: toWatches(row.watches),
    duplicate_of: formatDuplicateOf(row.duplicate_of),
    ingest_disposition: parseIngestDisposition(row.ingest_disposition),
    earnings: row.earnings == null ? null : Number(row.earnings),
    earnings_basis:
      row.earnings_basis === "EBITDA" || row.earnings_basis === "SDE" ? row.earnings_basis : null,
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

const VERDICT_ACTION_SET = new Set(["short", "pass", "discuss"]);

function verdictFromColumns(
  row: Record<string, unknown>,
  dealId: number,
  member: MemberId,
  kind: "verdict" | "cim_verdict",
): NextVerdictRow | null {
  const prefix = MEMBER_PREFIX[member];
  const base = kind === "verdict" ? `${prefix}_verdict` : `${prefix}_cim_verdict`;
  const action = row[base];
  if (action == null || !VERDICT_ACTION_SET.has(String(action))) return null;
  const at = row[`${base}_at`] ? isoString(row[`${base}_at`]) : isoString(null);
  return {
    deal_id: dealId,
    member,
    action: String(action) as VerdictAction,
    reason:
      kind === "verdict" && row[`${base}_reason`] != null ? String(row[`${base}_reason`]) : null,
    note: row[`${base}_note`] == null ? null : String(row[`${base}_note`]),
    created_at: at,
    updated_at: at,
  };
}

function buildNextDeal(row: Record<string, unknown>): NextDeal {
  const deal = normalizeDeal(row);
  const verdicts: NextDeal["verdicts"] = {};
  const cimVerdicts: NextDeal["cim_verdicts"] = {};
  for (const member of ["tristan", "partner"] as MemberId[]) {
    const verdict = verdictFromColumns(row, deal.id, member, "verdict");
    if (verdict) verdicts[member] = verdict;
    const cim = verdictFromColumns(row, deal.id, member, "cim_verdict");
    if (cim) cimVerdicts[member] = cim;
  }
  return { ...deal, verdicts, cim_verdicts: cimVerdicts };
}

export async function listNextDeals(): Promise<NextDeal[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM v_deals_next
     ORDER BY super_liked_at DESC NULLS LAST, earnings DESC NULLS LAST, last_seen DESC, id DESC`,
  );
  return rows.map(buildNextDeal);
}

/** Inbound queue for `/next` Review → New. Board stages and remints never belong here. */
export async function listNextInboxDeals(): Promise<NextDeal[]> {
  const deals = await listNextDeals();
  return deals.filter((deal) => deal.stage === "inbox" && !isNextRemintCard(deal));
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
  return rows.map(buildNextDeal).filter((deal) => deal.stage !== "inbox");
}

export async function getNextDeal(id: number): Promise<NextDeal | null> {
  const row = await queryOne<Record<string, unknown>>("SELECT * FROM v_deals_next WHERE id = $1", [
    id,
  ]);
  return row ? buildNextDeal(row) : null;
}

export type NextDealRouteRef =
  | { kind: "id"; id: number }
  | { kind: "number"; dealNumber: string };

/**
 * `/next/deals/[id]` accepts a numeric DB id, `TLY-013` (any case / padding),
 * or a zero-padded bare number (`013` → TLY-013). Plain `13` stays a DB id.
 */
export function parseNextDealRouteParam(raw: string | null | undefined): NextDealRouteRef | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;

  const tly = parseDealNumber(trimmed);
  if (tly) return { kind: "number", dealNumber: formatDealNumber(tly) };

  if (/^0+\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isInteger(n) && n > 0) return { kind: "number", dealNumber: formatDealNumber(n) };
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    const id = Number(trimmed);
    if (Number.isInteger(id) && id > 0) return { kind: "id", id };
  }
  return null;
}

/** Stable punch-list URL: `/next/deals/TLY-XXX`. */
export function nextDealPublicPath(dealNumber: string | null | undefined): string | null {
  const n = parseDealNumber(dealNumber);
  return n ? `/next/deals/${formatDealNumber(n)}` : null;
}

export async function getNextDealByRouteParam(raw: string): Promise<NextDeal | null> {
  const parsed = parseNextDealRouteParam(raw);
  if (!parsed) return null;
  if (parsed.kind === "id") return getNextDeal(parsed.id);

  const row = await queryOne<{ id: number }>(
    "SELECT id FROM deals_next WHERE UPPER(deal_number) = $1 OR alias_numbers ? $1",
    [parsed.dealNumber],
  );
  if (!row) return null;
  return getNextDeal(Number(row.id));
}

interface WriteMeta {
  channel?: string;
  onBehalfOf?: string | null;
  reason?: string | null;
  sourceRef?: string | null;
}

export async function setNextVerdict(
  dealId: number,
  member: MemberId,
  action: VerdictAction,
  reason: string | null,
  note: string | null = null,
  meta: WriteMeta = {},
): Promise<void> {
  const prefix = MEMBER_PREFIX[member];
  const before = await queryOne<Record<string, unknown>>(
    `SELECT deal_number, ${prefix}_verdict AS old_action FROM deals_next WHERE id = $1`,
    [dealId],
  );
  if (!before) return;
  await query(
    `UPDATE deals_next
        SET ${prefix}_verdict = $1,
            ${prefix}_verdict_reason = $2,
            ${prefix}_verdict_note = $3,
            ${prefix}_verdict_at = now(),
            updated_at = now()
      WHERE id = $4`,
    [action, reason, note, dealId],
  );
  await logDealChange({
    dealId,
    dealNumber: String(before.deal_number ?? ""),
    actor: member,
    onBehalfOf: meta.onBehalfOf ?? null,
    kind: "verdict",
    patch: { [`${prefix}_verdict`]: { old: before.old_action ?? null, new: action } },
    reason,
    channel: meta.channel ?? "ui:review",
  });

  if (action === "short" || action === "pass") {
    await clearNextSuperLike(dealId);
  }

  await applyNextReviewOutcome(dealId, member);
}

export async function clearNextVerdict(
  dealId: number,
  member: MemberId,
  meta: WriteMeta = {},
): Promise<void> {
  const prefix = MEMBER_PREFIX[member];
  const before = await queryOne<Record<string, unknown>>(
    `SELECT deal_number, ${prefix}_verdict AS old_action FROM deals_next WHERE id = $1`,
    [dealId],
  );
  if (!before || before.old_action == null) return;
  await query(
    `UPDATE deals_next
        SET ${prefix}_verdict = NULL,
            ${prefix}_verdict_reason = NULL,
            ${prefix}_verdict_note = NULL,
            ${prefix}_verdict_at = NULL,
            updated_at = now()
      WHERE id = $1`,
    [dealId],
  );
  await logDealChange({
    dealId,
    dealNumber: String(before.deal_number ?? ""),
    actor: member,
    kind: "verdict",
    patch: { [`${prefix}_verdict`]: { old: before.old_action, new: null } },
    channel: meta.channel ?? "ui:review",
  });
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
  meta: WriteMeta = {},
): Promise<string | null> {
  if (!liked) {
    await clearNextSuperLike(dealId, member, meta);
    return null;
  }
  const rows = await query<{ super_liked_at: unknown; deal_number: unknown }>(
    `UPDATE deals_next
        SET super_liked_at = now(), super_liked_by = $2, updated_at = now()
      WHERE id = $1
    RETURNING super_liked_at, deal_number`,
    [dealId, member],
  );
  const raw = rows[0]?.super_liked_at;
  const at = raw ? isoString(raw) : null;
  await logDealChange({
    dealId,
    dealNumber: String(rows[0]?.deal_number ?? ""),
    actor: member,
    kind: "super_like",
    patch: { super_liked_at: { old: null, new: at } },
    channel: meta.channel ?? "ui:review",
  });
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
  meta: WriteMeta = {},
): Promise<void> {
  if (!isMemberId(member)) return;
  const prefix = MEMBER_PREFIX[member];
  const before = await queryOne<Record<string, unknown>>(
    `SELECT deal_number, ${prefix}_cim_verdict AS old_action FROM deals_next WHERE id = $1`,
    [dealId],
  );
  if (!before) return;
  await query(
    `UPDATE deals_next
        SET ${prefix}_cim_verdict = $1,
            ${prefix}_cim_verdict_note = $2,
            ${prefix}_cim_verdict_at = now(),
            updated_at = now()
      WHERE id = $3`,
    [action, note, dealId],
  );
  await logDealChange({
    dealId,
    dealNumber: String(before.deal_number ?? ""),
    actor: member,
    kind: "cim_verdict",
    patch: { [`${prefix}_cim_verdict`]: { old: before.old_action ?? null, new: action } },
    channel: meta.channel ?? "ui:cim-review",
  });
  await applyNextCimOutcome(dealId, member);
}

export async function clearNextCimVerdict(
  dealId: number,
  member: MemberId,
  meta: WriteMeta = {},
): Promise<void> {
  if (!isMemberId(member)) return;
  const prefix = MEMBER_PREFIX[member];
  const before = await queryOne<Record<string, unknown>>(
    `SELECT deal_number, ${prefix}_cim_verdict AS old_action FROM deals_next WHERE id = $1`,
    [dealId],
  );
  if (!before || before.old_action == null) return;
  await query(
    `UPDATE deals_next
        SET ${prefix}_cim_verdict = NULL,
            ${prefix}_cim_verdict_note = NULL,
            ${prefix}_cim_verdict_at = NULL,
            updated_at = now()
      WHERE id = $1`,
    [dealId],
  );
  await logDealChange({
    dealId,
    dealNumber: String(before.deal_number ?? ""),
    actor: member,
    kind: "cim_verdict",
    patch: { [`${prefix}_cim_verdict`]: { old: before.old_action, new: null } },
    channel: meta.channel ?? "ui:cim-review",
  });
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

export async function clearNextSuperLike(
  dealId: number,
  actor: string = "system",
  meta: WriteMeta = {},
): Promise<void> {
  const rows = await query<{ deal_number: unknown }>(
    `UPDATE deals_next
        SET super_liked_at = NULL, super_liked_by = NULL, updated_at = now()
      WHERE id = $1 AND super_liked_at IS NOT NULL
    RETURNING deal_number`,
    [dealId],
  );
  if (rows.length === 0) return;
  await logDealChange({
    dealId,
    dealNumber: String(rows[0]?.deal_number ?? ""),
    actor,
    kind: "super_like",
    patch: { super_liked_at: { new: null } },
    channel: meta.channel ?? "app",
  });
}

export async function moveNextStage(
  dealId: number,
  member: string,
  stage: NextStageId,
  options: { onlyFrom?: NextStageId; channel?: string; onBehalfOf?: string | null } = {},
): Promise<void> {
  const current = await queryOne<{
    stage: string;
    next_action: string | null;
    deal_number: string;
    watches: unknown;
  }>("SELECT stage, next_action, deal_number, watches FROM deals_next WHERE id = $1", [dealId]);
  if (!current) return;
  const from = coerceNextStage(current.stage);
  if (options.onlyFrom && from !== options.onlyFrom) return;
  if (stage === "closed") {
    await clearNextSuperLike(dealId, member);
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
  await logDealChange({
    dealId,
    dealNumber: current.deal_number,
    actor: member,
    onBehalfOf: options.onBehalfOf ?? null,
    kind: "stage",
    patch: { stage: { old: from, new: stage } },
    channel: options.channel ?? "app",
  });

  const kind = nextFollowupKind(stage);
  if (kind) {
    const watches = toWatches(current.watches);
    const alreadyOpen = watches.some((w) => w.kind === kind && w.status === "open");
    if (!alreadyOpen) {
      const armed: NextWatch = {
        kind,
        status: "open",
        armed_by: member,
        armed_at: new Date().toISOString(),
        due_at: null,
        note: null,
      };
      await query(
        `UPDATE deals_next SET watches = watches || $1::jsonb, updated_at = now() WHERE id = $2`,
        [JSON.stringify([armed]), dealId],
      );
      await logDealChange({
        dealId,
        dealNumber: current.deal_number,
        actor: member,
        kind: "watch",
        patch: { watches: { new: armed } },
        channel: options.channel ?? "app",
      });
    }
  }

  if (stage === "cim") {
    await applyNextCimOutcome(dealId, member);
  }
}

export async function setNextAction(dealId: number, nextAction: string | null): Promise<void> {
  await query(`UPDATE deals_next SET next_action = $1, updated_at = now() WHERE id = $2`, [
    sanitizeNextAction(nextAction),
    dealId,
  ]);
}

export async function saveNextCimLink(
  dealId: number,
  member: MemberId,
  url: string,
  meta: WriteMeta = {},
): Promise<void> {
  const trimmed = url.trim();
  if (!trimmed) return;
  const before = await queryOne<{ cim_url: string | null; deal_number: string }>(
    "SELECT cim_url, deal_number FROM deals_next WHERE id = $1",
    [dealId],
  );
  if (!before) return;
  await query(`UPDATE deals_next SET cim_url = $1, updated_at = now() WHERE id = $2`, [
    trimmed,
    dealId,
  ]);
  await logDealChange({
    dealId,
    dealNumber: before.deal_number,
    actor: member,
    kind: "update",
    patch: { cim_url: { old: before.cim_url, new: trimmed } },
    channel: meta.channel ?? "ui:attach-cim",
  });
  const current = await queryOne<{ stage: string }>(
    "SELECT stage FROM deals_next WHERE id = $1",
    [dealId],
  );
  if (current && shouldAdvanceToCimOnPack(coerceNextStage(current.stage))) {
    await moveNextStage(dealId, member, "cim", { channel: meta.channel ?? "ui:attach-cim" });
  }
}

/** Legacy stored CIM blobs (uploads are retired — packs are URLs now). */
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

const NOTE_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "UTC",
});

function stampedNote(body: string): string {
  return `${NOTE_DATE_FMT.format(new Date())} — ${body.trim()}`;
}

/**
 * Partner note → appended to that member's notes column (dated). Any other
 * actor (Simon etc.) becomes a log-only note: visible in history and on /db,
 * never on partner cards. Never writes votes, never moves stage.
 */
export async function addNextNote(
  dealId: number,
  member: string,
  body: string,
  meta: WriteMeta = {},
): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) return;
  const before = await queryOne<Record<string, unknown>>(
    "SELECT deal_number, tristan_notes, jim_notes FROM deals_next WHERE id = $1",
    [dealId],
  );
  if (!before) return;

  if (isMemberId(member)) {
    const column = `${MEMBER_PREFIX[member]}_notes`;
    const old = before[column] == null ? null : String(before[column]);
    const next = old && old.trim() ? `${old}\n\n${stampedNote(trimmed)}` : stampedNote(trimmed);
    await query(`UPDATE deals_next SET ${column} = $1, updated_at = now() WHERE id = $2`, [
      next,
      dealId,
    ]);
    await logDealChange({
      dealId,
      dealNumber: String(before.deal_number ?? ""),
      actor: member,
      kind: "note",
      patch: { note: { new: trimmed } },
      channel: meta.channel ?? "ui:notes",
    });
    return;
  }

  await logDealChange({
    dealId,
    dealNumber: String(before.deal_number ?? ""),
    actor: member,
    onBehalfOf: meta.onBehalfOf ?? null,
    kind: "note",
    patch: { note: { new: trimmed } },
    reason: meta.reason ?? null,
    channel: meta.channel ?? "api:next",
  });
}

function notesFromColumns(row: Record<string, unknown>): NextNoteRow[] {
  const dealId = Number(row.id);
  const updated = row.updated_at ? isoString(row.updated_at) : isoString(null);
  const out: NextNoteRow[] = [];
  const tristan = row.tristan_notes == null ? "" : String(row.tristan_notes).trim();
  if (tristan) {
    out.push({ id: dealId * 10 + 1, deal_id: dealId, member: "tristan", body: tristan, created_at: updated });
  }
  const jim = row.jim_notes == null ? "" : String(row.jim_notes).trim();
  if (jim) {
    out.push({ id: dealId * 10 + 2, deal_id: dealId, member: "partner", body: jim, created_at: updated });
  }
  return out;
}

export async function listNextNotes(dealId: number): Promise<NextNoteRow[]> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT id, updated_at, tristan_notes, jim_notes FROM deals_next WHERE id = $1",
    [dealId],
  );
  return row ? notesFromColumns(row) : [];
}

export async function listNextNotesForDeals(
  dealIds: number[],
): Promise<Map<number, NextNoteRow[]>> {
  const out = new Map<number, NextNoteRow[]>();
  if (dealIds.length === 0) return out;
  const placeholders = dealIds.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await query<Record<string, unknown>>(
    `SELECT id, updated_at, tristan_notes, jim_notes FROM deals_next WHERE id IN (${placeholders})`,
    dealIds,
  );
  for (const row of rows) {
    out.set(Number(row.id), notesFromColumns(row));
  }
  return out;
}

/** Stage history now reads from deal_log (kind = stage). */
export async function listNextStageEvents(dealId: number): Promise<NextStageEventRow[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT id, deal_id, actor, patch, created_at
       FROM deal_log
      WHERE deal_id = $1 AND kind = 'stage' AND status = 'applied'
      ORDER BY created_at DESC`,
    [dealId],
  );
  return rows.map((row) => {
    let patch: Record<string, { old?: unknown; new?: unknown }> = {};
    if (row.patch && typeof row.patch === "object") {
      patch = row.patch as typeof patch;
    } else if (typeof row.patch === "string") {
      try {
        patch = JSON.parse(row.patch) as typeof patch;
      } catch {
        patch = {};
      }
    }
    return {
      id: Number(row.id),
      deal_id: Number(row.deal_id),
      from_stage: patch.stage?.old == null ? null : String(patch.stage.old),
      to_stage: patch.stage?.new == null ? "" : String(patch.stage.new),
      member: String(row.actor ?? ""),
      created_at: isoString(row.created_at),
    };
  });
}

export function gmailThreadHrefs(ids: string[]): string[] {
  return ids.filter(Boolean).map(gmailAllHref);
}
