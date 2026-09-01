import { NextResponse } from "next/server";

import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { getNextDealFile } from "@/lib/next/deals";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await ensureReady();
  await requireMember();

  const { id: raw } = await context.params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const file = await getNextDealFile(id);
  if (!file) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return new NextResponse(Buffer.from(file.bytes), {
    headers: {
      "Content-Type": file.content_type,
      "Content-Disposition": `inline; filename="${file.filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
