import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ensureReady } from "@/lib/boot";
import { applyAuthorizedCimUrl } from "@/lib/next/cim-url-auth";

/**
 * Dirk stamps a Drive file URL onto a Next deal.
 *
 *   Authorization: Bearer FLOW_IMPORT_TOKEN
 *   { "dealNumber": "TLY-092", "cimUrl": "https://drive.google.com/file/d/FILE_ID/view" }
 *
 * Token only — a browser session is not enough. Does not call Google.
 * Sets stage CIM on a live deal (closed stays closed; pursuing stays past CIM).
 */

const schema = z
  .object({
    dealId: z.union([z.number(), z.string()]).optional(),
    dealNumber: z.string().optional(),
    deal_number: z.string().optional(),
    cimUrl: z.string().optional(),
    cim_url: z.string().optional(),
  })
  .refine((value) => value.dealId != null || Boolean((value.dealNumber ?? value.deal_number)?.trim()), {
    message: "dealId or dealNumber required",
  });

export async function POST(request: NextRequest) {
  await ensureReady();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid CIM URL stamp." }, { status: 400 });
  }

  const result = await applyAuthorizedCimUrl({
    authorization: request.headers.get("authorization"),
    dealId: parsed.data.dealId,
    dealNumber: parsed.data.dealNumber ?? parsed.data.deal_number,
    cimUrl: parsed.data.cimUrl ?? parsed.data.cim_url,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    ok: true,
    dealId: result.dealId,
    dealNumber: result.dealNumber,
    cimUrl: result.cimUrl,
    stage: result.stage,
  });
}
