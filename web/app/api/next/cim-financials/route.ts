import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ensureReady } from "@/lib/boot";
import { applyAuthorizedCimFinancials } from "@/lib/next/cim-financials-auth";

/**
 * Dirk stamps CIM pack numbers onto a Next deal by TLY.
 *
 *   Authorization: Bearer FLOW_IMPORT_TOKEN
 *   POST /api/next/cim-financials
 *   { "dealNumber": "TLY-092", "revenue": 4200000, "ebitda": 920000, "margin": 0.22, "asking": 6500000 }
 *
 * Token only — a browser session is not enough. Omits unspecified fields.
 * Never writes stage.
 */

const schema = z
  .object({
    dealId: z.union([z.number(), z.string()]).optional(),
    deal_id: z.union([z.number(), z.string()]).optional(),
    dealNumber: z.string().optional(),
    deal_number: z.string().optional(),
    revenue: z.unknown().optional(),
    ebitda: z.unknown().optional(),
    margin: z.unknown().optional(),
    asking: z.unknown().optional(),
    asking_price: z.unknown().optional(),
    price: z.unknown().optional(),
  })
  .refine((value) => value.dealId != null || value.deal_id != null || Boolean((value.dealNumber ?? value.deal_number)?.trim()), {
    message: "dealId or dealNumber required",
  });

export async function POST(request: NextRequest) {
  await ensureReady();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid CIM financials stamp." }, { status: 400 });
  }

  const result = await applyAuthorizedCimFinancials({
    authorization: request.headers.get("authorization"),
    dealId: parsed.data.dealId ?? parsed.data.deal_id,
    dealNumber: parsed.data.dealNumber ?? parsed.data.deal_number,
    revenue: parsed.data.revenue,
    ebitda: parsed.data.ebitda,
    margin: parsed.data.margin,
    asking: parsed.data.asking ?? parsed.data.asking_price ?? parsed.data.price,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    ok: true,
    dealId: result.dealId,
    dealNumber: result.dealNumber,
    revenue: result.revenue,
    ebitda: result.ebitda,
    margin: result.margin,
    asking: result.asking,
    stage: result.stage,
  });
}
