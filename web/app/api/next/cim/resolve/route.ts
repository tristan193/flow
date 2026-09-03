import { NextResponse, type NextRequest } from "next/server";

import { currentMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { importTokenValid } from "@/lib/import-auth";
import { resolveCimDriveLinks } from "@/lib/next/cim-drive-sync";

/**
 * Scan the live CIM Drive parent for `TLY-XXX Headline` folders and cache cim_url.
 * Bearer FLOW_IMPORT_TOKEN or member session.
 */
export async function POST(request: NextRequest) {
  await ensureReady();
  const sessionMember = await currentMember();
  if (!importTokenValid(request.headers.get("authorization")) && !sessionMember) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { dealNumber?: string } | null;
  const dealNumber = body?.dealNumber?.trim();
  const result = await resolveCimDriveLinks(dealNumber ? [dealNumber] : undefined);
  return NextResponse.json({ ok: !result.error, ...result });
}
