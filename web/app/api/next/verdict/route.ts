import { NextResponse } from "next/server";
import { z } from "zod";

import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { PASS_REASONS, isVerdictAction } from "@/lib/next/model";
import { clearNextVerdict, getNextDeal, setNextVerdict } from "@/lib/next/deals";

const schema = z.object({
  dealId: z.number().int().positive(),
  action: z.string().nullable(),
  reason: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

export async function POST(request: Request) {
  await ensureReady();
  const member = await requireMember();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid verdict." }, { status: 400 });
  }

  const { dealId, action, reason, note } = parsed.data;
  if (action === null) {
    await clearNextVerdict(dealId, member);
  } else if (!isVerdictAction(action)) {
    return NextResponse.json({ error: "Invalid verdict." }, { status: 400 });
  } else {
    const passReason =
      action === "pass" && reason && (PASS_REASONS as readonly string[]).includes(reason)
        ? reason
        : null;

    let verdictNote: string | null = null;
    if (action === "short" || action === "discuss") {
      if (note !== undefined) {
        verdictNote = typeof note === "string" ? note.trim().slice(0, 500) || null : null;
      } else {
        const deal = await getNextDeal(dealId);
        verdictNote = deal?.verdicts[member]?.note ?? null;
      }
    }

    await setNextVerdict(dealId, member, action, passReason, verdictNote);
  }

  return NextResponse.json({ ok: true });
}
