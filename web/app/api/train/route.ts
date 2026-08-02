import { NextResponse } from "next/server";
import { z } from "zod";

import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { clearTrainFlag, getDeal, listTrainFlags, setTrainFlag } from "@/lib/deals";
import { isTrainReason } from "@/lib/model";
import { inspectTrainFlag } from "@/lib/repertoire-inspect";

const schema = z.object({
  dealId: z.number().int().positive(),
  // null clears the train flag without touching triage verdicts.
  reason: z.string().nullable(),
  detail: z.string().trim().max(500).nullable().optional(),
});

/**
 * Train AI → format repertoire feedback loop.
 *
 * Saving a flag inspects the deal against pipeline/formats/repertoire.yaml
 * (via repertoire.meta.json) and stores a checklist for gotcha / detect fixes.
 * GET returns the open queue for agents / learn.py train-queue.
 */
export async function POST(request: Request) {
  await ensureReady();
  const member = await requireMember();

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid train flag." }, { status: 400 });
  }

  const { dealId, reason, detail } = parsed.data;
  if (reason === null) {
    await clearTrainFlag(dealId, member);
    return NextResponse.json({ ok: true, cleared: true });
  }
  if (!isTrainReason(reason)) {
    return NextResponse.json({ error: "Invalid train flag." }, { status: 400 });
  }

  const deal = await getDeal(dealId);
  if (!deal) {
    return NextResponse.json({ error: "Deal not found." }, { status: 404 });
  }

  const inspection = inspectTrainFlag(deal, reason, detail ?? null);
  await setTrainFlag(dealId, member, reason, detail ?? null, {
    formatId: inspection.format_id,
    inspection,
  });

  return NextResponse.json({
    ok: true,
    format_id: inspection.format_id,
    inspection,
  });
}

export async function GET() {
  await ensureReady();
  await requireMember();
  const flags = await listTrainFlags();
  return NextResponse.json({
    repertoire_path: "pipeline/formats/repertoire.yaml",
    playbook_path: "docs/deal-format-repertoire.md",
    count: flags.length,
    flags,
  });
}
