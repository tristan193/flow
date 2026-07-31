import { NextResponse } from "next/server";
import { z } from "zod";

import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { addNote } from "@/lib/deals";

const schema = z.object({
  dealId: z.number().int().positive(),
  body: z.string().trim().min(1).max(4000),
});

export async function POST(request: Request) {
  await ensureReady();
  const member = await requireMember();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A note needs some text." }, { status: 400 });
  }

  await addNote(parsed.data.dealId, member, parsed.data.body);
  return NextResponse.json({ ok: true });
}
