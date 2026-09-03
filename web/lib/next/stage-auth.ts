import { queryOne } from "../db";
import { importTokenValid } from "../import-auth";
import { addNextNote, getNextDeal, moveNextStage } from "./deals";
import { parseDealNumber } from "./identity";
import { canonicalizeNextStage, isMemberId, type NextStageId } from "./model";
import { NEXT_STAGE_ACTOR } from "./write-auth";

export { NEXT_STAGE_ACTOR };

export interface AuthorizedStageInput {
  authorization: string | null;
  sessionMember: string | null;
  dealId?: number | string | null;
  dealNumber?: string | null;
  stage: string;
  member?: string | null;
  note?: string | null;
  reason?: string | null;
}

export type AuthorizedStageResult =
  | {
      ok: true;
      dealId: number;
      dealNumber: string;
      stage: NextStageId;
      actor: string;
      viewUrl: string | null;
    }
  | { ok: false; error: string; status: number };

function asPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    return n > 0 ? n : null;
  }
  return null;
}

export async function findNextDealRef(input: {
  dealId?: number | string | null;
  dealNumber?: string | null;
}): Promise<{ id: number; dealNumber: string } | null> {
  const dealId = asPositiveInt(input.dealId);
  if (dealId != null) {
    const row = await queryOne<{ id: number; deal_number: string }>(
      "SELECT id, deal_number FROM deals_next WHERE id = $1",
      [dealId],
    );
    if (row) return { id: Number(row.id), dealNumber: String(row.deal_number) };
  }

  const number = input.dealNumber?.trim().toUpperCase() || null;
  if (!number || !parseDealNumber(number)) return null;
  const row = await queryOne<{ id: number; deal_number: string }>(
    "SELECT id, deal_number FROM deals_next WHERE deal_number = $1",
    [number],
  );
  if (!row) return null;
  return { id: Number(row.id), dealNumber: String(row.deal_number) };
}

function resolveActor(
  input: AuthorizedStageInput,
): { actor: string } | { error: string; status: number } {
  if (importTokenValid(input.authorization)) {
    const posted = input.member?.trim() || "";
    return { actor: isMemberId(posted) ? posted : NEXT_STAGE_ACTOR };
  }
  if (input.sessionMember) {
    return { actor: input.sessionMember };
  }
  return { error: "Unauthorized.", status: 401 };
}

function noteBody(input: AuthorizedStageInput): string | null {
  const reason = input.reason?.trim() || "";
  const note = input.note?.trim() || "";
  const body = [reason, note].filter(Boolean).join(" — ");
  return body || null;
}

/**
 * Token (FLOW_IMPORT_TOKEN) or member session can move a deals_next row.
 * Dirk is the operator: dealNumber + bearer, no browser cookie.
 */
export async function applyAuthorizedNextStage(
  input: AuthorizedStageInput,
): Promise<AuthorizedStageResult> {
  const who = resolveActor(input);
  if ("error" in who) return { ok: false, error: who.error, status: who.status };

  const stage = canonicalizeNextStage(input.stage);
  if (!stage) {
    return { ok: false, error: "Invalid stage.", status: 400 };
  }

  const ref = await findNextDealRef({ dealId: input.dealId, dealNumber: input.dealNumber });
  if (!ref) {
    return { ok: false, error: "Deal not found.", status: 404 };
  }

  await moveNextStage(ref.id, who.actor, stage);
  const extra = noteBody(input);
  if (extra) await addNextNote(ref.id, who.actor, extra);
  const deal = await getNextDeal(ref.id);
  return {
    ok: true,
    dealId: ref.id,
    dealNumber: ref.dealNumber,
    stage,
    actor: who.actor,
    viewUrl: deal?.cim_url ?? null,
  };
}
