import { canonicalDriveFileUrl, isDriveFolderUrl } from "../cim-pack-id";
import { query } from "../db";
import { importTokenValid } from "../import-auth";
import { findNextDealRef } from "./stage-auth";

export interface AuthorizedCimUrlInput {
  authorization: string | null;
  dealId?: number | string | null;
  dealNumber?: string | null;
  cimUrl?: string | null;
}

export type AuthorizedCimUrlResult =
  | { ok: true; dealId: number; dealNumber: string; cimUrl: string }
  | { ok: false; error: string; status: number };

/**
 * Token-only write of a Drive *file* URL onto deals_next.cim_url.
 * Browser session is not enough — Dirk uses FLOW_IMPORT_TOKEN.
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

  await query(`UPDATE deals_next SET cim_url = $1, updated_at = now() WHERE id = $2`, [
    canonical,
    ref.id,
  ]);

  return { ok: true, dealId: ref.id, dealNumber: ref.dealNumber, cimUrl: canonical };
}
