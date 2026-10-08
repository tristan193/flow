import { NextResponse, type NextRequest } from "next/server";

import { resolveMachineActor } from "@/lib/actors";
import { ensureReady } from "@/lib/boot";
import { listNextBoardDeals } from "@/lib/next/deals";
import { nextDealHeadline, nextDealSubline } from "@/lib/next/display";
import { byPinnedThenEarnings } from "@/lib/next/fit";
import { NEXT_BOARD_STAGES } from "@/lib/next/stages";

/**
 * The pipeline board, same rows and order as /next/pipeline.
 * Same bearer as GET /api/next/dirk.
 *
 *   GET /api/next/board
 *
 * Columns follow the board: Shortlisted, NDA, CIM, LOI, Pursuing, Closed.
 * Inside a column: pinned first, then earnings. Headline is the CIM name
 * when one is set. This is not the Dirk follow-up feed.
 */
export async function GET(request: NextRequest) {
  if (!resolveMachineActor(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  await ensureReady();
  const deals = await listNextBoardDeals();
  const columns = NEXT_BOARD_STAGES.map((stage) => ({
    id: stage.id,
    label: stage.label,
    deals: deals
      .filter((deal) => deal.stage === stage.id)
      .sort(byPinnedThenEarnings)
      .map((deal) => ({
        id: deal.id,
        n: deal.deal_number,
        headline: nextDealHeadline(deal),
        title: nextDealSubline(deal),
        city: deal.city,
        state: deal.state,
        earnings: deal.earnings,
        pinned: Boolean(deal.super_liked_at),
      })),
  }));

  return NextResponse.json({ ok: true, columns });
}
