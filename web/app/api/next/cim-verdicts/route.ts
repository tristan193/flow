import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ensureReady } from "@/lib/boot";
import { applyAuthorizedClearCimVerdicts } from "@/lib/next/cim-verdicts-auth";

/**
 * Clear both CIM Review votes on an existing Next deal. Dirk is the operator.
 *
 *   Authorization: Bearer FLOW_IMPORT_TOKEN
 *   POST /api/next/cim-verdicts
 *   { "dealNumber": "TLY-168", "mode": "clear" }
 *
 * Nulls tristan_cim_verdict/_note/_at and jim_cim_verdict/_note/_at.
 * Does not write stage. Token only — a browser session is not enough.
 * Casting a vote stays on session-gated POST /api/next/cim/verdict.
 */

const schema = z.object({
  dealId: z.union([z.number(), z.string()]).optional(),
  deal_id: z.union([z.number(), z.string()]).optional(),
  dealNumber: z.string().optional(),
  deal_number: z.string().optional(),
  mode: z.string().optional(),
});

export async function POST(request: NextRequest) {
  await ensureReady();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid CIM verdict clear." }, { status: 400 });
  }

  const result = await applyAuthorizedClearCimVerdicts({
    authorization: request.headers.get("authorization"),
    dealId: parsed.data.dealId ?? parsed.data.deal_id,
    dealNumber: parsed.data.dealNumber ?? parsed.data.deal_number,
    mode: parsed.data.mode,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    ok: true,
    dealId: result.dealId,
    dealNumber: result.dealNumber,
    stage: result.stage,
    cleared: result.cleared,
  });
}
