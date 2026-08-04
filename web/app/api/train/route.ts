import { NextResponse } from "next/server";
import { z } from "zod";

import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { clearTrainFlag, getDeal, listTrainFlags, setTrainFlag } from "@/lib/deals";
import {
  isTrainCriteriaIntent,
  isTrainListingReason,
  isTrainTheme,
  TRAIN_CRITERIA_REASON_BY_INTENT,
  type TrainCriteriaIntent,
  type TrainListingReason,
  type TrainTheme,
} from "@/lib/model";
import { inspectTrainFlag } from "@/lib/repertoire-inspect";

const schema = z.object({
  dealId: z.number().int().positive(),
  // null clears the train flag without touching triage verdicts.
  reason: z.string().nullable(),
  theme: z.string().optional(),
  criteriaIntent: z.string().nullable().optional(),
  detail: z.string().trim().max(500).nullable().optional(),
});

/**
 * Train AI → listing (repertoire) or criteria (buy-box queue) feedback.
 *
 * Listing saves run repertoire inspection. Criteria never auto-edits the buy
 * box — agents act only on strong trends / careful exclude misses.
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

  const theme: TrainTheme = isTrainTheme(parsed.data.theme) ? parsed.data.theme : "listing";
  const rawIntent = parsed.data.criteriaIntent;
  const criteriaIntent: TrainCriteriaIntent | null = isTrainCriteriaIntent(rawIntent)
    ? rawIntent
    : null;

  const deal = await getDeal(dealId);
  if (!deal) {
    return NextResponse.json({ error: "Deal not found." }, { status: 404 });
  }

  if (theme === "listing") {
    if (!isTrainListingReason(reason)) {
      return NextResponse.json({ error: "Invalid listing reason." }, { status: 400 });
    }
    const listingReason = reason as TrainListingReason;
    const inspection = inspectTrainFlag(deal, listingReason, detail ?? null);
    await setTrainFlag(dealId, member, listingReason, detail ?? null, {
      theme: "listing",
      criteriaIntent: null,
      formatId: inspection.format_id,
      inspection,
    });
    return NextResponse.json({
      ok: true,
      theme: "listing",
      format_id: inspection.format_id,
      inspection,
    });
  }

  // Criteria
  if (!criteriaIntent) {
    return NextResponse.json({ error: "Pick a criteria option." }, { status: 400 });
  }
  const criteriaReason = TRAIN_CRITERIA_REASON_BY_INTENT[criteriaIntent];
  if (reason !== criteriaReason) {
    return NextResponse.json({ error: "Invalid criteria reason." }, { status: 400 });
  }
  const note = detail?.trim() || null;
  if (criteriaIntent === "criteria_change" && !note) {
    return NextResponse.json(
      { error: "Describe the criteria change — hard rules already have exceptions." },
      { status: 400 },
    );
  }

  await setTrainFlag(dealId, member, criteriaReason, note, {
    theme: "criteria",
    criteriaIntent,
    formatId: null,
    inspection: null,
  });

  return NextResponse.json({
    ok: true,
    theme: "criteria",
    criteria_intent: criteriaIntent,
  });
}

export async function GET() {
  await ensureReady();
  await requireMember();
  const flags = await listTrainFlags();
  const listing = flags.filter((f) => f.theme === "listing");
  const criteria = flags.filter((f) => f.theme === "criteria");
  const exclusionMiss = criteria.filter((f) => f.criteria_intent === "exclusion_miss");
  const criteriaChange = criteria.filter((f) => f.criteria_intent === "criteria_change");
  return NextResponse.json({
    repertoire_path: "pipeline/formats/repertoire.yaml",
    playbook_path: "docs/deal-format-repertoire.md",
    buybox_path: "pipeline/buybox.yaml",
    fit_path: "web/lib/fit.ts",
    count: flags.length,
    by_theme: {
      listing: listing.length,
      criteria: criteria.length,
    },
    by_intent: {
      exclusion_miss: exclusionMiss.length,
      criteria_change: criteriaChange.length,
    },
    flags,
  });
}
