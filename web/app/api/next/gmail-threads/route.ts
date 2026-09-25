import { NextResponse, type NextRequest } from "next/server";

import { ensureReady } from "@/lib/boot";
import { applyAuthorizedGmailThreads } from "@/lib/next/gmail-threads";

/**
 * Dirk replaces Gmail thread ids on an existing Next deal.
 *
 *   Authorization: Bearer FLOW_IMPORT_TOKEN
 *   POST /api/next/gmail-threads
 *   { "dealNumber": "TLY-096", "mode": "replace", "gmailThreadIds": ["1a086a480b0fbc7e"] }
 *
 * mode "replace" overwrites deals_next.gmail_thread_ids (deduped, order kept;
 * [] clears). "append" and "prepend" are optional. Token only — a browser
 * session is not enough. Does not change source_deal_id or import blank-fill.
 */

export async function POST(request: NextRequest) {
  await ensureReady();

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "Invalid gmail thread update." }, { status: 400 });
  }

  const body = payload as Record<string, unknown>;
  const dealNumber =
    typeof body.dealNumber === "string"
      ? body.dealNumber
      : typeof body.deal_number === "string"
        ? body.deal_number
        : null;
  const mode = typeof body.mode === "string" ? body.mode : null;
  const gmailThreadIds = Object.prototype.hasOwnProperty.call(body, "gmailThreadIds")
    ? body.gmailThreadIds
    : body.gmail_thread_ids;

  const result = await applyAuthorizedGmailThreads({
    authorization: request.headers.get("authorization"),
    dealNumber,
    mode,
    gmailThreadIds,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    ok: true,
    dealNumber: result.dealNumber,
    gmailThreadIds: result.gmailThreadIds,
  });
}
