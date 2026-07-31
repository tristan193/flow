import { NextResponse, type NextRequest } from "next/server";

import { ensureReady } from "@/lib/boot";
import { importTokenValid } from "@/lib/import-auth";
import { importSnapshot } from "@/lib/import";

/**
 * Machine endpoint for the Python pipeline.
 *
 * Authenticated with a bearer token rather than a session cookie, because the
 * caller is `pipeline/export_snapshot.py --post`, not a browser. Middleware lets
 * this path through for that reason.
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

  const result = await importSnapshot(payload, "pipeline", payload.sourceDb ?? "api");
  return NextResponse.json({ ok: true, ...result });
}
