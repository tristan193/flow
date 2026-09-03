import { query } from "../db";
import { cimFolderTitle, closedCimArchive, parseDriveFolderId } from "./cim-drive";
import { gmailAllHref } from "./identity";
import {
  coerceNextStage,
  defaultNextAction,
  memberLabel,
  nextFollowupKind,
  nextStageLabel,
  sanitizeNextAction,
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
  driveFolderId: string | null;
  viewUrl: string | null;
  simonReview: string | null;
  dueAt: string | null;
}

export interface DirkCimFolder {
  dealNumber: string | null;
  title: string;
  folderTitle: string;
  viewUrl: string | null;
  folderId: string | null;
  sendToSimon: string;
}

export interface DirkClosed {
  dealNumber: string | null;
  title: string;
  closedAt: string | null;
  closedBy: string | null;
  cimUrl: string | null;
  driveFolderId: string | null;
  driveFolderUrl: string | null;
  archiveFolderId: string;
  archiveFolderUrl: string;
  archiveHint: string;
}

export interface DirkFeed {
  inbound: DirkInbound[];
  verdicts: DirkVerdict[];
  followups: DirkFollowup[];
  cimFolders: DirkCimFolder[];
  closed: DirkClosed[];
}

export async function listDirkInbound(limit = 50): Promise<DirkInbound[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT d.deal_number, d.title, d.source, d.nickname, d.last_seen, d.gmail_thread_ids
       FROM deals_next d
      WHERE d.stage = 'inbox'
        AND NOT EXISTS (
          SELECT 1 FROM verdicts_next v WHERE v.deal_id = d.id
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

export async function listDirkVerdicts(limit = 50): Promise<DirkVerdict[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT d.deal_number, d.title, d.stage, v.member, v.action, v.reason, v.note, v.updated_at
       FROM verdicts_next v
       JOIN deals_next d ON d.id = v.deal_id
      ORDER BY v.updated_at DESC
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
      at: iso(row.updated_at),
      stage: nextStageLabel(stage),
    };
  });
}

export async function listDirkFollowups(limit = 80): Promise<DirkFollowup[]> {
  const watched = await query<Record<string, unknown>>(
    `SELECT d.deal_number, d.title, d.stage, d.next_action, d.nda_url, d.cim_url,
            d.gmail_thread_ids, e.kind, e.due_at
       FROM next_followups e
       JOIN deals_next d ON d.id = e.deal_id
      WHERE e.status = 'open'
      ORDER BY e.armed_at DESC
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
      nextAction: sanitizeNextAction(row.next_action) ?? defaultNextAction(stage),
      gmailLinks: threadLinks(row),
      ndaUrl: row.nda_url == null ? null : String(row.nda_url),
      cimUrl: row.cim_url == null ? null : String(row.cim_url),
      driveFolderId: parseDriveFolderId(row.cim_url == null ? null : String(row.cim_url)),
      viewUrl: row.cim_url == null ? null : String(row.cim_url),
      simonReview: null,
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
      nextAction: sanitizeNextAction(row.next_action) ?? defaultNextAction(stage),
      gmailLinks: threadLinks(row),
      ndaUrl: row.nda_url == null ? null : String(row.nda_url),
      cimUrl: row.cim_url == null ? null : String(row.cim_url),
      driveFolderId: parseDriveFolderId(row.cim_url == null ? null : String(row.cim_url)),
      viewUrl: row.cim_url == null ? null : String(row.cim_url),
      simonReview: null,
      dueAt: null,
    });
  }

  await attachSimonReviews(out);
  return out.slice(0, limit);
}

async function attachSimonReviews(items: DirkFollowup[]): Promise<void> {
  const numbers = items.map((item) => item.dealNumber).filter((n): n is string => Boolean(n));
  if (numbers.length === 0) return;
  const placeholders = numbers.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await query<{ deal_number: string; body: string }>(
    `SELECT DISTINCT ON (d.deal_number) d.deal_number, n.body
       FROM notes_next n
       JOIN deals_next d ON d.id = n.deal_id
      WHERE n.member = 'simon'
        AND d.deal_number IN (${placeholders})
      ORDER BY d.deal_number, n.created_at DESC`,
    numbers,
  );
  const byNumber = new Map(rows.map((row) => [String(row.deal_number), String(row.body)]));
  for (const item of items) {
    if (item.dealNumber) item.simonReview = byNumber.get(item.dealNumber) ?? null;
  }
}

export async function listDirkClosed(limit = 40): Promise<DirkClosed[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT deal_number, title, cim_url, stage_changed_at, stage_changed_by
       FROM deals_next
      WHERE stage IN ('closed', 'dead', 'pass', 'passed')
      ORDER BY stage_changed_at DESC NULLS LAST, id DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((row) => {
    const pack = closedCimArchive({
      deal_number: row.deal_number == null ? null : String(row.deal_number),
      title: row.title == null ? null : String(row.title),
      cim_url: row.cim_url == null ? null : String(row.cim_url),
    });
    return {
      dealNumber: row.deal_number == null ? null : String(row.deal_number),
      title: String(row.title ?? ""),
      closedAt: row.stage_changed_at ? iso(row.stage_changed_at) : null,
      closedBy: row.stage_changed_by == null ? null : String(row.stage_changed_by),
      ...pack,
    };
  });
}

export async function listDirkCimFolders(limit = 40): Promise<DirkCimFolder[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT deal_number, title, cim_url
       FROM deals_next
      WHERE stage = 'cim'
      ORDER BY stage_changed_at DESC NULLS LAST, id DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((row) => {
    const dealNumber = row.deal_number == null ? null : String(row.deal_number);
    const title = String(row.title ?? "");
    const viewUrl = row.cim_url == null ? null : String(row.cim_url);
    return {
      dealNumber,
      title,
      folderTitle: cimFolderTitle(dealNumber ?? "", title),
      viewUrl,
      folderId: parseDriveFolderId(viewUrl),
      sendToSimon: viewUrl
        ? `Send Simon this viewUrl. He uploads the CIM PDF when the review is done.`
        : `Folder not created yet — POST /api/next/cim/resolve { dealNumber } after Drive is configured.`,
    };
  });
}

export async function buildDirkFeed(): Promise<DirkFeed> {
  const [inbound, verdicts, followups, cimFolders, closed] = await Promise.all([
    listDirkInbound(),
    listDirkVerdicts(),
    listDirkFollowups(),
    listDirkCimFolders(),
    listDirkClosed(),
  ]);
  return { inbound, verdicts, followups, cimFolders, closed };
}
