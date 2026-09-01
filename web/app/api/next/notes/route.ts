import { NextResponse } from "next/server";
import { z } from "zod";

import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { addNextNote } from "@/lib/next/deals";

const schema = z.object({
  dealId: z.number().int().positive(),
  body: z.string().trim().min(1).max(4000),
});

export async function POST(request: Request) {
  await ensureReady();
  const member = await requireMember();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid note." }, { status: 400 });
  }

  await addNextNote(parsed.data.dealId, member, parsed.data.body);
  return NextResponse.json({ ok: true });
}
