import { canonicalDriveFileUrl, isDriveFileUrl, parseCimDealId } from "./cim-pack-id";
import { queryOne } from "./db";

export type CimOpenResult =
  | { status: "invalid" }
  | { status: "missing"; dealNumber: string }
  | { status: "found"; dealNumber: string; viewUrl: string };

/**
 * `/cim/TLY-XXX` happy path: look up the deal and return the stamped Drive
 * file URL. Never talks to Google. DB errors become "not in yet", never 500.
 */
export async function resolveStoredCim(rawId: string): Promise<CimOpenResult> {
  const dealNumber = parseCimDealId(rawId);
  if (!dealNumber) return { status: "invalid" };

  try {
    const row = await queryOne<{ deal_number: string; cim_url: string | null }>(
      "SELECT deal_number, cim_url FROM deals_next WHERE deal_number = $1",
      [dealNumber],
    );
    const stored = row?.cim_url?.trim() || "";
    if (isDriveFileUrl(stored)) {
      return {
        status: "found",
        dealNumber,
        viewUrl: canonicalDriveFileUrl(stored) ?? stored,
      };
    }
    return { status: "missing", dealNumber };
  } catch {
    return { status: "missing", dealNumber };
  }
}
