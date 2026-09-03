import { NextResponse, type NextRequest } from "next/server";

import { ensureReady } from "@/lib/boot";
import { importTokenValid } from "@/lib/import-auth";
import {
  buildDirkFeed,
  listDirkClosed,
  listDirkFollowups,
  listDirkInbound,
  listDirkVerdicts,
} from "@/lib/next/dirk";

/**
 * Dirk poll surface for the Next loop.
 * Same bearer as POST /api/next/import (FLOW_IMPORT_TOKEN).
 *
 *   GET /api/next/dirk            full feed
 *   GET /api/next/dirk?section=inbound|verdicts|followups|closed
 */
export async function GET(request: NextRequest) {
  if (!importTokenValid(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  await ensureReady();

  const section = request.nextUrl.searchParams.get("section");
  if (section === "inbound") {
    return NextResponse.json({ ok: true, inbound: await listDirkInbound() });
  }
  if (section === "verdicts") {
    return NextResponse.json({ ok: true, verdicts: await listDirkVerdicts() });
  }
  if (section === "followups") {
    return NextResponse.json({ ok: true, followups: await listDirkFollowups() });
  }
  if (section === "closed") {
    return NextResponse.json({ ok: true, closed: await listDirkClosed() });
  }

  const feed = await buildDirkFeed();
  return NextResponse.json({ ok: true, ...feed });
}
