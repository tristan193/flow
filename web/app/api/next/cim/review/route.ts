import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { currentMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { applyAuthorizedCimReview } from "@/lib/next/cim-review";

/**
 * Dirk/Simon write: Drive CIM folder + Simon's written review.
 * Same bearer as POST /api/next/stage (FLOW_IMPORT_TOKEN).
 *
 *   { "dealNumber": "TLY-007", "url": "https://drive.google.com/drive/folders/...",
 *     "review": "Solid margin, customer concentration is the flag." }
 *
 * Review is attributed to Simon. Never a Pursue/Pass/Hold verdict.
 */

const schema = z
  .object({
    dealId: z.union([z.number(), z.string()]).optional(),
    dealNumber: z.string().optional(),
    url: z.string().optional(),
    review: z.string().optional(),
    body: z.string().optional(),
    actor: z.string().optional(),
  })
  .refine((value) => value.dealId != null || Boolean(value.dealNumber?.trim()), {
    message: "dealId or dealNumber required",
  });

export async function POST(request: NextRequest) {
  await ensureReady();
  const sessionMember = await currentMember();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Need dealId or dealNumber." }, { status: 400 });
  }

  const result = await applyAuthorizedCimReview({
    authorization: request.headers.get("authorization"),
    sessionMember,
    dealId: parsed.data.dealId,
    dealNumber: parsed.data.dealNumber,
    url: parsed.data.url,
    review: parsed.data.review,
    body: parsed.data.body,
    actor: parsed.data.actor,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    ok: true,
    dealId: result.dealId,
    dealNumber: result.dealNumber,
    cimUrl: result.cimUrl,
    review: result.review,
    actor: result.actor,
  });
}
