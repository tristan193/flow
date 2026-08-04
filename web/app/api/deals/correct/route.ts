import { NextResponse } from "next/server";
import { z } from "zod";

import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { clearTrainFlag, getDeal, updateDealListing } from "@/lib/deals";

const money = z.number().nonnegative().nullable().optional();

const schema = z.object({
  dealId: z.number().int().positive(),
  title: z.string().trim().min(3).max(200).optional(),
  blurb: z.string().trim().max(2000).nullable().optional(),
  revenue: money,
  ebitda: money,
  sde: money,
  asking: money,
  /** Clear the caller's Train AI flag after applying the correction. */
  clearTrain: z.boolean().optional(),
});

/**
 * Apply a Train-AI correction to listing fields (member session).
 * Used when the harvest snapshot still has the wrong money/title and a
 * full re-ingest isn't ready yet.
 */
export async function POST(request: Request) {
  await ensureReady();
  const member = await requireMember();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid correction." }, { status: 400 });
  }

  const { dealId, clearTrain, ...fields } = parsed.data;
  const existing = await getDeal(dealId);
  if (!existing) {
    return NextResponse.json({ error: "Deal not found." }, { status: 404 });
  }

  const patch: Parameters<typeof updateDealListing>[1] = {};
  if (fields.title !== undefined) patch.title = fields.title;
  if (fields.blurb !== undefined) patch.blurb = fields.blurb;
  if (fields.revenue !== undefined) patch.revenue = fields.revenue;
  if (fields.ebitda !== undefined) patch.ebitda = fields.ebitda;
  if (fields.sde !== undefined) patch.sde = fields.sde;
  if (fields.asking !== undefined) patch.asking = fields.asking;

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "No fields to update." }, { status: 400 });
  }

  const deal = await updateDealListing(dealId, patch);
  if (clearTrain) {
    await clearTrainFlag(dealId, member);
  }

  return NextResponse.json({
    ok: true,
    dealId,
    title: deal?.title,
    revenue: deal?.revenue,
    ebitda: deal?.ebitda,
    sde: deal?.sde,
    asking: deal?.asking,
  });
}
