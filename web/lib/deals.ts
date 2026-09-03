import { query, queryOne } from "./db";
import { normalizeGmailThreadUrl } from "./gmail-thread";
import {
  type Deal,
  type DealRow,
  type MemberId,
  type NoteRow,
  type OutreachEventRow,
  type OutreachOutcomeId,
  type StageEventRow,
  type StageId,
  type TrainCriteriaIntent,
  type TrainFlagRow,
  type TrainReason,
  type TrainTheme,
  type VerdictAction,
  type VerdictRow,
  isOutreachOutcomeId,
  stageFromOutcomes,
} from "./model";
import { syncExpectationsFromOutreach } from "./expectations";
import { normalizeAxialHref } from "./playbooks";

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
  const rawUrl = row.url == null ? null : String(row.url);
  return {
    ...(row as unknown as DealRow),
    needs_llm: toStringArray(row.needs_llm),
    first_seen: isoString(row.first_seen),
    last_seen: isoString(row.last_seen),
    stage_changed_at: row.stage_changed_at ? isoString(row.stage_changed_at) : null,
    // Axial Pass/decline → Pursue so every UI link is safe even if Neon still has old URLs.
    url: normalizeAxialHref(rawUrl) ?? rawUrl,
    cim_url: row.cim_url == null ? null : String(row.cim_url),
    nda_url: row.nda_url == null ? null : String(row.nda_url),
    gmail_thread_url: normalizeGmailThreadUrl(
      row.gmail_thread_url == null ? null : String(row.gmail_thread_url),
    ),
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

function normalizeTrainFlag(row: Record<string, unknown>): TrainFlagRow {
  let inspection: Record<string, unknown> | null = null;
  const rawInspection = row.inspection;
  if (rawInspection && typeof rawInspection === "object" && !Array.isArray(rawInspection)) {
    inspection = rawInspection as Record<string, unknown>;
  } else if (typeof rawInspection === "string") {
    try {
      const parsed = JSON.parse(rawInspection);
      if (parsed && typeof parsed === "object") inspection = parsed as Record<string, unknown>;
    } catch {
      inspection = null;
    }
  }
  const reason = String(row.reason);
  const rawTheme = row.theme == null ? null : String(row.theme);
  const theme =
    rawTheme === "criteria" || rawTheme === "listing"
      ? rawTheme
      : reason === "Should be excluded" || reason === "Request criteria change"
        ? "criteria"
        : "listing";
  const rawIntent = row.criteria_intent == null ? null : String(row.criteria_intent);
  const criteria_intent =
    rawIntent === "exclusion_miss" || rawIntent === "criteria_change"
      ? rawIntent
      : reason === "Should be excluded"
        ? "exclusion_miss"
        : reason === "Request criteria change"
          ? "criteria_change"
          : null;
  return {
    deal_id: Number(row.deal_id),
    member: row.member as TrainFlagRow["member"],
    theme,
    criteria_intent: theme === "criteria" ? criteria_intent : null,
    reason,
    detail: (row.detail as string | null) ?? null,
    format_id: (row.format_id as string | null) ?? null,
    inspection,
    created_at: isoString(row.created_at),
    updated_at: isoString(row.updated_at),
  };
}

function normalizeOutreach(row: Record<string, unknown>): OutreachEventRow {
  const raw = row.outcomes;
  let outcomes: OutreachOutcomeId[] = [];
  if (Array.isArray(raw)) {
    outcomes = raw.filter(isOutreachOutcomeId);
  } else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) outcomes = parsed.filter(isOutreachOutcomeId);
    } catch {
      outcomes = [];
    }
  }
  return {
    id: Number(row.id),
    deal_id: Number(row.deal_id),
    member: row.member as MemberId,
    outcomes,
    note: (row.note as string | null) ?? null,
    cim_url: (row.cim_url as string | null) ?? null,
    created_at: isoString(row.created_at),
  };
}

async function attachExtras(rows: DealRow[]): Promise<Deal[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");

  const [verdicts, flags, outreach] = await Promise.all([
    query<Record<string, unknown>>(
      `SELECT * FROM verdicts WHERE deal_id IN (${placeholders})`,
      ids,
    ),
    query<Record<string, unknown>>(
      `SELECT * FROM train_flags WHERE deal_id IN (${placeholders})`,
      ids,
    ),
    query<Record<string, unknown>>(
      `SELECT DISTINCT ON (deal_id) *
       FROM outreach_events
       WHERE deal_id IN (${placeholders})
       ORDER BY deal_id, created_at DESC`,
      ids,
    ).catch(() => [] as Record<string, unknown>[]),
  ]);

  const verdictsByDeal = new Map<number, Deal["verdicts"]>();
  for (const raw of verdicts) {
    const verdict = normalizeVerdict(raw);
    const bucket = verdictsByDeal.get(verdict.deal_id) ?? {};
    bucket[verdict.member] = verdict;
    verdictsByDeal.set(verdict.deal_id, bucket);
  }

  const flagsByDeal = new Map<number, Deal["trainFlags"]>();
  for (const raw of flags) {
    const flag = normalizeTrainFlag(raw);
    const bucket = flagsByDeal.get(flag.deal_id) ?? {};
    bucket[flag.member] = flag;
    flagsByDeal.set(flag.deal_id, bucket);
  }

  const outreachByDeal = new Map<number, OutreachEventRow>();
  for (const raw of outreach) {
    const event = normalizeOutreach(raw);
    outreachByDeal.set(event.deal_id, event);
  }

  return rows.map((row) => ({
    ...row,
    verdicts: verdictsByDeal.get(row.id) ?? {},
    trainFlags: flagsByDeal.get(row.id) ?? {},
    latestOutreach: outreachByDeal.get(row.id) ?? null,
  }));
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
  return attachExtras(rows.map(normalizeDeal));
}

export async function listBoardDeals(): Promise<Deal[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM v_deals
     WHERE stage <> 'inbox'
     ORDER BY earnings DESC NULLS LAST, id DESC`,
  );
  return attachExtras(rows.map(normalizeDeal));
}

export async function getDeal(id: number): Promise<Deal | null> {
  const row = await queryOne<Record<string, unknown>>("SELECT * FROM v_deals WHERE id = $1", [id]);
  if (!row) return null;
  const [deal] = await attachExtras([normalizeDeal(row)]);
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
  note: string | null = null,
): Promise<void> {
  await query(
    `INSERT INTO verdicts (deal_id, member, action, reason, note)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (deal_id, member) DO UPDATE
       SET action = excluded.action,
           reason = excluded.reason,
           note = excluded.note,
           updated_at = now()`,
    [dealId, member, action, reason, note],
  );

  if (action === "short") {
    await moveStage(dealId, member, "shortlist", { onlyFrom: "inbox" });
  }
}

export async function clearVerdict(dealId: number, member: MemberId): Promise<void> {
  await query("DELETE FROM verdicts WHERE deal_id = $1 AND member = $2", [dealId, member]);
}

/** Flag a listing for repertoire (listing) or buy-box queue (criteria). Does not touch triage. */
export async function setTrainFlag(
  dealId: number,
  member: MemberId,
  reason: TrainReason,
  detail: string | null = null,
  options: {
    theme?: TrainTheme;
    criteriaIntent?: TrainCriteriaIntent | null;
    formatId?: string | null;
    inspection?: Record<string, unknown> | null;
  } = {},
): Promise<void> {
  const theme = options.theme ?? "listing";
  const criteriaIntent = theme === "criteria" ? (options.criteriaIntent ?? null) : null;
  await query(
    `INSERT INTO train_flags (deal_id, member, theme, criteria_intent, reason, detail, format_id, inspection)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (deal_id, member) DO UPDATE
       SET theme = excluded.theme,
           criteria_intent = excluded.criteria_intent,
           reason = excluded.reason,
           detail = excluded.detail,
           format_id = excluded.format_id,
           inspection = excluded.inspection,
           updated_at = now()`,
    [
      dealId,
      member,
      theme,
      criteriaIntent,
      reason,
      detail,
      options.formatId ?? null,
      options.inspection ? JSON.stringify(options.inspection) : null,
    ],
  );
}

export async function clearTrainFlag(dealId: number, member: MemberId): Promise<void> {
  await query("DELETE FROM train_flags WHERE deal_id = $1 AND member = $2", [dealId, member]);
}

/** Manual correction from Train AI review — updates listing fields without a full re-import. */
export async function updateDealListing(
  dealId: number,
  fields: {
    title?: string;
    blurb?: string | null;
    revenue?: number | null;
    ebitda?: number | null;
    sde?: number | null;
    asking?: number | null;
  },
): Promise<Deal | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  for (const key of ["title", "blurb", "revenue", "ebitda", "sde", "asking"] as const) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = $${i++}`);
      vals.push(fields[key]);
    }
  }
  if (!sets.length) {
    return getDeal(dealId);
  }
  sets.push("updated_at = now()");
  vals.push(dealId);
  await query(`UPDATE deals SET ${sets.join(", ")} WHERE id = $${i}`, vals);
  return getDeal(dealId);
}

/** Open Train-AI queue with deal attribution — for repertoire follow-up. */
export async function listTrainFlags(): Promise<
  Array<
    TrainFlagRow & {
      ext_id: string;
      title: string;
      source: string | null;
      sub_source: string | null;
      nickname: string | null;
      revenue: number | null;
      ebitda: number | null;
      sde: number | null;
      asking: number | null;
      blurb: string | null;
    }
  >
> {
  const rows = await query<Record<string, unknown>>(
    `SELECT f.*, d.ext_id, d.title, d.source, d.sub_source, d.nickname,
            d.revenue, d.ebitda, d.sde, d.asking, d.blurb
       FROM train_flags f
       JOIN deals d ON d.id = f.deal_id
      ORDER BY f.updated_at DESC`,
  );
  return rows.map((row) => ({
    ...normalizeTrainFlag(row),
    ext_id: String(row.ext_id ?? ""),
    title: String(row.title ?? ""),
    source: (row.source as string | null) ?? null,
    sub_source: (row.sub_source as string | null) ?? null,
    nickname: (row.nickname as string | null) ?? null,
    revenue: row.revenue == null ? null : Number(row.revenue),
    ebitda: row.ebitda == null ? null : Number(row.ebitda),
    sde: row.sde == null ? null : Number(row.sde),
    asking: row.asking == null ? null : Number(row.asking),
    blurb: (row.blurb as string | null) ?? null,
  }));
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

/** Save action-deck debrief; advance stage from chips; store CIM link when provided. */
export async function recordOutreach(
  dealId: number,
  member: MemberId,
  outcomes: OutreachOutcomeId[],
  note: string | null = null,
  cimUrl: string | null = null,
): Promise<void> {
  const trimmedCim = cimUrl?.trim() || null;
  const trimmedNote = note?.trim() || null;

  await query(
    `INSERT INTO outreach_events (deal_id, member, outcomes, note, cim_url)
     VALUES ($1, $2, $3::jsonb, $4, $5)`,
    [dealId, member, JSON.stringify(outcomes), trimmedNote, trimmedCim],
  );

  if (trimmedCim) {
    await query(`UPDATE deals SET cim_url = $1, updated_at = now() WHERE id = $2`, [
      trimmedCim,
      dealId,
    ]);
  }

  const nextStage = stageFromOutcomes(outcomes);
  if (nextStage) {
    await moveStage(dealId, member, nextStage);
  }

  // Arm / fulfill inbox watches — shortlist alone does not; Act does.
  await syncExpectationsFromOutreach(dealId, member, outcomes, trimmedNote);
}

const MAX_CIM_BYTES = 4 * 1024 * 1024; // Vercel request body ceiling

export { MAX_CIM_BYTES };

/** Create a pipeline deal from a reviewed CIM extract (lands at stage `cim`). */
export async function createDealFromCim(
  member: MemberId,
  draft: {
    title: string;
    blurb: string | null;
    city: string | null;
    state: string | null;
    revenue: number | null;
    ebitda: number | null;
    sde: number | null;
    asking: number | null;
    businessModelType: string | null;
    url: string | null;
  },
  file?: { filename: string; contentType: string; bytes: Uint8Array },
): Promise<Deal> {
  const title = draft.title.trim();
  if (!title) throw new Error("Title is required.");

  const extId = `cim:${crypto.randomUUID()}`;
  const needs: string[] = [];
  if (draft.ebitda == null && draft.sde == null) needs.push("earnings");
  if (!draft.state) needs.push("location");

  const rows = await query<{ id: number }>(
    `INSERT INTO deals (
       ext_id, title, blurb, source, sub_source, nickname, sources,
       city, state, county,
       revenue, ebitda, sde, asking, business_model_type, needs_llm, url,
       stage, stage_changed_at, stage_changed_by,
       first_seen, last_seen, times_seen
     ) VALUES (
       $1, $2, $3, 'manual', $4, 'CIM upload', 'manual',
       $5, $6, NULL,
       $7, $8, $9, $10, $11, $12::jsonb, $13,
       'cim', now(), $14,
       now(), now(), 1
     )
     RETURNING id`,
    [
      extId,
      title,
      draft.blurb?.trim() || null,
      member,
      draft.city?.trim() || null,
      draft.state?.trim() || null,
      draft.revenue,
      draft.ebitda,
      draft.sde,
      draft.asking,
      draft.businessModelType?.trim() || "",
      JSON.stringify(needs),
      normalizeAxialHref(draft.url) ?? (draft.url?.trim() || null),
      member,
    ],
  );
  const id = Number(rows[0]?.id);
  if (!id) throw new Error("Could not create deal.");

  await query(
    `INSERT INTO stage_events (deal_id, from_stage, to_stage, member) VALUES ($1, NULL, 'cim', $2)`,
    [id, member],
  );
  // Short so it shows as yours on the board; stage stays `cim` (setVerdict only
  // promotes inbox → shortlist).
  await setVerdict(id, member, "short", null, null);

  if (file) {
    await saveDealFile(id, member, file);
  }

  const deal = await getDeal(id);
  if (!deal) throw new Error("Deal created but could not reload.");
  return deal;
}

/** Store an uploaded CIM and point deals.cim_url at the serve route. */
export async function saveDealFile(
  dealId: number,
  member: MemberId,
  file: { filename: string; contentType: string; bytes: Uint8Array },
  kind: string = "cim",
): Promise<{ id: number; url: string }> {
  if (file.bytes.byteLength > MAX_CIM_BYTES) {
    throw new Error(`File too large — max ${MAX_CIM_BYTES / (1024 * 1024)}MB`);
  }
  const rows = await query<{ id: number }>(
    `INSERT INTO deal_files (deal_id, member, kind, filename, content_type, bytes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [dealId, member, kind, file.filename, file.contentType, Buffer.from(file.bytes)],
  );
  const id = Number(rows[0]?.id);
  if (!id) throw new Error("Could not store file");
  const url = `/api/deal-files/${id}`;
  await query(`UPDATE deals SET cim_url = $1, updated_at = now() WHERE id = $2`, [url, dealId]);
  return { id, url };
}

export async function getDealFile(id: number): Promise<{
  id: number;
  deal_id: number;
  filename: string;
  content_type: string;
  bytes: Uint8Array;
} | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT id, deal_id, filename, content_type, bytes FROM deal_files WHERE id = $1`,
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
