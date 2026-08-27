/**
 * Deal expectations: Act/debrief arms a watch; inbox pursuit fulfills it.
 * Shortlist alone does not create an expectation.
 */

import { query, queryOne } from "./db";
import type { MemberId, OutreachOutcomeId } from "./model";

export type ExpectationKind = "nda" | "cim" | "broker_reply";
export type ExpectationStatus = "open" | "fulfilled" | "cancelled" | "expired";

export interface DealExpectation {
  id: number;
  deal_id: number;
  kind: ExpectationKind;
  status: ExpectationStatus;
  armed_by: string;
  armed_at: string;
  due_at: string | null;
  fulfilled_at: string | null;
  note: string | null;
  title?: string;
  nickname?: string | null;
  stage?: string;
  gmail_thread_url?: string | null;
  nda_url?: string | null;
}

const DEFAULT_DUE_DAYS = 14;

/** Map debrief chips → expectations to arm (and which prior kinds to close). */
export function expectationPlanFromOutcomes(outcomes: OutreachOutcomeId[]): {
  arm: ExpectationKind[];
  fulfill: ExpectationKind[];
  cancelAll: boolean;
} {
  if (outcomes.includes("not_pursuing") || outcomes.includes("unavailable")) {
    return { arm: [], fulfill: [], cancelAll: true };
  }

  const fulfill: ExpectationKind[] = [];
  const arm: ExpectationKind[] = [];

  if (outcomes.includes("cim_received")) {
    fulfill.push("cim", "broker_reply", "nda");
  } else if (outcomes.includes("nda_signed")) {
    fulfill.push("nda", "broker_reply");
    arm.push("cim");
  } else if (outcomes.includes("messaged") || outcomes.includes("waiting")) {
    // Acted: expect broker reply and/or NDA path from inbox.
    arm.push("broker_reply", "nda");
  }

  return { arm: [...new Set(arm)], fulfill: [...new Set(fulfill)], cancelAll: false };
}

export async function cancelOpenExpectations(dealId: number): Promise<void> {
  await query(
    `UPDATE deal_expectations
        SET status = 'cancelled', fulfilled_at = coalesce(fulfilled_at, now())
      WHERE deal_id = $1 AND status = 'open'`,
    [dealId],
  );
}

/** Dismiss one open watch from the Inbox watches panel. */
export async function cancelExpectation(id: number): Promise<boolean> {
  const rows = await query<{ id: number }>(
    `UPDATE deal_expectations
        SET status = 'cancelled', fulfilled_at = coalesce(fulfilled_at, now())
      WHERE id = $1 AND status = 'open'
      RETURNING id`,
    [id],
  );
  return rows.length > 0;
}

export async function fulfillExpectations(
  dealId: number,
  kinds: ExpectationKind[],
  crmEventId: number | null = null,
): Promise<number> {
  if (kinds.length === 0) return 0;
  const rows = await query<{ id: number }>(
    `UPDATE deal_expectations
        SET status = 'fulfilled',
            fulfilled_at = now(),
            crm_event_id = coalesce($3, crm_event_id)
      WHERE deal_id = $1
        AND status = 'open'
        AND kind = ANY($2::text[])
      RETURNING id`,
    [dealId, kinds, crmEventId],
  );
  return rows.length;
}

export async function armExpectations(
  dealId: number,
  member: MemberId,
  kinds: ExpectationKind[],
  note: string | null = null,
  dueDays: number = DEFAULT_DUE_DAYS,
): Promise<void> {
  for (const kind of kinds) {
    const existing = await queryOne<{ id: number }>(
      `SELECT id FROM deal_expectations
        WHERE deal_id = $1 AND kind = $2 AND status = 'open'
        LIMIT 1`,
      [dealId, kind],
    );
    if (existing) continue;
    await query(
      `INSERT INTO deal_expectations (deal_id, kind, status, armed_by, due_at, note)
       VALUES ($1, $2, 'open', $3, now() + ($4 || ' days')::interval, $5)`,
      [dealId, kind, member, String(dueDays), note],
    );
  }
}

/** Apply outreach outcomes: fulfill / cancel / arm watches. */
export async function syncExpectationsFromOutreach(
  dealId: number,
  member: MemberId,
  outcomes: OutreachOutcomeId[],
  note: string | null = null,
): Promise<void> {
  const plan = expectationPlanFromOutcomes(outcomes);
  if (plan.cancelAll) {
    await cancelOpenExpectations(dealId);
    return;
  }
  if (plan.fulfill.length) {
    await fulfillExpectations(dealId, plan.fulfill, null);
  }
  if (plan.arm.length) {
    await armExpectations(dealId, member, plan.arm, note);
  }
}

export async function listOpenExpectations(): Promise<DealExpectation[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT e.id, e.deal_id, e.kind, e.status, e.armed_by, e.armed_at, e.due_at,
            e.fulfilled_at, e.note, d.title, d.nickname, d.stage,
            d.gmail_thread_url, d.nda_url
       FROM deal_expectations e
       JOIN deals d ON d.id = e.deal_id
      WHERE e.status = 'open'
      ORDER BY e.due_at NULLS LAST, e.armed_at ASC
      LIMIT 100`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    deal_id: Number(r.deal_id),
    kind: r.kind as ExpectationKind,
    status: r.status as ExpectationStatus,
    armed_by: String(r.armed_by),
    armed_at: String(r.armed_at),
    due_at: r.due_at == null ? null : String(r.due_at),
    fulfilled_at: r.fulfilled_at == null ? null : String(r.fulfilled_at),
    note: r.note == null ? null : String(r.note),
    title: String(r.title),
    nickname: r.nickname == null ? null : String(r.nickname),
    stage: String(r.stage),
    gmail_thread_url: r.gmail_thread_url == null ? null : String(r.gmail_thread_url),
    nda_url: r.nda_url == null ? null : String(r.nda_url),
  }));
}

export async function listArmedDealIds(): Promise<Set<number>> {
  const rows = await query<{ deal_id: number }>(
    `SELECT DISTINCT deal_id FROM deal_expectations WHERE status = 'open'`,
  );
  return new Set(rows.map((r) => Number(r.deal_id)));
}

/** Map CRM event type → expectation kinds it fulfills. */
export function expectationKindsForEvent(
  eventType: string,
): ExpectationKind[] {
  switch (eventType) {
    case "nda_available":
    case "nda_signed":
      return ["nda", "broker_reply"];
    case "cim_received":
      return ["cim", "broker_reply", "nda"];
    case "vdr_access":
    case "broker_message":
      return ["broker_reply"];
    default:
      return ["broker_reply"];
  }
}
