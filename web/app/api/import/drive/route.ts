import { NextResponse } from "next/server";

import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { syncDriveFolder } from "@/lib/drive";

/** Pulls any deal snapshots from the shared Drive folder that are not in yet. */
export async function POST() {
  await ensureReady();
  await requireMember();

  try {
    const result = await syncDriveFolder();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    // Drive misconfiguration is the common case here, and the message from the
    // Google client is usually the actionable part.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Drive sync failed." },
      { status: 400 },
    );
  }
}
