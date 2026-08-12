/**
 * Pursuit-lane CRM: match broker/NDA/CIM mail to pipeline deals and apply.
 * Called by POST /api/crm/pursuit (machine token from harvest).
 */

import { query, queryOne } from "./db";
import { getDeal, moveStage, saveDealFile } from "./deals";
import { gmailCatcherThreadUrl, normalizeGmailThreadUrl } from "./gmail-thread";
import type { DealRow, MemberId, StageId } from "./model";

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
  };
  file?: {
    filename: string;
    contentType: string;
    bytes: Uint8Array;
  } | null;
}

export interface PursuitApplyResult {
  gmailMessageId: string;
  status: "applied" | "duplicate" | "unmatched" | "skipped";
  dealId: number | null;
  detail: string;
}

const SYSTEM_MEMBER: MemberId = "tristan";

const BOARD_OR_ACTIVE: StageId[] = [
  "inbox",
  "shortlist",
  "contacted",
  "nda",
  "cim",
  "call",
  "loi",
  "diligence",
  "offer",
];

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

/** Candidates: not dead/closed — pursuit mail can arrive before shortlist. */
export async function listPursuitCandidates(): Promise<
  Pick<DealRow, "id" | "title" | "url" | "ext_id" | "stage">[]
> {
  const rows = await query<Record<string, unknown>>(
    `SELECT id, title, url, ext_id, stage FROM deals
     WHERE stage = ANY($1::text[])
     ORDER BY last_seen DESC
     LIMIT 2000`,
    [BOARD_OR_ACTIVE],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    url: r.url == null ? null : String(r.url),
    ext_id: String(r.ext_id),
    stage: r.stage as StageId,
  }));
}

export function matchDeal(
  candidates: Pick<DealRow, "id" | "title" | "url" | "ext_id">[],
  hints: PursuitEventInput["matchHints"],
  subject: string,
  body: string,
): { dealId: number; score: number; how: string } | null {
  const dealNumber =
    hints?.dealNumber ||
    (subject + " " + body).match(/\bdeal\s*#?\s*(\d{5,})/i)?.[1] ||
    (subject + " " + body).match(/\b#(\d{6,})\b/)?.[1] ||
    null;

  if (dealNumber) {
    const hit = candidates.find(
      (c) =>
        (c.url && c.url.includes(dealNumber)) ||
        c.ext_id.includes(dealNumber) ||
        c.title.includes(dealNumber),
    );
    if (hit) return { dealId: hit.id, score: 1, how: `deal#${dealNumber}` };
  }

  const titleCue =
    hints?.titleCue ||
    subject
      .replace(/^re:\s*/i, "")
      .replace(/^\[external\]\s*/i, "")
      .replace(/^sent nda:\s*/i, "")
      .replace(/^signature requested on\s*[\"']?/i, "")
      .replace(/^you signed:\s*[\"']?/i, "")
      .replace(/^tristan,?\s*attached is our cim for\s*/i, "")
      .replace(/\s*for your review\.?$/i, "")
      .replace(/[\"']/g, "")
      .trim();

  // "acted on X" Axial phrasing
  const acted = subject.match(/acted on\s+(.+)$/i)?.[1]?.trim();
  const cue = acted || titleCue;
  if (!cue || cue.length < 6) return null;

  let best: { dealId: number; score: number; how: string } | null = null;
  for (const c of candidates) {
    const score = Math.max(titleScore(cue, c.title), titleScore(norm(cue), norm(c.title)));
    if (score >= 0.45 && (!best || score > best.score)) {
      best = { dealId: c.id, score, how: `title:${score.toFixed(2)}` };
    }
  }
  return best;
}

function gmailThreadLink(threadId: string | null | undefined): string | null {
  if (!threadId?.trim()) return null;
  return gmailCatcherThreadUrl(threadId);
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

  // Skip signed-NDA PDFs as CIM files
  if (
    input.eventType === "nda_signed" &&
    input.file &&
    /signed|nda/i.test(input.file.filename) &&
    !/cim|om\b|memorandum/i.test(input.file.filename)
  ) {
    // still record + match for thread/url, but don't save as CIM
    input = { ...input, file: null };
  }

  const candidates = await listPursuitCandidates();
  const matched = matchDeal(
    candidates,
    input.matchHints,
    input.subject || "",
    input.bodyText || "",
  );

  const threadUrl =
    normalizeGmailThreadUrl(input.gmailThreadUrl) ||
    gmailThreadLink(input.gmailThreadId) ||
    null;
  const ndaUrl = input.ndaUrl?.trim() || null;

  if (!matched) {
    await query(
      `INSERT INTO crm_events
         (gmail_message_id, gmail_thread_id, deal_id, event_type, subject, from_address,
          nda_url, gmail_thread_url, payload, status)
       VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8::jsonb,'unmatched')`,
      [
        input.gmailMessageId,
        input.gmailThreadId ?? null,
        input.eventType,
        input.subject ?? null,
        input.fromAddress ?? null,
        ndaUrl,
        threadUrl,
        JSON.stringify({ matchHints: input.matchHints ?? {}, reason: "no deal match" }),
      ],
    );
    return {
      gmailMessageId: input.gmailMessageId,
      status: "unmatched",
      dealId: null,
      detail: "No matching pipeline deal",
    };
  }

  const dealId = matched.dealId;
  const updates: string[] = [];
  const params: unknown[] = [];
  let p = 1;

  if (ndaUrl && (input.eventType === "nda_available" || input.eventType === "nda_signed")) {
    updates.push(`nda_url = $${p++}`);
    params.push(ndaUrl);
  }
  if (threadUrl) {
    updates.push(`gmail_thread_url = $${p++}`);
    params.push(threadUrl);
  }
  if (updates.length) {
    updates.push("updated_at = now()");
    params.push(dealId);
    await query(`UPDATE deals SET ${updates.join(", ")} WHERE id = $${p}`, params);
  }

  if (input.eventType === "cim_received" && input.file) {
    await saveDealFile(dealId, SYSTEM_MEMBER, {
      filename: input.file.filename,
      contentType: input.file.contentType,
      bytes: input.file.bytes,
    }, "cim");
  }

  // Forward-only soft stage nudges (never dead/closed)
  const deal = await getDeal(dealId);
  if (deal) {
    const stage = deal.stage;
    if (input.eventType === "cim_received" && input.file) {
      if (stage === "inbox" || stage === "shortlist" || stage === "contacted" || stage === "nda") {
        await moveStage(dealId, SYSTEM_MEMBER, "cim");
      }
    } else if (input.eventType === "nda_available") {
      if (stage === "inbox" || stage === "shortlist") {
        await moveStage(dealId, SYSTEM_MEMBER, "contacted");
      }
    } else if (input.eventType === "nda_signed") {
      if (stage === "inbox" || stage === "shortlist" || stage === "contacted") {
        await moveStage(dealId, SYSTEM_MEMBER, "nda");
      }
    }
  }

  await query(
    `INSERT INTO crm_events
       (gmail_message_id, gmail_thread_id, deal_id, event_type, subject, from_address,
        nda_url, gmail_thread_url, payload, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'applied')`,
    [
      input.gmailMessageId,
      input.gmailThreadId ?? null,
      dealId,
      input.eventType,
      input.subject ?? null,
      input.fromAddress ?? null,
      ndaUrl,
      threadUrl,
      JSON.stringify({ match: matched, matchHints: input.matchHints ?? {} }),
    ],
  );

  return {
    gmailMessageId: input.gmailMessageId,
    status: "applied",
    dealId,
    detail: matched.how,
  };
}
