import type { QueryFn } from "../db";
import { query, withTransaction } from "../db";
import {
  asStringArray,
  identityGroupKeys,
  mergeAliasNames,
  mergeThreadIds,
  parseDealNumber,
  parseSourceIdsValue,
} from "./identity";

/**
 * Collapse duplicate deals_next rows that share a source id or Axial hex
 * nickname. Keep the lowest TLY number, merge alias/thread/source lists, then
 * delete the extras. Token-authenticated — no member session.
 *
 * The unique index on source_deal_id is created here (and after import) only
 * once duplicates are gone; schema.sql cannot ship it while Neon still has the
 * raced TLY-023..029 rows.
 */

export const SOURCE_DEAL_ID_UNIQUE_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS ux_deals_next_source_deal_id
  ON deals_next (source_deal_id)
  WHERE source_deal_id IS NOT NULL AND btrim(source_deal_id) <> ''
`;

export interface MergePair {
  keep: string;
  delete: string[];
}

export interface MergeGroup {
  keep: string;
  deleted: string[];
  keys: string[];
}

export interface CollapseNextDuplicatesInput {
  keepDealNumbers?: string[] | null;
  deleteDealNumbers?: string[] | null;
  pairs?: MergePair[] | null;
  dryRun?: boolean | null;
}

export interface CollapseNextDuplicatesResult {
  dryRun: boolean;
  groups: MergeGroup[];
  merged: number;
  deleted: number;
  uniqueIndexReady: boolean;
}

interface MergeRow {
  id: number;
  deal_number: string;
  source_deal_id: string | null;
  source_ids: unknown;
  alias_names: unknown;
  gmail_thread_ids: unknown;
  nickname: string | null;
  url: string | null;
  title: string;
}

function normNumber(value: string | null | undefined): string | null {
  const raw = (value || "").trim().toUpperCase();
  return parseDealNumber(raw) ? raw : null;
}

function find(parent: Map<number, number>, id: number): number {
  let cur = id;
  while (parent.get(cur) !== cur) {
    const next = parent.get(cur);
    if (next == null) break;
    parent.set(cur, parent.get(next) ?? next);
    cur = next;
  }
  return cur;
}

function union(parent: Map<number, number>, a: number, b: number): void {
  const pa = find(parent, a);
  const pb = find(parent, b);
  if (pa !== pb) parent.set(pa, pb);
}

export function duplicateGroups(
  rows: Array<{
    id: number;
    deal_number: string;
    sourceDealId?: string | null;
    source_deal_id?: string | null;
    sourceIds?: unknown;
    source_ids?: unknown;
    nickname?: string | null;
    url?: string | null;
  }>,
): Array<{ ids: number[]; numbers: string[]; keys: string[] }> {
  const parent = new Map<number, number>();
  const byId = new Map<number, (typeof rows)[number]>();
  for (const row of rows) {
    parent.set(row.id, row.id);
    byId.set(row.id, row);
  }

  const owner = new Map<string, number>();
  const keysById = new Map<number, string[]>();
  for (const row of rows) {
    const keys = identityGroupKeys({
      sourceDealId: row.sourceDealId ?? row.source_deal_id,
      sourceIds: row.sourceIds ?? row.source_ids,
      nickname: row.nickname,
      url: row.url,
    });
    keysById.set(row.id, keys);
    for (const key of keys) {
      const existing = owner.get(key);
      if (existing != null) union(parent, row.id, existing);
      else owner.set(key, row.id);
    }
  }

  const buckets = new Map<number, number[]>();
  for (const row of rows) {
    const root = find(parent, row.id);
    const bucket = buckets.get(root) ?? [];
    bucket.push(row.id);
    buckets.set(root, bucket);
  }

  const out: Array<{ ids: number[]; numbers: string[]; keys: string[] }> = [];
  for (const ids of buckets.values()) {
    if (ids.length < 2) continue;
    const keys = new Set<string>();
    const numbers: string[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) continue;
      numbers.push(row.deal_number);
      for (const k of keysById.get(id) ?? []) keys.add(k);
    }
    out.push({ ids, numbers, keys: [...keys] });
  }
  return out;
}

function pickKeep(
  numbers: string[],
  preferred: Set<string>,
): string {
  const ranked = [...numbers].sort((a, b) => {
    const aPref = preferred.has(a) ? 0 : 1;
    const bPref = preferred.has(b) ? 0 : 1;
    if (aPref !== bPref) return aPref - bPref;
    return (parseDealNumber(a) ?? 999999) - (parseDealNumber(b) ?? 999999);
  });
  return ranked[0];
}

async function loadMergeRows(): Promise<MergeRow[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT id, deal_number, source_deal_id, source_ids, alias_names, alias_numbers,
            gmail_thread_ids, nickname, url, title
       FROM deals_next`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    deal_number: String(row.deal_number ?? ""),
    source_deal_id: row.source_deal_id == null ? null : String(row.source_deal_id),
    source_ids: row.source_ids,
    alias_names: row.alias_names,
    gmail_thread_ids: row.gmail_thread_ids,
    nickname: row.nickname == null ? null : String(row.nickname),
    url: row.url == null ? null : String(row.url),
    title: String(row.title ?? ""),
  }));
}

export async function ensureNextSourceDealIdUnique(): Promise<boolean> {
  try {
    await query(SOURCE_DEAL_ID_UNIQUE_SQL);
    return true;
  } catch {
    return false;
  }
}

/**
 * Two-table world: votes/notes/watches live on the deal row. Merge fills a
 * blank keeper column from the duplicate, concatenates notes, unions watches,
 * keeps history by repointing the duplicate's deal_log rows at the keeper
 * (their deal_number stays the historical TLY), and repoints any legacy
 * stored CIM blobs.
 *
 * Blank means NULL, or for text a string that trims to empty. When both sides
 * are non-empty the keeper wins — a later twin must not clobber a real stage,
 * title, or number already on the earlier TLY.
 *
 * source_deal_id is not in these lists. Identity is adopted in mergeRowInto,
 * which nulls the twin before the keeper takes the id. A blind COALESCE while
 * both rows still hold the id hits ux_deals_next_source_deal_id (23505).
 *
 * Also not blank-filled here:
 * - source_ids, alias_names, alias_numbers, gmail_thread_ids — unioned in mergeRowInto
 * - tristan_notes / jim_notes — concatenated below
 * - watches — jsonb union below
 * - duplicate_of / ingest_disposition — remint stamps on the twin; copying them
 *   would mark the live TLY as a remint
 * - id, deal_number, is_demo, first_seen, last_seen, times_seen, created_at —
 *   row identity and observation counters. updated_at is stamped now().
 */
const MERGE_FILL_TEXT = [
  "url",
  "title",
  "blurb",
  "cim_name",
  "source",
  "sub_source",
  "nickname",
  "sources",
  "city",
  "state",
  "county",
  "region",
  "broker_firm",
  "fingerprint",
  "next_action",
  "business_model_type",
  "stage",
  "stage_changed_by",
  "super_liked_by",
  "tristan_verdict",
  "tristan_verdict_reason",
  "tristan_verdict_note",
  "jim_verdict",
  "jim_verdict_reason",
  "jim_verdict_note",
  "tristan_cim_verdict",
  "tristan_cim_verdict_note",
  "jim_cim_verdict",
  "jim_cim_verdict_note",
  "cim_url",
  "cim_access_note",
  "nda_url",
] as const;

/** NULL is blank. 0 and a real timestamp are data, so plain COALESCE. */
const MERGE_FILL_SCALAR = [
  "tristan_verdict_at",
  "jim_verdict_at",
  "tristan_cim_verdict_at",
  "jim_cim_verdict_at",
  "stage_changed_at",
  "super_liked_at",
  "revenue",
  "ebitda",
  "sde",
  "asking",
  "margin",
] as const;

/** Empty jsonb array is blank. A non-empty keeper list is kept, not unioned. */
const MERGE_FILL_JSON_LISTS = ["needs_llm", "source_domains"] as const;

function mergeFillAssignments(): string {
  const text = MERGE_FILL_TEXT.map(
    (col) => `${col} = CASE
         WHEN NULLIF(btrim(keep.${col}), '') IS NOT NULL THEN keep.${col}
         WHEN NULLIF(btrim(dup.${col}), '') IS NOT NULL THEN dup.${col}
         ELSE keep.${col}
       END`,
  );
  const scalar = MERGE_FILL_SCALAR.map((col) => `${col} = COALESCE(keep.${col}, dup.${col})`);
  const lists = MERGE_FILL_JSON_LISTS.map(
    (col) => `${col} = CASE
         WHEN keep.${col} IS NOT NULL AND keep.${col} <> '[]'::jsonb THEN keep.${col}
         WHEN dup.${col} IS NOT NULL AND dup.${col} <> '[]'::jsonb THEN dup.${col}
         ELSE keep.${col}
       END`,
  );
  return [...text, ...scalar, ...lists].join(",\n       ");
}

async function reassignChildren(keepId: number, dupId: number, q: QueryFn): Promise<void> {
  const fills = mergeFillAssignments();
  await q(
    `UPDATE deals_next AS keep SET
       ${fills},
       tristan_notes = CASE
         WHEN dup.tristan_notes IS NULL OR btrim(dup.tristan_notes) = '' THEN keep.tristan_notes
         WHEN keep.tristan_notes IS NULL OR btrim(keep.tristan_notes) = '' THEN dup.tristan_notes
         ELSE keep.tristan_notes || E'\\n\\n' || dup.tristan_notes
       END,
       jim_notes = CASE
         WHEN dup.jim_notes IS NULL OR btrim(dup.jim_notes) = '' THEN keep.jim_notes
         WHEN keep.jim_notes IS NULL OR btrim(keep.jim_notes) = '' THEN dup.jim_notes
         ELSE keep.jim_notes || E'\\n\\n' || dup.jim_notes
       END,
       watches = keep.watches || dup.watches,
       updated_at = now()
     FROM deals_next AS dup
    WHERE keep.id = $1 AND dup.id = $2`,
    [keepId, dupId],
  );
  await q("UPDATE deal_log SET deal_id = $1 WHERE deal_id = $2", [keepId, dupId]);
  await q("UPDATE deal_files_next SET deal_id = $1 WHERE deal_id = $2", [keepId, dupId]);
}

async function mergeRowInto(keep: MergeRow, dup: MergeRow, q: QueryFn, actor: string): Promise<void> {
  const aliases = mergeAliasNames(
    asStringArray(keep.alias_names),
    dup.title,
    keep.title,
    asStringArray(dup.alias_names),
  );
  const threads = mergeThreadIds(
    asStringArray(keep.gmail_thread_ids),
    asStringArray(dup.gmail_thread_ids),
  );
  const mergedIds = parseSourceIdsValue(keep.source_ids);
  for (const s of parseSourceIdsValue(dup.source_ids)) {
    if (!mergedIds.some((p) => p.canonical === s.canonical)) mergedIds.push(s);
  }
  const sourceDealId = keep.source_deal_id || dup.source_deal_id;

  // Tombstone + full snapshot of the row being deleted. Nothing is ever
  // unrecoverable: the whole dup row rides in patch.old. Capture it before
  // source_deal_id is cleared below.
  const snapshot = await q<Record<string, unknown>>(
    "SELECT * FROM deals_next WHERE id = $1",
    [dup.id],
  );

  // ux_deals_next_source_deal_id is unique while both rows exist. Remints
  // leave the lower-TLY keeper null and the twin holding axial:/buildout:.
  // Free the twin's id, then COALESCE copies it onto the keeper.
  if (!keep.source_deal_id && dup.source_deal_id) {
    await q("UPDATE deals_next SET source_deal_id = NULL WHERE id = $1", [dup.id]);
  }

  await q(
    `UPDATE deals_next SET
       source_deal_id   = COALESCE(source_deal_id, $1),
       source_ids       = $2::jsonb,
       alias_names      = $3::jsonb,
       gmail_thread_ids = $4::jsonb,
       alias_numbers    = (
         SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb)
           FROM jsonb_array_elements_text(alias_numbers || $5::jsonb) AS t(x)
       ),
       updated_at       = now()
     WHERE id = $6`,
    [
      sourceDealId,
      JSON.stringify(mergedIds),
      JSON.stringify(aliases),
      JSON.stringify(threads),
      JSON.stringify([dup.deal_number, ...asStringArray((dup as { alias_numbers?: unknown }).alias_numbers)]),
      keep.id,
    ],
  );
  keep.source_deal_id = sourceDealId;
  keep.source_ids = mergedIds;
  keep.alias_names = aliases;
  keep.gmail_thread_ids = threads;
  await q(
    `INSERT INTO deal_log (deal_id, deal_number, actor, kind, patch, reason, channel)
     VALUES ($1, $2, $3, 'merge', $4::jsonb, $5, 'api:next/merge')`,
    [
      keep.id,
      dup.deal_number,
      actor,
      JSON.stringify({ merged_row: { old: snapshot[0] ?? null, new: keep.deal_number } }),
      `merged ${dup.deal_number} into ${keep.deal_number}`,
    ],
  );
}

function planGroups(
  rows: MergeRow[],
  input: CollapseNextDuplicatesInput,
): MergeGroup[] {
  const byNumber = new Map(rows.map((r) => [r.deal_number.toUpperCase(), r]));
  const preferred = new Set(
    (input.keepDealNumbers ?? []).map((n) => n.trim().toUpperCase()).filter((n) => parseDealNumber(n)),
  );
  const deleteOnly = new Set(
    (input.deleteDealNumbers ?? []).map((n) => n.trim().toUpperCase()).filter((n) => parseDealNumber(n)),
  );

  if (input.pairs?.length) {
    const groups: MergeGroup[] = [];
    for (const pair of input.pairs) {
      const keep = normNumber(pair.keep);
      if (!keep || !byNumber.has(keep)) continue;
      // Guard: a pair is only honored when the rows actually share an identity
      // key (source id / Axial hex / listing id). A token caller can no longer
      // delete arbitrary deals by calling them duplicates.
      const keepKeys = new Set(identityGroupKeys(byNumber.get(keep)!));
      const deleted = (pair.delete ?? [])
        .map((n) => normNumber(n))
        .filter((n): n is string => n != null && n !== keep && byNumber.has(n))
        .filter((n) => identityGroupKeys(byNumber.get(n)!).some((k) => keepKeys.has(k)));
      if (!deleted.length) continue;
      groups.push({ keep, deleted, keys: [...keepKeys] });
    }
    return groups;
  }

  const clustered = duplicateGroups(
    rows.map((r) => ({
      id: r.id,
      deal_number: r.deal_number,
      source_deal_id: r.source_deal_id,
      source_ids: r.source_ids,
      nickname: r.nickname,
      url: r.url,
    })),
  );

  const groups: MergeGroup[] = [];
  for (const cluster of clustered) {
    const numbers = cluster.numbers.map((n) => n.toUpperCase());
    const keep = pickKeep(numbers, preferred);
    let deleted = numbers.filter((n) => n !== keep);
    if (deleteOnly.size) deleted = deleted.filter((n) => deleteOnly.has(n));
    if (!deleted.length) continue;
    groups.push({ keep, deleted, keys: cluster.keys });
  }

  if (deleteOnly.size) {
    const planned = new Set(groups.flatMap((g) => g.deleted));
    for (const num of deleteOnly) {
      if (planned.has(num)) continue;
      const dup = byNumber.get(num);
      if (!dup) continue;
      const dupKeys = new Set(identityGroupKeys(dup));
      const mates = rows.filter((r) => {
        if (r.deal_number.toUpperCase() === num) return false;
        return identityGroupKeys(r).some((k) => dupKeys.has(k));
      });
      if (!mates.length) continue;
      const keep = pickKeep(
        mates.map((m) => m.deal_number.toUpperCase()),
        preferred,
      );
      groups.push({ keep, deleted: [num], keys: [...dupKeys] });
    }
  }

  return groups;
}

export async function collapseNextDuplicates(
  input: CollapseNextDuplicatesInput = {},
  actor: string = "dirk",
): Promise<CollapseNextDuplicatesResult> {
  const rows = await loadMergeRows();
  const groups = planGroups(rows, input);
  const dryRun = Boolean(input.dryRun);

  if (dryRun) {
    return {
      dryRun: true,
      groups,
      merged: groups.length,
      deleted: groups.reduce((n, g) => n + g.deleted.length, 0),
      uniqueIndexReady: false,
    };
  }

  const byNumber = new Map(rows.map((r) => [r.deal_number.toUpperCase(), r]));
  let deleted = 0;

  for (const group of groups) {
    const keep = byNumber.get(group.keep);
    if (!keep) continue;
    await withTransaction(async (q) => {
      for (const num of group.deleted) {
        const dup = byNumber.get(num);
        if (!dup) continue;
        await mergeRowInto(keep, dup, q, actor);
        await reassignChildren(keep.id, dup.id, q);
        await q("DELETE FROM deals_next WHERE id = $1", [dup.id]);
        byNumber.delete(num);
        deleted += 1;
      }
    });
  }

  const uniqueIndexReady = await ensureNextSourceDealIdUnique();
  return {
    dryRun: false,
    groups: groups.map((g) => ({ ...g, deleted: g.deleted.filter((n) => !byNumber.has(n)) })),
    merged: groups.length,
    deleted,
    uniqueIndexReady,
  };
}
