import { NextResponse } from "next/server";
import { z } from "zod";

import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { isVerdictAction } from "@/lib/next/model";
import { clearNextCimVerdict, setNextCimVerdict } from "@/lib/next/deals";

const schema = z.object({
  dealId: z.number().int().positive(),
  action: z.string().nullable(),
  note: z.string().nullable().optional(),
});

/** Tristan/Jim CIM votes. Token/Simon cannot hit this — no determinations. */
export async function POST(request: Request) {
  await ensureReady();
  const member = await requireMember();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid CIM verdict." }, { status: 400 });
  }

  const { dealId, action, note } = parsed.data;
  if (action === null) {
    await clearNextCimVerdict(dealId, member);
  } else if (!isVerdictAction(action)) {
    return NextResponse.json({ error: "Invalid CIM verdict." }, { status: 400 });
  } else {
    const verdictNote =
      typeof note === "string" ? note.trim().slice(0, 500) || null : null;
    await setNextCimVerdict(dealId, member, action, verdictNote);
  }

  return NextResponse.json({ ok: true });
}
