import { NextResponse, type NextRequest } from "next/server";

import { ensureReady } from "@/lib/boot";
import { resolveMachineActor } from "@/lib/actors";
import { loadNextDealStats } from "@/lib/next/stats";

/**
 * Read-only deal counts for Dirk.
 * Same bearer as GET /api/next/dirk (FLOW_IMPORT_TOKEN via resolveMachineActor).
 *
 *   GET /api/next/stats
 */
export async function GET(request: NextRequest) {
  if (!resolveMachineActor(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  await ensureReady();
  const stats = await loadNextDealStats();
  return NextResponse.json({ ok: true, ...stats });
}
