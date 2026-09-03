import { NextResponse, type NextRequest } from "next/server";

import { currentMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { importTokenValid } from "@/lib/import-auth";
import { findNextDealRef } from "@/lib/next/stage-auth";
import { ensureCimFolderForDeal, resolveCimDriveLinks } from "@/lib/next/cim-drive-sync";

/**
 * Dirk: create (or return) the Drive drop folder and viewUrl.
 * Created at Shortlist in the normal flow — this is the explicit / backfill path.
 * Legacy Simon-named folders (TLY-007 / 031 / 092) are matched, not recreated.
 *
 *   { "dealNumber": "TLY-014" }  → create `TLY-014 Headline`, save cimUrl, return viewUrl
 */
export async function POST(request: NextRequest) {
  await ensureReady();
  const sessionMember = await currentMember();
  if (!importTokenValid(request.headers.get("authorization")) && !sessionMember) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { dealNumber?: string; dealId?: number } | null;
  if (body?.dealNumber || body?.dealId != null) {
    const ref = await findNextDealRef({ dealId: body.dealId, dealNumber: body.dealNumber });
    if (!ref) return NextResponse.json({ error: "Deal not found." }, { status: 404 });
    const ensured = await ensureCimFolderForDeal(ref.id);
    return NextResponse.json({
      ok: ensured.ok,
      dealNumber: ref.dealNumber,
      viewUrl: ensured.viewUrl,
      folderId: ensured.folderId,
      folderTitle: ensured.folderTitle,
      created: ensured.created,
      matched: ensured.matched,
      error: ensured.error,
    });
  }

  const legacy = await resolveCimDriveLinks();
  return NextResponse.json({ ok: !legacy.error, legacy: true, ...legacy });
}
