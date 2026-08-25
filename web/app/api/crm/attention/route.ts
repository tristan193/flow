import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import {
  confirmCrmReview,
  dismissCrmReview,
  listCrmAttention,
} from "@/lib/crm-pursuit";

export const runtime = "nodejs";

/** Open expectations + unmatched / needs_review pursuit mail. */
export async function GET() {
  await ensureReady();
  await requireMember();
  const data = await listCrmAttention();
  return NextResponse.json(data);
}

const resolveSchema = z.object({
  eventId: z.number().int().positive(),
  action: z.enum(["confirm", "dismiss"]),
  dealId: z.number().int().positive().optional(),
});

/** Confirm a proposed match or dismiss noise. */
export async function POST(request: NextRequest) {
  await ensureReady();
  await requireMember();

  const parsed = resolveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid attention resolve." }, { status: 400 });
  }

  const { eventId, action, dealId } = parsed.data;
  if (action === "dismiss") {
    await dismissCrmReview(eventId);
    return NextResponse.json({ ok: true });
  }

  if (!dealId) {
    return NextResponse.json({ error: "dealId required to confirm." }, { status: 400 });
  }

  const result = await confirmCrmReview(eventId, dealId);
  if (!result.ok) {
    return NextResponse.json({ error: result.detail }, { status: 400 });
  }
  return NextResponse.json({ ok: true, detail: result.detail });
}
