import { NextResponse, type NextRequest } from "next/server";

import { ensureReady } from "@/lib/boot";
import { query } from "@/lib/db";
import { importTokenValid } from "@/lib/import-auth";

/**
 * Selective deal wipe (or full flush).
 *
 * Auth: same bearer as /api/import.
 *
 * Full wipe:
 *   { "confirm": "FLUSH" }
 *
 * BizBuySell-only (or any provider substring):
 *   { "confirm": "PURGE", "match": "bizbuysell" }
 * Matches source / nickname / sub_source / ext_id / url (case-insensitive).
 */
export async function POST(request: NextRequest) {
  if (!importTokenValid(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const confirm = String(body?.confirm || "");
  await ensureReady();

  if (confirm === "FLUSH") {
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
    return NextResponse.json({ ok: true, mode: "flush", dealsRemaining: Number(count) });
  }

  if (confirm === "PURGE") {
    const match = String(body?.match || "").trim().toLowerCase();
    if (!match || match.length < 3) {
      return NextResponse.json(
        { error: 'Send JSON { "confirm": "PURGE", "match": "bizbuysell" }.' },
        { status: 400 },
      );
    }
    // Parameterized LIKE — never interpolate user text into SQL.
    const like = `%${match}%`;
    const deleted = await query<{ id: number }>(
      `DELETE FROM deals
       WHERE lower(coalesce(source,'')) LIKE $1
          OR lower(coalesce(nickname,'')) LIKE $1
          OR lower(coalesce(sub_source,'')) LIKE $1
          OR lower(ext_id) LIKE $1
          OR lower(coalesce(url,'')) LIKE $1
       RETURNING id`,
      [like],
    );
    const [{ count }] = await query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM deals",
    );
    return NextResponse.json({
      ok: true,
      mode: "purge",
      match,
      deleted: deleted.length,
      dealsRemaining: Number(count),
    });
  }

  return NextResponse.json(
    { error: 'Send JSON { "confirm": "FLUSH" } or { "confirm": "PURGE", "match": "…" }.' },
    { status: 400 },
  );
}
