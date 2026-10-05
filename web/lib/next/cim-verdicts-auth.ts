import { resolveMachineActor } from "../actors";
import { queryOne } from "../db";
import { clearNextCimVerdict } from "./deals";
import { parseDealNumber } from "./identity";
import { findNextDealRef } from "./stage-auth";
import type { MemberId } from "./model";

export interface AuthorizedClearCimVerdictsInput {
  authorization: string | null;
  dealId?: number | string | null;
  dealNumber?: string | null;
  mode?: string | null;
}

export type ClearedCimVoter = "tristan" | "jim";

export type AuthorizedClearCimVerdictsResult =
  | {
      ok: true;
      dealId: number;
      dealNumber: string;
      stage: string;
      cleared: ClearedCimVoter[];
    }
  | { ok: false; error: string; status: number };

/** Member id → CIM column prefix. Jim's member id is partner. */
const CIM_VOTERS: Array<{ member: MemberId; column: ClearedCimVoter }> = [
  { member: "tristan", column: "tristan" },
  { member: "partner", column: "jim" },
];

/**
 * Token-only clear of both CIM Review votes.
 * Nulls tristan_cim_verdict/_note/_at and jim_cim_verdict/_note/_at.
 * Does not write stage. A later move to CIM will not Dual-Pursue
 * unless someone votes again.
 */
export async function applyAuthorizedClearCimVerdicts(
  input: AuthorizedClearCimVerdictsInput,
): Promise<AuthorizedClearCimVerdictsResult> {
  const actor = resolveMachineActor(input.authorization);
  if (!actor) {
    return { ok: false, error: "Unauthorized.", status: 401 };
  }

  const mode = String(input.mode || "").trim().toLowerCase();
  if (mode !== "clear") {
    return { ok: false, error: 'mode must be "clear".', status: 400 };
  }

  const number = input.dealNumber?.trim() || "";
  if (input.dealId == null && !number) {
    return { ok: false, error: "dealId or dealNumber is required.", status: 400 };
  }
  if (number && !parseDealNumber(number)) {
    return { ok: false, error: "dealNumber must look like TLY-168.", status: 400 };
  }

  const ref = await findNextDealRef({ dealId: input.dealId, dealNumber: number || null });
  if (!ref) {
    return { ok: false, error: "Deal not found.", status: 404 };
  }

  const before = await queryOne<{ stage: string }>(
    "SELECT stage FROM deals_next WHERE id = $1",
    [ref.id],
  );
  if (!before) {
    return { ok: false, error: "Deal not found.", status: 404 };
  }

  const cleared: ClearedCimVoter[] = [];
  for (const voter of CIM_VOTERS) {
    const did = await clearNextCimVerdict(ref.id, voter.member, {
      actor,
      channel: "api:next/cim-verdicts",
      reason: "Clear CIM verdicts",
    });
    if (did) cleared.push(voter.column);
  }

  const after = await queryOne<{ stage: string }>(
    "SELECT stage FROM deals_next WHERE id = $1",
    [ref.id],
  );

  return {
    ok: true,
    dealId: ref.id,
    dealNumber: ref.dealNumber,
    stage: String(after?.stage ?? before.stage),
    cleared,
  };
}
