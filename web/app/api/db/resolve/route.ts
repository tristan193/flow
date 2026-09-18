import { NextResponse } from "next/server";
import { z } from "zod";

import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { resolveDealLogReview } from "@/lib/next/change-log";
import { setNextVerdict } from "@/lib/next/deals";
import { isMemberId, isVerdictAction } from "@/lib/next/model";

const schema = z.object({
  id: z.number().int().positive(),
  resolution: z.enum(["confirmed", "dismissed"]),
});

/**
 * Resolve a needs_review deal_log row (session members only — the human half
 * of "agents propose, humans decide"). Confirming a verdict proposal applies
 * the vote for the member it was proposed on behalf of, attributed to them
 * with the confirming member recorded via the log entry this write creates.
 */
export async function POST(request: Request) {
  await ensureReady();
  const member = await requireMember();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid resolution." }, { status: 400 });
  }

  const row = await resolveDealLogReview(parsed.data.id, parsed.data.resolution, member);
  if (!row) {
    return NextResponse.json({ error: "Not found or already resolved." }, { status: 404 });
  }

  if (parsed.data.resolution === "confirmed" && row.kind === "verdict" && row.deal_id != null) {
    const proposed = row.patch.proposed_verdict?.new;
    const target = row.on_behalf_of;
    if (typeof proposed === "string" && isVerdictAction(proposed) && isMemberId(target)) {
      await setNextVerdict(row.deal_id, target, proposed, null, null);
    }
  }

  return NextResponse.json({ ok: true, status: row.status });
}
