import { NextResponse } from "next/server";
import { z } from "zod";

import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { moveNextStage } from "@/lib/next/deals";
import { mapNextStage } from "@/lib/next/model";

const schema = z.object({
  dealId: z.number().int().positive(),
  stage: z.string(),
});

export async function POST(request: Request) {
  await ensureReady();
  const member = await requireMember();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  const stage = parsed.success ? mapNextStage(parsed.data.stage) : null;
  if (!parsed.success || !stage) {
    return NextResponse.json({ error: "Invalid stage." }, { status: 400 });
  }

  await moveNextStage(parsed.data.dealId, member, stage);
  return NextResponse.json({ ok: true });
}
