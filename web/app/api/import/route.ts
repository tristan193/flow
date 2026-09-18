import { NextResponse, type NextRequest } from "next/server";

import { resolveMachineActor } from "@/lib/actors";
import { ensureReady } from "@/lib/boot";
import { importSnapshot } from "@/lib/import";

/**
 * Harvest snapshot → dealbook (`deals_next` + `deal_log`).
 *
 * Same path the Python pipeline already POSTs (`export_snapshot.py --post`).
 * Classic `deals` is not written. Bearer is PIPELINE_TOKEN or FLOW_IMPORT_TOKEN.
 */

export async function POST(request: NextRequest) {
  const actor = resolveMachineActor(request.headers.get("authorization"));
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  await ensureReady();

  const payload = await request.json().catch(() => null);
  if (!payload || !Array.isArray(payload.deals)) {
    return NextResponse.json({ error: "Expected a deals array." }, { status: 400 });
  }

  const result = await importSnapshot(
    payload,
    actor,
    String(payload.sourceDb ?? "harvest"),
  );
  return NextResponse.json({ ok: true, ...result });
}
