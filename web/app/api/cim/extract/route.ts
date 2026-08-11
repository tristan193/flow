import { NextResponse } from "next/server";

import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { extractDealFromCim } from "@/lib/cim-extract";
import { MAX_CIM_BYTES } from "@/lib/deals";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED = new Set([
  "application/pdf",
  "application/octet-stream",
]);

export async function POST(request: Request) {
  await ensureReady();
  await requireMember();

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Expected multipart form." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Choose a CIM PDF." }, { status: 400 });
  }

  const contentType = file.type || "application/octet-stream";
  const name = file.name || "cim.pdf";
  if (!ALLOWED.has(contentType) && !name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Upload a PDF CIM." }, { status: 400 });
  }

  if (file.size > MAX_CIM_BYTES) {
    return NextResponse.json(
      { error: `File too large — max ${MAX_CIM_BYTES / (1024 * 1024)}MB.` },
      { status: 400 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const draft = await extractDealFromCim(bytes, name);
    return NextResponse.json({ ok: true, draft, filename: name });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read that CIM.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
