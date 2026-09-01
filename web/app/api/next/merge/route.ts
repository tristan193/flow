import { NextResponse, type NextRequest } from "next/server";

import { ensureReady } from "@/lib/boot";
import { importTokenValid } from "@/lib/import-auth";
import { collapseNextDuplicates } from "@/lib/next/merge";

/**
 * Token-authenticated collapse of duplicate deals_next rows that share a
 * source_deal_id or Axial hex nickname. No member session.
 *
 *   { "confirm": "MERGE" }
 *   { "confirm": "MERGE", "dryRun": true }
 *   { "confirm": "MERGE", "deleteDealNumbers": ["TLY-023", "..."] }
 */
export async function POST(request: NextRequest) {
  if (!importTokenValid(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  await ensureReady();

  const payload = await request.json().catch(() => null);
  const confirm = String(payload?.confirm || "").toUpperCase();
  if (confirm !== "MERGE") {
    return NextResponse.json(
      { error: 'Send JSON { "confirm": "MERGE" } (optional dryRun, keepDealNumbers, deleteDealNumbers).' },
      { status: 400 },
    );
  }

  const result = await collapseNextDuplicates({
    keepDealNumbers: payload.keepDealNumbers,
    deleteDealNumbers: payload.deleteDealNumbers,
    pairs: payload.pairs,
    dryRun: Boolean(payload.dryRun),
  });
  return NextResponse.json({ ok: true, ...result });
}
