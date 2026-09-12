import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { type QueryFn, isUniqueViolation, query, withTransaction } from "../db";
import { normalizeAxialHref } from "../playbooks";
import { allocateDealNumber, bumpCounterToAtLeast } from "./deal-number";
import { applyNextReviewOutcome, clearNextSuperLike, moveNextStage } from "./deals";
import {
  type IdentityInput,
  type IdentityRecord,
  type MatchCandidate,
  type SourceId,
  asStringArray,
  buildIdentity,
  findIdentityMatch,
  isNonDealMail,
  mergeAliasNames,
  mergeThreadIds,
  formatDealNumber,
  parseDealNumber,
  parseSourceIdsValue,
  sanitizeSourceDealId,
} from "./identity";
import { ensureNextSourceDealIdUnique } from "./merge";
import { isMemberId, isVerdictAction, canonicalizeNextStage, sanitizeNextAction } from "./model";
import {
  formatDuplicateOf,
  isAttachOnlyIngest,
  parseIngestDisposition,
  type NextIngestDisposition,
} from "./remint";

export { isHarvestExtId } from "./identity";

/**
 * Next ingest. Identity is TLY number + source id + fingerprint.
 * Harvest `ext_id = format:gmail_msg:index` is ignored as a join key.
 *
 * Remint / attach-only: see `lib/next/remint.ts`. When `duplicateOf` or
 * `ingestDisposition` of attached/remint is set, import prefers merging
 * threads onto the canonical TLY and will not leave a live Review card.
 */
export interface IncomingNextDeal {
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
  isDemo?: boolean | null;
  stage?: string | null;
  proposedStage?: string | null;
  member?: string | null;
  /** Canonical TLY when this payload is a remint/dupe, e.g. "TLY-132". */
  duplicateOf?: string | null;
  /** new | attached | remint. attached/remint are attach-only (or Closed audit). */
  ingestDisposition?: string | null;
}

export interface IncomingNextVerdict {
  dealNumber?: string | null;
  member: string;
  action: string;
  reason?: string | null;
  note?: string | null;
  createdAt?: string | null;
}

export interface NextImportResult {
  dealsNew: number;
  dealsUpdated: number;
  verdictsApplied: number;
  skipped: number;
}

/** Machine actor recorded on ingest-driven stage moves. */
export const NEXT_INGEST_ACTOR = "dirk";

function normalizeBusinessModel(value: string | null | undefined): string {
  const t = (value || "").trim();
  if (!t || t === "AMBIGUOUS" || t === "LOCATION_AGNOSTIC") return "";
  return t;
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

async function loadMatchCandidates(q: QueryFn): Promise<MatchCandidate[]> {
  const rows = await q<Record<string, unknown>>(
    `SELECT id, deal_number, source_deal_id, source_ids, fingerprint,
            title, alias_names, broker_firm, city, state, nickname
       FROM deals_next`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    dealNumber: row.deal_number == null ? null : String(row.deal_number),
    sourceDealId: row.source_deal_id == null ? null : String(row.source_deal_id),
    sourceIds: parseSourceIdsValue(row.source_ids),
    fingerprint: row.fingerprint == null ? null : String(row.fingerprint),
    title: row.title == null ? null : String(row.title),
    aliasNames: asStringArray(row.alias_names),
    brokerFirm: row.broker_firm == null ? null : String(row.broker_firm),
    city: row.city == null ? null : String(row.city),
    state: row.state == null ? null : String(row.state),
    nickname: row.nickname == null ? null : String(row.nickname),
  }));
}

function incomingToIdentity(deal: IncomingNextDeal): IdentityInput {
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

function prepareIdentity(deal: IncomingNextDeal): IdentityRecord {
  const ident = buildIdentity(incomingToIdentity(deal));
  const postedSource = sanitizeSourceDealId(deal.sourceDealId);
  if (postedSource && !ident.sourceDealId) ident.sourceDealId = postedSource;
  if (deal.fingerprint && !ident.fingerprint) ident.fingerprint = deal.fingerprint;
  const postedNumber = deal.dealNumber?.trim().toUpperCase() || null;
  if (postedNumber && parseDealNumber(postedNumber)) ident.dealNumber = postedNumber;
  return ident;
}

async function lockIdentity(q: QueryFn, ident: IdentityRecord): Promise<void> {
  const keys = new Set<string>();
  if (ident.sourceDealId) keys.add(ident.sourceDealId);
  for (const s of ident.sourceIds) keys.add(s.canonical);
  if (ident.fingerprint) keys.add(`fp:${ident.fingerprint}`);
  if (keys.size === 0 && ident.teaserNorm) keys.add(`title:${ident.teaserNorm}`);
  for (const key of [...keys].sort()) {
    await q("SELECT pg_advisory_xact_lock(872011, hashtext($1))", [key]);
  }
}

async function updateMatchedDeal(
  q: QueryFn,
  matchedId: number,
  deal: IncomingNextDeal,
  ident: IdentityRecord,
  title: string,
): Promise<void> {
  const existing = await q<Record<string, unknown>>(
    `SELECT title, alias_names, gmail_thread_ids, source_ids, deal_number,
            source_deal_id, fingerprint, broker_firm
       FROM deals_next WHERE id = $1`,
    [matchedId],
  );
  const cur = existing[0];
  if (!cur) return;

  const aliases = mergeAliasNames(
    asStringArray(cur.alias_names),
    title,
    cur.title == null ? null : String(cur.title),
    deal.aliasNames,
  );
  const mergedThreads = mergeThreadIds(asStringArray(cur.gmail_thread_ids), ident.gmailThreadIds);
  const priorIds = parseSourceIdsValue(cur.source_ids);
  const mergedIds = [...priorIds];
  for (const s of ident.sourceIds) {
    if (!mergedIds.some((p) => p.canonical === s.canonical)) mergedIds.push(s);
  }

  if (ident.dealNumber) await bumpCounterToAtLeast(ident.dealNumber, q);

  const url = normalizeAxialHref(deal.url ?? null) ?? deal.url ?? null;
  const needs = JSON.stringify(deal.needsLlm ?? []);
  const broker = deal.brokerFirm?.trim() || ident.brokerFirm;
  const nextAction = sanitizeNextAction(deal.nextAction);

  await q(
    `UPDATE deals_next SET
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
       source_deal_id      = COALESCE(source_deal_id, $19),
       source_ids          = $20::jsonb,
       alias_names         = $21::jsonb,
       gmail_thread_ids    = $22::jsonb,
       broker_firm         = COALESCE($23, broker_firm),
       fingerprint         = COALESCE($24, fingerprint),
       next_action         = COALESCE($25, next_action),
       updated_at          = now()
     WHERE id = $26`,
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
      ident.sourceDealId,
      JSON.stringify(mergedIds),
      JSON.stringify(aliases),
      JSON.stringify(mergedThreads),
      broker,
      ident.fingerprint,
      nextAction,
      matchedId,
    ],
  );
}

/**
 * Append threads / aliases / source ids onto the live deal. Does not touch
 * title, blurb, money, or stage — remint copy must not clobber the canonical.
 */
async function attachToCanonicalDeal(
  q: QueryFn,
  matchedId: number,
  deal: IncomingNextDeal,
  ident: IdentityRecord,
  title: string,
): Promise<void> {
  const existing = await q<Record<string, unknown>>(
    `SELECT title, alias_names, gmail_thread_ids, source_ids, source_deal_id, fingerprint
       FROM deals_next WHERE id = $1`,
    [matchedId],
  );
  const cur = existing[0];
  if (!cur) return;

  const aliases = mergeAliasNames(
    asStringArray(cur.alias_names),
    title,
    cur.title == null ? null : String(cur.title),
    deal.aliasNames,
  );
  const mergedThreads = mergeThreadIds(asStringArray(cur.gmail_thread_ids), ident.gmailThreadIds);
  const priorIds = parseSourceIdsValue(cur.source_ids);
  const mergedIds = [...priorIds];
  for (const s of ident.sourceIds) {
    if (!mergedIds.some((p) => p.canonical === s.canonical)) mergedIds.push(s);
  }

  await q(
    `UPDATE deals_next SET
       last_seen        = GREATEST(last_seen, COALESCE($1::timestamptz, now())),
       times_seen       = GREATEST(times_seen, $2),
       source_deal_id   = COALESCE(source_deal_id, $3),
       source_ids       = $4::jsonb,
       alias_names      = $5::jsonb,
       gmail_thread_ids = $6::jsonb,
       fingerprint      = COALESCE(fingerprint, $7),
       updated_at       = now()
     WHERE id = $8`,
    [
      toTimestamp(deal.lastSeen),
      deal.timesSeen ?? 1,
      ident.sourceDealId,
      JSON.stringify(mergedIds),
      JSON.stringify(aliases),
      JSON.stringify(mergedThreads),
      ident.fingerprint,
      matchedId,
    ],
  );
}

async function stampClosedRemint(
  q: QueryFn,
  remintId: number,
  duplicateOf: string | null,
  disposition: NextIngestDisposition,
): Promise<void> {
  const current = await q<{ stage: string }>("SELECT stage FROM deals_next WHERE id = $1", [
    remintId,
  ]);
  if (!current[0]) return;
  const from = current[0].stage;
  await q(
    `UPDATE deals_next SET
       duplicate_of = COALESCE($1, duplicate_of),
       ingest_disposition = $2,
       stage = 'closed',
       stage_changed_at = CASE WHEN stage IS DISTINCT FROM 'closed' THEN now() ELSE stage_changed_at END,
       stage_changed_by = CASE WHEN stage IS DISTINCT FROM 'closed' THEN $3 ELSE stage_changed_by END,
       updated_at = now()
     WHERE id = $4`,
    [duplicateOf, disposition, NEXT_INGEST_ACTOR, remintId],
  );
  if (from !== "closed") {
    await q(
      `INSERT INTO stage_events_next (deal_id, from_stage, to_stage, member)
       VALUES ($1, $2, 'closed', $3)`,
      [remintId, from, NEXT_INGEST_ACTOR],
    );
  }
}

async function insertNewDeal(
  q: QueryFn,
  deal: IncomingNextDeal,
  ident: IdentityRecord,
  title: string,
  remint?: {
    duplicateOf?: string | null;
    disposition?: NextIngestDisposition | null;
    closed?: boolean;
  },
): Promise<number> {
  const dealNumber =
    ident.dealNumber && parseDealNumber(ident.dealNumber)
      ? ident.dealNumber
      : await allocateDealNumber(q);
  if (ident.dealNumber) await bumpCounterToAtLeast(dealNumber, q);

  const url = normalizeAxialHref(deal.url ?? null) ?? deal.url ?? null;
  const needs = JSON.stringify(deal.needsLlm ?? []);
  const broker = deal.brokerFirm?.trim() || ident.brokerFirm;
  const nextAction = sanitizeNextAction(deal.nextAction);
  const closed = Boolean(remint?.closed);
  const disposition = remint?.disposition ?? null;
  const duplicateOf = remint?.duplicateOf ?? null;

  const inserted = await q<{ id: number }>(
    `INSERT INTO deals_next (
       deal_number, source_deal_id, source_ids, alias_names,
       gmail_thread_ids, broker_firm, fingerprint, next_action, is_demo,
       title, blurb, source, sub_source, nickname, sources,
       city, state, county,
       revenue, ebitda, sde, asking, business_model_type, needs_llm, url,
       first_seen, last_seen, times_seen,
       stage, stage_changed_at, stage_changed_by,
       duplicate_of, ingest_disposition
     ) VALUES (
       $1, $2, $3::jsonb, $4::jsonb,
       $5::jsonb, $6, $7, $8, $9,
       $10, $11, $12, $13, $14, $15,
       $16, $17, $18,
       $19, $20, $21, $22, $23, $24::jsonb, $25,
       COALESCE($26::timestamptz, now()), COALESCE($27::timestamptz, now()), $28,
       $29, CASE WHEN $29 = 'closed' THEN now() ELSE NULL END, CASE WHEN $29 = 'closed' THEN $30 ELSE NULL END,
       $31, $32
     )
     RETURNING id`,
    [
      dealNumber,
      ident.sourceDealId,
      JSON.stringify(ident.sourceIds),
      JSON.stringify(ident.aliasNames),
      JSON.stringify(ident.gmailThreadIds),
      broker,
      ident.fingerprint,
      nextAction,
      Boolean(deal.isDemo),
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
      closed ? "closed" : "inbox",
      NEXT_INGEST_ACTOR,
      duplicateOf,
      disposition,
    ],
  );

  const id = Number(inserted[0]?.id);
  if (closed && id) {
    await q(
      `INSERT INTO stage_events_next (deal_id, from_stage, to_stage, member)
       VALUES ($1, NULL, 'closed', $2)`,
      [id, NEXT_INGEST_ACTOR],
    );
  }
  return id;
}

async function applyIncomingStage(dealId: number, deal: IncomingNextDeal): Promise<void> {
  if (isAttachOnlyIngest(deal)) return;
  const stage = canonicalizeNextStage(deal.stage ?? deal.proposedStage);
  if (!stage) return;
  const member =
    deal.member && isMemberId(deal.member) ? deal.member : NEXT_INGEST_ACTOR;
  await moveNextStage(dealId, member, stage);
}

function remintIntent(deal: IncomingNextDeal): {
  duplicateOf: string | null;
  disposition: NextIngestDisposition | null;
  attachOnly: boolean;
} {
  const duplicateOf = formatDuplicateOf(deal.duplicateOf);
  const disposition = parseIngestDisposition(deal.ingestDisposition);
  return {
    duplicateOf,
    disposition,
    attachOnly: isAttachOnlyIngest(deal),
  };
}

function postedDealNumber(deal: IncomingNextDeal): string | null {
  const n = parseDealNumber(deal.dealNumber);
  return n ? formatDealNumber(n) : null;
}

export async function upsertNextDeals(deals: IncomingNextDeal[]): Promise<{
  dealsNew: number;
  dealsUpdated: number;
  skipped: number;
  dealIds: number[];
}> {
  let dealsNew = 0;
  let dealsUpdated = 0;
  let skipped = 0;
  const staged: Array<{ id: number; deal: IncomingNextDeal }> = [];

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

    const intent = remintIntent(deal);
    const ident = prepareIdentity(deal);
    const matchInput = incomingToIdentity({ ...deal, dealNumber: ident.dealNumber });

    const outcome = await withTransaction(async (q) => {
      await lockIdentity(q, ident);
      if (intent.duplicateOf) {
        await q("SELECT pg_advisory_xact_lock(872011, hashtext($1))", [
          `tly:${intent.duplicateOf}`,
        ]);
      }
      const candidates = await loadMatchCandidates(q);

      const targetByDupe = intent.duplicateOf
        ? candidates.find((c) => formatDuplicateOf(c.dealNumber) === intent.duplicateOf) ?? null
        : null;
      const hit = findIdentityMatch(matchInput, candidates);
      const attachTarget = targetByDupe ?? (intent.attachOnly && hit ? hit.candidate : null);

      if (attachTarget) {
        await attachToCanonicalDeal(q, attachTarget.id, deal, ident, title);
        const ownNumber = postedDealNumber(deal);
        if (ownNumber && ownNumber !== attachTarget.dealNumber) {
          const orphan = candidates.find((c) => formatDuplicateOf(c.dealNumber) === ownNumber);
          if (orphan && orphan.id !== attachTarget.id) {
            await stampClosedRemint(
              q,
              orphan.id,
              intent.duplicateOf ?? attachTarget.dealNumber,
              intent.disposition === "attached" ? "attached" : "remint",
            );
          }
        }
        return { kind: "updated" as const, id: attachTarget.id };
      }

      if (intent.attachOnly) {
        try {
          await q("SAVEPOINT next_insert");
          const id = await insertNewDeal(q, deal, ident, title, {
            duplicateOf: intent.duplicateOf,
            disposition: intent.disposition ?? "remint",
            closed: true,
          });
          await q("RELEASE SAVEPOINT next_insert");
          return { kind: "new" as const, id };
        } catch (error) {
          try {
            await q("ROLLBACK TO SAVEPOINT next_insert");
          } catch {
            // savepoint missing — transaction already failed
          }
          if (!isUniqueViolation(error)) throw error;
          const again = await loadMatchCandidates(q);
          const retryTarget = intent.duplicateOf
            ? again.find((c) => formatDuplicateOf(c.dealNumber) === intent.duplicateOf)
            : null;
          const retry = retryTarget
            ? { candidate: retryTarget }
            : findIdentityMatch(matchInput, again);
          if (!retry) throw error;
          await attachToCanonicalDeal(q, retry.candidate.id, deal, ident, title);
          return { kind: "updated" as const, id: retry.candidate.id };
        }
      }

      if (hit) {
        await updateMatchedDeal(q, hit.candidate.id, deal, ident, title);
        return { kind: "updated" as const, id: hit.candidate.id };
      }
      try {
        await q("SAVEPOINT next_insert");
        const id = await insertNewDeal(q, deal, ident, title);
        await q("RELEASE SAVEPOINT next_insert");
        return { kind: "new" as const, id };
      } catch (error) {
        try {
          await q("ROLLBACK TO SAVEPOINT next_insert");
        } catch {
          // savepoint missing — transaction already failed
        }
        if (!isUniqueViolation(error)) throw error;
        const again = await loadMatchCandidates(q);
        const retry = findIdentityMatch(matchInput, again);
        if (!retry) throw error;
        await updateMatchedDeal(q, retry.candidate.id, deal, ident, title);
        return { kind: "updated" as const, id: retry.candidate.id };
      }
    });

    if (!outcome.id) {
      skipped += 1;
      continue;
    }
    if (outcome.kind === "new") dealsNew += 1;
    else dealsUpdated += 1;
    staged.push({ id: outcome.id, deal });
  }

  for (const item of staged) {
    await applyIncomingStage(item.id, item.deal);
  }

  return { dealsNew, dealsUpdated, skipped, dealIds: staged.map((item) => item.id) };
}

export async function applyNextVerdicts(verdicts: IncomingNextVerdict[]): Promise<number> {
  let applied = 0;

  for (const verdict of verdicts) {
    if (!isMemberId(verdict.member) || !isVerdictAction(verdict.action)) continue;
    if (!verdict.dealNumber || !parseDealNumber(verdict.dealNumber)) continue;

    const deal = await query<{ id: number }>(
      "SELECT id FROM deals_next WHERE deal_number = $1",
      [verdict.dealNumber.trim().toUpperCase()],
    );
    if (deal.length === 0) continue;

    const result = await query<{ deal_id: number }>(
      `INSERT INTO verdicts_next (deal_id, member, action, reason, note, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()), COALESCE($6::timestamptz, now()))
       ON CONFLICT (deal_id, member) DO UPDATE
         SET action = excluded.action,
             reason = excluded.reason,
             note   = excluded.note,
             updated_at = excluded.updated_at
       WHERE excluded.updated_at > verdicts_next.updated_at
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

    if (result.length === 0) continue;
    applied += 1;

    if (verdict.action === "short" || verdict.action === "pass") {
      await clearNextSuperLike(deal[0].id);
    }
    await applyNextReviewOutcome(deal[0].id, verdict.member);
  }

  return applied;
}

export async function importNextSnapshot(
  payload: { deals?: IncomingNextDeal[]; verdicts?: IncomingNextVerdict[] },
  source: string,
  detail: string,
): Promise<NextImportResult> {
  const dealResult = await upsertNextDeals(payload.deals ?? []);
  const verdictsApplied = await applyNextVerdicts(payload.verdicts ?? []);
  const result: NextImportResult = { ...dealResult, verdictsApplied };
  await query(
    `INSERT INTO next_import_runs (source, detail, deals_new, deals_updated, verdicts_applied, skipped)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [source, detail, result.dealsNew, result.dealsUpdated, result.verdictsApplied, result.skipped],
  );
  await ensureNextSourceDealIdUnique();
  return result;
}

/** Local dummy only — never rehydrate Next from seed on hosted Neon. */
export async function seedNextIfEmpty(): Promise<NextImportResult | null> {
  if (process.env.DATABASE_URL) return null;

  const [{ count }] = await query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM deals_next",
  );
  if (Number(count) > 0) return null;

  const seedPath = path.join(process.cwd(), "db", "next-seed.json");
  if (!existsSync(seedPath)) return null;

  const payload = JSON.parse(readFileSync(seedPath, "utf8"));
  return importNextSnapshot(payload, "seed-next", path.basename(seedPath));
}
