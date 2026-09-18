import { NextResponse } from "next/server";

import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { getNextDeal, saveNextCimLink } from "@/lib/next/deals";

export const runtime = "nodejs";

/**
 * Attach a CIM pack URL to a Next deal (session members). URL-only: uploads
 * are retired — packs live at Drive / Canva / data-room links. Old stored
 * blobs remain readable at /api/next/cim-files/[id].
 */
export async function POST(request: Request) {
  await ensureReady();
  const member = await requireMember();

  const body = (await request.json().catch(() => null)) as {
    dealId?: number;
    url?: string;
  } | null;
  const dealId = Number(body?.dealId);
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!Number.isInteger(dealId) || dealId <= 0 || !url) {
    return NextResponse.json({ error: "Need dealId and url." }, { status: 400 });
  }
  const deal = await getNextDeal(dealId);
  if (!deal) return NextResponse.json({ error: "Deal not found." }, { status: 404 });
  await saveNextCimLink(dealId, member, url);
  return NextResponse.json({ ok: true, url });
}
