import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseCsv } from "csv-parse/sync";

import { query } from "./db";
import { allocateDealNumber, bumpCounterToAtLeast } from "./deal-number";
import {
  type IdentityInput,
  type MatchCandidate,
  type SourceId,
  buildIdentity,
  findIdentityMatch,
  isNonDealMail,
  mergeAliasNames,
  mergeThreadIds,
  parseDealNumber,
} from "./identity";
import { isMemberId, isVerdictAction } from "./model";
import { normalizeAxialHref } from "./playbooks";

/**
 * Deals arrive from Dirk (POST /api/import) or the optional harvest backup.
 * Identity is owned here: TLY number on first touch, join on source id /
 * fingerprint, accumulate aliases and Gmail thread ids.
 */
export interface IncomingDeal {
  extId?: string | null;
  dealNumber?: string | null;
  title: string;
  blurb?: string | null;
  source?: string | null;
  subSource?: string | null;
  nickname?: string | null;
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
  brokerFirm?: string | null;
  aliasNames?: string[] | null;
  gmailThreadIds?: string[] | null;
  sourceDealId?: string | null;
  sourceIds?: SourceId[] | null;
  html?: string | null;
  subject?: string | null;
  body?: string | null;
  nextAction?: string | null;
  fingerprint?: string | null;
}

export interface IncomingVerdict {
  extId?: string;
  dealNumber?: string | null;
  member: string;
  action: string;
  reason?: string | null;
  note?: string | null;
  createdAt?: string | null;
}

/** Blank / legacy labels → empty string so NOT NULL columns stay valid. */
function normalizeBusinessModel(value: string | null | undefined): string {
  const t = (value || "").trim();
  if (!t || t === "AMBIGUOUS" || t === "LOCATION_AGNOSTIC") return "";
  return t;
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

function asStringArray(value: unknown): string[] {
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

function asSourceIds(value: unknown): SourceId[] {
  if (!Array.isArray(value)) return [];
  const out: SourceId[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    const kind = String(rec.kind || "");
    const val = String(rec.value || "");
    const canonical = String(rec.canonical || (kind && val ? `${kind}:${val}` : ""));
    if (!kind || !val || !canonical) continue;
    out.push({ kind: kind as SourceId["kind"], value: val, canonical });
  }
  return out;
}

function parseSourceIds(value: unknown): SourceId[] {
  if (Array.isArray(value)) return asSourceIds(value);
  if (typeof value === "string") {
    try {
      return asSourceIds(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

async function loadMatchCandidates(): Promise<MatchCandidate[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT id, deal_number, source_deal_id, source_ids, fingerprint,
            title, alias_names, broker_firm, city, state
       FROM deals`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    dealNumber: row.deal_number == null ? null : String(row.deal_number),
    sourceDealId: row.source_deal_id == null ? null : String(row.source_deal_id),
    sourceIds: parseSourceIds(row.source_ids),
    fingerprint: row.fingerprint == null ? null : String(row.fingerprint),
    title: row.title == null ? null : String(row.title),
    aliasNames: asStringArray(row.alias_names),
    brokerFirm: row.broker_firm == null ? null : String(row.broker_firm),
    city: row.city == null ? null : String(row.city),
    state: row.state == null ? null : String(row.state),
  }));
}

function incomingToIdentity(deal: IncomingDeal): IdentityInput {
  return {
    dealNumber: deal.dealNumber,
    title: deal.title,
    aliasNames: deal.aliasNames,
    brokerFirm: deal.brokerFirm,
    city: deal.city,
    state: deal.state,
    ebitda: toNumber(deal.ebitda),
    sde: toNumber(deal.sde),
    url: deal.url,
    html: deal.html,
    subject: deal.subject,
    body: deal.body ?? deal.blurb,
    source: deal.source,
    nickname: deal.nickname,
    gmailThreadIds: deal.gmailThreadIds,
    sourceIds: deal.sourceIds,
  };
}

/**
 * Applies a batch of deals.
 *
 * Join order: deal number → source id → fingerprint → alias+broker/geo.
 * Existing money/text is never overwritten with nulls. Title may change;
 * the previous title is kept in alias_names (Axial CIM titles differ).
 */
export async function upsertDeals(deals: IncomingDeal[]): Promise<{
  dealsNew: number;
  dealsUpdated: number;
  skipped: number;
}> {
  let dealsNew = 0;
  let dealsUpdated = 0;
  let skipped = 0;
  let candidates = await loadMatchCandidates();

  for (const deal of deals) {
    const title = deal.title?.trim();
    if (
      !title ||
      /^location\s*:/i.test(title) ||
      isNonDealMail({
        subject: deal.subject,
        source: deal.source,
        nickname: deal.nickname,
      })
    ) {
      skipped += 1;
      continue;
    }

    const ident = buildIdentity(incomingToIdentity(deal));
    if (deal.sourceDealId && !ident.sourceDealId) {
      ident.sourceDealId = deal.sourceDealId.trim().toLowerCase();
    }
    if (deal.fingerprint && !ident.fingerprint) {
      ident.fingerprint = deal.fingerprint;
    }

    const postedNumber = deal.dealNumber?.trim().toUpperCase() || null;
    if (postedNumber && parseDealNumber(postedNumber)) {
      ident.dealNumber = postedNumber;
    }

    const extId = deal.extId?.trim() || "";
    let matchedId: number | null = null;

    if (extId) {
      const byExt = await query<{ id: number }>("SELECT id FROM deals WHERE ext_id = $1", [extId]);
      if (byExt[0]) matchedId = Number(byExt[0].id);
    }

    if (matchedId == null) {
      const hit = findIdentityMatch(incomingToIdentity({ ...deal, dealNumber: ident.dealNumber }), candidates);
      if (hit) matchedId = hit.candidate.id;
    }

    const url = normalizeAxialHref(deal.url ?? null) ?? deal.url ?? null;
    const threads = ident.gmailThreadIds;
    const sourceIdsJson = JSON.stringify(ident.sourceIds);
    const needs = JSON.stringify(deal.needsLlm ?? []);
    const broker = deal.brokerFirm?.trim() || ident.brokerFirm;
    const nextAction = deal.nextAction?.trim() || null;

    if (matchedId != null) {
      const existing = await query<Record<string, unknown>>(
        `SELECT title, alias_names, gmail_thread_ids, source_ids, deal_number,
                source_deal_id, fingerprint, broker_firm, ext_id
           FROM deals WHERE id = $1`,
        [matchedId],
      );
      const cur = existing[0];
      if (!cur) {
        skipped += 1;
        continue;
      }

      const aliases = mergeAliasNames(
        asStringArray(cur.alias_names),
        title,
        cur.title == null ? null : String(cur.title),
        deal.aliasNames,
      );
      const mergedThreads = mergeThreadIds(asStringArray(cur.gmail_thread_ids), threads);
      const priorIds = parseSourceIds(cur.source_ids);
      const mergedIds = [...priorIds];
      for (const s of ident.sourceIds) {
        if (!mergedIds.some((p) => p.canonical === s.canonical)) mergedIds.push(s);
      }

      const keepNumber = String(cur.deal_number || ident.dealNumber || "");
      if (ident.dealNumber) await bumpCounterToAtLeast(ident.dealNumber);

      await query(
        `UPDATE deals SET
           title               = $1,
           blurb               = COALESCE($2, blurb),
           source              = COALESCE($3, source),
           sub_source          = COALESCE($4, sub_source),
           nickname            = COALESCE($5, nickname),
           sources             = COALESCE($6, sources),
           city                = COALESCE($7, city),
           state               = COALESCE($8, state),
           county              = COALESCE($9, county),
           revenue             = COALESCE($10, revenue),
           ebitda              = COALESCE($11, ebitda),
           sde                 = COALESCE($12, sde),
           asking              = COALESCE($13, asking),
           business_model_type = CASE
                                   WHEN business_model_type IS NULL
                                     OR business_model_type = ''
                                     OR business_model_type = 'AMBIGUOUS'
                                     OR business_model_type = 'LOCATION_AGNOSTIC'
                                     THEN $14
                                   ELSE business_model_type
                                 END,
           needs_llm           = $15::jsonb,
           url                 = COALESCE($16, url),
           last_seen           = GREATEST(last_seen, COALESCE($17::timestamptz, now())),
           times_seen          = GREATEST(times_seen, $18),
           deal_number         = COALESCE(deal_number, $19),
           source_deal_id      = COALESCE(source_deal_id, $20),
           source_ids          = $21::jsonb,
           alias_names         = $22::jsonb,
           gmail_thread_ids    = $23::jsonb,
           broker_firm         = COALESCE($24, broker_firm),
           fingerprint         = COALESCE($25, fingerprint),
           next_action         = COALESCE($26, next_action),
           ext_id              = COALESCE(NULLIF($27, ''), ext_id),
           updated_at          = now()
         WHERE id = $28`,
        [
          title,
          deal.blurb ?? null,
          deal.source ?? null,
          deal.subSource ?? null,
          deal.nickname ?? null,
          deal.sources ?? null,
          deal.city ?? null,
          deal.state ?? null,
          deal.county ?? null,
          toNumber(deal.revenue),
          toNumber(deal.ebitda),
          toNumber(deal.sde),
          toNumber(deal.asking),
          normalizeBusinessModel(deal.businessModelType),
          needs,
          url,
          toTimestamp(deal.lastSeen),
          deal.timesSeen ?? 1,
          keepNumber || null,
          ident.sourceDealId,
          JSON.stringify(mergedIds),
          JSON.stringify(aliases),
          JSON.stringify(mergedThreads),
          broker,
          ident.fingerprint,
          nextAction,
          extId,
          matchedId,
        ],
      );
      dealsUpdated += 1;
      const idx = candidates.findIndex((c) => c.id === matchedId);
      if (idx >= 0) {
        candidates[idx] = {
          ...candidates[idx],
          title,
          aliasNames: aliases,
          sourceDealId: ident.sourceDealId || candidates[idx].sourceDealId,
          sourceIds: mergedIds,
          fingerprint: ident.fingerprint || candidates[idx].fingerprint,
          brokerFirm: broker || candidates[idx].brokerFirm,
          city: deal.city ?? candidates[idx].city,
          state: deal.state ?? candidates[idx].state,
        };
      }
      continue;
    }

    const dealNumber = ident.dealNumber && parseDealNumber(ident.dealNumber)
      ? ident.dealNumber
      : await allocateDealNumber();
    if (ident.dealNumber) await bumpCounterToAtLeast(dealNumber);

    const mintedExt = extId || `flow:${dealNumber.toLowerCase()}`;
    const inserted = await query<{ id: number }>(
      `INSERT INTO deals (
         ext_id, deal_number, source_deal_id, source_ids, alias_names,
         gmail_thread_ids, broker_firm, fingerprint, next_action,
         title, blurb, source, sub_source, nickname, sources,
         city, state, county,
         revenue, ebitda, sde, asking, business_model_type, needs_llm, url,
         first_seen, last_seen, times_seen
       ) VALUES (
         $1, $2, $3, $4::jsonb, $5::jsonb,
         $6::jsonb, $7, $8, $9,
         $10, $11, $12, $13, $14, $15,
         $16, $17, $18,
         $19, $20, $21, $22, $23, $24::jsonb, $25,
         COALESCE($26::timestamptz, now()), COALESCE($27::timestamptz, now()), $28
       )
       RETURNING id`,
      [
        mintedExt,
        dealNumber,
        ident.sourceDealId,
        sourceIdsJson,
        JSON.stringify(ident.aliasNames),
        JSON.stringify(threads),
        broker,
        ident.fingerprint,
        nextAction,
        title,
        deal.blurb ?? null,
        deal.source ?? null,
        deal.subSource ?? null,
        deal.nickname ?? null,
        deal.sources ?? null,
        deal.city ?? null,
        deal.state ?? null,
        deal.county ?? null,
        toNumber(deal.revenue),
        toNumber(deal.ebitda),
        toNumber(deal.sde),
        toNumber(deal.asking),
        normalizeBusinessModel(deal.businessModelType),
        needs,
        url,
        toTimestamp(deal.firstSeen),
        toTimestamp(deal.lastSeen),
        deal.timesSeen ?? 1,
      ],
    );

    const newId = Number(inserted[0]?.id);
    dealsNew += 1;
    candidates = [
      ...candidates,
      {
        id: newId,
        dealNumber,
        sourceDealId: ident.sourceDealId,
        sourceIds: ident.sourceIds,
        fingerprint: ident.fingerprint,
        title,
        aliasNames: ident.aliasNames,
        brokerFirm: broker,
        city: deal.city ?? null,
        state: deal.state ?? null,
      },
    ];
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

    let deal: { id: number }[] = [];
    if (verdict.dealNumber && parseDealNumber(verdict.dealNumber)) {
      deal = await query<{ id: number }>("SELECT id FROM deals WHERE deal_number = $1", [
        verdict.dealNumber.trim().toUpperCase(),
      ]);
    }
    if (deal.length === 0 && verdict.extId) {
      deal = await query<{ id: number }>("SELECT id FROM deals WHERE ext_id = $1", [
        verdict.extId,
      ]);
    }
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

    let aliasNames: string[] = [];
    try {
      const parsed = JSON.parse(row.alias_names || "[]");
      if (Array.isArray(parsed)) aliasNames = parsed.map(String);
    } catch {
      aliasNames = [];
    }

    let threads: string[] = [];
    try {
      const parsed = JSON.parse(row.gmail_thread_ids || "[]");
      if (Array.isArray(parsed)) threads = parsed.map(String);
    } catch {
      threads = [];
    }

    return {
      extId: (row.ext_id || "").trim() || csvExtId(row),
      dealNumber: row.deal_number || null,
      title: row.title,
      blurb: row.blurb || null,
      source: row.source || null,
      subSource: row.sub_source || null,
      nickname: row.nickname || null,
      sources: row.sources || null,
      city: row.city || null,
      state: row.state || null,
      county: row.county || null,
      revenue: toNumber(row.revenue),
      ebitda: toNumber(row.ebitda),
      sde: toNumber(row.sde),
      asking: toNumber(row.asking),
      businessModelType: normalizeBusinessModel(row.business_model_type),
      needsLlm,
      url: row.url_norm || row.url || null,
      timesSeen: toNumber(row.times_seen) ?? 1,
      brokerFirm: row.broker_firm || null,
      aliasNames,
      gmailThreadIds: threads,
      sourceDealId: row.source_deal_id || null,
      fingerprint: row.fingerprint || null,
    };
  });

  return importSnapshot({ deals }, source, detail);
}

/**
 * First-run migration from the Python pipeline's SQLite database.
 *
 * Only ever runs against an empty deals table, so it cannot overwrite work done
 * in the app. Local PGlite only — hosted Neon stays empty after a flush.
 * The checked-in seed is DEMO fixture data, not live inventory.
 */
export async function seedIfEmpty(): Promise<ImportResult | null> {
  if (process.env.DATABASE_URL) return null;

  const [{ count }] = await query<{ count: string }>("SELECT COUNT(*)::text AS count FROM deals");
  if (Number(count) > 0) return null;

  const seedPath = path.join(process.cwd(), "db", "seed-data.json");
  if (!existsSync(seedPath)) return null;

  const payload = JSON.parse(readFileSync(seedPath, "utf8"));
  return importSnapshot(payload, "seed-demo", `DEMO fixture ${path.basename(seedPath)}`);
}
