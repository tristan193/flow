import { NextResponse, type NextRequest } from "next/server";

import { ensureReady } from "@/lib/boot";
import { buildDirkFeed, listDirkFollowups, listDirkInbound, listDirkVerdicts } from "@/lib/dirk";
import { importTokenValid } from "@/lib/import-auth";

/**
 * Dirk poll surface — same bearer as POST /api/import (FLOW_IMPORT_TOKEN).
 *
 *   GET /api/dirk            full feed
 *   GET /api/dirk?section=inbound|verdicts|followups
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

  const feed = await buildDirkFeed();
  return NextResponse.json({ ok: true, ...feed });
}
