import { NextResponse, type NextRequest } from "next/server";

import { ensureReady } from "@/lib/boot";
import { importTokenValid } from "@/lib/import-auth";
import { importNextSnapshot } from "@/lib/next/import";

/**
 * Machine endpoint for the Next / Dirk loop.
 * Does not write to the live `deals` table or `/api/import`.
 *
 * Authenticated with FLOW_IMPORT_TOKEN (same bearer as live harvest).
 */

export async function POST(request: NextRequest) {
  if (!importTokenValid(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  await ensureReady();

  const payload = await request.json().catch(() => null);
  if (!payload || !Array.isArray(payload.deals)) {
    return NextResponse.json({ error: "Expected a deals array." }, { status: 400 });
  }

  const result = await importNextSnapshot(payload, "dirk", payload.sourceDb ?? "api");
  return NextResponse.json({ ok: true, ...result });
}
