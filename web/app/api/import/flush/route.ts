import { NextResponse, type NextRequest } from "next/server";

import { ensureReady } from "@/lib/boot";
import { query } from "@/lib/db";
import { importTokenValid } from "@/lib/import-auth";

/**
 * Wipe deal data so the next harvest can repopulate cleanly.
 *
 * Body must be { "confirm": "FLUSH" }. Auth: same bearer as /api/import.
 */
export async function POST(request: NextRequest) {
  if (!importTokenValid(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (body?.confirm !== "FLUSH") {
    return NextResponse.json(
      { error: 'Send JSON { "confirm": "FLUSH" } to proceed.' },
      { status: 400 },
    );
  }

  await ensureReady();

  await query(`
    TRUNCATE TABLE
      train_flags,
      verdicts,
      stage_events,
      notes,
      deals,
      import_runs,
      drive_files_seen
    RESTART IDENTITY CASCADE
  `);

  const [{ count }] = await query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM deals",
  );

  return NextResponse.json({ ok: true, dealsRemaining: Number(count) });
}
