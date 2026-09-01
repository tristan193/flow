import { NextResponse } from "next/server";
import { z } from "zod";

import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { moveNextStage } from "@/lib/next/deals";
import { isNextStageId } from "@/lib/next/model";

const schema = z.object({
  dealId: z.number().int().positive(),
  stage: z.string(),
});

export async function POST(request: Request) {
  await ensureReady();
  const member = await requireMember();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isNextStageId(parsed.data.stage)) {
    return NextResponse.json({ error: "Invalid stage." }, { status: 400 });
  }

  await moveNextStage(parsed.data.dealId, member, parsed.data.stage);
  return NextResponse.json({ ok: true });
}
