import { query, queryOne } from "../db";

/**
 * The audit trail. Table 2 of the two-table design: deal_log tracks deals_next
 * but is not deals_next. Append-only — applied changes are history, rejected
 * agent submissions are the intake monitor, needs_review rows are the
 * attention queue. The only status flip allowed is resolving a needs_review
 * (→ confirmed / dismissed); applied rows are never touched.
 */

export type DealLogKind =
  | "create"
  | "update"
  | "stage"
  | "verdict"
  | "cim_verdict"
  | "note"
  | "super_like"
  | "merge"
  | "import"
  | "watch";

export type DealLogStatus = "applied" | "rejected" | "needs_review" | "confirmed" | "dismissed";

export type DealPatch = Record<string, { old?: unknown; new?: unknown }>;

export interface DealLogEntry {
  dealId?: number | null;
  dealNumber?: string | null;
  actor: string;
  onBehalfOf?: string | null;
  kind: DealLogKind;
  patch?: DealPatch;
  reason?: string | null;
  sourceRef?: string | null;
  channel: string;
  status?: DealLogStatus;
  error?: string | null;
  idempotencyKey?: string | null;
}

export interface DealLogRow {
  id: number;
  deal_id: number | null;
  deal_number: string | null;
  actor: string;
  on_behalf_of: string | null;
  kind: DealLogKind;
  patch: DealPatch;
  reason: string | null;
  source_ref: string | null;
  channel: string;
  status: DealLogStatus;
  error: string | null;
  created_at: string;
}

export async function logDealChange(entry: DealLogEntry): Promise<number> {
  const rows = await query<{ id: number }>(
    `INSERT INTO deal_log
       (deal_id, deal_number, actor, on_behalf_of, kind, patch, reason,
        source_ref, channel, status, error, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      entry.dealId ?? null,
      entry.dealNumber ?? null,
      entry.actor,
      entry.onBehalfOf ?? null,
      entry.kind,
      JSON.stringify(entry.patch ?? {}),
      entry.reason ?? null,
      entry.sourceRef ?? null,
      entry.channel,
      entry.status ?? "applied",
      entry.error ?? null,
      entry.idempotencyKey ?? null,
    ],
  );
  return Number(rows[0]?.id ?? 0);
}

/** Prior submission with the same (actor, idempotency_key), if any. */
export async function findByIdempotencyKey(
  actor: string,
  key: string | null | undefined,
): Promise<DealLogRow | null> {
  const trimmed = key?.trim();
  if (!trimmed) return null;
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM deal_log WHERE actor = $1 AND idempotency_key = $2",
    [actor, trimmed],
  );
  return row ? normalizeLogRow(row) : null;
}

/**
 * Columns applyDealChange may write. Everything else (id, deal_number,
 * created_at, vote columns — those go through their own kinds) is off-limits
 * to a generic patch.
 */
const MUTABLE_COLUMNS = new Set([
  "title",
  "cim_name",
  "blurb",
  "url",
  "source",
  "sub_source",
  "nickname",
  "broker_firm",
  "city",
  "state",
  "county",
  "asking",
  "revenue",
  "sde",
  "ebitda",
  "margin",
  "next_action",
  "cim_url",
  "cim_access_note",
  "nda_url",
  "tristan_notes",
  "jim_notes",
  "watches",
  "gmail_thread_ids",
]);

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }
  return String(a ?? "") === String(b ?? "");
}

export interface ApplyDealChangeInput {
  dealId: number;
  actor: string;
  onBehalfOf?: string | null;
  kind?: DealLogKind;
  channel: string;
  reason?: string | null;
  sourceRef?: string | null;
  idempotencyKey?: string | null;
  /** Desired new values by column name (allowlisted). */
  fields: Record<string, unknown>;
}

export interface ApplyDealChangeResult {
  changed: string[];
  logId: number | null;
  dealNumber: string;
}

/**
 * The single write path for deal fields: diff old→new, update only what
 * changed, and record the patch in deal_log — one transaction-equivalent
 * sequence, one audit entry. No-ops write nothing (including no log spam).
 */
export async function applyDealChange(input: ApplyDealChangeInput): Promise<ApplyDealChangeResult> {
  const before = await queryOne<Record<string, unknown>>(
    "SELECT * FROM deals_next WHERE id = $1",
    [input.dealId],
  );
  if (!before) throw new Error(`Deal ${input.dealId} not found`);
  const dealNumber = String(before.deal_number ?? "");

  const patch: DealPatch = {};
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [column, next] of Object.entries(input.fields)) {
    if (!MUTABLE_COLUMNS.has(column)) throw new Error(`Column not writable: ${column}`);
    const old = before[column] ?? null;
    if (valuesEqual(old, next)) continue;
    patch[column] = { old, new: next ?? null };
    params.push(typeof next === "object" && next !== null ? JSON.stringify(next) : (next ?? null));
    const cast = typeof next === "object" && next !== null ? "::jsonb" : "";
    sets.push(`${column} = $${params.length}${cast}`);
  }

  if (sets.length === 0) {
    return { changed: [], logId: null, dealNumber };
  }

  params.push(input.dealId);
  await query(
    `UPDATE deals_next SET ${sets.join(", ")}, updated_at = now() WHERE id = $${params.length}`,
    params,
  );

  const logId = await logDealChange({
    dealId: input.dealId,
    dealNumber,
    actor: input.actor,
    onBehalfOf: input.onBehalfOf ?? null,
    kind: input.kind ?? "update",
    patch,
    reason: input.reason ?? null,
    sourceRef: input.sourceRef ?? null,
    channel: input.channel,
    idempotencyKey: input.idempotencyKey ?? null,
  });

  return { changed: Object.keys(patch), logId, dealNumber };
}

export function normalizeLogRow(row: Record<string, unknown>): DealLogRow {
  let patch: DealPatch = {};
  const raw = row.patch;
  if (raw && typeof raw === "object") patch = raw as DealPatch;
  else if (typeof raw === "string") {
    try {
      patch = JSON.parse(raw) as DealPatch;
    } catch {
      patch = {};
    }
  }
  return {
    id: Number(row.id),
    deal_id: row.deal_id == null ? null : Number(row.deal_id),
    deal_number: row.deal_number == null ? null : String(row.deal_number),
    actor: String(row.actor ?? ""),
    on_behalf_of: row.on_behalf_of == null ? null : String(row.on_behalf_of),
    kind: String(row.kind ?? "update") as DealLogKind,
    patch,
    reason: row.reason == null ? null : String(row.reason),
    source_ref: row.source_ref == null ? null : String(row.source_ref),
    channel: String(row.channel ?? ""),
    status: String(row.status ?? "applied") as DealLogStatus,
    error: row.error == null ? null : String(row.error),
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(String(row.created_at ?? Date.now())).toISOString(),
  };
}

export interface ListDealLogFilters {
  dealId?: number | null;
  actor?: string | null;
  kind?: DealLogKind | null;
  status?: DealLogStatus | null;
  limit?: number;
}

export async function listDealLog(filters: ListDealLogFilters = {}): Promise<DealLogRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.dealId != null) {
    params.push(filters.dealId);
    where.push(`deal_id = $${params.length}`);
  }
  if (filters.actor) {
    params.push(filters.actor);
    where.push(`actor = $${params.length}`);
  }
  if (filters.kind) {
    params.push(filters.kind);
    where.push(`kind = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    where.push(`status = $${params.length}`);
  }
  params.push(Math.min(Math.max(filters.limit ?? 100, 1), 500));
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM deal_log
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows.map(normalizeLogRow);
}

/** Resolve a needs_review row — the one legal status flip. */
export async function resolveDealLogReview(
  id: number,
  resolution: "confirmed" | "dismissed",
  resolvedBy: string,
): Promise<DealLogRow | null> {
  const row = await queryOne<Record<string, unknown>>(
    `UPDATE deal_log
        SET status = $1,
            reason = COALESCE(reason, '') ||
                     CASE WHEN reason IS NULL OR reason = '' THEN '' ELSE ' · ' END ||
                     $2 || ' by ' || $3
      WHERE id = $4 AND status = 'needs_review'
      RETURNING *`,
    [resolution, resolution, resolvedBy, id],
  );
  return row ? normalizeLogRow(row) : null;
}
