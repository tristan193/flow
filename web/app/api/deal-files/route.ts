import { NextResponse } from "next/server";

import { requireMember } from "@/lib/auth";
import { ensureReady } from "@/lib/boot";
import { getDeal, saveDealFile } from "@/lib/deals";

export const runtime = "nodejs";

const ALLOWED = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream",
]);

export async function POST(request: Request) {
  await ensureReady();
  const member = await requireMember();

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Expected multipart form." }, { status: 400 });
  }

  const dealId = Number(form.get("dealId"));
  const file = form.get("file");
  if (!Number.isInteger(dealId) || dealId <= 0) {
    return NextResponse.json({ error: "Invalid deal." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose a file." }, { status: 400 });
  }

  const deal = await getDeal(dealId);
  if (!deal) {
    return NextResponse.json({ error: "Deal not found." }, { status: 404 });
  }

  const contentType = file.type || "application/octet-stream";
  if (!ALLOWED.has(contentType) && !file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Upload a PDF or Word CIM." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const saved = await saveDealFile(dealId, member, {
      filename: file.name || "cim.pdf",
      contentType: contentType === "application/octet-stream" ? "application/pdf" : contentType,
      bytes,
    });
    return NextResponse.json({ ok: true, id: saved.id, url: saved.url, filename: file.name });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
