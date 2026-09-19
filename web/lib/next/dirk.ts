import { query } from "../db";
import { gmailAllHref } from "./identity";
import {
  coerceNextStage,
  memberLabel,
  nextFollowupKind,
  nextStageLabel,
  resolveNextAction,
} from "./model";

/**
 * Live punch-list stages. Same allowlist as the staged followup query —
 * board columns plus leftover aliases that coerce onto shortlist/nda/cim/pursuing.
 */
const LIVE_PIPELINE_STAGES_SQL = `(
  'shortlist', 'pof', 'shortlisted',
  'nda', 'nda_to_sign', 'nda_signed',
  'cim',
  'pursuing', 'awaiting_reply', 'active'
)`;

/**
 * Closed-like strings: stages.ts aliases (closed/dead/pass/passed) plus leftover
 * labels (walked/archived) that would otherwise coerce to inbox.
 */
const CLOSED_LIKE_STAGES_SQL = `('closed', 'walked', 'passed', 'dead', 'archived', 'pass')`;

/** Floor so a default LIMIT 80 cannot drop live Shortlisted/NDA/CIM/Pursuing. */
const PUNCH_LIST_CAP = 500;

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  return new Date().toISOString();
}

function threadsOf(row: Record<string, unknown>): string[] {
  const raw = row.gmail_thread_ids;
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function threadLinks(row: Record<string, unknown>): string[] {
  return threadsOf(row).map(gmailAllHref);
}

function followupFromRow(
  row: Record<string, unknown>,
  kind: string,
  dueAt: string | null,
): DirkFollowup {
  const stage = coerceNextStage(row.stage);
  return {
    dealNumber: row.deal_number == null ? null : String(row.deal_number),
    title: String(row.title ?? ""),
    kind,
    stage: nextStageLabel(stage),
    nextAction: resolveNextAction(
      stage,
      row.next_action,
      row.cim_url == null ? null : String(row.cim_url),
    ),
    gmailLinks: threadLinks(row),
    ndaUrl: row.nda_url == null ? null : String(row.nda_url),
    cimUrl: row.cim_url == null ? null : String(row.cim_url),
    dueAt,
  };
}

export interface DirkInbound {
  dealNumber: string | null;
  title: string;
  source: string | null;
  nickname: string | null;
  lastSeen: string;
  gmailLinks: string[];
}

export interface DirkVerdict {
  dealNumber: string | null;
  title: string;
  member: string;
  memberLabel: string;
  action: string;
  reason: string | null;
  note: string | null;
  at: string;
  stage: string;
  gmailLinks: string[];
}

export interface DirkFollowup {
  dealNumber: string | null;
  title: string;
  kind: string;
  stage: string;
  nextAction: string | null;
  gmailLinks: string[];
  ndaUrl: string | null;
  cimUrl: string | null;
  dueAt: string | null;
}

export interface DirkFeed {
  inbound: DirkInbound[];
  verdicts: DirkVerdict[];
  followups: DirkFollowup[];
}

export async function listDirkInbound(limit = 50): Promise<DirkInbound[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT d.deal_number, d.title, d.source, d.nickname, d.last_seen, d.gmail_thread_ids
       FROM deals_next d
      WHERE d.stage = 'inbox'
        AND d.tristan_verdict IS NULL
        AND d.jim_verdict IS NULL
      ORDER BY d.last_seen DESC, d.id DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    dealNumber: row.deal_number == null ? null : String(row.deal_number),
    title: String(row.title ?? ""),
    source: row.source == null ? null : String(row.source),
    nickname: row.nickname == null ? null : String(row.nickname),
    lastSeen: iso(row.last_seen),
    gmailLinks: threadLinks(row),
  }));
}

export async function listDirkVerdicts(limit = 50): Promise<DirkVerdict[]> {
  // Votes are member columns on the deal row now; unpivot for the feed.
  const rows = await query<Record<string, unknown>>(
    `SELECT deal_number, title, stage, member, action, reason, note, at, gmail_thread_ids FROM (
       SELECT d.deal_number, d.title, d.stage, d.gmail_thread_ids, 'tristan' AS member,
              d.tristan_verdict AS action, d.tristan_verdict_reason AS reason,
              d.tristan_verdict_note AS note, d.tristan_verdict_at AS at
         FROM deals_next d WHERE d.tristan_verdict IS NOT NULL
       UNION ALL
       SELECT d.deal_number, d.title, d.stage, d.gmail_thread_ids, 'partner' AS member,
              d.jim_verdict AS action, d.jim_verdict_reason AS reason,
              d.jim_verdict_note AS note, d.jim_verdict_at AS at
         FROM deals_next d WHERE d.jim_verdict IS NOT NULL
     ) v
     ORDER BY v.at DESC NULLS LAST
     LIMIT $1`,
    [limit],
  );
  return rows.map((row) => {
    const member = String(row.member ?? "");
    const stage = coerceNextStage(row.stage);
    return {
      dealNumber: row.deal_number == null ? null : String(row.deal_number),
      title: String(row.title ?? ""),
      member,
      memberLabel: memberLabel(member),
      action: String(row.action ?? ""),
      reason: row.reason == null ? null : String(row.reason),
      note: row.note == null ? null : String(row.note),
      at: iso(row.at),
      stage: nextStageLabel(stage),
      gmailLinks: threadLinks(row),
    };
  });
}

export async function listDirkFollowups(limit = 80): Promise<DirkFollowup[]> {
  // Staged live-pipeline rows are the punch-list source. Fetch a high cap so
  // closed watches cannot starve Shortlisted/NDA/CIM/Pursuing.
  const fetchLimit = Math.max(limit, PUNCH_LIST_CAP);

  const staged = await query<Record<string, unknown>>(
    `SELECT deal_number, title, stage, next_action, nda_url, cim_url, gmail_thread_ids
       FROM deals_next
      WHERE stage IN ${LIVE_PIPELINE_STAGES_SQL}
      ORDER BY stage_changed_at DESC NULLS LAST, id DESC
      LIMIT $1`,
    [fetchLimit],
  );

  const watched = await query<Record<string, unknown>>(
    `SELECT d.deal_number, d.title, d.stage, d.next_action, d.nda_url, d.cim_url,
            d.gmail_thread_ids, w.value->>'kind' AS kind, w.value->>'due_at' AS due_at,
            w.value->>'armed_at' AS armed_at
       FROM deals_next d,
            jsonb_array_elements(d.watches) AS w(value)
      WHERE w.value->>'status' = 'open'
        AND d.stage IN ${LIVE_PIPELINE_STAGES_SQL}
        AND d.stage NOT IN ${CLOSED_LIKE_STAGES_SQL}
      ORDER BY (w.value->>'armed_at') DESC NULLS LAST
      LIMIT $1`,
    [fetchLimit],
  );

  const out: DirkFollowup[] = [];
  const seenDeals = new Set<string>();

  for (const row of staged) {
    const key = String(row.deal_number ?? "");
    seenDeals.add(key);
    const stage = coerceNextStage(row.stage);
    out.push(followupFromRow(row, nextFollowupKind(stage) ?? "follow_up", null));
  }

  for (const row of watched) {
    const key = String(row.deal_number ?? "");
    if (seenDeals.has(key)) continue;
    seenDeals.add(key);
    out.push(
      followupFromRow(row, String(row.kind ?? "watch"), row.due_at ? iso(row.due_at) : null),
    );
  }

  return out.slice(0, fetchLimit);
}

export async function buildDirkFeed(): Promise<DirkFeed> {
  const [inbound, verdicts, followups] = await Promise.all([
    listDirkInbound(),
    listDirkVerdicts(),
    listDirkFollowups(),
  ]);
  return { inbound, verdicts, followups };
}
