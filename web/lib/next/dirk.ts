import { query } from "../db";
import { gmailAllHref } from "./identity";
import {
  coerceNextStage,
  memberLabel,
  nextFollowupKind,
  nextStageLabel,
  resolveNextAction,
} from "./model";

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
    `SELECT deal_number, title, stage, member, action, reason, note, at FROM (
       SELECT d.deal_number, d.title, d.stage, 'tristan' AS member,
              d.tristan_verdict AS action, d.tristan_verdict_reason AS reason,
              d.tristan_verdict_note AS note, d.tristan_verdict_at AS at
         FROM deals_next d WHERE d.tristan_verdict IS NOT NULL
       UNION ALL
       SELECT d.deal_number, d.title, d.stage, 'partner' AS member,
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
    };
  });
}

export async function listDirkFollowups(limit = 80): Promise<DirkFollowup[]> {
  // Watches ride on the deal row (jsonb list) — expand the open ones.
  const watched = await query<Record<string, unknown>>(
    `SELECT d.deal_number, d.title, d.stage, d.next_action, d.nda_url, d.cim_url,
            d.gmail_thread_ids, w.value->>'kind' AS kind, w.value->>'due_at' AS due_at,
            w.value->>'armed_at' AS armed_at
       FROM deals_next d,
            jsonb_array_elements(d.watches) AS w(value)
      WHERE w.value->>'status' = 'open'
      ORDER BY (w.value->>'armed_at') DESC NULLS LAST
      LIMIT $1`,
    [limit],
  );

  const staged = await query<Record<string, unknown>>(
    `SELECT deal_number, title, stage, next_action, nda_url, cim_url, gmail_thread_ids
       FROM deals_next
      WHERE stage IN (
              'shortlist', 'pof', 'shortlisted',
              'nda', 'nda_to_sign', 'nda_signed',
              'cim',
              'pursuing', 'awaiting_reply', 'active'
            )
      ORDER BY stage_changed_at DESC NULLS LAST, id DESC
      LIMIT $1`,
    [limit],
  );

  const out: DirkFollowup[] = [];
  const seen = new Set<string>();

  for (const row of watched) {
    const key = `${row.deal_number}:${row.kind}`;
    seen.add(key);
    const stage = coerceNextStage(row.stage);
    out.push({
      dealNumber: row.deal_number == null ? null : String(row.deal_number),
      title: String(row.title ?? ""),
      kind: String(row.kind ?? "watch"),
      stage: nextStageLabel(stage),
      nextAction: resolveNextAction(
        stage,
        row.next_action,
        row.cim_url == null ? null : String(row.cim_url),
      ),
      gmailLinks: threadLinks(row),
      ndaUrl: row.nda_url == null ? null : String(row.nda_url),
      cimUrl: row.cim_url == null ? null : String(row.cim_url),
      dueAt: row.due_at ? iso(row.due_at) : null,
    });
  }

  for (const row of staged) {
    const stage = coerceNextStage(row.stage);
    const kind = nextFollowupKind(stage) ?? "follow_up";
    const key = `${row.deal_number}:${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
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
      dueAt: null,
    });
  }

  return out.slice(0, limit);
}

export async function buildDirkFeed(): Promise<DirkFeed> {
  const [inbound, verdicts, followups] = await Promise.all([
    listDirkInbound(),
    listDirkVerdicts(),
    listDirkFollowups(),
  ]);
  return { inbound, verdicts, followups };
}
