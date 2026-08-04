import { NextResponse } from "next/server";
import { z } from "zod";

import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { clearVerdict, getDeal, setVerdict } from "@/lib/deals";
import { PASS_REASONS, isVerdictAction } from "@/lib/model";

const schema = z.object({
  dealId: z.number().int().positive(),
  // null clears the verdict, which is how a mis-tap gets undone.
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
    await clearVerdict(dealId, member);
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
        // Omitted note must not wipe an existing one (e.g. re-tapping ✓).
        const deal = await getDeal(dealId);
        verdictNote = deal?.verdicts[member]?.note ?? null;
      }
    }

    await setVerdict(dealId, member, action, passReason, verdictNote);
  }

  return NextResponse.json({ ok: true });
}
