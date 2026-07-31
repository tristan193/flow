import { NextResponse } from "next/server";
import { z } from "zod";

import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { clearTrainFlag, setTrainFlag } from "@/lib/deals";
import { isTrainReason } from "@/lib/model";

const schema = z.object({
  dealId: z.number().int().positive(),
  // null clears the train flag without touching triage verdicts.
  reason: z.string().nullable(),
  detail: z.string().trim().max(500).nullable().optional(),
});

export async function POST(request: Request) {
  await ensureReady();
  const member = await requireMember();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid train flag." }, { status: 400 });
  }

  const { dealId, reason, detail } = parsed.data;
  if (reason === null) {
    await clearTrainFlag(dealId, member);
  } else if (!isTrainReason(reason)) {
    return NextResponse.json({ error: "Invalid train flag." }, { status: 400 });
  } else {
    await setTrainFlag(dealId, member, reason, detail ?? null);
  }

  return NextResponse.json({ ok: true });
}
