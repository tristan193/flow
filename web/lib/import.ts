import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseCsv } from "csv-parse/sync";

import { query } from "./db";
import { isMemberId, isVerdictAction } from "./model";

/**
 * Deals arrive from the Python pipeline, which owns extraction. Flow App never
 * re-parses email; it upserts whatever the pipeline produced, keyed on ext_id.
 */
export interface IncomingDeal {
  extId: string;
  title: string;
  blurb?: string | null;
  subSource?: string | null;
  sources?: string | null;
  city?: string | null;
  state?: string | null;
  county?: string | null;
  revenue?: number | null;
  ebitda?: number | null;
  sde?: number | null;
  asking?: number | null;
  businessModelType?: string | null;
  needsLlm?: string[] | null;
  url?: string | null;
  firstSeen?: string | null;
  lastSeen?: string | null;
  timesSeen?: number | null;
}

export interface IncomingVerdict {
  extId: string;
  member: string;
  action: string;
  reason?: string | null;
  note?: string | null;
  createdAt?: string | null;
}

export interface ImportResult {
  dealsNew: number;
  dealsUpdated: number;
  verdictsApplied: number;
  skipped: number;
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toTimestamp(value: unknown): string | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Applies a batch of deals.
 *
 * Existing values are never overwritten with nulls: a later source that omits
 * revenue must not erase a revenue an earlier one disclosed. Only gaps get
 * filled. The title is allowed to change, since a broker follow-up often carries
 * a fuller version of the same listing's name.
 */
export async function upsertDeals(deals: IncomingDeal[]): Promise<{
  dealsNew: number;
  dealsUpdated: number;
  skipped: number;
}> {
  let dealsNew = 0;
  let dealsUpdated = 0;
  let skipped = 0;

  for (const deal of deals) {
    const extId = deal.extId?.trim();
    const title = deal.title?.trim();
    if (!extId || !title) {
      skipped += 1;
      continue;
    }
    // SMB Deal Hunter half-listings from an older paragraph split.
    if (/^location\s*:/i.test(title)) {
      skipped += 1;
      continue;
    }

    const existing = await query<{ id: number }>("SELECT id FROM deals WHERE ext_id = $1", [extId]);

    await query(
      `INSERT INTO deals (
         ext_id, title, blurb, sub_source, sources, city, state, county,
         revenue, ebitda, sde, asking, business_model_type, needs_llm, url,
         first_seen, last_seen, times_seen
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13, $14::jsonb, $15,
         COALESCE($16::timestamptz, now()), COALESCE($17::timestamptz, now()), $18
       )
       ON CONFLICT (ext_id) DO UPDATE SET
         title               = excluded.title,
         blurb               = COALESCE(deals.blurb, excluded.blurb),
         sub_source          = COALESCE(deals.sub_source, excluded.sub_source),
         sources             = COALESCE(excluded.sources, deals.sources),
         city                = COALESCE(deals.city, excluded.city),
         state               = COALESCE(deals.state, excluded.state),
         county              = COALESCE(deals.county, excluded.county),
         revenue             = COALESCE(deals.revenue, excluded.revenue),
         ebitda              = COALESCE(deals.ebitda, excluded.ebitda),
         sde                 = COALESCE(deals.sde, excluded.sde),
         asking              = COALESCE(deals.asking, excluded.asking),
         business_model_type = CASE
                                 WHEN deals.business_model_type = 'AMBIGUOUS'
                                   THEN excluded.business_model_type
                                 ELSE deals.business_model_type
                               END,
         needs_llm           = excluded.needs_llm,
         url                 = COALESCE(deals.url, excluded.url),
         last_seen           = GREATEST(deals.last_seen, excluded.last_seen),
         times_seen          = GREATEST(deals.times_seen, excluded.times_seen),
         updated_at          = now()`,
      [
        extId,
        title,
        deal.blurb ?? null,
        deal.subSource ?? null,
        deal.sources ?? null,
        deal.city ?? null,
        deal.state ?? null,
        deal.county ?? null,
        toNumber(deal.revenue),
        toNumber(deal.ebitda),
        toNumber(deal.sde),
        toNumber(deal.asking),
        deal.businessModelType || "AMBIGUOUS",
        JSON.stringify(deal.needsLlm ?? []),
        deal.url ?? null,
        toTimestamp(deal.firstSeen),
        toTimestamp(deal.lastSeen),
        deal.timesSeen ?? 1,
      ],
    );

    if (existing.length > 0) dealsUpdated += 1;
    else dealsNew += 1;
  }

  return { dealsNew, dealsUpdated, skipped };
}

/**
 * Applies historical verdicts without stepping on live ones.
 *
 * Flow App is now where verdicts are made, so an imported verdict only wins if
 * it is genuinely newer than what is already recorded. This is what makes
 * re-importing an old pipeline snapshot harmless.
 */
export async function applyVerdicts(verdicts: IncomingVerdict[]): Promise<number> {
  let applied = 0;

  for (const verdict of verdicts) {
    if (!isMemberId(verdict.member) || !isVerdictAction(verdict.action)) continue;

    const deal = await query<{ id: number }>("SELECT id FROM deals WHERE ext_id = $1", [
      verdict.extId,
    ]);
    if (deal.length === 0) continue;

    const result = await query<{ deal_id: number }>(
      `INSERT INTO verdicts (deal_id, member, action, reason, note, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()), COALESCE($6::timestamptz, now()))
       ON CONFLICT (deal_id, member) DO UPDATE
         SET action = excluded.action,
             reason = excluded.reason,
             note   = excluded.note,
             updated_at = excluded.updated_at
       WHERE excluded.updated_at > verdicts.updated_at
       RETURNING deal_id`,
      [
        deal[0].id,
        verdict.member,
        verdict.action,
        verdict.reason ?? null,
        verdict.note ?? null,
        toTimestamp(verdict.createdAt),
      ],
    );

    if (result.length > 0) applied += 1;
  }

  return applied;
}

export async function recordImport(
  source: string,
  detail: string,
  result: ImportResult,
): Promise<void> {
  await query(
    `INSERT INTO import_runs (source, detail, deals_new, deals_updated, verdicts_applied)
     VALUES ($1, $2, $3, $4, $5)`,
    [source, detail, result.dealsNew, result.dealsUpdated, result.verdictsApplied],
  );
}

export async function importSnapshot(
  payload: { deals?: IncomingDeal[]; verdicts?: IncomingVerdict[] },
  source: string,
  detail: string,
): Promise<ImportResult> {
  const dealResult = await upsertDeals(payload.deals ?? []);
  const verdictsApplied = await applyVerdicts(payload.verdicts ?? []);
  const result: ImportResult = { ...dealResult, verdictsApplied };
  await recordImport(source, detail, result);
  return result;
}

/**
 * Builds a stable ext_id for CSV rows, which carry no identifier of their own.
 *
 * The listing URL is the strongest identity available; without one, a slug of
 * title plus state is used. Getting this wrong duplicates deals on every import,
 * so it must be deterministic rather than random.
 */
function csvExtId(row: Record<string, string>): string {
  const url = (row.url_norm || row.url || "").trim().toLowerCase();
  if (url) return `csv:${url}`;
  const slug = (row.title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
  return `csv:${slug}:${(row.state || "na").toLowerCase()}`;
}

/**
 * Imports the pipeline's CSV export shape, which is also what lands in the Drive
 * archive as a dated daily snapshot.
 */
export async function importCsv(
  text: string,
  source: string,
  detail: string,
): Promise<ImportResult> {
  const rows = parseCsv(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Record<string, string>[];

  const deals: IncomingDeal[] = rows.map((row) => {
    let needsLlm: string[] = [];
    try {
      const parsed = JSON.parse(row.needs_llm || "[]");
      if (Array.isArray(parsed)) needsLlm = parsed.map(String);
    } catch {
      needsLlm = [];
    }

    return {
      extId: (row.ext_id || "").trim() || csvExtId(row),
      title: row.title,
      blurb: row.blurb || null,
      subSource: row.sub_source || null,
      sources: row.sources || null,
      city: row.city || null,
      state: row.state || null,
      county: row.county || null,
      revenue: toNumber(row.revenue),
      ebitda: toNumber(row.ebitda),
      sde: toNumber(row.sde),
      asking: toNumber(row.asking),
      businessModelType: row.business_model_type || "AMBIGUOUS",
      needsLlm,
      url: row.url_norm || row.url || null,
      timesSeen: toNumber(row.times_seen) ?? 1,
    };
  });

  return importSnapshot({ deals }, source, detail);
}

/**
 * First-run migration from the Python pipeline's SQLite database.
 *
 * Only ever runs against an empty deals table, so it cannot overwrite work done
 * in the app. Regenerate the file with pipeline/export_snapshot.py.
 */
export async function seedIfEmpty(): Promise<ImportResult | null> {
  // Hosted Neon must stay empty after a flush until harvest posts — never
  // rehydrate from the checked-in seed snapshot in production.
  if (process.env.DATABASE_URL) return null;

  const [{ count }] = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM deals");
  if (Number(count) > 0) return null;

  const seedPath = path.join(process.cwd(), "db", "seed-data.json");
  if (!existsSync(seedPath)) return null;

  const payload = JSON.parse(readFileSync(seedPath, "utf8"));
  return importSnapshot(payload, "seed", path.basename(seedPath));
}
