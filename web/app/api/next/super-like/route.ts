import { NextResponse } from "next/server";
import { z } from "zod";

import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { getNextDeal, setNextSuperLike } from "@/lib/next/deals";

const schema = z.object({
  dealId: z.number().int().positive(),
  liked: z.boolean(),
});

/**
 * Super Like pins a deal to the top of its current stack.
 * Not a verdict — does not change stage or close the card.
 */
export async function POST(request: Request) {
  await ensureReady();
  await requireMember();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Super Like." }, { status: 400 });
  }

  const deal = await getNextDeal(parsed.data.dealId);
  if (!deal) {
    return NextResponse.json({ error: "Deal not found." }, { status: 404 });
  }

  const superLikedAt = await setNextSuperLike(parsed.data.dealId, parsed.data.liked);
  return NextResponse.json({ ok: true, superLikedAt });
}
