import { query } from "./db";
import { gmailAllHref } from "./identity";
import { coerceStage, defaultNextAction, memberLabel, stageLabel } from "./model";

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
  const ids = threadsOf(row);
  const links = ids.map(gmailAllHref);
  const legacy = row.gmail_thread_url == null ? null : String(row.gmail_thread_url);
  if (legacy && !links.includes(legacy)) links.push(legacy);
  return links;
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

/** New inbound still sitting on review cards. */
export async function listDirkInbound(limit = 50): Promise<DirkInbound[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT d.deal_number, d.title, d.source, d.nickname, d.last_seen,
            d.gmail_thread_ids, d.gmail_thread_url
       FROM deals d
      WHERE d.stage = 'inbox'
        AND NOT EXISTS (
          SELECT 1 FROM verdicts v WHERE v.deal_id = d.id
        )
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

/** Latest card verdicts — who / when / deal number / action. */
export async function listDirkVerdicts(limit = 50): Promise<DirkVerdict[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT d.deal_number, d.title, d.stage, v.member, v.action, v.reason, v.note, v.updated_at
       FROM verdicts v
       JOIN deals d ON d.id = v.deal_id
      ORDER BY v.updated_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((row) => {
    const member = String(row.member ?? "");
    const stage = coerceStage(row.stage == null ? null : String(row.stage));
    return {
      dealNumber: row.deal_number == null ? null : String(row.deal_number),
      title: String(row.title ?? ""),
      member,
      memberLabel: memberLabel(member),
      action: String(row.action ?? ""),
      reason: row.reason == null ? null : String(row.reason),
      note: row.note == null ? null : String(row.note),
      at: iso(row.updated_at),
      stage: stageLabel(stage),
    };
  });
}

/** Open NDAs, CIMs, broker replies — plus stage-based follow-ups. */
export async function listDirkFollowups(limit = 80): Promise<DirkFollowup[]> {
  const watched = await query<Record<string, unknown>>(
    `SELECT d.deal_number, d.title, d.stage, d.next_action, d.nda_url, d.cim_url,
            d.gmail_thread_ids, d.gmail_thread_url, e.kind, e.due_at
       FROM deal_expectations e
       JOIN deals d ON d.id = e.deal_id
      WHERE e.status = 'open'
      ORDER BY e.armed_at DESC
      LIMIT $1`,
    [limit],
  ).catch(() => [] as Record<string, unknown>[]);

  const staged = await query<Record<string, unknown>>(
    `SELECT deal_number, title, stage, next_action, nda_url, cim_url,
            gmail_thread_ids, gmail_thread_url
       FROM deals
      WHERE stage IN ('shortlist', 'pof', 'nda_to_sign', 'nda', 'cim', 'awaiting_reply', 'active')
      ORDER BY stage_changed_at DESC NULLS LAST, id DESC
      LIMIT $1`,
    [limit],
  );

  const out: DirkFollowup[] = [];
  const seen = new Set<string>();

  for (const row of watched) {
    const key = `${row.deal_number}:${row.kind}`;
    seen.add(key);
    const stage = coerceStage(row.stage == null ? null : String(row.stage));
    out.push({
      dealNumber: row.deal_number == null ? null : String(row.deal_number),
      title: String(row.title ?? ""),
      kind: String(row.kind ?? "watch"),
      stage: stageLabel(stage),
      nextAction: row.next_action == null ? defaultNextAction(stage) : String(row.next_action),
      gmailLinks: threadLinks(row),
      ndaUrl: row.nda_url == null ? null : String(row.nda_url),
      cimUrl: row.cim_url == null ? null : String(row.cim_url),
      dueAt: row.due_at ? iso(row.due_at) : null,
    });
  }

  for (const row of staged) {
    const stage = coerceStage(row.stage == null ? null : String(row.stage));
    const kind =
      stage === "nda_to_sign" || stage === "nda"
        ? "nda"
        : stage === "cim"
          ? "cim"
          : stage === "awaiting_reply"
            ? "broker_reply"
            : "follow_up";
    const key = `${row.deal_number}:${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      dealNumber: row.deal_number == null ? null : String(row.deal_number),
      title: String(row.title ?? ""),
      kind,
      stage: stageLabel(stage),
      nextAction: row.next_action == null ? defaultNextAction(stage) : String(row.next_action),
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
