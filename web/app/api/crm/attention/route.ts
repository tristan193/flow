import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import {
  confirmCrmReview,
  dismissCrmReview,
  listCrmAttention,
} from "@/lib/crm-pursuit";
import { cancelExpectation } from "@/lib/expectations";

export const runtime = "nodejs";

/** Open expectations + unmatched / needs_review pursuit mail. */
export async function GET() {
  await ensureReady();
  await requireMember();
  const data = await listCrmAttention();
  return NextResponse.json(data);
}

const resolveSchema = z
  .object({
    action: z.enum(["confirm", "dismiss"]),
    eventId: z.number().int().positive().optional(),
    expectationId: z.number().int().positive().optional(),
    dealId: z.number().int().positive().optional(),
  })
  .refine((v) => v.eventId != null || v.expectationId != null, {
    message: "eventId or expectationId required",
  });

/** Confirm a proposed match, or dismiss a review / inbox watch. */
export async function POST(request: NextRequest) {
  await ensureReady();
  await requireMember();

  const parsed = resolveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid attention resolve." }, { status: 400 });
  }

  const { eventId, expectationId, action, dealId } = parsed.data;

  if (action === "dismiss") {
    if (expectationId != null) {
      const ok = await cancelExpectation(expectationId);
      if (!ok) {
        return NextResponse.json({ error: "Watch not found or already closed." }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    }
    await dismissCrmReview(eventId!);
    return NextResponse.json({ ok: true });
  }

  if (eventId == null) {
    return NextResponse.json({ error: "eventId required to confirm." }, { status: 400 });
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
