/**
 * Pursuit-lane CRM: type + hard-match inbox mail onto armed deals.
 *
 * Auto-apply only on listing-id or verbatim-title match.
 * Soft fuzzy → needs_review (agentic). Unarmed fuzzy misses stay unmatched.
 *
 * Writes the dealbook (`deals_next` + `deal_log`). Classic `deals` is unused.
 */

import { query, queryOne } from "./db";
import { extractGmailThreadId, gmailCatcherThreadUrl, normalizeGmailThreadUrl } from "./gmail-thread";
import { logDealChange } from "./next/change-log";
import { getNextDeal, moveNextStage } from "./next/deals";
import { mergeThreadIds } from "./next/identity";
import { coerceNextStage, type NextStageId } from "./next/stages";
import type { DealExpectation } from "./expectations";

export type CrmEventType =
  | "nda_available"
  | "nda_signed"
  | "cim_received"
  | "vdr_access"
  | "broker_message";

export interface PursuitEventInput {
  gmailMessageId: string;
  gmailThreadId?: string | null;
  subject?: string | null;
  fromAddress?: string | null;
  bodyText?: string | null;
  eventType: CrmEventType;
  ndaUrl?: string | null;
  gmailThreadUrl?: string | null;
  matchHints?: {
    dealNumber?: string | null;
    titleCue?: string | null;
    listingIds?: string[] | null;
  };
  file?: {
    filename: string;
    contentType: string;
    bytes: Uint8Array;
  } | null;
}

export interface PursuitApplyResult {
  gmailMessageId: string;
  status: "applied" | "duplicate" | "unmatched" | "needs_review" | "skipped";
  dealId: number | null;
  detail: string;
}

export type PursuitCandidate = {
  id: number;
  title: string;
  url: string | null;
  ext_id: string;
};

const CRM_ACTOR = "dirk";
const CRM_CHANNEL = "api:crm/pursuit";

const LIVE_STAGES: NextStageId[] = ["inbox", "shortlist", "nda", "cim", "pursuing"];

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): Set<string> {
  return new Set(
    norm(s)
      .split(" ")
      .filter((t) => t.length > 2 && !["the", "and", "for", "your", "with", "from"].includes(t)),
  );
}

function titleScore(cue: string, title: string): number {
  const a = tokens(cue);
  const b = tokens(title);
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit += 1;
  return hit / Math.max(a.size, Math.min(b.size, a.size));
}

/** Listing / marketplace ids from URLs and body. */
export function extractListingIds(...parts: (string | null | undefined)[]): string[] {
  const hay = parts.filter(Boolean).join("\n");
  const ids: string[] = [];
  const patterns = [
    /bizbuysell\.com\/[^?\s]*[?&]q=(\d{5,})/gi,
    /\/business-opportunity\/[^/\s]+\/(\d{5,})/gi,
    /rejigg\.com\/app\/businesses\/(\d+)/gi,
    /websiteclosers\.com\/businesses\/[^/\s]+\/(\d+)/gi,
    /axial\.net\/[^\s]*opportunity\/([a-f0-9-]{8,})/gi,
    /\bdeal\s*#?\s*(\d{5,})\b/gi,
    /\b#(\d{6,})\b/g,
  ];
  for (const re of patterns) {
    for (const m of hay.matchAll(re)) {
      if (m[1]) ids.push(m[1]);
    }
  }
  return [...new Set(ids)];
}

function cleanTitleCue(subject: string, hints?: PursuitEventInput["matchHints"]): string {
  const acted = subject.match(/acted on\s+(.+)$/i)?.[1]?.trim();
  if (acted) return acted;
  if (hints?.titleCue?.trim()) return hints.titleCue.trim();
  return subject
    .replace(/^re:\s*/i, "")
    .replace(/^\[external\]\s*/i, "")
    .replace(/^sent nda:\s*/i, "")
    .replace(/^signature requested on\s*["']?/i, "")
    .replace(/^you signed:\s*["']?/i, "")
    .replace(/^tristan,?\s*attached is our cim for\s*/i, "")
    .replace(/\s*for your review\.?$/i, "")
    .replace(/^new deal alert:\s*/i, "")
    .replace(/["']/g, "")
    .trim();
}

/** True when cue and title are the same headline (containment / equality). */
export function verbatimTitleMatch(cue: string, title: string): boolean {
  const a = norm(cue);
  const b = norm(title);
  if (a.length < 10 || b.length < 10) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 12) return false;
  return long.includes(short);
}

export async function listPursuitCandidates(): Promise<PursuitCandidate[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT id, title, url, source_deal_id, deal_number
       FROM deals_next
      WHERE stage = ANY($1::text[])
        AND duplicate_of IS NULL
      ORDER BY last_seen DESC
      LIMIT 2000`,
    [LIVE_STAGES],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    url: r.url == null ? null : String(r.url),
    ext_id: [r.source_deal_id, r.deal_number].filter(Boolean).join(" "),
  }));
}

async function listArmedDealIds(): Promise<Set<number>> {
  const rows = await query<{ id: number }>(
    `SELECT DISTINCT d.id
       FROM deals_next d,
            jsonb_array_elements(d.watches) AS w(value)
      WHERE w.value->>'status' = 'open'
        AND d.stage = ANY($1::text[])
        AND d.duplicate_of IS NULL`,
    [LIVE_STAGES],
  );
  return new Set(rows.map((r) => Number(r.id)));
}

export type MatchDecision =
  | { kind: "hard"; dealId: number; how: string }
  | { kind: "review"; dealId: number; how: string; score: number }
  | null;

/**
 * Hard match = listing id OR verbatim title.
 * Soft fuzzy only proposes needs_review (and only vs armed deals).
 */
export function decideMatch(
  candidates: PursuitCandidate[],
  armedIds: Set<number>,
  hints: PursuitEventInput["matchHints"],
  subject: string,
  body: string,
): MatchDecision {
  const listingIds = [
    ...extractListingIds(subject, body, ...(hints?.listingIds || [])),
    ...(hints?.dealNumber ? [hints.dealNumber] : []),
  ];
  const uniqueIds = [...new Set(listingIds)];

  for (const id of uniqueIds) {
    const hit = candidates.find(
      (c) =>
        (c.url && c.url.includes(id)) ||
        c.ext_id.includes(id) ||
        norm(c.title).includes(id),
    );
    if (hit) return { kind: "hard", dealId: hit.id, how: `listing_id:${id}` };
  }

  const cue = cleanTitleCue(subject, hints);
  if (!cue || cue.length < 6) return null;

  const armed = candidates.filter((c) => armedIds.has(c.id));
  for (const pool of [armed, candidates]) {
    for (const c of pool) {
      if (verbatimTitleMatch(cue, c.title)) {
        return {
          kind: "hard",
          dealId: c.id,
          how: armedIds.has(c.id) ? "verbatim+armed" : "verbatim",
        };
      }
    }
  }

  let best: { dealId: number; score: number } | null = null;
  for (const c of armed) {
    const score = Math.max(titleScore(cue, c.title), titleScore(norm(cue), norm(c.title)));
    if (score >= 0.7 && (!best || score > best.score)) {
      best = { dealId: c.id, score };
    }
  }
  if (best) {
    return {
      kind: "review",
      dealId: best.dealId,
      how: `fuzzy:${best.score.toFixed(2)}+armed`,
      score: best.score,
    };
  }

  return null;
}

function gmailThreadLink(threadId: string | null | undefined): string | null {
  if (!threadId?.trim()) return null;
  return gmailCatcherThreadUrl(threadId);
}

async function insertCrmEvent(args: {
  gmailMessageId: string;
  gmailThreadId?: string | null;
  dealId: number | null;
  eventType: string;
  subject?: string | null;
  fromAddress?: string | null;
  ndaUrl: string | null;
  threadUrl: string | null;
  status: string;
  payload: Record<string, unknown>;
}): Promise<number | null> {
  const rows = await query<{ id: number }>(
    `INSERT INTO crm_events
       (gmail_message_id, gmail_thread_id, deal_id, event_type, subject, from_address,
        nda_url, gmail_thread_url, payload, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
     RETURNING id`,
    [
      args.gmailMessageId,
      args.gmailThreadId ?? null,
      args.dealId,
      args.eventType,
      args.subject ?? null,
      args.fromAddress ?? null,
      args.ndaUrl,
      args.threadUrl,
      JSON.stringify(args.payload),
      args.status,
    ],
  );
  return rows[0]?.id ?? null;
}

async function resolveOpenWatches(dealId: number, kinds: string[]): Promise<void> {
  const deal = await getNextDeal(dealId);
  if (!deal) return;
  let changed = false;
  const watches = deal.watches.map((w) => {
    if (w.status === "open" && kinds.includes(w.kind)) {
      changed = true;
      return { ...w, status: "fulfilled" };
    }
    return w;
  });
  if (!changed) return;
  await query(`UPDATE deals_next SET watches = $1::jsonb, updated_at = now() WHERE id = $2`, [
    JSON.stringify(watches),
    dealId,
  ]);
  await logDealChange({
    dealId,
    dealNumber: deal.deal_number,
    actor: CRM_ACTOR,
    kind: "watch",
    patch: { watches: { new: watches } },
    channel: CRM_CHANNEL,
  });
}

async function stampPursuitOnDeal(args: {
  dealId: number;
  eventType: string;
  ndaUrl: string | null;
  threadId: string | null;
}): Promise<boolean> {
  const deal = await getNextDeal(args.dealId);
  if (!deal) return false;

  const threads = mergeThreadIds(deal.gmail_thread_ids, args.threadId ? [args.threadId] : []);
  const ndaForEvent =
    args.ndaUrl && (args.eventType === "nda_available" || args.eventType === "nda_signed")
      ? args.ndaUrl
      : null;

  await query(
    `UPDATE deals_next
        SET nda_url = COALESCE($1, nda_url),
            gmail_thread_ids = $2::jsonb,
            updated_at = now()
      WHERE id = $3`,
    [ndaForEvent, JSON.stringify(threads), args.dealId],
  );
  await logDealChange({
    dealId: args.dealId,
    dealNumber: deal.deal_number,
    actor: CRM_ACTOR,
    kind: "update",
    patch: {
      ...(ndaForEvent ? { nda_url: { old: deal.nda_url, new: ndaForEvent } } : {}),
      gmail_thread_ids: { old: deal.gmail_thread_ids, new: threads },
    },
    channel: CRM_CHANNEL,
  });

  const stage = coerceNextStage(deal.stage);
  if (args.eventType === "cim_received" && (stage === "inbox" || stage === "shortlist" || stage === "nda")) {
    await moveNextStage(args.dealId, CRM_ACTOR, "cim", { channel: CRM_CHANNEL });
  } else if (
    (args.eventType === "nda_available" || args.eventType === "nda_signed") &&
    (stage === "inbox" || stage === "shortlist")
  ) {
    await moveNextStage(args.dealId, CRM_ACTOR, "nda", { channel: CRM_CHANNEL });
  }

  if (args.eventType === "cim_received") {
    await resolveOpenWatches(args.dealId, ["cim", "nda", "broker_reply"]);
  } else if (args.eventType === "nda_signed" || args.eventType === "nda_available") {
    await resolveOpenWatches(args.dealId, ["nda"]);
  }

  return true;
}

export async function applyPursuitEvent(input: PursuitEventInput): Promise<PursuitApplyResult> {
  const existing = await queryOne<{ id: number; deal_id: number | null }>(
    `SELECT id, deal_id FROM crm_events WHERE gmail_message_id = $1`,
    [input.gmailMessageId],
  );
  if (existing) {
    return {
      gmailMessageId: input.gmailMessageId,
      status: "duplicate",
      dealId: existing.deal_id,
      detail: "Already processed",
    };
  }

  const candidates = await listPursuitCandidates();
  const armedIds = await listArmedDealIds();
  const decision = decideMatch(
    candidates,
    armedIds,
    input.matchHints,
    input.subject || "",
    input.bodyText || "",
  );

  const threadUrl =
    normalizeGmailThreadUrl(input.gmailThreadUrl) ||
    gmailThreadLink(input.gmailThreadId) ||
    null;
  const threadId =
    extractGmailThreadId(input.gmailThreadId) || extractGmailThreadId(threadUrl) || null;
  const ndaUrl = input.ndaUrl?.trim() || null;

  if (!decision) {
    await insertCrmEvent({
      gmailMessageId: input.gmailMessageId,
      gmailThreadId: input.gmailThreadId,
      dealId: null,
      eventType: input.eventType,
      subject: input.subject,
      fromAddress: input.fromAddress,
      ndaUrl,
      threadUrl,
      status: "unmatched",
      payload: { matchHints: input.matchHints ?? {}, reason: "no hard match" },
    });
    return {
      gmailMessageId: input.gmailMessageId,
      status: "unmatched",
      dealId: null,
      detail: "No hard match (listing id / verbatim title)",
    };
  }

  if (decision.kind === "review") {
    await insertCrmEvent({
      gmailMessageId: input.gmailMessageId,
      gmailThreadId: input.gmailThreadId,
      dealId: decision.dealId,
      eventType: input.eventType,
      subject: input.subject,
      fromAddress: input.fromAddress,
      ndaUrl,
      threadUrl,
      status: "needs_review",
      payload: {
        matchHints: input.matchHints ?? {},
        proposed: decision,
      },
    });
    return {
      gmailMessageId: input.gmailMessageId,
      status: "needs_review",
      dealId: decision.dealId,
      detail: decision.how,
    };
  }

  const dealId = decision.dealId;
  const stamped = await stampPursuitOnDeal({
    dealId,
    eventType: input.eventType,
    ndaUrl,
    threadId,
  });
  if (!stamped) {
    return {
      gmailMessageId: input.gmailMessageId,
      status: "unmatched",
      dealId: null,
      detail: "Matched deal missing from dealbook",
    };
  }

  await insertCrmEvent({
    gmailMessageId: input.gmailMessageId,
    gmailThreadId: input.gmailThreadId,
    dealId,
    eventType: input.eventType,
    subject: input.subject,
    fromAddress: input.fromAddress,
    ndaUrl,
    threadUrl,
    status: "applied",
    payload: { match: decision, matchHints: input.matchHints ?? {} },
  });

  return {
    gmailMessageId: input.gmailMessageId,
    status: "applied",
    dealId,
    detail: decision.how,
  };
}

/** Human confirms a needs_review event onto its proposed (or chosen) deal. */
export async function confirmCrmReview(
  eventId: number,
  dealId: number,
): Promise<{ ok: boolean; detail: string }> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT * FROM crm_events WHERE id = $1`,
    [eventId],
  );
  if (!row) return { ok: false, detail: "Event not found" };
  if (String(row.status) !== "needs_review" && String(row.status) !== "unmatched") {
    return { ok: false, detail: `Status is ${row.status}` };
  }

  const ndaUrl = row.nda_url == null ? null : String(row.nda_url);
  const threadUrl = normalizeGmailThreadUrl(
    row.gmail_thread_url == null ? null : String(row.gmail_thread_url),
  );
  const threadId =
    extractGmailThreadId(row.gmail_thread_id == null ? null : String(row.gmail_thread_id)) ||
    extractGmailThreadId(threadUrl);
  const eventType = String(row.event_type);

  const stamped = await stampPursuitOnDeal({
    dealId,
    eventType,
    ndaUrl,
    threadId,
  });
  if (!stamped) return { ok: false, detail: "Deal not found" };

  await query(
    `UPDATE crm_events
        SET deal_id = $1, status = 'applied',
            payload = payload || jsonb_build_object('confirmed', true, 'confirmedAt', now())
      WHERE id = $2`,
    [dealId, eventId],
  );

  return { ok: true, detail: `Applied to deal ${dealId}` };
}

export async function dismissCrmReview(eventId: number): Promise<void> {
  await query(
    `UPDATE crm_events
        SET status = 'dismissed',
            payload = payload || jsonb_build_object('dismissed', true)
      WHERE id = $1 AND status IN ('needs_review', 'unmatched')`,
    [eventId],
  );
}

export async function listCrmAttention(): Promise<{
  expectations: DealExpectation[];
  reviews: Array<{
    id: number;
    deal_id: number | null;
    event_type: string;
    subject: string | null;
    from_address: string | null;
    status: string;
    created_at: string;
    proposed_title: string | null;
    gmail_thread_url: string | null;
    nda_url: string | null;
  }>;
}> {
  const rows = await query<Record<string, unknown>>(
    `SELECT e.id, e.deal_id, e.event_type, e.subject, e.from_address, e.status, e.created_at,
            e.gmail_thread_url, e.nda_url, d.title AS proposed_title
       FROM crm_events e
       LEFT JOIN deals_next d ON d.id = e.deal_id
      WHERE e.status IN ('needs_review', 'unmatched')
      ORDER BY e.created_at DESC
      LIMIT 50`,
  );
  return {
    expectations: [],
    reviews: rows.map((r) => ({
      id: Number(r.id),
      deal_id: r.deal_id == null ? null : Number(r.deal_id),
      event_type: String(r.event_type),
      subject: r.subject == null ? null : String(r.subject),
      from_address: r.from_address == null ? null : String(r.from_address),
      status: String(r.status),
      created_at: String(r.created_at),
      proposed_title: r.proposed_title == null ? null : String(r.proposed_title),
      gmail_thread_url: normalizeGmailThreadUrl(
        r.gmail_thread_url == null ? null : String(r.gmail_thread_url),
      ),
      nda_url: r.nda_url == null ? null : String(r.nda_url),
    })),
  };
}
