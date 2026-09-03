import { canonicalDriveFileUrl, isDriveFolderUrl } from "../cim-pack-id";
import { query, queryOne } from "../db";
import { importTokenValid } from "../import-auth";
import { moveNextStage } from "./deals";
import {
  coerceNextStage,
  nextActionAfterCimPack,
  shouldAdvanceToCimOnPack,
  type NextStageId,
} from "./model";
import { findNextDealRef, NEXT_STAGE_ACTOR } from "./stage-auth";

export interface AuthorizedCimUrlInput {
  authorization: string | null;
  dealId?: number | string | null;
  dealNumber?: string | null;
  cimUrl?: string | null;
}

export type AuthorizedCimUrlResult =
  | { ok: true; dealId: number; dealNumber: string; cimUrl: string; stage: NextStageId }
  | { ok: false; error: string; status: number };

/**
 * Token-only write of a Drive *file* URL onto deals_next.cim_url.
 * Browser session is not enough — Dirk uses FLOW_IMPORT_TOKEN.
 *
 * A non-null pack URL advances a live deal to stage CIM (stage_changed_at/by,
 * CIM follow-up). Closed stays closed. Pursuing stays past CIM. cim_url is
 * never cleared by this path.
 */
export async function applyAuthorizedCimUrl(
  input: AuthorizedCimUrlInput,
): Promise<AuthorizedCimUrlResult> {
  if (!importTokenValid(input.authorization)) {
    return { ok: false, error: "Unauthorized.", status: 401 };
  }

  const canonical = canonicalDriveFileUrl(input.cimUrl);
  if (!canonical || isDriveFolderUrl(input.cimUrl)) {
    return { ok: false, error: "cimUrl must be a Google Drive file URL.", status: 400 };
  }

  const ref = await findNextDealRef({ dealId: input.dealId, dealNumber: input.dealNumber });
  if (!ref) {
    return { ok: false, error: "Deal not found.", status: 404 };
  }

  const before = await queryOne<{ stage: string; next_action: string | null }>(
    "SELECT stage, next_action FROM deals_next WHERE id = $1",
    [ref.id],
  );
  if (!before) {
    return { ok: false, error: "Deal not found.", status: 404 };
  }

  await query(`UPDATE deals_next SET cim_url = $1, updated_at = now() WHERE id = $2`, [
    canonical,
    ref.id,
  ]);

  const from = coerceNextStage(before.stage);
  if (shouldAdvanceToCimOnPack(from)) {
    await moveNextStage(ref.id, NEXT_STAGE_ACTOR, "cim");
  }

  const after = await queryOne<{ stage: string; next_action: string | null }>(
    "SELECT stage, next_action FROM deals_next WHERE id = $1",
    [ref.id],
  );
  const stage = coerceNextStage(after?.stage ?? before.stage);
  const written = nextActionAfterCimPack(stage, after?.next_action ?? before.next_action);
  if ((after?.next_action ?? null) !== written) {
    await query(`UPDATE deals_next SET next_action = $1, updated_at = now() WHERE id = $2`, [
      written,
      ref.id,
    ]);
  }

  return { ok: true, dealId: ref.id, dealNumber: ref.dealNumber, cimUrl: canonical, stage };
}
