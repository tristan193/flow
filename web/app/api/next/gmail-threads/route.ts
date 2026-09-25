import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ensureReady } from "@/lib/boot";
import { applyAuthorizedGmailThreads } from "@/lib/next/gmail-threads-auth";

/**
 * Replace (or prepend / append) Gmail thread ids on an existing Next deal.
 * Import and merge only union threads, so a wrong digest cannot be removed there.
 *
 *   Authorization: Bearer FLOW_IMPORT_TOKEN
 *   POST /api/next/gmail-threads
 *   { "dealNumber": "TLY-096", "mode": "replace", "gmailThreadIds": ["1a086a480b0fbc7e"] }
 *
 * mode "replace" sets deals_next.gmail_thread_ids to that ordered array
 * (deduped; [] clears). "prepend" and "append" are optional.
 * Token only — a browser session is not enough. Does not write stage or source_deal_id.
 */

const schema = z.object({
  dealId: z.union([z.number(), z.string()]).optional(),
  deal_id: z.union([z.number(), z.string()]).optional(),
  dealNumber: z.string().optional(),
  deal_number: z.string().optional(),
  mode: z.string().optional(),
  gmailThreadIds: z.array(z.string()).optional(),
  gmail_thread_ids: z.array(z.string()).optional(),
});

export async function POST(request: NextRequest) {
  await ensureReady();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid gmail thread update." }, { status: 400 });
  }

  const result = await applyAuthorizedGmailThreads({
    authorization: request.headers.get("authorization"),
    dealId: parsed.data.dealId ?? parsed.data.deal_id,
    dealNumber: parsed.data.dealNumber ?? parsed.data.deal_number,
    mode: parsed.data.mode,
    gmailThreadIds: parsed.data.gmailThreadIds ?? parsed.data.gmail_thread_ids,
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
