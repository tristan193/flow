import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { currentMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { importTokenValid } from "@/lib/import-auth";
import { applyAuthorizedNextStage } from "@/lib/next/stage-auth";

/**
 * Move a Next deal on the board. Dirk is the operator.
 *
 *   Authorization: Bearer FLOW_IMPORT_TOKEN
 *   { "dealNumber": "TLY-002", "stage": "closed" }
 *   { "dealId": 12, "stage": "cim", "note": "optional" }
 *
 * Member-session UI still works with the same body + cookie (no token).
 * Does not write to the live `deals` table.
 */

const schema = z
  .object({
    dealId: z.union([z.number(), z.string()]).optional(),
    dealNumber: z.string().optional(),
    stage: z.string(),
    member: z.string().optional(),
    note: z.string().optional(),
    reason: z.string().optional(),
  })
  .refine((value) => value.dealId != null || Boolean(value.dealNumber?.trim()), {
    message: "dealId or dealNumber required",
  });

export async function POST(request: NextRequest) {
  await ensureReady();

  const sessionMember = await currentMember();
  if (!importTokenValid(request.headers.get("authorization")) && !sessionMember) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid stage." }, { status: 400 });
  }

  const result = await applyAuthorizedNextStage({
    authorization: request.headers.get("authorization"),
    sessionMember,
    dealId: parsed.data.dealId,
    dealNumber: parsed.data.dealNumber,
    stage: parsed.data.stage,
    member: parsed.data.member,
    note: parsed.data.note,
    reason: parsed.data.reason,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    ok: true,
    dealId: result.dealId,
    dealNumber: result.dealNumber,
    stage: result.stage,
  });
}
