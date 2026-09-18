import { NextResponse, type NextRequest } from "next/server";

import { ensureReady } from "@/lib/boot";
import {
  applyAuthorizedCimIntake,
  applyAuthorizedCimIntakeBatch,
  extractCimIntakeItems,
  publicCimIntakeResult,
} from "@/lib/next/cim-intake";

/**
 * Simon stamps https pack URL(s) onto existing TLY rows and moves them to CIM.
 * One card or many. No Google on Vercel.
 *
 *   Authorization: Bearer FLOW_IMPORT_TOKEN
 *   POST /api/next/cim-intake
 *
 * Single:
 *   { "cimUrl": "https://drive.google.com/file/d/FILE_ID/view", "dealNumber": "TLY-092", "city": "Austin", "state": "TX" }
 *
 * Batch:
 *   { "cims": [
 *       { "cimUrl": "https://...", "dealNumber": "TLY-092" },
 *       { "link": "https://...", "dealUrl": "https://web-tau-seven-77.vercel.app/next/deals/TLY-014" }
 *     ] }
 *
 * Identity is dealNumber / dealUrl / TLY filename — not title.
 * fileName still works (TLY-XXX Headline.pdf). Optional: revenue, ebitda,
 * margin, asking, cimName, city, state, country, location.
 * Token only — a browser session is not enough.
 */

export async function POST(request: NextRequest) {
  await ensureReady();

  const raw = await request.json().catch(() => null);
  const extracted = extractCimIntakeItems(raw);
  if (!extracted.ok) {
    return NextResponse.json({ error: extracted.error }, { status: 400 });
  }

  const authorization = request.headers.get("authorization");

  if (!extracted.batch) {
    const result = await applyAuthorizedCimIntake({
      authorization,
      ...extracted.items[0],
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ...publicCimIntakeResult(result), deal: result.deal });
  }

  const batch = await applyAuthorizedCimIntakeBatch({
    authorization,
    items: extracted.items,
  });
  if (!batch.ok) {
    return NextResponse.json({ error: batch.error }, { status: batch.status });
  }

  return NextResponse.json({
    ok: true,
    applied: batch.applied,
    failed: batch.failed,
    results: batch.results.map((row) =>
      row.ok
        ? { index: row.index, ...publicCimIntakeResult(row) }
        : { index: row.index, ok: false, error: row.error, status: row.status },
    ),
  });
}
