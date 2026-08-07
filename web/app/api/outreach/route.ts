import { NextResponse } from "next/server";
import { z } from "zod";

import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { recordOutreach } from "@/lib/deals";
import { isOutreachOutcomeId } from "@/lib/model";

const schema = z.object({
  dealId: z.number().int().positive(),
  outcomes: z.array(z.string()).min(1),
  note: z.string().nullable().optional(),
  cimUrl: z.string().nullable().optional(),
});

export async function POST(request: Request) {
  await ensureReady();
  const member = await requireMember();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid outreach debrief." }, { status: 400 });
  }

  const outcomes = parsed.data.outcomes.filter(isOutreachOutcomeId);
  if (outcomes.length === 0) {
    return NextResponse.json({ error: "Pick at least one outcome." }, { status: 400 });
  }

  await recordOutreach(
    parsed.data.dealId,
    member,
    outcomes,
    parsed.data.note ?? null,
    parsed.data.cimUrl ?? null,
  );

  return NextResponse.json({ ok: true });
}
